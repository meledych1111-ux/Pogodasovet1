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

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');
const bot = new Bot(BOT_TOKEN);

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ = :====================

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
    80: 'Небольшой ливень 🌧️', 81: 'Ливень 🌧️', 82: 'Сильный ливень 🌧️',
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
    msg += `📝 *Состояние:* ${getWeatherDescription(cur.weather_code)}\n`;
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
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code&daily=sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const start = dayOffset * 24;
    const periods = [
      { n: '🌙 Ночь (03:00)', i: start + 3 },
      { n: '🌅 Утро (09:00)', i: start + 9 },
      { n: '☀️ День (15:00)', i: start + 15 },
      { n: '🌆 Вечер (21:00)', i: start + 21 }
    ];

    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    const dateTitle = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    let msg = `📅 *Прогноз на ${dateTitle}*\n`;
    msg += `📍 *${name}*\n`;
    msg += `───────────────────\n\n`;

    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.i]);
      const f = Math.round(data.hourly.apparent_temperature[p.i]);
      const pr = data.hourly.precipitation_probability[p.i];
      const desc = getWeatherDescription(data.hourly.weather_code[p.i]);
      
      msg += `${p.n}\n`;
      msg += `🌡️ ${t}°C (ощущается ${f}°C)\n`;
      msg += `${desc}${pr > 10 ? ` | ☔ ${pr}%` : ''}\n\n`;
    });

    msg += `───────────────────\n`;
    msg += `🌅 Восход: ${data.daily.sunrise[dayOffset].substring(11, 16)}\n`;
    msg += `🌇 Закат: ${data.daily.sunset[dayOffset].substring(11, 16)}`;

    return { success: true, message: msg };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== ПОЛНЫЙ СПРАВОЧНИК ФРАЗ =====================
const dailyPhrases = [
  // ТРАНСПОРТ
  { e: "Where is the nearest bus stop?", r: "Где ближайшая автобусная остановка?", c: "Транспорт" },
  { e: "How much is the fare?", r: "Сколько стоит проезд?", c: "Транспорт" },
  { e: "Does this bus go to the center?", r: "Этот автобус едет в центр?", c: "Транспорт" },
  { e: "I'd like a ticket to London, please.", r: "Мне один билет до Лондона, пожалуйста.", c: "Транспорт" },
  { e: "Stop here, please.", r: "Остановитесь здесь, пожалуйста.", c: "Транспорт" },
  // ЕДА И РЕСТОРАН
  { e: "A table for two, please.", r: "Столик на двоих, пожалуйста.", c: "Еда" },
  { e: "Can I see the menu?", r: "Можно посмотреть меню?", c: "Еда" },
  { e: "What do you recommend?", r: "Что вы порекомендуете?", c: "Еда" },
  { e: "The bill, please.", r: "Счет, пожалуйста.", c: "Еда" },
  { e: "Could I have some water?", r: "Можно мне воды?", c: "Еда" },
  { e: "Everything was delicious, thank you!", r: "Все было очень вкусно, спасибо!", c: "Еда" },
  // ПОКУПКИ
  { e: "How much does this cost?", r: "Сколько это стоит?", c: "Покупки" },
  { e: "Do you have a smaller size?", r: "У вас есть размер поменьше?", c: "Покупки" },
  { e: "Can I try this on?", r: "Можно это примерить?", c: "Покупки" },
  { e: "Where are the fitting rooms?", r: "Где находятся примерочные?", c: "Покупки" },
  { e: "I'll take it.", r: "Я это возьму.", c: "Покупки" },
  { e: "Can I pay by card?", r: "Можно оплатить картой?", c: "Покупки" },
  // ОБЩЕНИЕ
  { e: "Nice to meet you!", r: "Приятно познакомиться!", c: "Общение" },
  { e: "How is it going?", r: "Как дела? / Как успехи?", c: "Общение" },
  { e: "Could you repeat that, please?", r: "Не могли бы вы повторить?", c: "Общение" },
  { e: "I don't understand.", r: "Я не понимаю.", c: "Общение" },
  { e: "What do you mean?", r: "Что вы имеете в виду?", c: "Общение" },
  { e: "Have a great day!", r: "Хорошего дня!", c: "Общение" },
  // ЗДОРОВЬЕ
  { e: "I need a doctor.", r: "Мне нужен врач.", c: "Здоровье" },
  { e: "Where is the pharmacy?", r: "Где находится аптека?", c: "Здоровье" },
  { e: "I have a headache.", r: "У меня болит голова.", c: "Здоровье" },
  { e: "I feel sick.", r: "Я плохо себя чувствую.", c: "Здоровье" },
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
    `Я твой ассистент по погоде и английскому. Мы уважаем приватность: никаких имен и ID в базе.\n\n` +
    `📍 Чтобы начать, выбери свой город:`,
    { parse_mode: 'Markdown', reply_markup: cityKeyboard }
  );
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
  
  const t = Math.round(w.raw.apparent_temperature);
  let advice = `👕 *Совет по одежде для ${w.city}*\n`;
  advice += `───────────────────\n`;
  advice += `🌡️ Ощущается как: ${t}°C\n\n`;
  
  if (t >= 25) advice += "На улице жара! ☀️ Надевай шорты, майку и кепку. Не забудь солнцезащитные очки.";
  else if (t >= 18) advice += "Тепло и комфортно. 👕 Подойдет футболка или легкая рубашка с джинсами.";
  else if (t >= 10) advice += "Прохладно. 🧥 Стоит надеть легкую куртку, свитшот или худи.";
  else if (t >= 0) advice += "Холодно. 🧣 Время осенней куртки, шарфа и закрытой обуви.";
  else advice += "Мороз! ❄️ Надевай теплый пуховик, шапку, варежки и термобелье.";

  if (w.raw.rain > 0) advice += "\n\n☔️ *Возьми зонт!* Идет дождь.";
  
  await ctx.reply(advice, { parse_mode: 'Markdown' });
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
    `🕹️ *Тетрис*\n\nТвое анонимное имя: *${name}*\nГород: *${res.city}*\n\nНажми кнопку ниже, чтобы начать игру и попасть в таблицу лидеров!`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url } }]] }
    }
  );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));
bot.hears('✏️ ДРУГОЙ ГОРОД', (ctx) => ctx.reply('Напиши название своего города:'));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => {
  ctx.reply(
    `*Как пользоваться ботом?*\n\n` +
    `1. 🌤️ Погода — детальные данные и прогноз на 2 дня.\n` +
    `2. 👕 Одежда — умные советы на основе температуры.\n` +
    `3. 💬 Английский — учи фразы каждый день.\n` +
    `4. 🎮 Тетрис — играй анонимно, соревнуйся по городам.\n\n` +
    `Твое имя генерируется автоматически и не содержит личных данных.`,
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
    ctx.reply('❌ Город не найден. Попробуй ввести название на русском или английском.', { reply_markup: cityKeyboard });
  }
});

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
