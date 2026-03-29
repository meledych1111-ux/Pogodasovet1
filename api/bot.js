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

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не найден!');
}
const bot = new Bot(BOT_TOKEN || 'dummy');

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ПОГОДЫ =====================
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  return directions[Math.round(degrees / 45) % 8];
}

function getCloudDescription(cloudPercent) {
  if (cloudPercent < 10) return 'Ясно ☀️';
  if (cloudPercent < 30) return 'Малооблачно 🌤️';
  if (cloudPercent < 50) return 'Переменная облачность ⛅';
  if (cloudPercent < 70) return 'Облачно с прояснениями 🌥️';
  if (cloudPercent < 85) return 'Облачно ☁️';
  return 'Пасмурно ☁️';
}

function calculateDayLength(sunrise, sunset) {
  if (!sunrise || !sunset) return '—';
  const [sH, sM] = sunrise.split(':').map(Number);
  const [eH, eM] = sunset.split(':').map(Number);
  let h = eH - sH;
  let m = eM - sM;
  if (m < 0) { h--; m += 60; }
  return `${h} ч ${m} мин`;
}

function getWeatherDescription(code) {
  const map = {
    0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 61: 'Небольшой дождь 🌧️',
    63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️', 71: 'Небольшой снег ❄️', 80: 'Ливень 🌧️', 95: 'Гроза ⛈️'
  };
  return map[code] || `Облачно`;
}

function getPrecipitationType(rain, snow) {
  if (snow > 0) return snow < 1 ? 'Небольшой снег ❄️' : 'Снег ❄️';
  if (rain > 0) return rain < 1 ? 'Небольшой дождь 🌦️' : 'Дождь 🌧️';
  return 'Без осадков ✨';
}

// ===================== API ПОГОДЫ =====================
async function getWeatherData(cityName) {
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`).then(r => r.json());
    if (!geo.results?.[0]) throw new Error('Город не найден');
    const { latitude, longitude, name } = geo.results[0];
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,weather_code,cloud_cover&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=1`).then(r => r.json());
    
    const c = w.current;
    return {
      success: true, city: name, temp: Math.round(c.temperature_2m), feels_like: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m, wind_speed: c.wind_speed_10m.toFixed(1), wind_dir: getWindDirection(c.wind_direction_10m),
      pressure: Math.round(c.pressure_msl * 0.750062), cloud_desc: getCloudDescription(c.cloud_cover),
      description: getWeatherDescription(c.weather_code), precip_type: getPrecipitationType(c.rain || 0, c.snowfall || 0),
      sunrise: w.daily.sunrise[0].substring(11, 16), sunset: w.daily.sunset[0].substring(11, 16),
      day_length: calculateDayLength(w.daily.sunrise[0].substring(11, 16), w.daily.sunset[0].substring(11, 16))
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`).then(r => r.json());
    const { latitude, longitude, name } = geo.results[0];
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,weather_code,precipitation_probability&timezone=auto&forecast_days=2`).then(r => r.json());
    
    const startIdx = dayOffset * 24;
    const periods = [
      { name: 'Ночь 🌙', range: [0, 6], title: 'Ночь' },
      { name: 'Утро 🌅', range: [6, 12], title: 'Утро' },
      { name: 'День ☀️', range: [12, 18], title: 'День' },
      { name: 'Вечер 🌆', range: [18, 24], title: 'Вечер' }
    ];

    const forecast = periods.map(p => {
      const temps = w.hourly.temperature_2m.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const feels = w.hourly.apparent_temperature.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const codes = w.hourly.weather_code.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const probs = w.hourly.precipitation_probability.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const avgTemp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
      const avgFeels = Math.round(feels.reduce((a, b) => a + b, 0) / feels.length);
      const maxProb = Math.max(...probs);
      return `${p.name} *${p.title}*: ${avgTemp}°C (ощущается ${avgFeels}°C), ${getWeatherDescription(codes[Math.floor(codes.length/2)])} (☔ ${maxProb}%)`;
    }).join('\n');

    return { success: true, city: name, periods: forecast };
  } catch (e) { return { success: false, error: 'Ошибка сети' }; }
}

// ===================== РЕКОМЕНДАЦИИ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(w) {
  if (!w.success) return '❌ Нет данных';
  const { temp, feels_like, wind_speed, precip_type, city, description } = w;
  let advice = [`👕 *Что надеть в ${city} сейчас?*`, `🌡️ *Сейчас:* ${temp}°C (ощущается ${feels_like}°C)`, `📝 ${description}\n`, `📋 *Одеваемся по погоде:*`];

  if (temp >= 25) advice.push('• Легкая футболка из хлопка, шорты или юбка. Солнцезащитные очки! 🕶️');
  else if (temp >= 18) advice.push('• Футболка, рубашка или легкое худи. На вечер возьмите кофту. 🧥');
  else if (temp >= 10) advice.push('• Худи, ветровка или легкая куртка. Кроссовки. 👟');
  else if (temp >= 0) advice.push('• Теплый свитер, демисезонное пальто, шарф. 🧣');
  else advice.push('• Зимний пуховик, шапка, перчатки. Обувь на меху. ❄️');

  if (parseFloat(wind_speed) > 7) advice.push('\n💨 *Ветрено:* Наденьте непродуваемую куртку!');
  if (precip_type.includes('дождь')) advice.push('☔ *Идет дождь:* Возьмите зонт!');
  
  return advice.join('\n');
}

