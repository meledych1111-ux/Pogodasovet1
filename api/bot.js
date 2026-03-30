import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import { pool, getOrRegisterPin, saveUserCity, getUserCity } from './db.js';

dotenv.config();
const bot = new Bot(process.env.BOT_TOKEN || '');

// Память только для текущей сессии сервера (анонимно)
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
    msg += `💧 *Влажность:* ${cur.relative_humidity_2m}%\n`;
    msg += `☁️ *Облачность:* ${getCloudDescription(cur.cloud_cover)} (${cur.cloud_cover}%)\n`;
    msg += `👁️ *Видимость:* ${(cur.visibility / 1000).toFixed(1)} км\n`;
    msg += `☀️ *УФ-индекс:* ${daily.uv_index_max[0]}\n───────────────────\n`;
    if (cur.rain > 0) msg += `🌧️ *Дождь:* ${cur.rain} мм\n`;
    if (cur.snowfall > 0) msg += `❄️ *Снег:* ${cur.snowfall} см\n`;
    msg += `🌅 Восход: ${sunrise} | 🌇 Закат: ${sunset}\n`;
    msg += `⏱ Длина дня: ${calculateDayLength(sunrise, sunset)}`;
    
    return { success: true, city: name, message: msg, feels_like: cur.apparent_temperature, description: getWeatherDescription(cur.weather_code), has_rain: cur.rain > 0, wind_speed: cur.wind_speed_10m };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const start = dayOffset * 24;
    const periods = [{ n: '🌙 Ночь', i: start + 3, e: '🌙' }, { n: '🌅 Утро', i: start + 9, e: '🌅' }, { n: '☀️ День', i: start + 15, e: '☀️' }, { n: '🌆 Вечер', i: start + 21, e: '🌆' }];

    const date = new Date(); date.setDate(date.getDate() + dayOffset);
    let msg = `📅 *Прогноз: ${name}* (${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })})\n───────────────────\n`;
    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.i]);
      const f = Math.round(data.hourly.apparent_temperature[p.i]);
      const pr = data.hourly.precipitation_probability[p.i];
      msg += `${p.e} *${p.n}:* ${t}°C (ощ. ${f}°C) | ${getWeatherDescription(data.hourly.weather_code[p.i])}${pr > 5 ? ` | ☔️ ${pr}%` : ''}\n`;
    });
    return { success: true, message: msg };
  } catch (e) { return { success: false, message: "❌ Ошибка прогноза." }; }
}

function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Данные недоступны.';
  const t = w.feels_like;
  let advice = `👕 *Что надеть в ${w.city}?*\n🌡️ Ощущается как ${Math.round(t)}°C\n📝 ${w.description}\n\n📋 *Рекомендации по слоям:*\n`;
  if (t >= 25) advice += "☀️ Футболка, шорты, сандалии.";
  else if (t >= 12) advice += "🌥️ Лонгслив + легкая ветровка, джинсы.";
  else if (t >= 5) advice += "🧥 Свитер + демисезонная куртка, ботинки.";
  else advice += "❄️ Плотное термобелье + пуховик, шапка, шарф.";
  return advice;
}

const dailyPhrases = [
  { e: "Where is the nearest bus stop?", r: "Где ближайшая остановка?", c: "Транспорт" },
  { e: "How much is the fare?", r: "Сколько стоит проезд?", c: "Транспорт" },
  { e: "A table for two, please.", r: "Столик на двоих, пожалуйста.", c: "Еда" },
  { e: "Nice to meet you!", r: "Приятно познакомиться!", c: "Общение" },
  { e: "Everything was delicious, thank you!", r: "Все было очень вкусно, спасибо!", c: "Еда" },
  { e: "Can I pay by card?", r: "Можно оплатить картой?", c: "Покупки" },
  { e: "It's too expensive.", r: "Это слишком дорого.", c: "Покупки" },
  { e: "I'm lost, help me please.", r: "Я заблудился, помогите пожалуйста.", c: "Город" }
];

