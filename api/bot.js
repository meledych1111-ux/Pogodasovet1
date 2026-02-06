import { Bot, Keyboard } from 'grammy';

// ИМПОРТЫ ИЗ ПАПКИ UTILS
import { dailyPhrases } from './utils/phrases.js';
import { getWeatherData } from './utils/weather.js';
import { getWardrobeAdvice } from './utils/wardrobe.js';

const bot = new Bot(process.env.BOT_TOKEN || '');
const userStorage = new Map();

// ===================== КЛАВИАТУРЫ =====================

// 🚀 СТАРТОВАЯ КНОПКА
const startKeyboard = new Keyboard()
  .text('🚀 НАЧАТЬ')
  .resized()
  .oneTime();

// 🏠 ГЛАВНОЕ МЕНЮ
const mainMenuKeyboard = new Keyboard()
  .text('🌤️ ПОГОДА СЕЙЧАС')
  .row()
  .text('👕 ЧТО НАДЕТЬ?')
  .text('💬 ФРАЗА ДНЯ')
  .row()
  .text('🏙️ СМЕНИТЬ ГОРОД')
  .text('ℹ️ ПОМОЩЬ')
  .resized()
  .oneTime();

// 🏙️ ВЫБОР ГОРОДА
const cityKeyboard = new Keyboard()
  .text('📍 СИМФЕРОПОЛЬ').text('📍 СЕВАСТОПОЛЬ')
  .row()
  .text('📍 ЯЛТА').text('📍 АЛУШТА')
  .row()
  .text('📍 ЕВПАТОРИЯ').text('📍 ФЕОДОСИЯ')
  .row()
  .text('📍 ДРУГОЙ ГОРОД')
  .row()
  .text('🔙 НАЗАД В МЕНЮ')
  .resized()
  .oneTime();

// ===================== ОБРАБОТЧИКИ КОМАНД =====================

// 🚀 КОМАНДА /start И КНОПКА НАЧАТЬ
bot.command('start', async (ctx) => {
  await showStartScreen(ctx);
});

bot.hears('🚀 НАЧАТЬ', async (ctx) => {
  await showStartScreen(ctx);
});

