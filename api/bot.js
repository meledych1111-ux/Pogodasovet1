import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
  saveOrUpdateUser,
  generateAnonymousName
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config();
dotenv.config({ path: envPath });

const bot = new Bot(process.env.BOT_TOKEN || 'dummy');

/**
 * Генерация проверочного хэша для входа без ПИН-кода
 */
function generateAuthHash(name) {
  const secret = process.env.BOT_TOKEN || 'fallback_secret';
  return crypto.createHash('sha256').update(name + secret).digest('hex').substring(0, 16);
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================
const weatherCache = new Map();

function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['северный', 'северо-восточный', 'восточный', 'юго-восточный', 'южный', 'юго-западный', 'западный', 'северо-западный'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно, чистое небо ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 53: 'Морось 🌧️', 55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌧️', 63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️', 71: 'Небольшой снег ❄️',
    73: 'Снег ❄️', 75: 'Сильный снег ❄️', 80: 'Небольшой ливень 🌧️', 81: 'Ливень 🌧️', 82: 'Сильный ливень 🌧️',
    85: 'Небольшой снегопад ❄️', 86: 'Сильный снегопад ❄️', 95: 'Гроза ⛈️', 96: 'Гроза с градом ⛈️', 99: 'Сильная гроза с градом ⛈️'
  };
  return weatherMap[code] || `Код: ${code}`;
}

async function getWeatherData(cityName) {
  try {
    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.[0]) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(weatherUrl);
    const wData = await wRes.json();
    
    return {
      success: true, city: name,
      temp: Math.round(wData.current.temperature_2m),
      feels_like: Math.round(wData.current.apparent_temperature),
      humidity: wData.current.relative_humidity_2m,
      wind_speed: wData.current.wind_speed_10m.toFixed(1),
      description: getWeatherDescription(wData.current.weather_code)
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.[0]) throw new Error('Город не найден');

    const { latitude, longitude, name } = geoData.results[0];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,uv_index_max&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const dateStr = targetDate.toISOString().split('T')[0];

    const dayMax = Math.round(data.daily.temperature_2m_max[dayOffset]);
    const dayMin = Math.round(data.daily.temperature_2m_min[dayOffset]);
    const dayDesc = getWeatherDescription(data.daily.weather_code[dayOffset]);

    let output = `📊 *Прогноз:* ${dayMin}°...${dayMax}°C, ${dayDesc}\n\n`;
    const periods = [{n:'Ночь',h:[0,3]}, {n:'Утро',h:[6,9]}, {n:'День',h:[12,15]}, {n:'Вечер',h:[18,21]}];
    
    periods.forEach(p => {
      const idx = data.hourly.time.findIndex(t => t.startsWith(dateStr) && parseInt(t.substring(11,13)) === p.h[0]);
      if (idx !== -1) {
        const t = Math.round(data.hourly.temperature_2m[idx]);
        const f = Math.round(data.hourly.apparent_temperature[idx]);
        const pr = data.hourly.precipitation_probability[idx];
        const desc = getWeatherDescription(data.hourly.weather_code[idx]);
        output += `*${p.n}:* ${t}° (ощущ. ${f}°) — ${desc}${pr > 5 ? ` (осадки ${pr}%)` : ''}\n`;
      }
    });

    output += `\n🌅 Восход: ${data.daily.sunrise[dayOffset].substring(11,16)} | 🌆 Закат: ${data.daily.sunset[dayOffset].substring(11,16)}`;
    return { success: true, city: name, periods: output };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== ОБРАБОТЧИКИ БОТА =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').resized();

const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('📍 СЕВАСТОПОЛЬ').text('🔙 НАЗАД').resized();

bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: name, city: 'Не указан' });
  await ctx.reply(`👋 Привет! Я — твой анонимный ассистент.\n\nТвое имя: *${name}*\n\nВыбери город для прогноза:`, {
    parse_mode: 'Markdown',
    reply_markup: new Keyboard().text('🚀 НАЧАТЬ РАБОТУ').resized()
  });
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', (ctx) => ctx.reply('🏙️ Выбери город или напиши его название:', { reply_markup: cityKeyboard }));

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка: ' + w.error);
  await ctx.reply(`🌤️ *Погода в ${w.city}:*\n🌡️ ${w.temp}°C (ощущ. ${w.feels_like}°C)\n📝 ${w.description}\n💨 Ветер: ${w.wind_speed} м/с\n💧 Влажность: ${w.humidity}%`, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(`📅 *Погода в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(`📅 *Погода в ${f.city} на завтра:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const hash = generateAuthHash(name);
  // Передаем хэш для бесшовного входа
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(res.city || 'Не указан')}&hash=${hash}`;
  
  await ctx.reply(`🕹️ *Тетрис 3D*\n\nТвое имя в игре: *${name}*\n\nВход будет выполнен автоматически!`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.trim();
  try {
    const check = await getWeatherData(city);
    if (!check.success) throw new Error();
    await saveUserCity(name, check.city);
    await ctx.reply(`✅ Город *${check.city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ Город не найден.', { reply_markup: cityKeyboard });
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
  return res.status(200).json({ status: 'running' });
}
