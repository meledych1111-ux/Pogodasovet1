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
  getUserProfile,
  generateAnonymousName
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config();
dotenv.config({ path: envPath });

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');
const bot = new Bot(BOT_TOKEN);

// ===================== ХРАНИЛИЩЕ И КЭШ =====================
const weatherCache = new Map();
const rateLimit = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const userLimit = rateLimit.get(userId) || { count: 0, lastRequest: 0 };
  if (now - userLimit.lastRequest > 60000) userLimit.count = 0;
  userLimit.count++;
  userLimit.lastRequest = now;
  rateLimit.set(userId, userLimit);
  return userLimit.count > 40;
}

function generateAuthHash(name) {
  const secret = process.env.BOT_TOKEN || 'fallback';
  return crypto.createHash('sha256').update(name + secret).digest('hex').substring(0, 16);
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОГОДЫ =====================

function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['С ⬆️', 'СВ ↗️', 'В ➡️', 'ЮВ ↘️', 'Ю ⬇️', 'ЮЗ ↙️', 'З ⬅️', 'СЗ ↖️'];
  return directions[Math.round(degrees / 45) % 8];
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
    80: 'Небольшой ливень 🌧️', 81: 'Ливень 🌧️', 82: 'Сильный ливень 🌧️',
    85: 'Небольшой снегопад ❄️', 86: 'Сильный снегопад ❄️',
    95: 'Гроза ⛈️', 96: 'Гроза с градом ⛈️', 99: 'Сильная гроза с градом ⛈️'
  };
  return weatherMap[code] || `Код погоды: ${code}`;
}

function getPrecipitationType(rain, snow) {
  if (snow > 0) return snow < 1 ? 'Небольшой снег ❄️' : snow < 3 ? 'Снег ❄️' : 'Сильный снегопад ❄️❄️';
  if (rain > 0) return rain < 1 ? 'Небольшой дождь 🌦️' : rain < 3 ? 'Дождь 🌧️' : 'Сильный дождь 🌧️';
  return 'Без осадков ✨';
}

// ===================== УЛУЧШЕННЫЕ ФУНКЦИИ ПОГОДЫ =====================

