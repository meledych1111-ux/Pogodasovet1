import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import { pool, generateAnonymousName } from './db.js';

dotenv.config();
const bot = new Bot(process.env.BOT_TOKEN || '');

// Помощники для работы с БД (анонимно)
async function getBotUserCity(cloudName) {
    const res = await pool.query('SELECT city FROM users_cloud WHERE cloud_name = $1', [cloudName]);
    return res.rows[0]?.city || 'Не указан';
}

async function saveBotUserCity(cloudName, city) {
    await pool.query(
        `INSERT INTO users_cloud (cloud_name, city, last_active) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (cloud_name) DO UPDATE SET city = $2, last_active = NOW()`,
        [cloudName, city]
    );
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================
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

    let msg = `📍 *${name}* — сейчас\n`;
    msg += `───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C\n`;
    msg += `🤔 *Ощущается как:* ${Math.round(cur.apparent_temperature)}°C\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n`;
    msg += `───────────────────\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    msg += `📊 *Давление:* ${Math.round(cur.pressure_msl * 0.750062)} мм рт. ст.\n`;
    msg += `☀️ *УФ-индекс:* ${daily.uv_index_max[0]}\n`;
    msg += `🌅 Восход: ${sunrise} | 🌇 Закат: ${sunset}\n`;
    msg += `⏱ Длина дня: ${calculateDayLength(sunrise, sunset)}`;
    
    return { 
      success: true, 
      city: name, 
      message: msg, 
      temp: cur.temperature_2m,
      feels_like: cur.apparent_temperature,
      description: getWeatherDescription(cur.weather_code),
      has_rain: cur.rain > 0,
      has_snow: cur.snowfall > 0,
      wind_speed: cur.wind_speed_10m
    };
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
    const periods = [{ n: '🌅 Утро', i: start + 9, e: '🌅' }, { n: '☀️ День', i: start + 15, e: '☀️' }, { n: '🌆 Вечер', i: start + 21, e: '🌆' }];

    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    let msg = `📅 *Прогноз: ${name}* (${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })})\n`;
    msg += `───────────────────\n`;
    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.i]);
      msg += `${p.e} *${p.n}:* ${t}°C, ${getWeatherDescription(data.hourly.weather_code[p.i])}\n`;
    });
    return { success: true, message: msg };
  } catch (e) { return { success: false, message: "❌ Ошибка прогноза." }; }
}

function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Данные недоступны.';
  const t = w.feels_like;
  let advice = `👕 *Что надеть в ${w.city}?*\n🌡️ Ощущается как ${Math.round(t)}°C\n\n`;
  if (t >= 20) advice += "☀️ Легкая одежда, футболка, шорты.";
  else if (t >= 10) advice += "🌥️ Легкая куртка или ветровка.";
  else if (t >= 0) advice += "🧥 Пальто или теплая куртка.";
  else advice += "❄️ Очень холодно! Надевайте пуховик, шапку и шарф.";
  return advice;
}

const dailyPhrases = [
  { e: "Where is the nearest bus stop?", r: "Где ближайшая остановка?", c: "Транспорт" },
  { e: "How much does this cost?", r: "Сколько это стоит?", c: "Покупки" },
  { e: "Everything was delicious, thank you!", r: "Все было очень вкусно, спасибо!", c: "Еда" },
  { e: "Nice to meet you!", r: "Приятно познакомиться!", c: "Общение" }
];

// ===================== КЛАВИАТУРЫ =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').row()
    .text('💬 ФРАЗА ДНЯ').text('🎲 СЛУЧАЙНАЯ').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row()
    .text('📍 СЕВАСТОПОЛЬ').row()
    .text('✏️ ДРУГОЙ ГОРОД').resized();

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  const cloudName = generateAnonymousName(ctx.from.id);
  const city = await getBotUserCity(cloudName);
  const gameUrl = `https://pogodasovet1.vercel.app/game?cloud_name=${encodeURIComponent(cloudName)}&city=${encodeURIComponent(city)}`;
  
  const startInlineKeyboard = new InlineKeyboard()
    .webApp('🎮 ИГРАТЬ В ТЕТРИС', gameUrl).row()
    .url('📢 Канал проекта', 'https://t.me/pogodasovet_news');

  let info = `👤 Ник: *${cloudName}*\n`;
  if (city !== 'Не указан') {
    info += `📍 Город: *${city}*`;
    await ctx.reply(info, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
    await ctx.reply('🚀 *Твой Тетрис готов!*', { reply_markup: startInlineKeyboard, parse_mode: 'Markdown' });
  } else {
    info += `\n👇 *Выбери город:*`;
    await ctx.reply(info, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
  }
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const cloudName = generateAnonymousName(ctx.from.id);
  const city = await getBotUserCity(cloudName);
  if (city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(city);
  await ctx.reply(w.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const cloudName = generateAnonymousName(ctx.from.id);
  const city = await getBotUserCity(cloudName);
  const f = await getDetailedForecast(city, 0);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const cloudName = generateAnonymousName(ctx.from.id);
  const city = await getBotUserCity(cloudName);
  const f = await getDetailedForecast(city, 1);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const cloudName = generateAnonymousName(ctx.from.id);
  const city = await getBotUserCity(cloudName);
  const w = await getDetailedWeatherData(city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  await ctx.reply(`💬 \`${p.e}\`\n🇷🇺 ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ', async (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  await ctx.reply(`🎲 \`${p.e}\` — ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const cloudName = generateAnonymousName(ctx.from.id);
  const city = await getBotUserCity(cloudName);
  const gameUrl = `https://pogodasovet1.vercel.app/game?cloud_name=${encodeURIComponent(cloudName)}&city=${encodeURIComponent(city)}`;
  await ctx.reply(`🕹️ *Тетрис*\nНик: *${cloudName}*`, { 
    parse_mode: 'Markdown', 
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url: gameUrl } }]] } 
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город из списка:', { reply_markup: cityKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const cloudName = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveBotUserCity(cloudName, city);
  await ctx.reply(`✅ Город *${city}* успешно установлен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const cloudName = generateAnonymousName(ctx.from.id);
  const check = await getDetailedWeatherData(ctx.message.text.trim());
  if (check.success) {
    await saveBotUserCity(cloudName, check.city);
    await ctx.reply(`✅ Город *${check.city}* выбран!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } else { ctx.reply('❌ Город не найден.', { reply_markup: cityKeyboard }); }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { if (!bot.isInited()) await bot.init(); await bot.handleUpdate(req.body); } catch (e) { console.error(e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'active' });
}
