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
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 53: 'Морось 🌧️', 55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌧️', 63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️', 73: 'Снег ❄️', 75: 'Сильный снег ❄️',
    80: 'Ливень 🌧️', 81: 'Сильный ливень 🌧️', 95: 'Гроза ⛈️'
  };
  return weatherMap[code] || `Код: ${code}`;
}

function generateAuthHash(name) {
  const secret = process.env.BOT_TOKEN || 'fallback';
  return crypto.createHash('sha256').update(name + secret).digest('hex').substring(0, 16);
}

// ===================== ПОЛУЧЕНИЕ ПОГОДЫ =====================

async function getDetailedWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,weather_code,rain,snowfall&wind_speed_unit=ms&timezone=auto`;
    const wRes = await fetch(url);
    const wData = await wRes.json();
    const cur = wData.current;

    if (!cur) throw new Error('Данные не получены');

    return {
      success: true,
      city: name,
      temp: Math.round(cur.temperature_2m),
      feels_like: Math.round(cur.apparent_temperature),
      description: getWeatherDescription(cur.weather_code),
      wind_speed: cur.wind_speed_10m,
      wind_dir: getWindDirection(cur.wind_direction_10m),
      humidity: cur.relative_humidity_2m,
      pressure: Math.round(cur.pressure_msl * 0.750062),
      has_rain: cur.rain > 0,
      has_snow: cur.snowfall > 0
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code&daily=sunrise,sunset&timezone=auto&forecast_days=${dayOffset + 1}`;
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
    let msg = `📅 *Прогноз: ${name}* (${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })})\n`;
    msg += `───────────────────\n\n`;

    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.i]);
      const f = Math.round(data.hourly.apparent_temperature[p.i]);
      const pr = data.hourly.precipitation_probability[p.i];
      const desc = getWeatherDescription(data.hourly.weather_code[p.i]);
      msg += `${p.e} *${p.n}:* ${t}°C (ощ. ${f}°C)\n   ${desc}${pr > 5 ? ` | ☔️ ${pr}%` : ''}\n\n`;
    });

    msg += `───────────────────\n`;
    msg += `🌅 Восход: ${data.daily.sunrise[dayOffset].substring(11, 16)} | 🌇 Закат: ${data.daily.sunset[dayOffset].substring(11, 16)}`;
    return { success: true, message: msg };
  } catch (e) { return { success: false, message: "❌ Не удалось получить прогноз." }; }
}

// ===================== СОВЕТЫ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Данные о погоде недоступны.';
  const { temp, feels_like, city, description, has_rain, has_snow, wind_speed } = w;
  const t = feels_like;
  
  let advice = `👕 *Что надеть в ${city} сейчас?*\n`;
  advice += `🌡️ Сейчас: ${temp}°C (ощущается как ${t}°C)\n`;
  advice += `📝 ${description}\n\n`;
  advice += `📋 *Рекомендации по слоям:*\n`;
  
  if (t >= 25) {
    advice += "☀️ *Верх:* легкая футболка, майка из хлопка\n🩳 *Низ:* шорты, легкие брюки, юбка\n👟 *Обувь:* сандалии, открытые кеды\n🕶️ *Аксессуары:* кепка, солнцезащитные очки";
  } else if (t >= 18) {
    advice += "🌤️ *Верх:* футболка, рубашка с коротким рукавом\n👖 *Низ:* джинсы, легкие брюки\n👟 *Обувь:* кеды, кроссовки\n🧥 *Запас:* легкая кофта на вечер";
  } else if (t >= 12) {
    advice += "🌥️ *Верх:* лонгслив, рубашка + легкая ветровка\n👖 *Низ:* джинсы, чиносы\n👟 *Обувь:* кроссовки, закрытые туфли\n🧣 *Аксессуары:* тонкий шарф";
  } else if (t >= 5) {
    advice += "🧥 *Верх:* теплый свитер + демисезонная куртка\n👖 *Низ:* плотные джинсы или брюки\n🥾 *Обувь:* ботинки, утепленные кроссовки\n🧣 *Аксессуары:* шапка, шарф, перчатки";
  } else if (t >= -5) {
    advice += "🧣 *Верх:* термобелье + свитер + зимняя куртка\n👖 *Низ:* утепленные штаны\n🥾 *Обувь:* зимние ботинки\n🧤 *Аксессуары:* теплая шапка, шарф, варежки";
  } else {
    advice += "❄️ *Верх:* плотное термобелье + флис + теплый пуховик\n👖 *Низ:* термоштаны + утепленные брюки\n🥾 *Обувь:* зимние ботинки на меху\n🧤 *Аксессуары:* шапка-ушанка, плотный шарф, варежки";
  }

  if (has_rain) advice += "\n\n☔️ *Внимание:* Идет дождь, возьмите зонт!";
  if (has_snow) advice += "\n\n☃️ *Внимание:* На улице снег, выбирайте обувь с протектором.";
  if (wind_speed > 8) advice += "\n\n💨 *Ветрено:* Наденьте непродуваемую одежду.";

  return advice;
}