async function getWeatherData(cityName, forceRefresh = false) {
  try {
    const cacheKey = `current_${cityName.toLowerCase()}`;
    const now = Date.now();
    if (!forceRefresh && weatherCache.has(cacheKey)) {
      const cached = weatherCache.get(cacheKey);
      if (now - cached.timestamp < 600000) return cached.data;
    }

    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,precipitation,rain,snowfall,weather_code,cloud_cover,visibility,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(weatherUrl);
    const wData = await wRes.json();
    const cur = wData.current;
    const daily = wData.daily;

    const sunrise = daily?.sunrise?.[0]?.substring(11, 16) || '—';
    const sunset = daily?.sunset?.[0]?.substring(11, 16) || '—';

    const result = {
      success: true, city: name, temp: Math.round(cur.temperature_2m), feels_like: Math.round(cur.apparent_temperature),
      humidity: cur.relative_humidity_2m, pressure: Math.round(cur.pressure_msl * 0.750062),
      wind_speed: cur.wind_speed_10m.toFixed(1), wind_dir: getWindDirection(cur.wind_direction_10m),
      description: getWeatherDescription(cur.weather_code), cloud_desc: getCloudDescription(cur.cloud_cover),
      precip_type: getPrecipitationType(cur.rain || 0, cur.snowfall || 0), has_precipitation: (cur.rain > 0 || cur.snowfall > 0),
      rain_now: cur.rain || 0, snow_now: cur.snowfall || 0,
      sunrise, sunset, day_length: calculateDayLength(sunrise, sunset),
      visibility_km: cur.visibility ? (cur.visibility / 1000).toFixed(1) : '>10',
      date: new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
    };
    weatherCache.set(cacheKey, { data: result, timestamp: now });
    return result;
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedPeriodForecast(cityName, dayOffset = 0) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const start = dayOffset * 24;
    const periods = [
      { n: '🌙 Ночь (03:00)', i: start + 3, e: '🌙' },
      { n: '🌅 Утро (09:00)', i: start + 9, e: '🌅' },
      { n: '☀️ День (15:00)', i: start + 15, e: '☀️' },
      { n: '🌆 Вечер (21:00)', i: start + 21, e: '🌆' }
    ];

    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    const dateTitle = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    let output = "";
    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.i]);
      const f = Math.round(data.hourly.apparent_temperature[p.i]);
      const pr = data.hourly.precipitation_probability[p.i];
      const desc = getWeatherDescription(data.hourly.weather_code[p.i]);
      output += `${p.e} *${p.n}*\n`;
      output += `🌡️ ${t}°C (ощущается ${f}°C)\n`;
      output += `📝 ${desc}${pr > 10 ? ` | ☔ ${pr}%` : ''}\n\n`;
    });

    return {
      success: true, city: name, date: dateTitle, periods: output,
      sunrise: data.daily.sunrise[dayOffset].substring(11, 16),
      sunset: data.daily.sunset[dayOffset].substring(11, 16),
      min: Math.round(data.daily.temperature_2m_min[dayOffset]),
      max: Math.round(data.daily.temperature_2m_max[dayOffset])
    };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== ФУНКЦИЯ РЕКОМЕНДАЦИЙ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Нет данных о погоде.';
  const { temp, feels_like, wind_speed, rain_now, snow_now, has_precipitation, city, description } = w;
  const advice = [`👕 *Что надеть в ${city} сейчас?*\n`, `🌡️ *Сейчас:* ${temp}°C (ощущается ${feels_like}°C)\n📝 ${description}\n\n📋 *Одеваемся по погоде:*\n`];
  
  if (temp >= 25) {
    advice.push('👕 *Базовый слой:* майка, футболка из хлопка\n🩳 *Низ:* шорты, легкие брюки\n👟 *Обувь:* сандалии, кеды\n🕶️ *Аксессуары:* кепка, очки');
  } else if (temp >= 20) {
    advice.push('👕 *Базовый слой:* футболка, рубашка\n👖 *Низ:* джинсы, брюки\n👟 *Обувь:* кроссовки, кеды\n🧥 *На вечер:* легкая кофта');
  } else if (temp >= 15) {
    advice.push('👕 *Базовый слой:* лонгслив, рубашка\n🧥 *Верх:* свитер, легкая куртка\n👖 *Низ:* джинсы\n👟 *Обувь:* кроссовки');
  } else if (temp >= 10) {
    advice.push('👕 *Базовый слой:* термобелье, лонгслив\n🧥 *Верх:* плотный свитер, ветровка\n👖 *Низ:* утепленные джинсы\n🧣 *Аксессуары:* шарф');
  } else if (temp >= 5) {
    advice.push('🧥 *Верх:* теплый свитер, демисезонная куртка\n👖 *Низ:* утепленные штаны\n👟 *Обувь:* ботинки\n🧣 *Аксессуары:* шапка, шарф, перчатки');
  } else if (temp >= 0) {
    advice.push('🧥 *Верх:* пуховик, зимняя куртка\n👖 *Низ:* термоштаны\n👟 *Обувь:* зимние ботинки\n🧣 *Аксессуары:* теплая шапка, шарф, варежки');
  } else {
    advice.push('🧥 *Верх:* плотный пуховик, парка\n👖 *Низ:* термобелье + теплые брюки\n👟 *Обувь:* зимние ботинки на меху\n🧣 *Аксессуары:* теплая шапка, шарф, варежки, балаклава');
  }

  if (has_precipitation) {
    advice.push('\n\n🌧️ *Осадки:*');
    if (snow_now > 0) advice.push('\n   • ❄️ Непромокаемая обувь\n   • 🧤 Теплые варежки');
    else if (rain_now > 0) advice.push('\n   • ☔ Зонт или дождевик\n   • 👢 Непромокаемая обувь');
  }

  const tempDiff = Math.abs(temp - feels_like);
  if (tempDiff > 2) {
    advice.push(`\n\n🌡️ *Важно:* Ощущается на ${tempDiff}°C ${feels_like < temp ? 'холоднее' : 'теплее'}!`);
  }

  return advice.join('');
}

