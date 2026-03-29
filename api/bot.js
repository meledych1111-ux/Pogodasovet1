import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================
const weatherCache = new Map();

function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['северный', 'северо-восточный', 'восточный', 'юго-восточный', 'южный', 'юго-западный', 'западный', 'северо-западный'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
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
    0: 'Ясно, чистое небо ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 53: 'Морось 🌧️', 55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌧️', 63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️', 71: 'Небольшой снег ❄️',
    73: 'Снег ❄️', 75: 'Сильный снег ❄️', 80: 'Небольшой ливень 🌧️', 81: 'Ливень 🌧️', 82: 'Сильный ливень 🌧️',
    85: 'Небольшой снегопад ❄️', 86: 'Сильный снегопад ❄️', 95: 'Гроза ⛈️', 96: 'Гроза с градом ⛈️', 99: 'Сильная гроза с градом ⛈️'
  };
  return weatherMap[code] || `Код: ${code}`;
}

function getWeatherSummary(w) {
  let summary = `Сейчас ${w.description.toLowerCase()}. `;
  if (w.temp > 28) summary += "Очень жарко! ";
  else if (w.temp < -15) summary += "Сильный мороз. ";
  if (parseFloat(w.wind_speed) > 10) summary += "Сильный ветер. ";
  if (w.rain_now > 0) summary += "Идет дождь. ";
  if (w.snow_now > 0) summary += "Идет снег. ";
  return summary;
}

