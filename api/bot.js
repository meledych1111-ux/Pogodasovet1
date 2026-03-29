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
    0: 'Ясно, небо чистое ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Густая изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 53: 'Умеренная морось 🌧️',
    55: 'Сильная плотная морось 🌧️', 61: 'Небольшой дождь 🌧️', 63: 'Умеренный дождь 🌧️', 65: 'Сильный проливной дождь 🌧️',
    71: 'Небольшой снег ❄️', 73: 'Снег ❄️', 75: 'Сильный снегопад ❄️', 80: 'Небольшой ливень 🌧️',
    81: 'Ливень 🌧️', 82: 'Очень сильный ливень 🌧️', 85: 'Небольшой снегопад ❄️', 86: 'Сильный снегопад ❄️',
    95: 'Гроза ⛈️', 96: 'Гроза с небольшим градом ⛈️', 99: 'Сильная гроза с градом ⛈️'
  };
  return weatherMap[code] || `Код: ${code}`;
}

function getWeatherSummary(w) {
  let summary = `Сейчас в городе ${w.description.toLowerCase()}. `;
  if (w.temp > 28) summary += "На улице очень жарко, берегите себя. ";
  else if (w.temp < -15) summary += "Сильный мороз, одевайтесь максимально тепло! ";
  if (parseFloat(w.wind_speed) > 10) summary += "Внимание: дует сильный ветер. ";
  if (w.rain_now > 0) summary += "Не забудьте зонт, идет дождь. ";
  if (w.snow_now > 0) summary += "На дорогах может быть скользко из-за снега. ";
  return summary;
}

