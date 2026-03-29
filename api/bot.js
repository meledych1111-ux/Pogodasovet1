import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
  saveGameScore,
  getGameStats as fetchGameStats,
  getTopPlayers as fetchTopPlayers,
  saveGameProgress,
  getGameProgress,
  deleteGameProgress,
  pool,
  saveOrUpdateUser,
  getUserProfile,
  generateAnonymousName
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

// ===================== КОНФИГУРАЦИЯ =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Bot(BOT_TOKEN);

// ===================== ХРАНИЛИЩЕ ДЛЯ СЕССИЙ =====================
const userStorage = new Map();

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ПОГОДЫ =====================
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

function getCloudDescription(cloudPercent) {
  if (cloudPercent === undefined || cloudPercent === null) return '—';
  if (cloudPercent < 10) return 'Ясно ☀️';
  if (cloudPercent < 30) return 'Малооблачно 🌤️';
  if (cloudPercent < 50) return 'Переменная облачность ⛅';
  if (cloudPercent < 70) return 'Облачно с прояснениями 🌥️';
  if (cloudPercent < 85) return 'Облачно ☁️';
  return 'Пасмурно ☁️';
}

function calculateDayLength(sunrise, sunset) {
  if (!sunrise || !sunset || sunrise === '—' || sunset === '—') return '—';
  const [sunriseHour, sunriseMin] = sunrise.split(':').map(Number);
  const [sunsetHour, sunsetMin] = sunset.split(':').map(Number);
  let hours = sunsetHour - sunriseHour;
  let minutes = sunsetMin - sunriseMin;
  if (minutes < 0) { hours--; minutes += 60; }
  return `${hours} ч ${minutes} мин`;
}

function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅',
    3: 'Пасмурно ☁️', 45: 'Туман 🌫️', 48: 'Изморозь 🌫️',
    51: 'Лёгкая морось 🌧️', 53: 'Морось 🌧️', 55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌧️', 63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️', 73: 'Снег ❄️', 75: 'Сильный снег ❄️',
    80: 'Небольшой ливень 🌧️', 81: 'Ливень 🌧️', 82: 'Сильный ливень 🌧️',
    85: 'Небольшой снегопад ❄️', 86: 'Сильный снегопад ❄️',
    95: 'Гроза ⛈️', 96: 'Гроза с градом ⛈️', 99: 'Сильная гроза с градом ⛈️'
  };
  return weatherMap[code] || `Код погоды: ${code}`;
}

// ===================== ПОГОДА API =====================
async function getWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl).then(r => r.json());
    if (!geoRes.results?.[0]) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoRes.results[0];
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,wind_speed_10m,relative_humidity_2m,weather_code,pressure_msl,cloud_cover&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
    const w = await fetch(weatherUrl).then(r => r.json());
    return {
      success: true, city: name, temp: Math.round(w.current.temperature_2m),
      feels_like: Math.round(w.current.apparent_temperature),
      wind_speed: w.current.wind_speed_10m,
      humidity: w.current.relative_humidity_2m,
      description: getWeatherDescription(w.current.weather_code),
      pressure: Math.round(w.current.pressure_msl * 0.750062),
      cloud_desc: getCloudDescription(w.current.cloud_cover),
      sunrise: w.daily.sunrise[0].split('T')[1],
      sunset: w.daily.sunset[0].split('T')[1]
    };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== ФРАЗЫ = [твои фразы из старого кода] =====================
const dailyPhrases = [
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая автобусная остановка?", explanation: "Спрашиваем про транспорт", category: "Транспорт", level: "A1" },
  { english: "How much does this cost?", russian: "Сколько это стоит?", explanation: "В магазине", category: "Покупки", level: "A1" },
  // ... добавь остальные свои фразы здесь
];

// ===================== КЛАВИАТУРЫ =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').text('👕 ЧТО НАДЕТЬ?').row()
    .text('💬 ФРАЗА ДНЯ').text('🎲 СЛУЧАЙНАЯ ФРАЗА').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ').resized();

const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ =====================
bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: ctx.from.id.toString(), telegram_id: ctx.from.id.toString(), username: name });
  await ctx.reply(`👋 Привет! Твоё анонимное имя: *${name}*`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('Ошибка: ' + w.error);
  await ctx.reply(`🌤️ *${w.city}*: ${w.temp}°C, ${w.description}\n💨 Ветер: ${w.wind_speed} м/с\n💧 Влажность: ${w.humidity}%`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const url = `https://${process.env.VERCEL_URL || 'pogodasovet1.vercel.app'}?telegramId=${ctx.from.id}&username=${encodeURIComponent(name)}`;
  await ctx.reply(`🎮 *Тетрис*\nИгрок: ${name}`, {
    reply_markup: { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выберите город:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const city = ctx.message.text.replace('📍 ', '');
  await saveUserCity(ctx.from.id.toString(), city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

// ===================== ЭКСПОРТ ДЛЯ VERCEL (ТОЛЬКО ЭТА ЧАСТЬ ИЗМЕНЕНА) =====================
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
    } catch (err) {
      console.error('Bot Error:', err);
    }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'running' });
}
