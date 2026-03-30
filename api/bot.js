import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import { pool, getOrRegisterPin, saveUserCity, getUserCity } from './db.js';

dotenv.config();
const bot = new Bot(process.env.BOT_TOKEN || '');

// ===================== ПОМОЩНИКИ =====================
// Эта функция позволяет боту "узнать" ПИН пользователя по его Telegram ID,
// но при этом МЫ НЕ ХРАНИМ ТЕЛЕГРАМ ID В БАЗЕ ДАННЫХ.
// Мы используем его только как временный ключ для поиска ПИНа в памяти сессии.
const sessionPinMap = new Map();

async function getPinForUser(ctx) {
    if (sessionPinMap.has(ctx.from.id)) {
        return sessionPinMap.get(ctx.from.id);
    }
    return null;
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОГОДЫ =====================
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['С ⬆️', 'СВ ↗️', 'В ➡️', 'ЮВ ↘️', 'Ю ⬇️', 'ЮЗ ↙️', 'З ⬅️', 'СЗ ↖️'];
  return directions[Math.round(degrees / 45) % 8];
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
    
    let msg = `📍 *${name}* — сейчас\n───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C\n`;
    msg += `🤔 *Ощущается как:* ${Math.round(cur.apparent_temperature)}°C\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n───────────────────\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    msg += `📊 *Давление:* ${Math.round(cur.pressure_msl * 0.750062)} мм рт. ст.\n`;
    msg += `☀️ *УФ-индекс:* ${wData.daily.uv_index_max[0]}\n`;
    
    return { success: true, message: msg };
  } catch (e) { return { success: false, error: e.message }; }
}

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('🔑 МОЙ ПИН').resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row()
    .text('📍 СЕВАСТОПОЛЬ').row()
    .text('✏️ ДРУГОЙ ГОРОД').resized();

const welcomeKeyboard = new InlineKeyboard()
    .text('🆕 Новый профиль', 'new_profile').row()
    .text('🔑 Войти по ПИНу', 'login_pin');

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  await ctx.reply(`👋 Привет! Я твой анонимный помощник.\n\nЧтобы я тебя запомнил, создай новый профиль или введи свой ПИН:`, { reply_markup: welcomeKeyboard });
});

bot.callbackQuery('new_profile', async (ctx) => {
  const { pin, cloudName } = await getOrRegisterPin();
  sessionPinMap.set(ctx.from.id, { pin, cloudName });
  await ctx.answerCallbackQuery();
  await ctx.reply(`✅ Создан профиль: *${cloudName}*\n🔑 Твой ПИН-код: \`${pin}\` (сохрани его!)\n\nТеперь выбери свой город:`, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
});

bot.callbackQuery('login_pin', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('Отправь мне свой ПИН-код (6 цифр) для входа:');
});

bot.hears(/^\d{6}$/, async (ctx) => {
  const pin = ctx.message.text;
  try {
    const { cloudName } = await getOrRegisterPin(pin);
    sessionPinMap.set(ctx.from.id, { pin, cloudName });
    await ctx.reply(`✅ Вход выполнен! Добро пожаловать, *${cloudName}*`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
  } catch (e) { await ctx.reply('❌ Ошибка. Проверь ПИН.'); }
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const user = sessionPinMap.get(ctx.from.id);
  if (!user) return ctx.reply('Сначала войди! Нажми /start или введи ПИН.');
  const res = await getUserCity(user.cloudName);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(w.message, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const user = sessionPinMap.get(ctx.from.id);
  if (!user) return ctx.reply('Сначала войди! Нажми /start или введи ПИН.');
  const gameUrl = `https://pogodasovet1.vercel.app/game?pin=${user.pin}`;
  await ctx.reply(`🕹️ *Тетрис*\nНик: *${user.cloudName}*`, { 
    parse_mode: 'Markdown', 
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url: gameUrl } }]] } 
  });
});

bot.hears(/^📍 /, async (ctx) => {
  const user = sessionPinMap.get(ctx.from.id);
  if (!user) return ctx.reply('Нажми /start!');
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(user.cloudName, city);
  await ctx.reply(`✅ Город *${city}* установлен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('🔑 МОЙ ПИН', async (ctx) => {
  const user = sessionPinMap.get(ctx.from.id);
  if (!user) return ctx.reply('Нажми /start!');
  await ctx.reply(`Твой ПИН-код: \`${user.pin}\``, { parse_mode: 'Markdown' });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { 
      if (!bot.isInited()) await bot.init(); 
      await bot.handleUpdate(req.body); 
    } catch (e) { console.error('Bot Error:', e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'active' });
}
