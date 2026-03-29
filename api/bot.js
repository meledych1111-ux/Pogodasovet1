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

function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 61: 'Небольшой дождь 🌧️',
    63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️', 71: 'Небольшой снег ❄️', 80: 'Ливень 🌧️', 95: 'Гроза ⛈️'
  };
  return weatherMap[code] || `Облачно`;
}

async function getWeatherData(cityName) {
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`).then(r => r.json());
    if (!geo.results?.[0]) throw new Error('Город не найден');
    const { latitude, longitude, name } = geo.results[0];
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,weather_code,cloud_cover&daily=sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=1`).then(r => r.json());
    return {
      success: true, city: name, temp: Math.round(w.current.temperature_2m), feels_like: Math.round(w.current.apparent_temperature),
      humidity: w.current.relative_humidity_2m, wind_speed: w.current.wind_speed_10m.toFixed(1), wind_dir: getWindDirection(w.current.wind_direction_10m),
      pressure: Math.round(w.current.pressure_msl * 0.750062), cloud_desc: getCloudDescription(w.current.cloud_cover),
      description: getWeatherDescription(w.current.weather_code)
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`).then(r => r.json());
    if (!geo.results?.[0]) throw new Error('Город не найден');
    const { latitude, longitude, name } = geo.results[0];
    const data = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,weather_code,precipitation_probability&timezone=auto&forecast_days=2`).then(r => r.json());
    const startIdx = dayOffset * 24;
    const periods = [{ name: 'Ночь 🌙', range: [0, 6] }, { name: 'Утро 🌅', range: [6, 12] }, { name: 'День ☀️', range: [12, 18] }, { name: 'Вечер 🌆', range: [18, 24] }];
    const forecast = periods.map(p => {
      const temps = data.hourly.temperature_2m.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const codes = data.hourly.weather_code.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const probs = data.hourly.precipitation_probability.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const avgTemp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
      const maxProb = Math.max(...probs);
      return `*${p.name}*: ${avgTemp}°C, ${getWeatherDescription(codes[Math.floor(codes.length/2)])} (☔ ${maxProb}%)`;
    }).join('\n');
    return { success: true, city: name, periods: forecast };
  } catch (e) { return { success: false, error: e.message }; }
}

function getWardrobeAdvice(w) {
  if (!w.success) return '❌ Данные недоступны';
  const { temp, feels_like, wind_speed, city, description } = w;
  let advice = [`👕 *Что надеть в ${city} сейчас?*`, `🌡️ ${temp}°C (ощ. ${feels_like}°C)\n`, `📋 *Советы:*` ];
  if (temp >= 25) advice.push('• Легкая футболка, шорты или юбка. 👕', '• Обязательно очки! 🕶️');
  else if (temp >= 18) advice.push('• Футболка и легкие брюки. 👖', '• На вечер возьмите кофту. 🧥');
  else if (temp >= 10) advice.push('• Худи, ветровка или легкая куртка. 🧥', '• Кроссовки или ботинки. 👟');
  else if (temp >= 0) advice.push('• Пальто или теплая куртка, шарф. 🧣');
  else advice.push('• Зимний пуховик, шапка и перчатки. ❄️', '• Теплая обувь. 🥾');
  if (parseFloat(wind_speed) > 7) advice.push('\n💨 *Ветрено:* Наденьте что-то непродуваемое!');
  return advice.join('\n');
}

// ===================== РАЗГОВОРНИК =====================
const dailyPhrases = [
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая остановка?", exp: "Про транспорт." },
  { english: "How much does this cost?", russian: "Сколько это стоит?", exp: "Про цену." },
  { english: "I need to see a doctor.", russian: "Мне нужно к врачу.", exp: "Про здоровье." },
  { english: "I have a reservation.", russian: "У меня забронировано.", exp: "В отеле." },
  { english: "How do I get to the museum?", russian: "Как мне добраться до музея?", exp: "Маршрут." },
  { english: "Practice makes perfect.", russian: "Практика ведет к совершенству.", exp: "Делай больше для результата." }
];

// ===================== КЛАВИАТУРЫ =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').text('💬 ФРАЗА ДНЯ').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ').resized();

const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('📍 СЕВАСТОПОЛЬ').text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ =====================
bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: ctx.from.id.toString(), chat_id: ctx.chat.id, city: 'Не указан' });
  await ctx.reply(`👋 Привет! Твое имя: *${name}*\nУкажи город для прогноза погоды.`, { parse_mode: 'Markdown', reply_markup: new Keyboard().text('🚀 НАЧАТЬ РАБОТУ').resized() });
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', (ctx) => ctx.reply('🏙️ Выберите ваш город:', { reply_markup: cityKeyboard }));

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка: ' + w.error);
  await ctx.reply(`🌤️ *${w.city} сейчас:*\n🌡️ ${w.temp}°C (ощущается как ${w.feels_like}°C)\n📝 ${w.description}\n💨 Ветер: ${w.wind_speed} м/с`, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажи город!');
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(`📅 *Прогноз в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажи город!');
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
  ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 ${p.english}\n🇷🇺 ${p.russian}\n\n💡 ${p.explanation || ''}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const cityRes = await getUserCity(ctx.from.id);
  const city = cityRes.found ? cityRes.city : 'Не указан';
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}`;
  await ctx.reply(`🕹️ Играй анонимно как *${name}*!`, {
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Тетрис', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выберите город:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(ctx.from.id.toString(), city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => ctx.reply('Бот показывает погоду и советы по одежде. Игра в Тетрис доступна анонимно.', { reply_markup: mainMenuKeyboard }));

// ===================== ЭКСПОРТ ДЛЯ VERCEL =====================
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      if (!bot.isInited()) {
        await bot.init();
      }
      await bot.handleUpdate(req.body);
    } catch (e) {
      console.error('Bot Update Error:', e);
    }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'running' });
}