// ===================== СПРАВОЧНИК ФРАЗ (ПОЛНЫЙ) =====================
const dailyPhrases = [
  { e: "Where is the nearest bus stop?", r: "Где ближайшая остановка?", c: "Транспорт" },
  { e: "How much is the fare?", r: "Сколько стоит проезд?", c: "Транспорт" },
  { e: "I'd like a window seat, please.", r: "Я хотел бы место у окна.", c: "Транспорт" },
  { e: "Keep the change.", r: "Сдачи не надо.", c: "Транспорт" },
  { e: "A table for two, please.", r: "Столик на двоих, пожалуйста.", c: "Еда" },
  { e: "The bill, please.", r: "Счет, пожалуйста.", c: "Еда" },
  { e: "What do you recommend?", r: "Что вы порекомендуете?", c: "Еда" },
  { e: "Can I try this on?", r: "Можно это примерить?", c: "Покупки" },
  { e: "How much does this cost?", r: "Сколько это стоит?", c: "Покупки" },
  { e: "I'll take it.", r: "Я это беру.", c: "Покупки" },
  { e: "Nice to meet you!", r: "Приятно познакомиться!", c: "Общение" },
  { e: "I don't understand.", r: "Я не понимаю.", c: "Общение" },
  { e: "Could you speak slower?", r: "Могли бы вы говорить медленнее?", c: "Общение" },
  { e: "I need a doctor.", r: "Мне нужен врач.", c: "Здоровье" },
  { e: "Where is the pharmacy?", r: "Где находится аптека?", c: "Здоровье" },
  { e: "Call an ambulance!", r: "Вызовите скорую!", c: "Здоровье" },
  { e: "I'm lost, help me please.", r: "Я заблудился, помогите пожалуйста.", c: "Город" },
  { e: "Where is the restroom?", r: "Где туалет?", c: "Город" }
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
  const name = generateAnonymousName(ctx.from.id);
  // Сохраняем анонимно без chat_id
  await saveOrUpdateUser({ user_id: name, city: 'Не указан' });
  
  const welcome = 
    `👋 *Привет!* Твой анонимный ник: *${name}*\n\n` +
    `Я твой ассистент по погоде и английскому. Никаких личных данных в базе.\n\n` +
    `🚀 *Команды:*\n` +
    `🌤 /weather — Погода сейчас\n` +
    `📅 /today — Прогноз на сегодня\n` +
    `👕 /wardrobe — Что надеть\n` +
    `💬 /phrase — Учить английский\n` +
    `🎮 /tetris — Мини-игра\n\n` +
    `📍 *Чтобы начать, выбери свой город:*`;

  await ctx.reply(welcome, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка поиска.');
  let m = `📍 *${w.city}* — сейчас\n───────────────────\n`;
  m += `🌡️ Температура: ${w.temp}°C\n🤔 Ощущается: ${w.feels_like}°C\n📝 ${w.description}\n`;
  m += `💨 Ветер: ${w.wind_speed} м/с (${w.wind_dir})\n💧 Влажность: ${w.humidity}%\n📊 Давление: ${w.pressure} мм`;
  await ctx.reply(m, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 ПОГОДА СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!');
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!');
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!');
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  await ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 \`${p.e}\`\n🇷🇺 ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ ФРАЗА', async (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  await ctx.reply(`🎲 \`${p.e}\` — ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const hash = generateAuthHash(name);
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(res.city || 'Не указан')}&hash=${hash}`;
  
  const msg = `🕹️ *Тетрис*\n\nВаше имя: *${name}*\n\n` +
              `Играть можно через кнопку ниже или по прямой ссылке (удобно для браузера):\n` +
              `🔗 ${url}`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));

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
    const check = await getDetailedWeatherData(ctx.message.text.trim());
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