async function showStartScreen(ctx) {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'друг';
  
  userStorage.delete(userId);
  
  await ctx.reply(
    `👋 *Привет, ${userName}!*\n\n` +
    `🌟 *Добро пожаловать в Weather & English Bot!*\n\n` +
    `Я твой персональный помощник, который поможет:\n\n` +
    `🌤️  Узнать *точную погоду* с осадками\n` +
    `👕  Получить *персональный совет* по одежде\n` +
    `💬  Выучить *новую фразу* на английском каждый день\n\n` +
    `Всё управление через кнопки — просто и удобно!\n\n` +
    `👇 *Нажми кнопку ниже, чтобы начать:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: startKeyboard 
    }
  );
}

// 📍 ВЫБОР ГОРОДА
bot.hears('📍 ДРУГОЙ ГОРОД', async (ctx) => {
  const userId = ctx.from.id;
  userStorage.set(userId, { 
    awaitingCityInput: true,
    city: null 
  });
  
  await ctx.reply(
    '📍 *Напишите название вашего города:*\n\n' +
    '_Например: Москва, Санкт-Петербург, Сочи, Алупка_',
    { parse_mode: 'Markdown' }
  );
});

bot.hears(/^📍\s/, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '');
  
  userStorage.set(userId, { 
    city: city,
    awaitingCityInput: false 
  });
  
  await showCitySavedMessage(ctx, city);
});

// Обработка ручного ввода города
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const userData = userStorage.get(userId);
  
  if (text.startsWith('/') || 
      text === '🚀 НАЧАТЬ' || 
      text.startsWith('📍') ||
      text === '🔙 НАЗАД В МЕНЮ') {
    return;
  }
  
  if (userData && userData.awaitingCityInput === true) {
    if (text.length < 2) {
      await ctx.reply('Пожалуйста, введите корректное название города (минимум 2 символа).');
      return;
    }
    
    userStorage.set(userId, { 
      city: text,
      awaitingCityInput: false 
    });
    
    await showCitySavedMessage(ctx, text);
  }
});

async function showCitySavedMessage(ctx, city) {
  await ctx.reply(
    `✅ *Отлично! Город "${city}" сохранён.*\n\n` +
    `Теперь вы можете:\n\n` +
    `• Нажать *"🌤️ ПОГОДА СЕЙЧАС"* — узнать актуальную погоду\n` +
    `• Нажать *"👕 ЧТО НАДЕТЬ?"* — получить совет по одежде\n` +
    `• Нажать *"💬 ФРАЗА ДНЯ"* — выучить новое выражение\n\n` +
    `👇 *Выберите действие:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// ===================== ОБРАБОТКА ГЛАВНОГО МЕНЮ =====================

// 🌤️ ПОГОДА СЕЙЧАС
bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.city) {
    await ctx.reply(
      '❌ *Сначала выберите город!*\n\n' +
      'Нажмите "🏙️ СМЕНИТЬ ГОРОД" для выбора города.',
      { 
        parse_mode: 'Markdown',
        reply_markup: cityKeyboard 
      }
    );
    return;
  }
  
  try {
    await ctx.reply(`⏳ *Запрашиваю погоду для ${userData.city}...*`, { parse_mode: 'Markdown' });
    
    // ИМПОРТ из utils/weather.js
    const weather = await getWeatherData(userData.city);
    
    await ctx.reply(
      `🌤️ *ПОГОДА В ${userData.city.toUpperCase()}*\n\n` +
      `🌡️ Температура: *${weather.temp}°C*\n` +
      `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
      `💨 Ветер: ${weather.wind} м/с\n` +
      `💧 Влажность: ${weather.humidity}%\n` +
      `🌧️ Осадки: ${weather.precipitation}\n` +
      `📝 ${weather.description}\n\n` +
      `_Данные от Open-Meteo API_`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  } catch (error) {
    console.error('Ошибка погоды:', error);
    await ctx.reply(
      `❌ *Не удалось получить погоду для ${userData.city}*\n\n` +
      `Попробуйте позже или выберите другой город.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
});

// 👕 ЧТО НАДЕТЬ?
bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.city) {
    await ctx.reply(
      '❌ *Сначала выберите город!*\n\n' +
      'Нажмите "🏙️ СМЕНИТЬ ГОРОД" для выбора города.',
      { 
        parse_mode: 'Markdown',
        reply_markup: cityKeyboard 
      }
    );
    return;
  }
  
  try {
    await ctx.reply(`👗 *Анализирую погоду для подбора одежды...*`, { parse_mode: 'Markdown' });
    
    // ИМПОРТ из utils/weather.js
    const weather = await getWeatherData(userData.city);
    
    // ИМПОРТ из utils/wardrobe.js
    const advice = getWardrobeAdvice(weather);
    
    await ctx.reply(
      `👕 *ЧТО НАДЕТЬ В ${userData.city.toUpperCase()}?*\n\n` +
      `${advice}\n\n` +
      `_Рекомендация основана на:\n` +
      `• Температура: ${weather.temp}°C\n` +
      `• Осадки: ${weather.precipitation}\n` +
      `• Ветер: ${weather.wind} м/с_`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  } catch (error) {
    console.error('Ошибка совета по одежде:', error);
    await ctx.reply(
      '❌ Не удалось получить рекомендацию.',
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
});

// 💬 ФРАЗА ДНЯ
bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  try {
    // ИМПОРТ из utils/phrases.js
    const dayOfMonth = new Date().getDate();
    const phraseIndex = dayOfMonth % dailyPhrases.length;
    const phrase = dailyPhrases[phraseIndex];
    
    await ctx.reply(
      `💬 *ФРАЗА ДНЯ*\n\n` +
      `📅 ${new Date().toLocaleDateString('ru-RU')}\n\n` +
      `🇬🇧 *Английский:*\n"${phrase.english}"\n\n` +
      `🇷🇺 *Перевод:*\n${phrase.russian}\n\n` +
      `📚 *Объяснение:*\n${phrase.explanation}\n\n` +
      `🏷️ Категория: ${phrase.category}\n\n` +
      `_Учите по одной фразе каждый день!_`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  } catch (error) {
    console.error('Ошибка получения фразы:', error);
    await ctx.reply(
      `💬 *ФРАЗА ДНЯ*\n\n` +
      `🇬🇧 "It's raining cats and dogs"\n\n` +
      `🇷🇺 "Льёт как из ведра"\n\n` +
      `📚 Идиома для описания очень сильного дождя`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
});

// 🏙️ СМЕНИТЬ ГОРОД
bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
  const userId = ctx.from.id;
  
  userStorage.set(userId, { 
    city: null,
    awaitingCityInput: false 
  });
  
  await ctx.reply(
    `🏙️ *ВЫБЕРИТЕ НОВЫЙ ГОРОД*\n\n` +
    `Можете выбрать из списка или ввести название вручную.\n` +
    `Все города Крыма поддерживаются!`,
    { 
      parse_mode: 'Markdown',
      reply_markup: cityKeyboard 
    }
  );
});

