import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
  saveGameScore,
  getGameStats as fetchGameStats,
  getTopPlayers as fetchTopPlayers,
  saveOrUpdateUser,
  getUserProfile,
  generateAnonymousName
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

// ===================== КОНФИГУРАЦИЯ =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Bot(BOT_TOKEN || 'dummy');

// ===================== ФРАЗЫ ДНЯ =====================
const dailyPhrases = [
  { english: "Consistency is the key to success.", russian: "Постоянство — залог успеха.", explanation: "Важно делать что-то регулярно.", category: "Мотивация", level: "Средний" },
  { english: "Better late than never.", russian: "Лучше поздно, чем никогда.", explanation: "Важно закончить начатое.", category: "Пословицы", level: "Начальный" },
  { english: "Take it easy.", russian: "Расслабься / Не принимай близко к сердцу.", explanation: "Совет не переживать по пустякам.", category: "Общение", level: "Начальный" },
  { english: "Break a leg!", russian: "Ни пуха, ни пера!", explanation: "Пожелание удачи перед выступлением.", category: "Идиомы", level: "Средний" },
  { english: "Keep your chin up!", russian: "Выше нос!", explanation: "Поддержка в трудной ситуации.", category: "Общение", level: "Начальный" },
  { english: "Every cloud has a silver lining.", russian: "Нет худа без добра.", explanation: "В любой плохой ситуации есть что-то хорошее.", category: "Идиомы", level: "Продвинутый" },
  { english: "Actions speak louder than words.", russian: "Поступки говорят громче слов.", explanation: "О том, что дела важнее обещаний.", category: "Пословицы", level: "Средний" }
];

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ПОГОДЫ =====================
function getWeatherDescription(code) {
  const map = { 0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Облачно ⛅', 3: 'Пасмурно ☁️', 45: 'Туман 🌫️', 51: 'Морось 🌧️', 61: 'Дождь 🌧️', 71: 'Снег ❄️', 80: 'Ливень 🌧️', 95: 'Гроза ⛈️' };
  return map[code] || 'Облачно 🌥️';
}

async function getDetailedWeather(city, dayOffset = 0) {
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`).then(r => r.json());
    if (!geo.results?.[0]) return { success: false, error: 'Город не найден' };
    const { latitude, longitude, name } = geo.results[0];
    
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=2`).then(r => r.json());
    
    const startIdx = dayOffset * 24;
    const periods = [
      { name: 'Ночь 🌙', range: [0, 6] },
      { name: 'Утро 🌅', range: [6, 12] },
      { name: 'День ☀️', range: [12, 18] },
      { name: 'Вечер 🌆', range: [18, 24] }
    ];

    const forecast = periods.map(p => {
      const temps = w.hourly.temperature_2m.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const codes = w.hourly.weather_code.slice(startIdx + p.range[0], startIdx + p.range[1]);
      const avgTemp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
      const mainCode = codes[Math.floor(codes.length / 2)];
      return `${p.name}: ${avgTemp}°C, ${getWeatherDescription(mainCode)}`;
    }).join('\n');

    return { success: true, city: name, current: w.current, daily: w.daily, periods: forecast };
  } catch (e) { return { success: false, error: 'Ошибка сети' }; }
}

function getWardrobeAdvice(w) {
  const temp = w.current.temperature_2m;
  const wind = w.current.wind_speed_10m;
  const code = w.current.weather_code;
  
  let advice = `👕 *Что надеть в ${w.city}?*\n🌡️ ${Math.round(temp)}°C (ощущается как ${Math.round(w.current.apparent_temperature)}°C)\n\n`;
  
  if (temp >= 25) advice += "• Легкая футболка и шорты/юбка. 👕";
  else if (temp >= 18) advice += "• Футболка и легкие брюки. Вечером может понадобиться кофта. 🧥";
  else if (temp >= 10) advice += "• Плотное худи или легкая куртка/ветровка. 🧥";
  else if (temp >= 0) advice += "• Осеннее пальто или куртка, не забудьте шарф. 🧣";
  else if (temp >= -10) advice += "• Зимний пуховик, теплая шапка и перчатки. ❄️";
  else advice += "• Термобелье и самый теплый пуховик. 🥶";

  if (wind > 7) advice += "\n• Ветер сильный, наденьте что-то непродуваемое! 💨";
  if ([61, 63, 65, 80, 81, 82].includes(code)) advice += "\n• Идет дождь — возьмите зонт! ☔";
  
  return advice;
}

