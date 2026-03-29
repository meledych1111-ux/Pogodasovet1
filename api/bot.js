import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
  saveOrUpdateUser,
  generateAnonymousName,
  convertUserIdForDb
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config();
dotenv.config({ path: envPath });

// ===================== КОНФИГУРАЦИЯ =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не найден в .env!');
}
const bot = new Bot(BOT_TOKEN || 'dummy');

// ===================== ПОЛНЫЙ РАЗГОВОРНИК =====================
const dailyPhrases = [
  { english: "Consistency is the key to success.", russian: "Постоянство — залог успеха.", explanation: "Важно делать что-то регулярно.", category: "Мотивация" },
  { english: "Better late than never.", russian: "Лучше поздно, чем никогда.", explanation: "Важно закончить начатое.", category: "Пословицы" },
  { english: "Take it easy.", russian: "Расслабься / Не принимай близко к сердцу.", explanation: "Совет не переживать по пустякам.", category: "Общение" },
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая автобусная остановка?", explanation: "Спрашиваем про общественный транспорт", category: "Транспорт" },
  { english: "I'd like a window seat, please.", russian: "Я хотел бы место у окна, пожалуйста.", explanation: "Заказываем место в транспорте", category: "Транспорт" },
  { english: "How much does this cost?", russian: "Сколько это стоит?", explanation: "Спрашиваем цену", category: "Покупки" },
  { english: "Can I try this on?", russian: "Можно это примерить?", explanation: "Примерка одежды", category: "Покупки" },
  { english: "I need to see a doctor.", russian: "Мне нужно к врачу.", explanation: "Вызов врача", category: "Здоровье" },
  { english: "I have a headache.", russian: "У меня болит голова.", explanation: "Симптомы", category: "Здоровье" },
  { english: "I have a reservation.", russian: "У меня забронировано.", explanation: "В отеле или ресторане", category: "Гостиница" },
  { english: "How do I get to the museum?", russian: "Как мне добраться до музея?", explanation: "Поиск пути", category: "Город" },
  { english: "Practice makes perfect.", russian: "Практика ведет к совершенству.", explanation: "Делай больше для результата.", category: "Пословицы" }
];

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ПОГОДЫ =====================
function getWeatherDescription(code) {
  const map = { 
    0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Облачно ⛅', 3: 'Пасмурно ☁️', 
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Морось 🌧️', 61: 'Небольшой дождь 🌧️', 
    63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️', 71: 'Снег ❄️', 80: 'Ливень 🌧️', 95: 'Гроза ⛈️' 
  };
  return map[code] || 'Облачно 🌥️';
}

async function getDetailedWeather(city, dayOffset = 0) {
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`).then(r => r.json());
    if (!geo.results?.[0]) return { success: false, error: 'Город не найден' };
    const { latitude, longitude, name } = geo.results[0];
    
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=2`;
    const data = await fetch(weatherUrl).then(r => r.json());
    
    const startIdx = dayOffset * 24;
    const periods = [
      { name: 'Ночь 🌙 (00-06)', range: [0, 6] },
      { name: 'Утро 🌅 (06-12)', range: [6, 12] },
      { name: 'День ☀️ (12-18)', range: [12, 18] },
      { name: 'Вечер 🌆 (18-00)', range: [18, 24] }
    ];

    const forecast = periods.map(p => {
      const temps = data.hourly.temperature_2m.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const codes = data.hourly.weather_code.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const avgTemp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
      const mainCode = codes[Math.floor(codes.length / 2)];
      return `*${p.name}*: ${avgTemp}°C, ${getWeatherDescription(mainCode)}`;
    }).join('\n');

    return { 
      success: true, city: name, 
      temp: Math.round(data.current.temperature_2m), 
      feels_like: Math.round(data.current.apparent_temperature),
      wind_speed: data.current.wind_speed_10m,
      code: data.current.weather_code,
      humidity: data.current.relative_humidity_2m,
      periods: forecast 
    };
  } catch (e) { return { success: false, error: 'Ошибка сети' }; }
}