// ℹ️ ПОМОЩЬ
bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
  await ctx.reply(
    `ℹ️ *ПОМОЩЬ ПО БОТУ*\n\n` +
    `*КАК РАБОТАЕТ БОТ:*\n\n` +
    `1. Нажмите *"🚀 НАЧАТЬ"* или отправьте */start*\n` +
    `2. Выберите свой город из списка или введите вручную\n` +
    `3. Используйте кнопки главного меню для получения:\n` +
    `   • 🌤️ Актуальной погоды с осадками\n` +
    `   • 👕 Совета по одежде на основе погоды\n` +
    `   • 💬 Новой фразы на английском с переводом\n\n` +
    `*ДОСТУПНЫЕ КНОПКИ:*\n` +
    `• 🌤️ ПОГОДА СЕЙЧАС — текущая погода\n` +
    `• 👕 ЧТО НАДЕТЬ? — персональный совет\n` +
    `• 💬 ФРАЗА ДНЯ — новая фраза каждый день\n` +
    `• 🏙️ СМЕНИТЬ ГОРОД — изменить локацию\n` +
    `• ℹ️ ПОМОЩЬ — эта информация\n\n` +
    `_Все данные о погоде — от Open-Meteo API_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.hears('🔙 НАЗАД В МЕНЮ', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (userData && userData.city) {
    await ctx.reply(
      `🏠 *ГЛАВНОЕ МЕНЮ*\n\n📍 Ваш город: *${userData.city}*\n\nВыберите действие:`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  } else {
    await ctx.reply(
      'Сначала выберите город!',
      { reply_markup: cityKeyboard }
    );
  }
});

// ===================== ЗАПУСК ДЛЯ VERCEL =====================

// Для Vercel Serverless Function
export default async function handler(req, res) {
  try {
    // Для GET запросов (проверка работы)
    if (req.method === 'GET') {
      return res.status(200).json({ message: 'Bot is running' });
    }
    
    // Для POST запросов от Telegram
    if (req.method === 'POST') {
      // Инициализируем бота
      await bot.init();
      
      // Обрабатываем обновление от Telegram
      await bot.handleUpdate(req.body);
      
      return res.status(200).json({ ok: true });
    }
    
    // Для других методов HTTP
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error in handler:', error);
    // Всегда возвращаем 200 для Telegram
    return res.status(200).json({ 
      ok: false, 
      error: error.message 
    });
  }
}