// ===================== КЛАВИАТУРЫ =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').text('💬 ФРАЗА ДНЯ').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('📊 СТАТИСТИКА').text('🏆 РЕЙТИНГ').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ').resized();

const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').text('📍 СЕВАСТОПОЛЬ').row().text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ =====================
bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: ctx.from.id.toString(), chat_id: ctx.chat.id, city: 'Не указан' });
  await ctx.reply(`👋 Привет, *${name}*!\nЯ твой анонимный погодный помощник.`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала укажи город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeather(res.city);
  if (!w.success) return ctx.reply('❌ ' + w.error);
  const m = `🌤️ *${w.city} сейчас:*\n🌡️ ${Math.round(w.current.temperature_2m)}°C (ощущается как ${Math.round(w.current.apparent_temperature)}°C)\n📝 ${getWeatherDescription(w.current.weather_code)}\n💧 Влажность: ${w.current.relative_humidity_2m}% | 💨 Ветер: ${w.current.wind_speed_10m} м/с`;
  await ctx.reply(m, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажи город!');
  const w = await getDetailedWeather(res.city, 0);
  await ctx.reply(`📅 *Прогноз в ${w.city} на сегодня:*\n\n${w.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажи город!');
  const w = await getDetailedWeather(res.city, 1);
  await ctx.reply(`📅 *Прогноз в ${w.city} на завтра:*\n\n${w.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала укажи город!');
  const w = await getDetailedWeather(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('📊 СТАТИСТИКА', async (ctx) => {
  const s = await fetchGameStats(ctx.from.id.toString());
  const name = generateAnonymousName(ctx.from.id);
  const m = `📊 *Статистика ${name}*\n\n🏆 Рекорд: ${s.best_score}\n🎮 Игр: ${s.games_played}\n📏 Линий: ${s.best_lines}\n⭐ Уровень: ${s.best_level}\n💰 Средний счет: ${s.avg_score}`;
  await ctx.reply(m, { parse_mode: 'Markdown' });
});

bot.hears('🏆 РЕЙТИНГ', async (ctx) => {
  const res = await fetchTopPlayers('tetris', 5);
  let m = `🏆 *ТОП ИГРОКОВ*\n\n`;
  res.players.forEach(p => { m += `${p.rank}. ${p.display_name} — *${p.best_score}*\n   📍 ${p.city}\n`; });
  await ctx.reply(m, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const url = `https://pogodasovet1.vercel.app?telegramId=${ctx.from.id}&username=${encodeURIComponent(name)}`;
  const ik = new InlineKeyboard().webApp('🎮 Открыть игру', url);
  await ctx.reply(`🕹️ Играй анонимно как *${name}*`, { reply_markup: ik, parse_mode: 'Markdown' });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город или напиши 📍 Город', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(ctx.from.id.toString(), city);
  await ctx.reply(`✅ Город *${city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 ${p.english}\n🇷🇺 ${p.russian}\n\n💡 _${p.explanation}_`, { parse_mode: 'Markdown' });
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => ctx.reply('Этот бот помогает следить за погодой и играть в Тетрис. Ваши рекорды сохраняются в общую таблицу лидеров!', { reply_markup: mainMenuKeyboard }));

// ===================== ЭКСПОРТ ДЛЯ VERCEL =====================
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { await bot.handleUpdate(req.body); } catch (e) { console.error(e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'Бот активен' });
}