// ===================== ПОЛНАЯ ЛОГИКА ОДЕЖДЫ =====================
function getWardrobeAdvice(w) {
  if (!w.success) return '❌ Данные недоступны';
  const { temp, feels_like, wind_speed, code, city } = w;
  let advice = [
    `👕 *Что надеть в ${city} сейчас?*`,
    `🌡️ *Температура:* ${temp}°C (ощущается как ${feels_like}°C)\n`,
    `📋 *Рекомендации:*`
  ];

  if (temp >= 25) {
    advice.push('• Легкая футболка из хлопка, шорты или юбка. 👕');
    advice.push('• Сандалии или легкие кеды. Обязательно солнцезащитные очки! 🕶️');
  } else if (temp >= 18) {
    advice.push('• Футболка, легкая рубашка или лонгслив. 👖');
    advice.push('• На вечер возьмите легкую кофту или кардиган. 🧥');
  } else if (temp >= 10) {
    advice.push('• Плотное худи, ветровка или легкая куртка. 🧥');
    advice.push('• Кроссовки или ботинки. 👟');
  } else if (temp >= 0) {
    advice.push('• Теплый свитер, демисезонное пальто или куртка. 🧥');
    advice.push('• Не забудьте шарф. Обувь с небольшим утеплением. 🧣');
  } else if (temp >= -10) {
    advice.push('• Зимний пуховик, теплая шапка и перчатки. ❄️');
    advice.push('• Зимние ботинки. 🥾');
  } else {
    advice.push('• Термобелье, теплый свитер, самый толстый пуховик. 🥶');
    advice.push('• Теплая шапка, шерстяной шарф и меховые варежки. 🧤');
  }

  if (wind_speed > 7) advice.push('\n💨 *Внимание:* Сильный ветер! Наденьте что-то непродуваемое.');
  if ([61, 63, 65, 80, 81, 82].includes(code)) advice.push('☔ *Осадки:* Идет дождь, не забудьте зонт или дождевик!');
  if ([71, 73, 75, 85, 86].includes(code)) advice.push('❄️ *Осадки:* Идет снег, выбирайте нескользкую обувь.');
  
  return advice.join('\n');
}

// ===================== КЛАВИАТУРЫ =====================
const startKeyboard = new Keyboard().text('🚀 НАЧАТЬ РАБОТУ').resized();

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').text('💬 ФРАЗА ДНЯ').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ').resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row()
    .text('📍 СЕВАСТОПОЛЬ').text('✏️ ДРУГОЙ ГОРОД').row()
    .text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ =====================
bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  // Техническая регистрация пользователя для хранения города
  await saveOrUpdateUser({ user_id: ctx.from.id.toString(), chat_id: ctx.chat.id, city: 'Не указан' });
  await ctx.reply(`👋 Привет, *${name}*!\nЯ твой анонимный помощник. Укажи город, чтобы я мог показывать погоду и советы по одежде.`, { parse_mode: 'Markdown', reply_markup: startKeyboard });
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', (ctx) => ctx.reply('🏙️ Выберите ваш город из списка или напишите свой:', { reply_markup: cityKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(ctx.from.id.toString(), city);
  await ctx.reply(`✅ Город *${city}* успешно сохранен! Теперь можно пользоваться меню.`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeather(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка: ' + w.error);
  const m = `🌤️ *${w.city} сейчас:*\n` +
            `🌡️ ${w.temp}°C (ощущается как ${w.feels_like}°C)\n` +
            `📝 ${getWeatherDescription(w.code)}\n` +
            `💨 Ветер: ${w.wind_speed} м/с\n` +
            `💧 Влажность: ${w.humidity}%`;
  await ctx.reply(m, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажите город!');
  const f = await getDetailedWeather(res.city, 0);
  await ctx.reply(`📅 *Прогноз в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажите город!');
  const f = await getDetailedWeather(res.city, 1);
  await ctx.reply(`📅 *Прогноз в ${f.city} на завтра:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала выберите город!');
  const w = await getDetailedWeather(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 ${p.english}\n🇷🇺 ${p.russian}\n\n💡 _${p.explanation}_`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const cityRes = await getUserCity(ctx.from.id);
  const city = cityRes.found ? cityRes.city : 'Не указан';
  
  // URL БЕЗ ID ПОЛЬЗОВАТЕЛЯ. Только анонимное имя и город.
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}`;
  
  await ctx.reply(`🕹️ Нажми кнопку, чтобы играть анонимно как *${name}* из города *${city}*!\n\nСтатистика и Топ доступны внутри игры.`, {
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Тетрис', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('🏙️ Выберите город:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));
bot.hears('ℹ️ ПОМОЩЬ', (ctx) => ctx.reply('Бот показывает погоду, дает советы по одежде и позволяет играть в Тетрис анонимно. Ваши рекорды сохраняются в общей таблице лидеров!', { reply_markup: mainMenuKeyboard }));

// ===================== ЭКСПОРТ ДЛЯ VERCEL =====================
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { await bot.handleUpdate(req.body); } catch (e) { console.error('Bot Update Error:', e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'running' });
}