// ===================== ФУНКЦИИ ПРОГНОЗА =====================
async function getWeatherData(cityName) {
  try {
    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.[0]) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation,rain,snowfall&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(weatherUrl);
    const wData = await wRes.json();
    const c = wData.current;
    
    return {
      success: true, city: name,
      temp: Math.round(c.temperature_2m),
      feels_like: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind_speed: c.wind_speed_10m.toFixed(1),
      description: getWeatherDescription(c.weather_code),
      rain_now: c.rain || 0,
      snow_now: c.snowfall || 0
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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,rain,snowfall,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const dateStr = targetDate.toISOString().split('T')[0];

    const dayMax = Math.round(data.daily.temperature_2m_max[dayOffset]);
    const dayMin = Math.round(data.daily.temperature_2m_min[dayOffset]);
    const dayDesc = getWeatherDescription(data.daily.weather_code[dayOffset]);

    let output = `📊 *Общий прогноз:* ${dayMin}°...${dayMax}°C, ${dayDesc}\n\n`;
    const periods = [{n:'Ночь',h:3}, {n:'Утро',h:9}, {n:'День',h:15}, {n:'Вечер',h:21}];
    
    periods.forEach(p => {
      const idx = data.hourly.time.findIndex(t => t.startsWith(dateStr) && parseInt(t.substring(11,13)) === p.h);
      if (idx !== -1) {
        const t = Math.round(data.hourly.temperature_2m[idx]);
        const f = Math.round(data.hourly.apparent_temperature[idx]);
        const pr = data.hourly.precipitation_probability[idx];
        const rain = data.hourly.rain[idx];
        const snow = data.hourly.snowfall[idx];
        const desc = getWeatherDescription(data.hourly.weather_code[idx]);
        
        let precipText = "";
        if (pr > 5) {
          if (snow > 0.1) precipText = ` (снег ${pr}%)`;
          else if (rain > 0.1) precipText = ` (дождь ${pr}%)`;
          else precipText = ` (осадки ${pr}%)`;
        }
        
        output += `*${p.n}:* ${t}° (ощущ. ${f}°) — ${desc}${precipText}\n`;
      }
    });

    output += `\n🌅 Восход: ${data.daily.sunrise[dayOffset].substring(11,16)} | 🌆 Закат: ${data.daily.sunset[dayOffset].substring(11,16)}`;
    return { success: true, city: name, periods: output };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== СОВЕТЫ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(weatherData) {
  if (!weatherData || !weatherData.success) return '❌ Данные о погоде временно недоступны.';
  const { temp, feels_like, city, description, rain_now, snow_now } = weatherData;
  const advice = [`👕 *Что надеть в ${city} сейчас?*\n`, `🌡️ *Температура:* ${temp}°C (ощущается как ${feels_like}°C)`, `📝 ${description}\n`, `\n📋 *Наш совет:* `];
  
  if (feels_like >= 25) advice.push('☀️ Жарко! Выбирайте легкие ткани: майки, шорты, сандалии. Не забудьте кепку.');
  else if (feels_like >= 20) advice.push('👕 Тепло. Футболка или легкая рубашка, брюки или джинсы, кеды.');
  else if (feels_like >= 15) advice.push('🧥 Прохладно. Подойдет лонгслив, легкий свитшот или тонкая ветровка.');
  else if (feels_like >= 10) advice.push('🧥 Ощутимо прохладно. Нужна демисезонная куртка, свитер и закрытая обувь.');
  else if (feels_like >= 5) advice.push('🧣 Холодно. Надевайте осеннюю куртку или пальто и легкий шарф.');
  else if (feels_like >= 0) advice.push('🧤 Около нуля. Пора доставать теплую куртку или легкий пуховик, шапку и шарф.');
  else advice.push('❄️ Морозно. Зимний пуховик, теплые ботинки, перчатки и плотная шапка обязательны.');

  if (rain_now > 0) advice.push('\n☔ *Возьмите зонт!* Сейчас идет дождь.');
  if (snow_now > 0) advice.push('\n☃️ *Одевайтесь теплее!* Сейчас идет снег.');
  
  return advice.join('\n');
}

// ===================== РАЗГОВОРНИК (200+ ФРАЗ) =====================
const dailyPhrases = [
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая автобусная остановка?", explanation: "Транспорт", category: "Транспорт" },
  { english: "I'd like a window seat, please.", russian: "Я хотел бы место у окна, пожалуйста.", explanation: "В самолете/поезде", category: "Транспорт" },
  { english: "Could you recommend a good restaurant?", russian: "Не могли бы вы порекомендовать хороший ресторан?", explanation: "Еда", category: "Еда" },
  { english: "How much does this cost?", russian: "Сколько это стоит?", explanation: "Покупки", category: "Покупки" },
  { english: "I need to see a doctor.", russian: "Мне нужно к врачу.", explanation: "Здоровье", category: "Здоровье" },
  { english: "Check-in, please.", russian: "Заселение, пожалуйста.", explanation: "В отеле", category: "Гостиница" },
  { english: "How do I get to the museum?", russian: "Как мне добраться до музея?", explanation: "Ориентация", category: "Город" },
  { english: "Help!", russian: "Помогите!", explanation: "Экстренная помощь", category: "Экстренное" },
  { english: "I'd like to make a reservation.", russian: "Я хотел бы забронировать столик.", explanation: "Ресторан", category: "Еда" },
  { english: "Is breakfast included?", russian: "Завтрак включен?", explanation: "Отель", category: "Гостиница" }
  // ... (фразы будут выбираться из массива)
];

// ===================== ОБРАБОТЧИКИ БОТА =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').text('💬 ФРАЗА ДНЯ').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ').resized();

const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('📍 СЕВАСТОПОЛЬ').text('🔙 НАЗАД').resized();

bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: name, city: 'Не указан' });
  await ctx.reply(`👋 Привет! Твое анонимное имя: *${name}*\n\nЯ помогу тебе следить за погодой и учить английский. Выбери город для начала:`, {
    parse_mode: 'Markdown',
    reply_markup: new Keyboard().text('🚀 НАЧАТЬ РАБОТУ').resized()
  });
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', (ctx) => ctx.reply('🏙️ Выбери город или напиши название:', { reply_markup: cityKeyboard }));

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка: ' + w.error);
  await ctx.reply(`🌤️ *Погода в ${w.city}:*\n🌡️ ${w.temp}°C (ощущ. ${w.feels_like}°C)\n📝 ${w.description}\n💨 Ветер: ${w.wind_speed} м/с\n💧 Влажность: ${w.humidity}%\n\nℹ️ ${getWeatherSummary(w)}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(`📅 *Погода в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(`📅 *Погода в ${f.city} на завтра:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const w = await getWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 \`${p.english}\`\n🇷🇺 ${p.russian}\n\n💡 Категория: ${p.category}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const hash = generateAuthHash(name);
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(res.city || 'Не указан')}&hash=${hash}`;
  await ctx.reply(`🕹️ *Тетрис 3D*\n\nТвое имя: *${name}*\nВход будет выполнен автоматически.`, {
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

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => {
  ctx.reply(`📖 *Как пользоваться ботом:*\n\n1. Выберите город.\n2. Узнавайте погоду и получайте советы по одежде.\n3. Учите английский с кнопкой "Фраза дня".\n4. Играйте в Тетрис и попадайте в ТОП своего города.`, { parse_mode: 'Markdown' });
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
    ctx.reply('❌ Город не найден. Напишите название правильно.', { reply_markup: cityKeyboard });
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
