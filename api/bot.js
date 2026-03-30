import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import { pool, getOrRegisterPin, saveUserCity, getUserCity } from './db.js';

dotenv.config();
const bot = new Bot(process.env.BOT_TOKEN || '');

const userPinCache = new Map();

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

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('🔑 МОЙ ПИН').resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row()
    .text('📍 СЕВАСТОПОЛЬ').row()
    .text('✏️ ДРУГОЙ ГОРОД').resized();

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  let pinData = userPinCache.get(ctx.from.id);
  if (!pinData) { pinData = await getOrRegisterPin(); userPinCache.set(ctx.from.id, pinData); }
  const gameUrl = `https://pogodasovet1.vercel.app/game?pin=${pinData.pin}`;
  const inline = new InlineKeyboard().webApp('🎮 ИГРАТЬ В ТЕТРИС', gameUrl);
  let msg = `👋 Привет, *${pinData.cloudName}*!\n🔑 Твой ПИН: \`${pinData.pin}\` (сохрани его)\n\n👇 Выбери город для прогноза:`;
  await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
  await ctx.reply('🕹️ *Тетрис готов:*', { reply_markup: inline, parse_mode: 'Markdown' });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const pinData = userPinCache.get(ctx.from.id);
  if (!pinData) return ctx.reply('Бот перезагрузился. Отправь свой ПИН-код (6 цифр) для входа.');
  const res = await getUserCity(pinData.cloudName);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(w.message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const pinData = userPinCache.get(ctx.from.id);
  if (!pinData) return ctx.reply('Отправь свой ПИН-код для входа.');
  const res = await getUserCity(pinData.cloudName);
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const pinData = userPinCache.get(ctx.from.id);
  if (!pinData) return ctx.reply('Отправь свой ПИН-код для входа.');
  const res = await getUserCity(pinData.cloudName);
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears(/^\d{6}$/, async (ctx) => {
  const pin = ctx.message.text;
  const { cloudName } = await getOrRegisterPin(pin);
  userPinCache.set(ctx.from.id, { pin, cloudName });
  await ctx.reply(`✅ Вход выполнен! Добро пожаловать, *${cloudName}*`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const pinData = userPinCache.get(ctx.from.id);
  if (!pinData) return ctx.reply('Нажми /start или введи ПИН.');
  const gameUrl = `https://pogodasovet1.vercel.app/game?pin=${pinData.pin}`;
  await ctx.reply(`🕹️ *Тетрис*\nНик: *${pinData.cloudName}*`, { 
    parse_mode: 'Markdown', 
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url: gameUrl } }]] } 
  });
});

bot.hears(/^📍 /, async (ctx) => {
  const pinData = userPinCache.get(ctx.from.id);
  if (!pinData) return ctx.reply('Сначала введи свой ПИН-код.');
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(pinData.cloudName, city);
  await ctx.reply(`✅ Город *${city}* установлен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/') || /^\d{6}$/.test(ctx.message.text)) return;
  const pinData = userPinCache.get(ctx.from.id);
  if (!pinData) return;
  const check = await getDetailedWeatherData(ctx.message.text.trim());
  if (check.success) {
    await saveUserCity(pinData.cloudName, check.city);
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