// ===================== КЛАВИАТУРЫ =====================
const mainMenuKeyboard = new Keyboard().text('🌤️ ПОГОДА СЕЙЧАС').row().text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row().text('👕 ЧТО НАДЕТЬ?').row().text('💬 ФРАЗА ДНЯ').text('🎲 СЛУЧАЙНАЯ').row().text('🎮 ИГРАТЬ В ТЕТРИС').row().text('🏙️ СМЕНИТЬ ГОРОД').text('🔑 МОЙ ПИН').resized();
const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('📍 СЕВАСТОПОЛЬ').row().text('✏️ ДРУГОЙ ГОРОД').resized();
const startKeyboard = new InlineKeyboard().text('🆕 НОВЫЙ ПРОФИЛЬ', 'new').text('🔑 ВОЙТИ ПО ПИНУ', 'login');

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  await ctx.reply(`👋 Привет! Я твой анонимный помощник.\n\nВыбери действие:`, { reply_markup: startKeyboard });
});

bot.callbackQuery('new', async (ctx) => {
  const { pin, cloudName } = await getOrRegisterPin(); // Генерирует случайный ПИН в db.js
  botMemory.set(ctx.from.id, { pin, cloudName });
  await ctx.reply(`✅ Создан профиль: *${cloudName}*\n🔑 Твой ПИН: \`${pin}\` (сохрани его!)\n\nТеперь выбери город:`, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
});

bot.callbackQuery('login', (ctx) => ctx.reply('Отправь мне свой ПИН-код (6 цифр):'));

bot.hears(/^\d{6}$/, async (ctx) => {
  const { pin, cloudName } = await getOrRegisterPin(ctx.message.text);
  botMemory.set(ctx.from.id, { pin, cloudName });
  await ctx.reply(`✅ Вход выполнен: *${cloudName}*`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const user = botMemory.get(ctx.from.id);
  if (!user) return ctx.reply('Сначала войди или создай профиль /start');
  const res = await getUserCity(user.cloudName);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(w.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const user = botMemory.get(ctx.from.id);
  if (!user) return ctx.reply('Нажми /start');
  const res = await getUserCity(user.cloudName);
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const user = botMemory.get(ctx.from.id);
  if (!user) return ctx.reply('Нажми /start');
  const res = await getUserCity(user.cloudName);
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const user = botMemory.get(ctx.from.id);
  if (!user) return ctx.reply('Нажми /start');
  const res = await getUserCity(user.cloudName);
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 \`${p.e}\`\n🇷🇺 ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ', (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  ctx.reply(`🎲 \`${p.e}\` — ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const user = botMemory.get(ctx.from.id);
  if (!user) return ctx.reply('Нажми /start');
  const gameUrl = `https://pogodasovet1.vercel.app/game?pin=${user.pin}`;
  await ctx.reply(`🕹️ *Тетрис*\nНик: *${user.cloudName}*`, { 
    parse_mode: 'Markdown', 
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url: gameUrl } }]] } 
  });
});

bot.hears(/^📍 /, async (ctx) => {
  const user = botMemory.get(ctx.from.id);
  if (!user) return ctx.reply('Нажми /start');
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(user.cloudName, city);
  await ctx.reply(`✅ Город *${city}* установлен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));

bot.hears('🔑 МОЙ ПИН', async (ctx) => {
  const user = botMemory.get(ctx.from.id);
  if (!user) return ctx.reply('Нажми /start');
  await ctx.reply(`Твой ПИН: \`${user.pin}\``);
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/') || /^\d{6}$/.test(ctx.message.text)) return;
  const user = botMemory.get(ctx.from.id);
  if (!user) return;
  const check = await getDetailedWeatherData(ctx.message.text.trim());
  if (check.success) {
    await saveUserCity(user.cloudName, check.city);
    await ctx.reply(`✅ Город *${check.city}* выбран!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { if (!bot.isInited()) await bot.init(); await bot.handleUpdate(req.body); } catch (e) { console.error(e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'active' });
}