// ===================== ПОЛНЫЙ РАЗГОВОРНИК =====================
const dailyPhrases = [
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая автобусная остановка?", exp: "Спрашиваем про транспорт" },
  { english: "How much does this cost?", russian: "Сколько это стоит?", exp: "Спрашиваем цену" },
  { english: "Can I try this on?", russian: "Можно это примерить?", exp: "Примерка одежды" },
  { english: "I need to see a doctor.", russian: "Мне нужно к врачу.", exp: "Вызов врача" },
  { english: "I have a headache.", russian: "У меня болит голова.", exp: "Симптомы" },
  { english: "I have a reservation.", russian: "У меня забронировано.", exp: "В отеле" },
  { english: "How do I get to the museum?", russian: "Как мне добраться до музея?", exp: "Маршрут" },
  { english: "I'm lost.", russian: "Я заблудился.", exp: "Помощь" },
  { english: "Hi, my name is...", russian: "Привет, меня зовут...", exp: "Знакомство" },
  { english: "Nice to meet you.", russian: "Приятно познакомиться.", exp: "Вежливость" },
  { english: "Practice makes perfect.", russian: "Практика ведет к совершенству.", exp: "Совет" }
];

// ===================== КЛАВИАТУРЫ =====================
const startKeyboard = new Keyboard().text('🚀 НАЧАТЬ РАБОТУ').resized();

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС')
    .text('📅 ПОГОДА СЕГОДНЯ').text('📅 ПОГОДА ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?')
    .text('💬 ФРАЗА ДНЯ')
    .text('🎲 СЛУЧАЙНАЯ ФРАЗА').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД')
    .text('ℹ️ ПОМОЩЬ').resized();

const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('📍 СЕВАСТОПОЛЬ').text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ =====================
bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: ctx.from.id.toString(), chat_id: ctx.chat.id, city: 'Не указан' });
  await ctx.reply(`👋 Привет, *${name}*!\nЯ помогу узнать погоду и поиграть в Тетрис.`, { parse_mode: 'Markdown', reply_markup: startKeyboard });
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', (ctx) => ctx.reply('🏙️ Выберите ваш город:', { reply_markup: cityKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(ctx.from.id.toString(), city);
  await ctx.reply(`✅ Город *${city}* сохранен! Теперь можно пользоваться меню.`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка: ' + w.error);
  const m = `🌤️ *${w.city} сейчас:*\n` +
            `🌡️ ${w.temp}°C (ощущается как ${w.feels_like}°C)\n` +
            `📝 ${w.description}\n` +
            `💨 Ветер: ${w.wind_speed} м/с, ${w.wind_dir}\n` +
            `💧 Влажность: ${w.humidity}% | 📊 Давление: ${w.pressure} мм\n` +
            `🌅 Восход: ${w.sunrise} | 🌇 Закат: ${w.sunset}`;
  await ctx.reply(m, { parse_mode: 'Markdown' });
});

bot.hears('📅 ПОГОДА СЕГОДНЯ', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажите город!');
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(`📅 *Прогноз в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажите город!');
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(`📅 *Прогноз в ${f.city} на завтра:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Выберите город!');
  const w = await getWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 ${p.english}\n🇷🇺 ${p.russian}\n\n💡 _${p.exp}_`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ ФРАЗА', (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  ctx.reply(`🎲 *Случайная фраза*\n\n🇬🇧 ${p.english}\n🇷🇺 ${p.russian}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const cityRes = await getUserCity(ctx.from.id);
  const city = cityRes.found ? cityRes.city : 'Не указан';
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}`;
  await ctx.reply(`🕹️ Нажми кнопку ниже, чтобы играть анонимно как *${name}*!`, {
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Тетрис', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выберите город:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));
bot.hears('ℹ️ ПОМОЩЬ', (ctx) => ctx.reply('Бот показывает погоду и помогает учить фразы. Игра доступна анонимно. Статистика и топ — внутри игры!', { reply_markup: mainMenuKeyboard }));

// ===================== ЭКСПОРТ ДЛЯ VERCEL =====================
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { await bot.handleUpdate(req.body); } catch (e) { console.error('Bot Error:', e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'active' });
}
