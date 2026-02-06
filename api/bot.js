import { Bot, Keyboard } from 'grammy';
import { getWeatherData } from '../utils/weather.js';
import { getWardrobeAdvice } from '../utils/wardrobe.js';
import { dailyPhrases } from '../utils/phrases.js';

const bot = new Bot(process.env.BOT_TOKEN);
const userStorage = new Map(); // Простое хранилище пользователей

// ====================== КЛАВИАТУРЫ ======================
// 🚀 СТАРТОВАЯ КНОПКА (отдельная, не перекрывает остальные) [citation:8]
const startKeyboard = new Keyboard()
  .text('🚀 НАЧАТЬ')
  .resized() // Делает кнопку компактной
  .oneTime(); // Скрывается после нажатия

// 🏠 ГЛАВНОЕ МЕНЮ
const mainMenuKeyboard = new Keyboard()
  .text('🌤️ ПОГОДА')
  .row()
  .text('👕 ЧТО НАДЕТЬ?')
  .text('💬 ФРАЗА ДНЯ')
  .row()
  .text('🏙️ СМЕНИТЬ ГОРОД')
  .text('ℹ️ ПОМОЩЬ')
  .resized()
  .oneTime();

// 🏙️ ВЫБОР ГОРОДА (включая крымские) [citation:3]
const cityKeyboard = new Keyboard()
  .text('📍 Симферополь').text('📍 Севастополь').row()
  .text('📍 Ялта').text('📍 Алушта').row()
  .text('📍 Москва').text('📍 Санкт-Петербург').row()
  .text('✏️ ДРУГОЙ ГОРОД')
  .row()
  .text('🔙 НАЗАД')
  .resized()
  .oneTime();

// ====================== ОБРАБОТЧИКИ КОМАНД ======================
// 1. КОМАНДА /START И КНОПКА "НАЧАТЬ" [citation:3][citation:8]
bot.command('start', handleStart);
bot.hears('🚀 НАЧАТЬ', handleStart);

async function handleStart(ctx) {
  const userId = ctx.from.id;
  userStorage.delete(userId); // Сбрасываем старые данные

  await ctx.reply(
    `👋 *Привет, ${ctx.from.first_name}!*\n\n` +
    `Я твой погодный помощник и гид по английскому! Вот что я умею:\n\n` +
    `🌤️ *Погода* — точный прогноз с данными Open-Meteo\n` +
    `👕 *Гардероб* — подробный совет, что надеть\n` +
    `💬 *Фраза дня* — полезное выражение на английском с переводом\n\n` +
    `Всё управление — через кнопки. Это просто и удобно! [citation:3]\n\n` +
    `👇 *Нажми кнопку НАЧАТЬ, чтобы продолжить:*`,
    { parse_mode: 'Markdown', reply_markup: startKeyboard }
  );
}

// 2. ВЫБОР ГОРОДА
bot.hears('✏️ ДРУГОЙ ГОРОД', (ctx) => {
  ctx.reply('Напиши название своего города:');
});

bot.hears(/^📍\s/, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '');
  userStorage.set(userId, { city });
  
  await ctx.reply(
    `✅ *Отлично!*\nСохранил твой город: *${city}*\n\n` +
    `Теперь можешь узнать погоду или получить совет по одежде. Выбери действие в меню ниже:`,
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
  );
});

// Обработка ручного ввода города
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  // Если это не команда и не кнопка, и пользователь еще не выбрал город
  if (!text.startsWith('/') && !text.startsWith('📍') && text !== '🚀 НАЧАТЬ') {
    userStorage.set(userId, { city: text });
    await ctx.reply(
      `✅ *Город "${text}" сохранён!*\nИспользуй меню для запроса погоды.`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  }
});

// 3. ГЛАВНОЕ МЕНЮ [citation:8]
bot.hears('🌤️ ПОГОДА', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData?.city) {
    await ctx.reply(
      'Сначала выбери город, чтобы я мог показать погоду.',
      { reply_markup: cityKeyboard }
    );
    return;
  }
  
  await ctx.reply(`⏳ *Запрашиваю погоду для ${userData.city}...*`, { parse_mode: 'Markdown' });
  
  try {
    const weather = await getWeatherData(userData.city);
    const icon = weather.isFallback ? '⚠️' : '🌤️';
    
    await ctx.reply(
      `${icon} *Погода в ${weather.city}*\n\n` +
      `🌡️ Температура: *${weather.temp}°C*\n` +
      `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
      `💨 Ветер: ${weather.wind} м/с\n` +
      `💧 Влажность: ${weather.humidity}%\n` +
      `🌧️ Осадки: ${weather.precipitation} мм\n` +
      `📝 ${weather.description}\n\n` +
      `${weather.isFallback ? '_Используются базовые данные. Сервис может быть временно недоступен._' : '_Данные от Open-Meteo_'}`, 
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  } catch (error) {
    await ctx.reply(
      '❌ Не удалось получить погоду. Попробуй выбрать другой город или проверь название.',
      { reply_markup: mainMenuKeyboard }
    );
  }
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData?.city) {
    await ctx.reply(
      'Сначала выбери город, чтобы я мог дать совет.',
      { reply_markup: cityKeyboard }
    );
    return;
  }
  
  await ctx.reply(`👗 *Подбираю гардероб для ${userData.city}...*`, { parse_mode: 'Markdown' });
  
  try {
    const weather = await getWeatherData(userData.city);
    const advice = getWardrobeAdvice(weather);
    
    await ctx.reply(
      `*Совет по одежде на сегодня:*\n\n${advice}\n\n` +
      `_Основано на данных: ${weather.temp}°C, ${weather.description}_`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  } catch (error) {
    await ctx.reply(
      '❌ Не могу подобрать совет. Проверь выбор города или попробуй позже.',
      { reply_markup: mainMenuKeyboard }
    );
  }
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const phrase = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  await ctx.reply(
    `💬 *Фраза дня*\n\n` +
    `🇬🇧 *${phrase.english}*\n\n` +
    `🇷🇺 *${phrase.russian}*\n\n` +
    `📚 *${phrase.explanation}*\n\n` +
    `#${phrase.category}`,
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
  );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => {
  ctx.reply(
    'Выбери город из списка или напиши свой:',
    { reply_markup: cityKeyboard }
  );
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => {
  ctx.reply(
    `*Помощь по боту*\n\n` +
    `• Используй кнопки для навигации\n` +
    `• Сначала выбери город, потом запрашивай погоду\n` +
    `• Для ручного ввода города нажми "✏️ ДРУГОЙ ГОРОД"\n` +
    `• Команда /start перезапускает бота\n\n` +
    `_Все данные о погоде предоставляются сервисом Open-Meteo_`,
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
  );
});

bot.hears('🔙 НАЗАД', (ctx) => {
  ctx.reply(
    'Возвращаю в главное меню. Выбери действие:',
    { reply_markup: mainMenuKeyboard }
  );
});

// ====================== ЗАПУСК ДЛЯ VERCEL ======================
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ message: 'Bot is running' });
  }
  if (req.method === 'POST') {
    try {
      await bot.init();
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Error:', error);
      return res.status(200).json({ ok: false, error: error.message });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
