import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import { pool, generateAnonymousName } from './db.js';

dotenv.config();
const bot = new Bot(process.env.BOT_TOKEN || '');

// Помощник для работы с БД внутри бота
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
    
    let msg = `📍 *${name}* — сейчас\n`;
    msg += `───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C\n`;
    msg += `🤔 *Ощущается как:* ${Math.round(cur.apparent_temperature)}°C\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    
    return { success: true, city: name, message: msg };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== КЛАВИАТУРЫ =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('👕 ЧТО НАДЕТЬ?').row()
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
  
  // ВАЖНО: Мы больше не передаем tg_id в URL. 
  // Вместо этого мы передаем анонимный cloudName, чтобы игра знала, кто вошел.
  const gameUrl = `https://pogodasovet1.vercel.app/game?cloud_name=${encodeURIComponent(cloudName)}&city=${encodeURIComponent(city)}`;
  
  const startInlineKeyboard = new InlineKeyboard()
    .webApp('🎮 ИГРАТЬ В ТЕТРИС', gameUrl).row()
    .url('📢 Канал проекта', 'https://t.me/pogodasovet_news');

  let info = `👤 Твой анонимный ник: *${cloudName}*\n`;
  if (city !== 'Не указан') {
    info += `📍 Твой город: *${city}*`;
    await ctx.reply(info, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
    await ctx.reply('🚀 *Твой Тетрис готов!*', { reply_markup: startInlineKeyboard, parse_mode: 'Markdown' });
  } else {
    info += `\n👇 *Выбери свой город для начала:*`;
    await ctx.reply(info, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
  }
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const cloudName = generateAnonymousName(ctx.from.id);
  const city = await getBotUserCity(cloudName);
  if (city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(city);
  await ctx.reply(w.message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const cloudName = generateAnonymousName(ctx.from.id);
  const city = await getBotUserCity(cloudName);
  const gameUrl = `https://pogodasovet1.vercel.app/game?cloud_name=${encodeURIComponent(cloudName)}&city=${encodeURIComponent(city)}`;
  await ctx.reply(`🕹️ *Тетрис*\nТвой ник: *${cloudName}*`, { 
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
  } else { 
    ctx.reply('❌ Город не найден. Напиши правильно.', { reply_markup: cityKeyboard }); 
  }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { 
      if (!bot.isInited()) await bot.init(); 
      await bot.handleUpdate(req.body); 
    } catch (e) { console.error('Bot Error:', e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'bot is active' });
}
