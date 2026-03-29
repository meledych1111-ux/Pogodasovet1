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
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['С ⬆️', 'СВ ↗️', 'В ➡️', 'ЮВ ↘️', 'Ю ⬇️', 'ЮЗ ↙️', 'З ⬅️', 'СЗ ↖️'];
  return directions[Math.round(degrees / 45) % 8];
}

function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 53: 'Умеренная морось 🌧️', 55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌧️', 63: 'Умеренный дождь 🌧️', 65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️', 73: 'Снег ❄️', 75: 'Сильный снег ❄️',
    80: 'Слабый ливень 🌧️', 81: 'Ливень 🌧️', 82: 'Сильный ливень 🌧️',
    85: 'Небольшой снегопад ❄️', 86: 'Сильный снегопад ❄️',
    95: 'Гроза ⛈️', 96: 'Гроза с градом ⛈️', 99: 'Сильная гроза с градом ⛈️'
  };
  return weatherMap[code] || `Код: ${code}`;
}

function generateAuthHash(name) {
  const secret = process.env.BOT_TOKEN || 'fallback';
  return crypto.createHash('sha256').update(name + secret).digest('hex').substring(0, 16);
}

// ===================== КРАСИВАЯ ПОГОДА =====================

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

    let msg = `📍 *Погода в ${name} сейчас*\n`;
    msg += `───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C\n`;
    msg += `🤔 *Ощущается как:* ${Math.round(cur.apparent_temperature)}°C\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n`;
    msg += `───────────────────\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    msg += `💧 *Влажность:* ${cur.relative_humidity_2m}%\n`;
    msg += `📊 *Давление:* ${Math.round(cur.pressure_msl * 0.750062)} мм рт. ст.\n`;
    msg += `☁️ *Облачность:* ${cur.cloud_cover}%\n`;
    
    if (cur.rain > 0) msg += `🌧️ *Идет дождь:* ${cur.rain} мм\n`;
    if (cur.snowfall > 0) msg += `❄️ *Идет снег:* ${cur.snowfall} см\n`;
    
    return { success: true, city: name, message: msg, raw: cur };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const start = dayOffset * 24;
    const periods = [
      { n: '🌙 Ночь', i: start + 3, e: '🌙' },
      { n: '🌅 Утро', i: start + 9, e: '🌅' },
      { n: '☀️ День', i: start + 15, e: '☀️' },
      { n: '🌆 Вечер', i: start + 21, e: '🌆' }
    ];

    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    const dateTitle = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    let msg = `📅 *Прогноз на ${dateTitle}*\n`;
    msg += `📍 *${name}*\n`;
    msg += `───────────────────\n`;
    msg += `📊 Обзор: от ${Math.round(data.daily.temperature_2m_min[dayOffset])}° до ${Math.round(data.daily.temperature_2m_max[dayOffset])}°C\n\n`;

    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.i]);
      const f = Math.round(data.hourly.apparent_temperature[p.i]);
      const pr = data.hourly.precipitation_probability[p.i];
      const desc = getWeatherDescription(data.hourly.weather_code[p.i]);
      
      msg += `${p.e} *${p.n}*\n`;
      msg += `🌡️ ${t}°C (ощущается ${f}°C)\n`;
      msg += `${desc}${pr > 5 ? ` | ☔️ ${pr}%` : ''}\n\n`;
    });

    msg += `───────────────────\n`;
    msg += `🌅 Восход: ${data.daily.sunrise[dayOffset].substring(11, 16)}\n`;
    msg += `🌇 Закат: ${data.daily.sunset[dayOffset].substring(11, 16)}`;

    return { success: true, message: msg };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== ФУНКЦИЯ РЕКОМЕНДАЦИЙ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Нет данных о погоде.';
  const t = Math.round(w.raw.apparent_temperature);
  let advice = `👕 *Что надеть в ${w.city} сейчас?*\n`;
  advice += `───────────────────\n`;
  advice += `🌡️ Ощущается как: ${t}°C\n\n`;
  
  if (t >= 25) {
    advice += "☀️ *Базовый слой:* Майка или футболка из хлопка\n🩳 *Низ:* Шорты или легкая юбка\n👟 *Обувь:* Сандалии или легкие кеды\n🕶️ *Аксессуары:* Кепка и солнцезащитные очки";
  } else if (t >= 18) {
    advice += "🌤️ *Базовый слой:* Футболка или легкая рубашка\n👖 *Низ:* Джинсы или тонкие брюки\n👟 *Обувь:* Кроссовки или кеды\n🧥 *На вечер:* Легкая кофта или джинсовка";
  } else if (t >= 10) {
    advice += "🧥 *Верх:* Свитшот, худи или ветровка\n👖 *Низ:* Плотные джинсы\n👟 *Обувь:* Кроссовки или ботинки\n🧣 *Аксессуары:* Легкий шарф";
  } else if (t >= 0) {
    advice += "🧣 *Верх:* Теплый свитер + демисезонная куртка или пальто\n👖 *Низ:* Утепленные брюки\n🥾 *Обувь:* Осенние ботинки\n🧤 *Аксессуары:* Шапка и перчатки";
  } else {
    advice += "❄️ *Верх:* Термобелье + флис + теплый пуховик\n👖 *Низ:* Плотные штаны с начесом\n🥾 *Обувь:* Зимние ботинки на меху\n🧤 *Аксессуары:* Теплая шапка, шарф и варежки";
  }

  if (w.raw.rain > 0) advice += "\n\n☔️ *Внимание:* Идет дождь, не забудьте зонт!";
  if (w.raw.snowfall > 0) advice += "\n\n☃️ *Внимание:* На улице снег, выбирайте обувь с нескользящей подошвой.";
  
  return advice;
}

// ===================== ПОЛНЫЙ СПРАВОЧНИК ФРАЗ =====================
const dailyPhrases = [
  { e: "Where is the nearest bus stop?", r: "Где ближайшая остановка?", c: "Транспорт" },
  { e: "How much is the fare?", r: "Сколько стоит проезд?", c: "Транспорт" },
  { e: "Keep the change.", r: "Сдачи не надо.", c: "Транспорт" },
  { e: "A table for two, please.", r: "Столик на двоих, пожалуйста.", c: "Еда" },
  { e: "The bill, please.", r: "Счет, пожалуйста.", c: "Еда" },
  { e: "Everything was delicious!", r: "Все было очень вкусно!", c: "Еда" },
  { e: "How much does this cost?", r: "Сколько это стоит?", c: "Покупки" },
  { e: "Can I try this on?", r: "Можно это примерить?", c: "Покупки" },
  { e: "I'll take it.", r: "Я это беру.", c: "Покупки" },
  { e: "Nice to meet you!", r: "Приятно познакомиться!", c: "Общение" },
  { e: "Could you repeat that, please?", r: "Не могли бы вы повторить?", c: "Общение" },
  { e: "I don't understand.", r: "Я не понимаю.", c: "Общение" },
  { e: "I need a doctor.", r: "Мне нужен врач.", c: "Здоровье" },
  { e: "Call an ambulance!", r: "Вызовите скорую!", c: "Здоровье" }
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
    .text('✏️ ДРУГОЙ ГОРОД').resized();

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: name, city: 'Не указан' });
  
  const welcome = 
    `👋 *Привет!* Твой анонимный профиль: *${name}*\n\n` +
    `Я твой ассистент по погоде и английскому. Мы уважаем твою приватность: никаких имен и ID в базе.\n\n` +
    `🚀 *Команды:*\n` +
    `🌤 /weather — Погода прямо сейчас\n` +
    `📅 /today — Прогноз на сегодня по часам\n` +
    `📅 /forecast — Прогноз на завтра\n` +
    `👕 /wardrobe — Советы по одежде\n` +
    `💬 /phrase — Фраза на английском\n` +
    `🎮 /tetris — Мини-игра\n\n` +
    `📍 *Выбери свой город, чтобы начать:*`;

  await ctx.reply(welcome, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка поиска.');
  await ctx.reply(w.message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 ПОГОДА СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!', { reply_markup: cityKeyboard });
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!', { reply_markup: cityKeyboard });
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!');
  const w = await getWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  await ctx.reply(`💬 *Фраза дня*\n───────────────────\n🇬🇧 \`${p.e}\`\n🇷🇺 ${p.r}\n\n📂 Категория: ${p.c}`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ ФРАЗА', async (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  await ctx.reply(`🎲 *Случайная фраза*\n───────────────────\n🇬🇧 \`${p.e}\`\n🇷🇺 ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const hash = generateAuthHash(name);
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(res.city || 'Не указан')}&hash=${hash}`;
  
  await ctx.reply(
    `🕹️ *Тетрис*\n\nТвое имя: *${name}*\nГород: *${res.city}*\n\nНажми кнопку ниже, чтобы начать игру:`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url } }]] }
    }
  );
});

// ОБРАБОТЧИК ДАННЫХ ИЗ ТЕТРИСА
bot.on('message:web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.message.web_app_data.data);
    const name = generateAnonymousName(ctx.from.id);
    if (data.score > 0) {
      await saveGameScore(name, 'tetris', data.score, data.level, data.lines, name);
      await ctx.reply(`🎉 *Результат сохранен!*\n🏆 Счет: ${data.score}\n👤 Игрок: ${name}`, { parse_mode: 'Markdown' });
    }
  } catch (e) { console.error('Score Error:', e); }
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));
bot.hears('✏️ ДРУГОЙ ГОРОД', (ctx) => ctx.reply('Напиши название своего города:'));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
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
    ctx.reply('❌ Город не найден.', { reply_markup: cityKeyboard });
  }
});

// ===================== ЭКСПОРТ ДЛЯ VERCEL =====================
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      if (!bot.isInited()) await bot.init();
      await bot.handleUpdate(req.body);
    } catch (e) { console.error('Error:', e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'running' });
}
