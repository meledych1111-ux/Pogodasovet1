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

// --- ПОЛНАЯ ПОГОДНАЯ ЛОГИКА ---
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

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,weather_code,cloud_cover,visibility,rain,snowfall&daily=sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(url);
    const wData = await wRes.json();
    const cur = wData.current;
    
    let msg = `📍 *${name}* — сейчас\n`;
    msg += `───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C\n`;
    msg += `🤔 *Ощущается как:* ${Math.round(cur.apparent_temperature)}°C\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    msg += `📊 *Давление:* ${Math.round(cur.pressure_msl * 0.750062)} мм рт. ст.\n`;
    msg += `💧 *Влажность:* ${cur.relative_humidity_2m}%\n`;
    msg += `☁️ *Облачность:* ${getCloudDescription(cur.cloud_cover)}\n`;
    msg += `👁️ *Видимость:* ${(cur.visibility / 1000).toFixed(1)} км\n`;
    msg += `🌅 Восход: ${wData.daily.sunrise[0].substring(11, 16)} | 🌇 Закат: ${wData.daily.sunset[0].substring(11, 16)}`;
    
    return { success: true, city: name, message: msg, raw: cur };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    const { latitude, longitude, name } = geoData.results[0];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();
    
    let msg = `📅 *Прогноз: ${name}* (${dayOffset === 0 ? 'Сегодня' : 'Завтра'})\n`;
    msg += `───────────────────\n`;
    msg += `🌡️ От ${Math.round(data.daily.temperature_2m_min[dayOffset])}° до ${Math.round(data.daily.temperature_2m_max[dayOffset])}°C\n`;
    msg += `📝 ${getWeatherDescription(data.daily.weather_code[dayOffset])}\n`;
    msg += `🌅 Восход: ${data.daily.sunrise[dayOffset].substring(11, 16)} | 🌇 Закат: ${data.daily.sunset[dayOffset].substring(11, 16)}`;
    return { success: true, message: msg };
  } catch (e) { return { success: false, message: "Ошибка прогноза" }; }
}

function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Данные недоступны.';
  const t = w.raw.apparent_temperature;
  let adv = `👕 *Что надеть в ${w.city}?*\n🌡️ Ощущается как ${Math.round(t)}°C\n\n`;
  if (t >= 25) adv += "☀️ Футболка, шорты и кепка. Пейте больше воды!";
  else if (t >= 18) adv += "🌤️ Футболка или легкая рубашка, джинсы.";
  else if (t >= 12) adv += "🌥️ Легкая куртка, ветровка или плотный худи.";
  else if (t >= 5) adv += "🧥 Демисезонная куртка, шарф и ботинки.";
  else if (t >= -5) adv += "🧣 Зимняя куртка, шапка, перчатки.";
  else adv += "❄️ Очень холодно! Термобелье, теплый пуховик и шерстяные носки.";
  return adv;
}

const dailyPhrases = [
  { e: "Where is the nearest bus stop?", r: "Где ближайшая остановка?", c: "Транспорт" },
  { e: "Can I have the bill, please?", r: "Можно счет, пожалуйста?", c: "Еда" },
  { e: "How much does this cost?", r: "Сколько это стоит?", c: "Покупки" },
  { e: "Everything was delicious, thank you!", r: "Все было очень вкусно, спасибо!", c: "Еда" },
  { e: "Could you repeat that, please?", r: "Не могли бы вы повторить?", c: "Общение" }
];

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 ПОГОДА СЕГОДНЯ').text('📅 ПОГОДА ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').row()
    .text('💬 ФРАЗА ДНЯ').text('🎲 СЛУЧАЙНАЯ ФРАЗА').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row()
    .text('📍 СЕВАСТОПОЛЬ').row()
    .text('✏️ ДРУГОЙ ГОРОД').resized();

bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await ctx.reply(`👋 *Привет!* Твой ник: *${name}*\n\nЯ твой анонимный помощник. Никаких ID в базе.\n\n📍 *Выбери город:*`, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(w.message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 ПОГОДА СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  await ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 \`${p.e}\`\n🇷🇺 ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ ФРАЗА', async (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  await ctx.reply(`🎲 \`${p.e}\` — ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const id = ctx.from.id;
  const name = generateAnonymousName(id);
  const hash = generateAuthHash(id);
  const cityRes = await getUserCity(name);
  const url = `https://pogodasovet1.vercel.app?login=${encodeURIComponent(name)}&hash=${hash}&city=${encodeURIComponent(cityRes.city)}&tg_id=${id}`;
  await ctx.reply(`🕹️ *Тетрис*\nНик: *${name}*`, { 
    parse_mode: 'Markdown', 
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url } }]] } 
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const name = generateAnonymousName(ctx.from.id);
  const check = await getDetailedWeatherData(ctx.message.text.trim());
  if (check.success) {
    await saveUserCity(name, check.city);
    await ctx.reply(`✅ Город *${check.city}* выбран!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } else { ctx.reply('❌ Город не найден.', { reply_markup: cityKeyboard }); }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { if (!bot.isInited()) await bot.init(); await bot.handleUpdate(req.body); } catch (e) { console.error(e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'running' });
}