// ===================== ПОГОДНЫЕ ФУНКЦИИ =====================
async function getWeatherData(cityName, forceRefresh = false) {
  try {
    if (!cityName) return { success: false, error: 'Город не указан' };
    const cacheKey = `current_${cityName.toLowerCase()}`;
    const now = Date.now();
    if (!forceRefresh && weatherCache.has(cacheKey)) {
      const cached = weatherCache.get(cacheKey);
      if (now - cached.timestamp < 600000) return cached.data;
    }

    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    if (!geoData.results || geoData.results.length === 0) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,precipitation,rain,snowfall,weather_code,is_day&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    const current = weatherData.current;
    const daily = weatherData.daily;

    const sunrise = daily?.sunrise?.[0]?.substring(11, 16) || '—';
    const sunset = daily?.sunset?.[0]?.substring(11, 16) || '—';

    const weatherResult = {
      success: true,
      city: name,
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind_speed: current.wind_speed_10m.toFixed(1),
      wind_dir: getWindDirection(current.wind_direction_10m),
      pressure: Math.round(current.pressure_msl * 0.750062),
      description: getWeatherDescription(current.weather_code),
      has_precipitation: (current.precipitation > 0),
      rain_now: current.rain || 0,
      snow_now: current.snowfall || 0,
      day_length: calculateDayLength(sunrise, sunset)
    };
    weatherCache.set(cacheKey, { data: weatherResult, timestamp: now });
    return weatherResult;
  } catch (error) { return { success: false, error: error.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.[0]) throw new Error('Город не найден');

    const { latitude, longitude, name } = geoData.results[0];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,snowfall,weather_code,wind_speed_10m,relative_humidity_2m,pressure_msl&daily=sunrise,sunset,uv_index_max,temperature_2m_max,temperature_2m_min,weather_code&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    
    const response = await fetch(url);
    const data = await response.json();

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const dateStr = targetDate.toISOString().split('T')[0];

    const periods = [
      { name: 'Ночь', hours: [0, 1, 2, 3, 4, 5], emoji: '🌙' },
      { name: 'Утро', hours: [6, 7, 8, 9, 10, 11], emoji: '🌅' },
      { name: 'День', hours: [12, 13, 14, 15, 16, 17], emoji: '☀️' },
      { name: 'Вечер', hours: [18, 19, 20, 21, 22, 23], emoji: '🌆' }
    ];

    const daily = data.daily;
    const dayMax = Math.round(daily.temperature_2m_max[dayOffset]);
    const dayMin = Math.round(daily.temperature_2m_min[dayOffset]);
    const dayDesc = getWeatherDescription(daily.weather_code[dayOffset]);

    let output = `📊 *Общий прогноз:* ${dayMin}°...${dayMax}°C, ${dayDesc}\n\n`;

    periods.forEach(p => {
      const indices = data.hourly.time.map((t, i) => {
        const d = new Date(t);
        return (t.startsWith(dateStr) && p.hours.includes(d.getHours())) ? i : -1;
      }).filter(i => i !== -1);

      if (indices.length > 0) {
        const temps = indices.map(i => data.hourly.temperature_2m[i]);
        const feels = indices.map(i => data.hourly.apparent_temperature[i]);
        const codes = indices.map(i => data.hourly.weather_code[i]);
        const winds = indices.map(i => data.hourly.wind_speed_10m[i]);
        const probs = indices.map(i => data.hourly.precipitation_probability[i]);
        const hums = indices.map(i => data.hourly.relative_humidity_2m[i]);
        const rains = indices.map(i => data.hourly.rain[i]);
        const snows = indices.map(i => data.hourly.snowfall[i]);

        const maxProb = Math.max(...probs);
        const avgWind = (winds.reduce((a, b) => a + b) / winds.length).toFixed(1);
        const avgHum = Math.round(hums.reduce((a, b) => a + b) / hums.length);
        
        const counts = {}; codes.forEach(c => counts[c] = (counts[c] || 0) + 1);
        const mainCode = Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b);

        let precipText = "";
        if (maxProb > 5) {
          const maxRain = Math.max(...rains);
          const maxSnow = Math.max(...snows);
          if (maxSnow > 0.1) precipText = ` (снег ${maxProb}%)`;
          else if (maxRain > 0.1) precipText = ` (дождь ${maxProb}%)`;
          else precipText = ` (осадки ${maxProb}%)`;
        }

        output += `${p.emoji} *${p.name}:* ${Math.min(...temps).toFixed(0)}°...${Math.max(...temps).toFixed(0)}°C\n`;
        output += `   ${getWeatherDescription(parseInt(mainCode))}${precipText}\n`;
        output += `   💨 ${avgWind} м/с | 💧 ${avgHum}%\n\n`;
      }
    });

    output += `🌅 Восход: ${daily.sunrise[dayOffset].split('T')[1]} | 🌆 Закат: ${daily.sunset[dayOffset].split('T')[1]}\n`;
    output += `☀️ УФ-индекс: ${daily.uv_index_max[dayOffset].toFixed(1)}`;

    return { success: true, city: name, periods: output };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedTodayWeather(cityName) { return await getDetailedForecast(cityName, 0); }
async function getWeatherForecast(cityName) { return await getDetailedForecast(cityName, 1); }

function getWardrobeAdvice(weatherData) {
  if (!weatherData || !weatherData.success) return '❌ Нет данных о погоде.';
  const { temp, feels_like, city, description } = weatherData;
  const advice = [`👕 *Что надеть в ${city} сейчас?*\n`, `🌡️ *Температура:* ${temp}°C (ощущается ${feels_like}°C)`, `📝 ${description}\n`, `\n📋 *Совет:* `];
  if (temp >= 25) advice.push('Майка, шорты, сандалии.');
  else if (temp >= 20) advice.push('Футболка, легкие брюки.');
  else if (temp >= 15) advice.push('Лонгслив, легкая куртка.');
  else if (temp >= 10) advice.push('Ветровка, свитер, джинсы.');
  else if (temp >= 5) advice.push('Осенняя куртка, шапка.');
  else if (temp >= 0) advice.push('Теплая куртка, шапка, шарф.');
  else advice.push('Пуховик, термобелье, теплая шапка.');
  return advice.join('');
}

// ===================== ОБРАБОТЧИКИ БОТА =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ').resized();

const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('📍 СЕВАСТОПОЛЬ').text('🔙 НАЗАД').resized();

bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  // Анонимность: НЕ сохраняем chat_id и используем имя вместо user_id
  await saveOrUpdateUser({ user_id: name, city: 'Не указан' });
  await ctx.reply(`👋 Привет! Твое имя: *${name}*\n\nВыбери город для прогноза:`, {
    parse_mode: 'Markdown',
    reply_markup: new Keyboard().text('🚀 НАЧАТЬ РАБОТУ').resized()
  });
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', (ctx) => ctx.reply('🏙️ Выбери город:', { reply_markup: cityKeyboard }));

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Выбери город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка: ' + w.error);
  await ctx.reply(`🌤️ *Погода в ${w.city}:*\n🌡️ ${w.temp}°C (ощущ. ${w.feels_like}°C)\n📝 ${w.description}\n💨 Ветер: ${w.wind_speed} м/с\n💧 Влажность: ${w.humidity}%\n\nℹ️ ${getWeatherSummary(w)}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const f = await getDetailedTodayWeather(res.city);
  await ctx.reply(`📅 *Прогноз в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const f = await getWeatherForecast(res.city);
  await ctx.reply(`📅 *Прогноз в ${f.city} на завтра:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const w = await getWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  // Никаких реальных ID в ссылке
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(res.city || 'Не указан')}`;
  await ctx.reply(`🕹️ *Тетрис 3D*\n\nТвое имя: *${name}*\n\nЖми на кнопку, чтобы играть!`, {
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
