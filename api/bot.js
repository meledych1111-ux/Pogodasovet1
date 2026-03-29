import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
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

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required');
}

const bot = new Bot(BOT_TOKEN);

// ===================== ХРАНИЛИЩЕ И КЭШ =====================
const rateLimit = new Map();

/**
 * Проверка ограничения запросов (защита от спама)
 */
function isRateLimited(userId) {
  const now = Date.now();
  const userLimit = rateLimit.get(userId) || { count: 0, lastRequest: 0 };
  if (now - userLimit.lastRequest > 60000) userLimit.count = 0;
  userLimit.count++;
  userLimit.lastRequest = now;
  rateLimit.set(userId, userLimit);
  return userLimit.count > 50;
}

/**
 * Хэш для проверки подлинности в игре
 */
function generateAuthHash(name) {
  const secret = process.env.BOT_TOKEN || 'fallback_secret';
  return crypto.createHash('sha256').update(name + secret).digest('hex').substring(0, 16);
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОГОДЫ =====================

function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  return directions[Math.round(degrees / 45) % 8];
}

function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 53: 'Морось 🌧️', 55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌧️', 63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️', 73: 'Снег ❄️', 75: 'Сильный снег ❄️',
    80: 'Небольшой ливень 🌧️', 81: 'Ливень 🌧️', 82: 'Сильный ливень 🌧️',
    85: 'Небольшой снегопад ❄️', 86: 'Сильный снегопад ❄️',
    95: 'Гроза ⛈️', 96: 'Гроза с градом ⛈️', 99: 'Сильная гроза с градом ⛈️'
  };
  return weatherMap[code] || `Код погоды: ${code}`;
}

// ===================== API ПОГОДЫ (OPEN-METEO) =====================

async function getWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,weather_code,cloud_cover,rain,snowfall&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(weatherUrl);
    const wData = await wRes.json();
    const cur = wData.current;

    return {
      success: true, city: name, temp: Math.round(cur.temperature_2m), feels_like: Math.round(cur.apparent_temperature),
      humidity: cur.relative_humidity_2m, pressure: Math.round(cur.pressure_msl * 0.750062),
      wind_speed: cur.wind_speed_10m.toFixed(1), wind_dir: getWindDirection(cur.wind_direction_10m),
      description: getWeatherDescription(cur.weather_code),
      has_rain: cur.rain > 0, has_snow: cur.snowfall > 0,
      date: new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
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

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const startIndex = dayOffset * 24;
    const periods = [
      { n: '🌙 Ночь', idx: startIndex + 3 },
      { n: '🌅 Утро', idx: startIndex + 9 },
      { n: '☀️ День', idx: startIndex + 15 },
      { n: '🌆 Вечер', idx: startIndex + 21 }
    ];

    let output = "";
    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.idx]);
      const f = Math.round(data.hourly.apparent_temperature[p.idx]);
      const pr = data.hourly.precipitation_probability[p.idx];
      const desc = getWeatherDescription(data.hourly.weather_code[p.idx]);
      output += `*${p.n}:* ${t}°C (ощущается ${f}°C)\n   ${desc}${pr > 10 ? ` | ☔ ${pr}%` : ''}\n\n`;
    });

    const date = new Date();
    date.setDate(date.getDate() + dayOffset);

    return {
      success: true, city: name, periods: output,
      date: date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }),
      sunrise: data.daily.sunrise[dayOffset].substring(11, 16),
      sunset: data.daily.sunset[dayOffset].substring(11, 16)
    };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== СОВЕТЫ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Нет данных о погоде.';
  const advice = [`👕 *Что надеть в ${w.city}?*\n`, `🌡️ ${w.temp}°C (ощущается ${w.feels_like}°C)\n📝 ${w.description}\n`, `\n📋 *Рекомендация:* `];
  const t = w.feels_like;
  if (t >= 25) advice.push('Жара! Футболка, шорты, кепка. Не забудьте воду.');
  else if (t >= 20) advice.push('Тепло. Футболка, легкие брюки, кроссовки.');
  else if (t >= 15) advice.push('Свежо. Лонгслив, джинсы, легкая ветровка.');
  else if (t >= 10) advice.push('Прохладно. Куртка, свитер, закрытая обувь.');
  else if (t >= 5) advice.push('Холодно. Осеннее пальто, шарф, легкая шапка.');
  else if (t >= 0) advice.push('Заморозки. Зимняя куртка, шапка, шарф, перчатки.');
  else advice.push('Мороз! Теплый пуховик, термобелье, теплая обувь.');
  if (w.has_rain) advice.push('\n\n☔ *Внимание:* Возможен дождь, возьмите зонт.');
  if (w.has_snow) advice.push('\n\n☃️ *Внимание:* Идет снег, выбирайте нескользящую обувь.');
  return advice.join('');
}

