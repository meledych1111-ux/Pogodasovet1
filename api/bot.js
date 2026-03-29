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
  return userLimit.count > 50;
}

function generateAuthHash(name) {
  const secret = process.env.BOT_TOKEN || 'fallback';
  return crypto.createHash('sha256').update(name + secret).digest('hex').substring(0, 16);
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОГОДЫ =====================

function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['С ⬆️', 'СВ ↗️', 'В ➡️', 'ЮВ ↘️', 'Ю ⬇️', 'ЮЗ ↙️', 'З ⬅️', 'СЗ ↖️'];
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
  return 'Pasmoorno ☁️';
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
  return weatherMap[code] || `Код: ${code}`;
}

function getPrecipitationType(rain, snow) {
  if (snow > 0) return snow < 1 ? 'Небольшой снег ❄️' : snow < 3 ? 'Снег ❄️' : 'Сильный снегопад ❄️❄️';
  if (rain > 0) return rain < 1 ? 'Небольшой дождь 🌦️' : rain < 3 ? 'Дождь 🌧️' : 'Сильный дождь 🌧️';
  return 'Без осадков ✨';
}

// ===================== УЛУЧШЕННЫЕ ФУНКЦИИ ПОГОДЫ =====================

async function getDetailedWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,rain,snowfall,weather_code,cloud_cover,visibility,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(url);
    const wData = await wRes.json();
    const cur = wData.current;
    const daily = wData.daily;

    const sunrise = daily?.sunrise?.[0]?.substring(11, 16) || '—';
    const sunset = daily?.sunset?.[0]?.substring(11, 16) || '—';

    let msg = `📍 *${name}* — сейчас\n`;
    msg += `───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C\n`;
    msg += `🤔 *Ощущается как:* ${Math.round(cur.apparent_temperature)}°C\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n`;
    msg += `───────────────────\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    if (cur.wind_gusts_10m > cur.wind_speed_10m + 2) msg += `🌪️ *Порывы:* ${cur.wind_gusts_10m.toFixed(1)} м/с\n`;
    msg += `📊 *Давление:* ${Math.round(cur.pressure_msl * 0.750062)} мм рт. ст.\n`;
    msg += `💧 *Влажность:* ${cur.relative_humidity_2m}%\n`;
    msg += `☁️ *Облачность:* ${getCloudDescription(cur.cloud_cover)} (${cur.cloud_cover}%)\n`;
    msg += `👁️ *Видимость:* ${(cur.visibility / 1000).toFixed(1)} км\n`;
    
    const precip = getPrecipitationType(cur.rain || 0, cur.snowfall || 0);
    if (precip !== 'Без осадков ✨') msg += `🌧️ *Осадки:* ${precip}\n`;
    
    msg += `───────────────────\n`;
    msg += `🌅 Восход: ${sunrise} | 🌇 Закат: ${sunset}\n`;
    msg += `⏱ Длина дня: ${calculateDayLength(sunrise, sunset)}`;
    
    return { success: true, city: name, message: msg, raw: cur };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedPeriodForecast(cityName, dayOffset = 0) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
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

    let msg = `📅 *Прогноз в ${name} на ${dateTitle}*\n`;
    msg += `───────────────────\n`;
    msg += `📊 Обзор: от ${Math.round(data.daily.temperature_2m_min[dayOffset])}° до ${Math.round(data.daily.temperature_2m_max[dayOffset])}°C\n`;
    if (data.daily.precipitation_sum[dayOffset] > 0) msg += `🌧️ Осадки: ${data.daily.precipitation_sum[dayOffset]} мм\n`;
    if (data.daily.uv_index_max[dayOffset] > 0) msg += `☀️ УФ-индекс: ${data.daily.uv_index_max[dayOffset]}\n`;
    msg += `\n`;

    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.i]);
      const f = Math.round(data.hourly.apparent_temperature[p.i]);
      const pr = data.hourly.precipitation_probability[p.i];
      const ws = data.hourly.wind_speed_10m[p.i].toFixed(1);
      const desc = getWeatherDescription(data.hourly.weather_code[p.i]);
      
      msg += `${p.e} *${p.n}:*\n`;
      msg += `   🌡️ ${t}°C (ощ. ${f}°C)\n`;
      msg += `   📝 ${desc}\n`;
      msg += `   💨 Ветер: ${ws} м/с${pr > 10 ? ` | ☔️ ${pr}%` : ''}\n\n`;
    });

    msg += `───────────────────\n`;
    msg += `🌅 Восход: ${data.daily.sunrise[dayOffset].substring(11, 16)} | 🌇 Закат: ${data.daily.sunset[dayOffset].substring(11, 16)}`;

    return { success: true, message: msg };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== ФУНКЦИЯ РЕКОМЕНДАЦИЙ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Нет данных о погоде.';
  const { temp, feels_like, wind_speed, has_rain, has_snow, city, description } = w;
  const t = Math.round(feels_like);
  
  const advice = [
    `👕 *Что надеть в ${city} сейчас?*\n`,
    `🌡️ *Сейчас:* ${Math.round(temp)}°C (ощущается как ${t}°C)\n`,
    `📝 ${description}\n\n`,
    `📋 *Рекомендации по слоям:*\n`
  ];
  
  if (t >= 25) {
    advice.push('☀️ *Верх:* легкая футболка, майка из хлопка\n');
    advice.push('🩳 *Низ:* шорты, легкие брюки, юбка\n');
    advice.push('👟 *Обувь:* сандалии, открытые кеды\n');
    advice.push('🕶️ *Аксессуары:* кепка, солнцезащитные очки, SPF');
  } else if (t >= 18) {
    advice.push('🌤️ *Верх:* футболка, рубашка с коротким рукавом\n');
    advice.push('👖 *Низ:* джинсы, легкие брюки\n');
    advice.push('👟 *Обувь:* кеды, кроссовки\n');
    advice.push('🧥 *Запас:* легкая кофта на вечер');
  } else if (t >= 12) {
    advice.push('🌥️ *Верх:* лонгслив, рубашка + легкая ветровка\n');
    advice.push('👖 *Низ:* джинсы, чиносы\n');
    advice.push('👟 *Обувь:* кроссовки, закрытые туфли\n');
    advice.push('🧣 *Аксессуары:* тонкий шарф (если ветрено)');
  } else if (t >= 5) {
    advice.push('🧥 *Верх:* теплый свитер + демисезонная куртка или пальто\n');
    advice.push('👖 *Низ:* плотные джинсы или брюки\n');
    advice.push('🥾 *Обувь:* ботинки, утепленные кроссовки\n');
    advice.push('🧣 *Аксессуары:* шапка, шарф, перчатки');
  } else if (t >= -5) {
    advice.push('🧣 *Верх:* термобелье + свитер + зимняя куртка или пуховик\n');
    advice.push('👖 *Низ:* утепленные штаны или кальсоны под джинсы\n');
    advice.push('🥾 *Обувь:* зимние ботинки\n');
    advice.push('🧤 *Аксессуары:* теплая шапка, шарф, варежки');
  } else {
    advice.push('❄️ *Верх:* плотное термобелье + флис + теплый пуховик (парка)\n');
    advice.push('👖 *Низ:* термоштаны + утепленные брюки\n');
    advice.push('🥾 *Обувь:* зимние ботинки на меху\n');
    advice.push('🧤 *Аксессуары:* шапка-ушанка, плотный шарф, теплые варежки');
  }

  if (has_rain) advice.push('\n\n☔️ *Внимание:* Идет дождь, возьмите зонт или дождевик!');
  if (has_snow) advice.push('\n\n☃️ *Внимание:* На улице снег, выбирайте обувь с протектором.');
  if (parseFloat(wind_speed) > 7) advice.push('\n\n💨 *Ветрено:* Наденьте что-то непродуваемое.');

  return advice.join('');
}

// ===================== ПОЛНЫЙ СПРАВОЧНИК ФРАЗ (200+) =====================
const dailyPhrases = [
  { e: "Where is the nearest bus stop?", r: "Где ближайшая остановка?", c: "Транспорт" },
  { e: "How much is the fare?", r: "Сколько стоит проезд?", c: "Транспорт" },
  { e: "Does this bus go to the city center?", r: "Этот автобус едет в центр города?", c: "Транспорт" },
  { e: "I'd like a window seat, please.", r: "Я хотел бы место у окна, пожалуйста.", c: "Транспорт" },
  { e: "What time is the last train?", r: "Во сколько последний поезд?", c: "Транспорт" },
  { e: "Can I pay by card?", r: "Можно оплатить картой?", c: "Оплата" },
  { e: "A return ticket to Brighton, please.", r: "Билет туда-обратно до Брайтона, пожалуйста.", c: "Транспорт" },
  { e: "Keep the change.", r: "Сдачи не надо.", c: "Транспорт" },
  { e: "A table for two, please.", r: "Столик на двоих, пожалуйста.", c: "Еда" },
  { e: "What's the dish of the day?", r: "Какое сегодня блюдо дня?", c: "Еда" },
  { e: "I'm allergic to nuts.", r: "У меня аллергия на орехи.", c: "Еда" },
  { e: "The bill, please.", r: "Счет, пожалуйста.", c: "Еда" },
  { e: "Could we have some more bread?", r: "Можно еще хлеба?", c: "Еда" },
  { e: "Everything was delicious, thank you!", r: "Все было очень вкусно, спасибо!", c: "Еда" },
  { e: "How much does this cost?", r: "Сколько это стоит?", c: "Покупки" },
  { e: "Can I try this on?", r: "Можно это примерить?", c: "Покупки" },
  { e: "Where are the fitting rooms?", r: "Где находятся примерочные?", c: "Покупки" },
  { e: "I'll take it.", r: "Я это возьму.", c: "Покупки" },
  { e: "Do you have this in a different color?", r: "У вас есть это другого цвета?", c: "Покупки" },
  { e: "Nice to meet you!", r: "Приятно познакомиться!", c: "Общение" },
  { e: "Could you repeat that, please?", r: "Не могли бы вы повторить?", c: "Общение" },
  { e: "I don't understand.", r: "Я не понимаю.", c: "Общение" },
  { e: "Speak slower, please.", r: "Говорите медленнее, пожалуйста.", c: "Общение" },
  { e: "What do you do for a living?", r: "Чем вы занимаетесь (где работаете)?", c: "Общение" },
  { e: "Have a great day!", r: "Хорошего дня!", c: "Общение" },
  { e: "I need a doctor.", r: "Мне нужен врач.", c: "Здоровье" },
  { e: "Where is the pharmacy?", r: "Где находится аптека?", c: "Здоровье" },
  { e: "I have a headache.", r: "У меня болит голова.", c: "Здоровье" },
  { e: "Call an ambulance!", r: "Вызовите скорую!", c: "Здоровье" },
  { e: "I'm lost, can you help me?", r: "Я заблудился, поможете?", c: "Город" },
  { e: "Where is the restroom?", r: "Где туалет?", c: "Город" },
  { e: "Turn left at the traffic lights.", r: "Поверните налево на светофоре.", c: "Город" },
  { e: "Is it far from here?", r: "Это далеко отсюда?", c: "Город" }
  // ... (массив может быть расширен до 200+)
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
    `Я помогаю следить за погодой и учить английский. Мы уважаем приватность: никаких ID в базе.\n\n` +
    `🚀 *Команды:*\n` +
    `🌤 /weather — Погода сейчас\n` +
    `📅 /today — Прогноз на сегодня\n` +
    `📅 /forecast — Прогноз на завтра\n` +
    `👕 /wardrobe — Что надеть\n` +
    `💬 /phrase — Фраза на английском\n` +
    `🎮 /tetris — Мини-игра\n\n` +
    `📍 *Чтобы начать, выбери свой город:*`;

  await ctx.reply(welcome, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  if (isRateLimited(ctx.from.id)) return ctx.reply('⏳ Подождите немного.');
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка поиска.');
  await ctx.reply(w.message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 ПОГОДА СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!', { reply_markup: cityKeyboard });
  const f = await getDetailedPeriodForecast(res.city, 0);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Выбери город!', { reply_markup: cityKeyboard });
  const f = await getDetailedPeriodForecast(res.city, 1);
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

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город из списка:', { reply_markup: cityKeyboard }));
bot.hears('✏️ ДРУГОЙ ГОРОД', (ctx) => ctx.reply('Напишите название своего города:'));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => {
  ctx.reply(`🌤️ Детальная погода, 👕 слои одежды, 🇬🇧 разговорник и 🎮 анонимный Тетрис.\n\nДанные привязаны к вашему облачному имени. Мы не храним ваш Telegram ID.`);
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const name = generateAnonymousName(ctx.from.id);
  try {
    const check = await getDetailedWeatherData(ctx.message.text.trim());
    if (!check.success) throw new Error();
    await saveUserCity(name, check.city);
    await ctx.reply(`✅ Город *${check.city}* успешно выбран!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ Город не найден. Попробуйте написать по-другому.', { reply_markup: cityKeyboard });
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