// ===================== СПРАВОЧНИК ФРАЗ (ПОЛНЫЙ) =====================
const dailyPhrases = [
  // ТРАНСПОРТ
  { e: "Where is the nearest bus stop?", r: "Где ближайшая остановка?", c: "Транспорт" },
  { e: "How often do the buses run?", r: "Как часто ходят автобусы?", c: "Транспорт" },
  { e: "A return ticket to London, please.", r: "Билет туда-обратно до Лондона, пожалуйста.", c: "Транспорт" },
  { e: "Is this the right platform for Oxford?", r: "Это нужная платформа на Оксфорд?", c: "Транспорт" },
  { e: "Keep the change.", r: "Сдачи не надо.", c: "Транспорт" },
  // ЕДА
  { e: "A table for two, please.", r: "Столик на двоих, пожалуйста.", c: "Еда" },
  { e: "Do you have a vegetarian menu?", r: "У вас есть вегетарианское меню?", c: "Еда" },
  { e: "I'm allergic to nuts.", r: "У меня аллергия на орехи.", c: "Еда" },
  { e: "Could we see the wine list?", r: "Можно винную карту?", c: "Еда" },
  { e: "The bill, please.", r: "Счет, пожалуйста.", c: "Еда" },
  { e: "Everything was delicious!", r: "Все было очень вкусно!", c: "Еда" },
  // МАГАЗИН
  { e: "How much does this cost?", r: "Сколько это стоит?", c: "Покупки" },
  { e: "Can I try this on?", r: "Можно это примерить?", c: "Покупки" },
  { e: "Where are the fitting rooms?", r: "Где примерочные?", c: "Покупки" },
  { e: "Do you have a larger size?", r: "У вас есть размер побольше?", c: "Покупки" },
  { e: "I'll take it.", r: "Я это беру.", c: "Покупки" },
  { e: "Can I pay by card?", r: "Можно оплатить картой?", c: "Покупки" },
  // ОБЩЕНИЕ
  { e: "Nice to meet you!", r: "Приятно познакомиться!", c: "Общение" },
  { e: "What do you do for a living?", r: "Чем вы занимаетесь (по жизни)?", c: "Общение" },
  { e: "Could you speak slower, please?", r: "Не могли бы вы говорить медленнее?", c: "Общение" },
  { e: "I don't understand.", r: "Я не понимаю.", c: "Общение" },
  { e: "Have a nice day!", r: "Хорошего дня!", c: "Общение" },
  { e: "See you later!", r: "До встречи!", c: "Общение" },
  // ЗДОРОВЬЕ
  { e: "I need to see a doctor.", r: "Мне нужно к врачу.", c: "Здоровье" },
  { e: "I have a headache.", r: "У меня болит голова.", c: "Здоровье" },
  { e: "Where is the nearest pharmacy?", r: "Где ближайшая аптека?", c: "Здоровье" },
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
    .text('✏️ ДРУГОЙ ГОРОД').text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: name, city: 'Не указан' });
  await ctx.reply(
    `👋 Привет! Твое анонимное имя: *${name}*\n\n` +
    `Я твой ассистент. Мы не храним твой ID или личные данные. Всё общение привязано к "облачному имени".\n\n` +
    `📍 Выбери свой город, чтобы начать:`,
    { parse_mode: 'Markdown', reply_markup: cityKeyboard }
  );
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  if (isRateLimited(ctx.from.id)) return ctx.reply('⏳ Слишком много запросов.');
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка поиска.');
  
  let msg = `📍 *Погода в ${w.city} сейчас*\n`;
  msg += `📅 ${w.date}\n───────────────────\n`;
  msg += `🌡️ *Температура:* ${w.temp}°C\n`;
  msg += `🤔 *Ощущается как:* ${w.feels_like}°C\n`;
  msg += `📝 *Состояние:* ${w.description}\n───────────────────\n`;
  msg += `💨 *Ветер:* ${w.wind_speed} м/с (${w.wind_dir})\n`;
  msg += `📊 *Давление:* ${w.pressure} мм рт. ст.\n`;
  msg += `💧 *Влажность:* ${w.humidity}%\n`;
  msg += `☁️ *Облачность:* ${w.cloud_desc}\n\n`;
  msg += `🌅 Восход: ${w.sunrise} | 🌇 Закат: ${w.sunset}\n`;
  msg += `⏳ Обновлено: ${new Date().toLocaleTimeString('ru-RU')}`;
  
  await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 ПОГОДА СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!', { reply_markup: cityKeyboard });
  
  const f = await getDetailedPeriodForecast(res.city, 0);
  if (!f.success) return ctx.reply('❌ Ошибка.');

  let msg = `📅 *Прогноз на сегодня*\n📍 *${f.city}* (${f.date})\n`;
  msg += `📊 Обзор: от ${f.min}° до ${f.max}°C\n───────────────────\n\n`;
  msg += f.periods;
  msg += `───────────────────\n`;
  msg += `🌅 Восход: ${f.sunrise} | 🌇 Закат: ${f.sunset}`;
  
  await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!', { reply_markup: cityKeyboard });
  
  const f = await getDetailedPeriodForecast(res.city, 1);
  if (!f.success) return ctx.reply('❌ Ошибка.');

  let msg = `📅 *Прогноз на завтра*\n📍 *${f.city}* (${f.date})\n`;
  msg += `📊 Обзор: от ${f.min}° до ${f.max}°C\n───────────────────\n\n`;
  msg += f.periods;
  msg += `───────────────────\n`;
  msg += `🌅 Восход: ${f.sunrise} | 🌇 Закат: ${f.sunset}`;
  
  await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
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
    `🕹️ *Тетрис*\n\nТвое анонимное имя: *${name}*\nГород: *${res.city}*\n\nНажми кнопку ниже для запуска игры:`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🎮 Начать игру', web_app: { url } }]] }
    }
  );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));
bot.hears('✏️ ДРУГОЙ ГОРОД', (ctx) => ctx.reply('Напиши название города (напр. Казань):'));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => {
  ctx.reply(
    `*Справка:*\n\n` +
    `• Погода СЕЙЧАС — текущие данные.\n` +
    `• Погода СЕГОДНЯ/ЗАВТРА — прогноз по периодам.\n` +
    `• Одежда — умный совет что надеть.\n` +
    `• Фразы — учи английский анонимно.\n` +
    `• Тетрис — играй и попадай в топ.\n\n` +
    `Твой ID не хранится в базе.`,
    { parse_mode: 'Markdown' }
  );
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const name = generateAnonymousName(ctx.from.id);
  try {
    const check = await getWeatherData(ctx.message.text.trim());
    if (!check.success) throw new Error();
    await saveUserCity(name, check.city);
    await ctx.reply(`✅ Город *${check.city}* успешно выбран!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ Город не найден. Попробуй еще раз.', { reply_markup: cityKeyboard });
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
