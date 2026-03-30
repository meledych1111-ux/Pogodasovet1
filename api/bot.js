import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import { pool, getOrRegisterPin, saveUserCity, getUserCity } from './db.js';

dotenv.config();
const bot = new Bot(process.env.BOT_TOKEN || '');

// Память сессий в рамках жизни сервера
const botMemory = new Map();

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОГОДЫ =====================
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['С ⬆️', 'СВ ↗️', 'В ➡️', 'ЮВ ↘️', 'Ю ⬇️', 'ЮЗ ↙️', 'З ⬅️', 'СЗ ↖️'];
  return directions[Math.round(degrees / 45) % 8];
}

function getCloudDescription(cloudPercent) {
  if (cloudPercent < 10) return 'Ясно ☀️';
  if (cloudPercent < 30) return 'Малооблачно 🌤️';
  if (cloudPercent < 50) return 'Переменная облачность ⛅';
  if (cloudPercent < 85) return 'Облачно ☁️';
  return 'Пасмурно ☁️';
}

function calculateDayLength(sunrise, sunset) {
  if (!sunrise || !sunset) return '—';
  const [srh, srm] = sunrise.split(':').map(Number);
  const [ssh, ssm] = sunset.split(':').map(Number);
  let h = ssh - srh; let m = ssm - srm;
  if (m < 0) { h--; m += 60; }
  return `${h} ч ${m} мин`;
}

function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 53: 'Морось 🌧️', 55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌧️', 63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️', 73: 'Снег ❄️', 75: 'Сильный снег ❄️',
    80: 'Ливень 🌧️', 81: 'Сильный ливень 🌧️', 95: 'Гроза ⛈️'
  };
  return weatherMap[code] || `Код: ${code}`;
}

async function getDetailedWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,weather_code,cloud_cover,visibility,rain,snowfall&daily=sunrise,sunset,uv_index_max&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(url);
    const wData = await wRes.json();
    const cur = wData.current;
    const daily = wData.daily;

    const sunrise = daily.sunrise[0].substring(11, 16);
    const sunset = daily.sunset[0].substring(11, 16);

    let msg = `📍 *${name}* — сейчас\n───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C\n`;
    msg += `🤔 *Ощущается как:* ${Math.round(cur.apparent_temperature)}°C\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n───────────────────\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    if (cur.wind_gusts_10m > cur.wind_speed_10m + 2) msg += `🌪️ *Порывы:* ${cur.wind_gusts_10m.toFixed(1)} м/с\n`;
    msg += `📊 *Давление:* ${Math.round(cur.pressure_msl * 0.750062)} мм рт. ст.\n`;
    msg += `☀️ *УФ-индекс:* ${daily.uv_index_max[0]}\n───────────────────\n`;
    msg += `🌅 Восход: ${sunrise} | 🌇 Закат: ${sunset}\n⏱ Длина дня: ${calculateDayLength(sunrise, sunset)}`;
    
    return { success: true, city: name, message: msg, feels_like: cur.apparent_temperature };
  } catch (e) { return { success: false, error: e.message }; }
}

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('🔑 МОЙ ПИН').resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row()
    .text('📍 СЕВАСТОПОЛЬ').row()
    .text('✏️ ДРУГОЙ ГОРОД').resized();

const welcomeKeyboard = new InlineKeyboard()
    .text('🆕 Создать новый профиль', 'new_profile').row()
    .text('🔑 Войти по ПИН-коду', 'login_pin');

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  await ctx.reply(`👋 Привет! Я твой анонимный помощник.\n\nВыбери действие:`, { reply_markup: welcomeKeyboard });
});

bot.callbackQuery('new_profile', async (ctx) => {
  const { pin, cloudName } = await getOrRegisterPin();
  botMemory.set(ctx.from.id, { pin, cloudName });
  
  let msg = `✅ Создан профиль: *${cloudName}*\n🔑 Твой ПИН-код: \`${pin}\` (ОБЯЗАТЕЛЬНО СОХРАНИ!)\n\nТеперь выбери свой город:`;
  await ctx.editMessageText(msg, { parse_mode: 'Markdown' });
  await ctx.reply('Выбор города:', { reply_markup: cityKeyboard });
});

bot.callbackQuery('login_pin', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('Отправь мне свой ПИН-код (6 цифр) для входа:');
});

bot.hears(/^\d{6}$/, async (ctx) => {
  const pin = ctx.message.text;
  const { cloudName } = await getOrRegisterPin(pin);
  botMemory.set(ctx.from.id, { pin, cloudName });
  
  await ctx.reply(`✅ Вход выполнен! Добро пожаловать, *${cloudName}*`, { 
    parse_mode: 'Markdown', 
    reply_markup: mainMenuKeyboard 
  });
});

bot.hears('🔑 МОЙ ПИН', async (ctx) => {
  const data = botMemory.get(ctx.from.id);
  if (!data) return ctx.reply('Я тебя не узнал. Нажми /start');
  await ctx.reply(`Твой ПИН-код: \`${data.pin}\``, { parse_mode: 'Markdown' });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const data = botMemory.get(ctx.from.id);
  if (!data) return ctx.reply('Сессия истекла. Нажми /start или введи свой ПИН.');
  const res = await getUserCity(data.cloudName);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(w.message, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const data = botMemory.get(ctx.from.id);
  if (!data) return ctx.reply('Сначала войди! Нажми /start или введи ПИН.');
  const gameUrl = `https://pogodasovet1.vercel.app/game?pin=${data.pin}`;
  await ctx.reply(`🕹️ *Тетрис*\nНик: *${data.cloudName}*`, { 
    parse_mode: 'Markdown', 
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url: gameUrl } }]] } 
  });
});

bot.hears(/^📍 /, async (ctx) => {
  const data = botMemory.get(ctx.from.id);
  if (!data) return ctx.reply('Бот перезапустился. Пожалуйста, введи свой ПИН-код (6 цифр) или нажми /start для нового профиля.');
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(data.cloudName, city);
  await ctx.reply(`✅ Город *${city}* установлен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { if (!bot.isInited()) await bot.init(); await bot.handleUpdate(req.body); } catch (e) { console.error(e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'active' });
}
