import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
  saveGameScore,
  pool,
  saveOrUpdateUser,
  generateAnonymousName
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config();
dotenv.config({ path: envPath });

const bot = new Bot(process.env.BOT_TOKEN || '');

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================

function getWindDirection(degrees) {
  if (degrees == null) return '—';
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
  let h = ssh - srh;
  let m = ssm - srm;
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

// ===================== ЛОГИКА ПОГОДЫ =====================

async function getDetailedWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,weather_code,cloud_cover,visibility,rain,snowfall&daily=sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(url);
    const wData = await wRes.json();
    const cur = wData.current;

    let msg = `📍 *${name}* — сейчас\n`;
    msg += `───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    msg += `📊 *Давление:* ${Math.round(cur.pressure_msl * 0.750062)} мм рт. ст.\n`;
    msg += `💧 *Влажность:* ${cur.relative_humidity_2m}%\n`;
    
    msg += `───────────────────\n`;
    msg += `🌅 Восход: ${wData.daily.sunrise[0].substring(11, 16)} | 🌇 Закат: ${wData.daily.sunset[0].substring(11, 16)}`;
    
    return { success: true, city: name, message: msg, feels_like: cur.apparent_temperature };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const startIdx = dayOffset * 24;
    const periods = [
      { n: '🌙 Ночь', i: startIdx + 3 },
      { n: '🌅 Утро', i: startIdx + 9 },
      { n: '☀️ День', i: startIdx + 15 },
      { n: '🌆 Вечер', i: startIdx + 21 }
    ];

    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    let msg = `📅 *Прогноз: ${name}*\n`;
    msg += `───────────────────\n`;

    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.i]);
      const desc = getWeatherDescription(data.hourly.weather_code[p.i]);
      msg += `*${p.n}:* ${t}°C, ${desc}\n`;
    });

    return { success: true, message: msg };
  } catch (e) { return { success: false, message: "❌ Ошибка получения прогноза." }; }
}

// ===================== СПРАВОЧНИК ФРАЗ =====================
const dailyPhrases = [
  { e: "Where is the nearest bus stop?", r: "Где ближайшая остановка?", c: "Транспорт" },
  { e: "How much is the fare?", r: "Сколько стоит проезд?", c: "Транспорт" },
  { e: "A table for two, please.", r: "Столик на двоих, пожалуйста.", c: "Еда" },
  { e: "Everything was delicious!", r: "Все было очень вкусно!", c: "Еда" },
  { e: "Can I try this on?", r: "Можно это примерить?", c: "Покупки" },
  { e: "Nice to meet you!", r: "Приятно познакомиться!", c: "Общение" },
  { e: "I'm lost, help me please.", r: "Я заблудился, помогите пожалуйста.", c: "Город" }
];

// ===================== КЛАВИАТУРЫ =====================
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

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  const anonName = generateAnonymousName(ctx.from.id);
  // В базу пишем только анонимный ник как основной ключ!
  await saveOrUpdateUser({ user_id: anonName, chat_id: ctx.chat.id, city: 'Не указан' });
  const welcome = `👋 *Привет!* Твой анонимный ник: *${anonName}*\n\n📍 *Выбери свой город:*`;
  await ctx.reply(welcome, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const anonName = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(anonName);
  if (!res.city || res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(w.message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 ПОГОДА СЕГОДНЯ', async (ctx) => {
  const anonName = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(anonName);
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
  const anonName = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(anonName);
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const anonName = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(anonName);
  const w = await getDetailedWeatherData(res.city);
  const t = Math.round(w.feels_like);
  let advice = `👕 В ${w.city} сейчас ощущается как ${t}°C.\n`;
  if (t >= 20) advice += "Надень футболку и шорты.";
  else if (t >= 10) advice += "Надень легкую куртку.";
  else advice += "Надень теплую куртку и шапку.";
  await ctx.reply(advice);
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  await ctx.reply(`🇬🇧 \`${p.e}\`\n🇷🇺 ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ ФРАЗА', async (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  await ctx.reply(`🎲 \`${p.e}\`\n🇷🇺 ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const anonName = generateAnonymousName(ctx.from.id);
  // Передаем ТОЛЬКО анонимный ник. Никаких реальных ID!
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(anonName)}`;
  
  await ctx.reply(`🎮 *Тетрис*\nТвой ник: *${anonName}*\n\nНажми кнопку ниже!`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '🎮 Открыть Тетрис', web_app: { url } }]]
    }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const anonName = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(anonName, city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const anonName = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.trim();
  try {
    const check = await getDetailedWeatherData(city);
    if (check.success) {
      await saveUserCity(anonName, check.city);
      await ctx.reply(`✅ Город *${check.city}* выбран!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
    } else { throw new Error(); }
  } catch (e) {
    ctx.reply('❌ Город не найден.', { reply_markup: cityKeyboard });
  }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      if (!bot.isInited()) await bot.init();
      await bot.handleUpdate(req.body);
    } catch (e) { console.error(e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).send('Bot is running');
}
