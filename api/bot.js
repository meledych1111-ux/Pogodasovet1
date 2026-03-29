import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';
import crypto from 'crypto';

import {
  saveUserCity,
  getUserCity,
  generateAnonymousName
} from './db.js';

dotenv.config();
const bot = new Bot(process.env.BOT_TOKEN || '');

function generateAuthHash(id) {
    const secret = process.env.BOT_TOKEN || 'fallback_secret';
    return crypto.createHash('sha256').update(String(id) + secret).digest('hex').substring(0, 16);
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================
function getWindDirection(degrees) {
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

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,weather_code,cloud_cover,visibility&daily=sunrise,sunset,uv_index_max&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(url);
    const wData = await wRes.json();
    const cur = wData.current;

    let msg = `📍 *${name}* — сейчас\n`;
    msg += `───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C (ощущается как ${Math.round(cur.apparent_temperature)}°C)\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    if (cur.wind_gusts_10m > cur.wind_speed_10m + 2) msg += `🌪️ *Порывы:* ${cur.wind_gusts_10m.toFixed(1)} м/с\n`;
    msg += `📊 *Давление:* ${Math.round(cur.pressure_msl * 0.750062)} мм рт. ст.\n`;
    msg += `💧 *Влажность:* ${cur.relative_humidity_2m}%\n`;
    msg += `👁️ *Видимость:* ${(cur.visibility / 1000).toFixed(1)} км\n`;
    msg += `☀️ *УФ-индекс:* ${wData.daily.uv_index_max[0]}\n`;
    msg += `🌅 Восход: ${wData.daily.sunrise[0].substring(11, 16)} | 🌇 Закат: ${wData.daily.sunset[0].substring(11, 16)}`;
    
    return { success: true, city: name, message: msg, raw: cur, desc: getWeatherDescription(cur.weather_code) };
  } catch (e) { return { success: false, error: e.message }; }
}

function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Данные недоступны.';
  const t = w.raw.apparent_temperature;
  let adv = `👕 *Что надеть в ${w.city}?*\n🌡️ Ощущается как ${Math.round(t)}°C\n\n`;
  if (t >= 25) adv += "☀️ *Верх:* легкая футболка, майка\n🩳 *Низ:* шорты, легкая юбка\n👟 *Обувь:* сандалии, шлепанцы";
  else if (t >= 18) adv += "🌤️ *Верх:* футболка, рубашка\n👖 *Низ:* джинсы, легкие брюки\n👟 *Обувь:* кеды, кроссовки";
  else if (t >= 12) adv += "🌥️ *Верх:* лонгслив, рубашка + ветровка\n👖 *Низ:* джинсы\n👟 *Обувь:* кроссовки";
  else if (t >= 5) adv += "🧥 *Верх:* свитер + куртка\n👖 *Низ:* плотные джинсы\n🥾 *Обувь:* теплые ботинки";
  else if (t >= -5) adv += "🧣 *Верх:* термобелье + свитер + куртка\n🧣 *Аксессуары:* шапка, шарф, перчатки";
  else adv += "❄️ *Максимальное утепление:* термобелье, пуховик, варежки.";
  return adv;
}

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('👕 ЧТО НАДЕТЬ?').row()
    .text('💬 ФРАЗА ДНЯ').text('🎲 СЛУЧАЙНАЯ').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row()
    .text('📍 СЕВАСТОПОЛЬ').row()
    .text('✏️ ДРУГОЙ ГОРОД').resized();

bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  
  if (res.city !== 'Не указан') {
    let welcome = `👋 *Рад видеть тебя снова!* Твой ник: *${name}*\n📍 Город: *${res.city}*\n\nВыбирай нужную кнопку в меню! 👇`;
    await ctx.reply(welcome, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
  } else {
    let welcome = `👋 *Привет! Я твой помощник по погоде и английскому!*\n\nТвой анонимный ник: *${name}*\n\nЧтобы начать, выбери свой город: 👇`;
    await ctx.reply(welcome, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
  }
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(w.message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!');
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const id = ctx.from.id;
  const name = generateAnonymousName(id);
  const hash = generateAuthHash(id);
  const cityRes = await getUserCity(name);
  const url = `https://pogodasovet1.vercel.app/game?login=${encodeURIComponent(name)}&hash=${hash}&city=${encodeURIComponent(cityRes.city)}&tg_id=${id}`;
  await ctx.reply(`🕹️ *Тетрис*\nНик: *${name}*`, { 
    parse_mode: 'Markdown', 
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url } }]] } 
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город из списка:', { reply_markup: cityKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* успешно установлен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const name = generateAnonymousName(ctx.from.id);
  const check = await getDetailedWeatherData(ctx.message.text.trim());
  if (check.success) {
    await saveUserCity(name, check.city);
    await ctx.reply(`✅ Город *${check.city}* выбран!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } else { ctx.reply('❌ Город не найден. Напиши правильно.', { reply_markup: cityKeyboard }); }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { if (!bot.isInited()) await bot.init(); await bot.handleUpdate(req.body); } catch (e) { console.error(e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'running' });
}