// ===================== РАЗГОВОРНИК (СПРАВОЧНИК) =====================
const dailyPhrases = [
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая автобусная остановка?", category: "Транспорт" },
  { english: "I'd like a window seat, please.", russian: "Я хотел бы место у окна, пожалуйста.", category: "Транспорт" },
  { english: "Can I pay by card?", russian: "Можно оплатить картой?", category: "Оплата" },
  { english: "A table for two, please.", russian: "Столик на двоих, пожалуйста.", category: "Еда" },
  { english: "What's the dish of the day?", russian: "Какое блюдо дня?", category: "Еда" },
  { english: "I'd like the bill, please.", russian: "Счет, пожалуйста.", category: "Еда" },
  { english: "How much does this cost?", russian: "Сколько это стоит?", category: "Покупки" },
  { english: "Can I try this on?", russian: "Можно это примерить?", category: "Покупки" },
  { english: "I need to see a doctor.", russian: "Мне нужно к врачу.", category: "Здоровье" },
  { english: "Call an ambulance!", russian: "Вызовите скорую!", category: "Здоровье" },
  { english: "Nice to meet you.", russian: "Приятно познакомиться.", category: "Общение" },
  { english: "What do you do?", russian: "Чем вы занимаетесь?", category: "Общение" },
  { english: "I'm lost, can you help me?", russian: "Я заблудился, поможете?", category: "Город" },
  { english: "Where is the restroom?", russian: "Где туалет?", category: "Город" }
];

// ===================== КЛАВИАТУРЫ =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 ПОГОДА СЕГОДНЯ').text('📅 ПОГОДА ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').row()
    .text('💬 ФРАЗА ДНЯ').text('🎲 СЛУЧАЙНАЯ ФРАЗА').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ').row()
    .resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row()
    .text('📍 СЕВАСТОПОЛЬ').row()
    .text('✏️ ДРУГОЙ ГОРОД').text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  // Сохраняем ТОЛЬКО анонимное имя. Никаких личных ID в базу.
  await saveOrUpdateUser({ user_id: name, city: 'Не указан' });
  await ctx.reply(
    `👋 Привет! Твое анонимное имя: *${name}*\n\n` +
    `Я помогаю следить за погодой и учить английский. Все данные полностью анонимны.\n\n` +
    `📍 Выберите ваш город, чтобы я мог показывать точный прогноз:`,
    { parse_mode: 'Markdown', reply_markup: cityKeyboard }
  );
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  if (isRateLimited(ctx.from.id)) return ctx.reply('⏳ Подождите минуту.');
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
  
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка поиска города.');
  
  let msg = `🌤️ *${w.city} сейчас:*\n📅 ${w.date}\n\n`;
  msg += `🌡️ Температура: ${w.temp}°C (ощущается ${w.feels_like}°C)\n`;
  msg += `📝 Состояние: ${w.description}\n💨 Ветер: ${w.wind_speed} м/с, ${w.wind_dir}\n📊 Давление: ${w.pressure} мм\n💧 Влажность: ${w.humidity}%`;
  
  await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 ПОГОДА СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выберите город!', { reply_markup: cityKeyboard });
  const f = await getDetailedForecast(res.city, 0);
  if (!f.success) return ctx.reply('❌ Ошибка');
  await ctx.reply(`📅 *Сегодня (${f.date}) в ${f.city}:*\n\n${f.periods}🌅 Восход: ${f.sunrise} | 🌇 Закат: ${f.sunset}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выберите город!', { reply_markup: cityKeyboard });
  const f = await getDetailedForecast(res.city, 1);
  if (!f.success) return ctx.reply('❌ Ошибка');
  await ctx.reply(`📅 *Завтра (${f.date}) в ${f.city}:*\n\n${f.periods}🌅 Восход: ${f.sunrise} | 🌇 Закат: ${f.sunset}`, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выберите город!');
  const w = await getWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  await ctx.reply(`💬 *Фраза дня:*\n\n🇬🇧 \`${p.english}\`\n🇷🇺 ${p.russian}\n\n📂 Категория: ${p.category}`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ ФРАЗА', async (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  await ctx.reply(`🎲 *Случайная фраза:*\n\n🇬🇧 \`${p.english}\`\n🇷🇺 ${p.russian}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const hash = generateAuthHash(name);
  // Переход без Telegram ID, только анонимное имя и город.
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(res.city || 'Не указан')}&hash=${hash}`;
  await ctx.reply(`🕹️ *Тетрис*\nВаше имя в игре: *${name}*\n\nНажмите кнопку для запуска:`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🎮 Начать игру', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выберите или напишите город:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));
bot.hears('✏️ ДРУГОЙ ГОРОД', (ctx) => ctx.reply('Напишите название города (например: Сочи):'));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* сохранен! Теперь я знаю, какую погоду тебе показывать.`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => {
  ctx.reply(`🌤️ Погода по часам, 👕 советы по одежде и 🇬🇧 английский. Регистрация не нужна, всё работает по вашему анонимному имени.`, { parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const name = generateAnonymousName(ctx.from.id);
  try {
    const check = await getWeatherData(ctx.message.text.trim());
    if (!check.success) throw new Error();
    await saveUserCity(name, check.city);
    await ctx.reply(`✅ Город *${check.city}* выбран!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ Город не найден. Попробуйте написать точнее.', { reply_markup: cityKeyboard });
  }
});

// ===================== ЭКСПОРТ ДЛЯ VERCEL =====================
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
