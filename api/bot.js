import { Bot, Keyboard } from 'grammy';
import { dailyPhrases } from 'utils/phrases.js';
import { getWeatherData } from 'utils/weather.js';
import { getWardrobeAdvice } from 'utils/wardrobe.js';

const bot = new Bot(process.env.BOT_TOKEN || '');
const userStorage = new Map();

// ===================== КЛАВИАТУРЫ =====================

const startKeyboard = new Keyboard()
  .text('🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ')
  .resized()
  .oneTime();

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

bot.command('start', async (ctx) => {
  await ctx.reply(
    `🎯 *ДОБРО ПОЖАЛОВАТЬ В WEATHER & ENGLISH BOT!*\n\n` +
    `🌟 *Ваш персональный помощник на каждый день:*\n\n` +
    `🌤️  *Актуальная погода* с осадками\n` +
    `👕  *Персональные советы* по одежде\n` +
    `💬  *Фразы дня* на английском с переводом\n\n` +
    `👇 *НАЖМИТЕ КНОПКУ НИЖЕ, ЧТОБЫ НАЧАТЬ:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: startKeyboard 
    }
  );
});

bot.hears('🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ', async (ctx) => {
  await ctx.reply(
    `📍 *ШАГ 1: ВЫБЕРИТЕ ВАШ ГОРОД*\n\n` +
    `Чтобы получать точные прогнозы погоды, выберите город из списка ниже.\n` +
    `Если вашего города нет, нажмите "📍 ДРУГОЙ ГОРОД".`,
    { 
      parse_mode: 'Markdown',
      reply_markup: cityKeyboard 
    }
  );
});

bot.hears('📍 ДРУГОЙ ГОРОД', async (ctx) => {
  await ctx.reply('Напишите название вашего города:');
});

bot.hears(/^📍\s/, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '');
  
  userStorage.set(userId, { 
    city: city,
    favoritePhrases: [],
    joinedAt: new Date().toISOString()
  });
  
  await ctx.reply(
    `✅ *Отлично! Город "${city}" сохранён.*\n\n` +
    `Теперь вы можете:\n` +
    `• Нажать *"🌤️ ПОГОДА СЕЙЧАС"* — узнать погоду\n` +
    `• Нажать *"👕 ЧТО НАДЕТЬ?"* — получить совет\n` +
    `• Нажать *"💬 ФРАЗА ДНЯ"* — выучить фразу\n\n` +
    `👇 *Выберите действие:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  
  if (text === '🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ' || text.startsWith('/') || text.startsWith('📍')) {
    return;
  }
  
  const userData = userStorage.get(userId);
  if (userData && !userData.city) {
    userData.city = text;
    await ctx.reply(
      `✅ *Город "${text}" сохранён!*\nИспользуйте меню для запроса погоды.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.city) {
    await ctx.reply(
      '❌ *Сначала выберите город!*\nНажмите "🏙️ СМЕНИТЬ ГОРОД" для выбора.',
      { 
        parse_mode: 'Markdown',
        reply_markup: cityKeyboard 
      }
    );
    return;
  }
  
  try {
    await ctx.reply(`⏳ *Запрашиваю погоду для ${userData.city}...*`, { parse_mode: 'Markdown' });
    
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
    await ctx.reply(
      `❌ *Не удалось получить погоду для ${userData.city}*\nПопробуйте позже или выберите другой город.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.city) {
    await ctx.reply(
      '❌ *Сначала выберите город!*\nНажмите "🏙️ СМЕНИТЬ ГОРОД" для выбора.',
      { 
        parse_mode: 'Markdown',
        reply_markup: cityKeyboard 
      }
    );
    return;
  }
  
  try {
    await ctx.reply(`👗 *Анализирую погоду для подбора одежды...*`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(userData.city);
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
    await ctx.reply(
      '❌ Не удалось получить рекомендацию.',
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const dayOfMonth = new Date().getDate();
  const phrase = dailyPhrases[dayOfMonth % dailyPhrases.length];
  
  await ctx.reply(
    `💬 *ФРАЗА ДНЯ*\n\n` +
    `🇬🇧 *Английский:*\n"${phrase.english}"\n\n` +
    `🇷🇺 *Перевод:*\n${phrase.russian}\n\n` +
    `📚 *Объяснение:*\n${phrase.explanation}\n\n` +
    `🏷️ Категория: ${phrase.category}\n` +
    `📊 Сложность: ${phrase.difficulty}\n\n` +
    `_Учите по одной фразе каждый день!_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
  await ctx.reply(
    `🏙️ *ВЫБЕРИТЕ НОВЫЙ ГОРОД*\nМожете выбрать из списка или ввести название вручную:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: cityKeyboard 
    }
  );
});

bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
  await ctx.reply(
    `ℹ️ *ПОМОЩЬ ПО БОТУ*\n\n` +
    `*ДОСТУПНЫЕ КНОПКИ:*\n\n` +
    `🌤️ ПОГОДА СЕЙЧАС - актуальная погода\n` +
    `👕 ЧТО НАДЕТЬ? - советы по одежде\n` +
    `💬 ФРАЗА ДНЯ - новая фраза каждый день\n` +
    `🏙️ СМЕНИТЬ ГОРОД - изменить локацию\n` +
    `ℹ️ ПОМОЩЬ - эта информация\n\n` +
    `_Все функции доступны через кнопки!_`,
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
      `🏠 *ГЛАВНОЕ МЕНЮ*\n📍 Ваш город: *${userData.city}*\n\nВыберите действие:`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  } else {
    await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
  }
});

// ===================== ЗАПУСК ДЛЯ VERCEL =====================

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ message: 'Bot is running' });
    }
    
    if (req.method === 'POST') {
      await bot.init();
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error in handler:', error);
    return res.status(200).json({ 
      ok: false, 
      error: error.message 
    });
  }
}
