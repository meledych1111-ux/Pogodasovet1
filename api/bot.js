import { Bot, Keyboard } from 'grammy';
import { getPhraseOfDay, getPhraseByCategory, getRandomPhrase, getAllCategories, getPhraseStats } from '../utils/phrases.js';
import { getWeatherData, getWeatherIcon } from '../utils/weather.js';
import { getWardrobeAdvice, getTemperatureAdvice } from '../utils/wardrobe.js';

const bot = new Bot(process.env.BOT_TOKEN || '');

// Хранилище пользователей (в продакшене заменить на базу данных)
const userStorage = new Map();

// ===================== ВСЕ КЛАВИАТУРЫ =====================

// 🚀 БОЛЬШАЯ СТАРТОВАЯ КНОПКА
const startButtonKeyboard = new Keyboard()
  .text('🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ')
  .resized()
  .oneTime();

// 🏠 ГЛАВНОЕ МЕНЮ
const mainMenuKeyboard = new Keyboard()
  .text('🌤️ ПОГОДА СЕЙЧАС')
  .row()
  .text('👕 ЧТО НАДЕТЬ?')
  .text('💬 ФРАЗА ДНЯ')
  .row()
  .text('📚 КАТЕГОРИИ ФРАЗ')
  .row()
  .text('🏙️ СМЕНИТЬ ГОРОД')
  .text('ℹ️ ПОМОЩЬ')
  .row()
  .text('⭐ ИЗБРАННЫЕ ФРАЗЫ')
  .resized()
  .oneTime();

// 🏙️ ВЫБОР ГОРОДА
const cityKeyboard = new Keyboard()
  .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ')
  .row()
  .text('📍 НОВОСИБИРСК').text('📍 ЕКАТЕРИНБУРГ')
  .row()
  .text('📍 КАЗАНЬ').text('📍 СОЧИ')
  .row()
  .text('📍 ДРУГОЙ ГОРОД')
  .row()
  .text('↩️ НАЗАД В МЕНЮ')
  .resized()
  .oneTime();

// 📚 МЕНЮ КАТЕГОРИЙ ФРАЗ
function getCategoriesKeyboard() {
  const categories = getAllCategories();
  const keyboard = new Keyboard();
  
  // Группируем по 2 кнопки в ряд
  for (let i = 0; i < categories.length; i += 2) {
    if (categories[i]) {
      keyboard.text(getCategoryEmoji(categories[i]) + ' ' + categories[i].toUpperCase());
    }
    if (categories[i + 1]) {
      keyboard.text(getCategoryEmoji(categories[i + 1]) + ' ' + categories[i + 1].toUpperCase());
    }
    keyboard.row();
  }
  
  keyboard.text('🎲 СЛУЧАЙНАЯ ФРАЗА');
  keyboard.row();
  keyboard.text('📊 СТАТИСТИКА');
  keyboard.row();
  keyboard.text('↩️ НАЗАД В МЕНЮ');
  
  return keyboard.resized().oneTime();
}

// ===================== ОСНОВНЫЕ ОБРАБОТЧИКИ =====================

// 🚀 СТАРТОВАЯ КОМАНДА
bot.command('start', async (ctx) => {
  await showStartScreen(ctx);
});

// 📨 ОБРАБОТКА ВСЕХ СООБЩЕНИЙ
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Пользователь';
  
  // 🚀 БОЛЬШАЯ СТАРТОВАЯ КНОПКА
  if (text === '🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ' || text === '/start') {
    await showStartScreen(ctx);
    return;
  }
  
  const userData = userStorage.get(userId);
  
  // 👤 НОВЫЙ ПОЛЬЗОВАТЕЛЬ
  if (!userData) {
    await showStartScreen(ctx);
    return;
  }
  
  // 📍 ОБРАБОТКА ВЫБОРА ГОРОДА
  if (text.startsWith('📍 ')) {
    const city = text.replace('📍 ', '');
    await saveCityAndShowMainMenu(ctx, userId, city, userName);
    return;
  }
  
  // 🏙️ ДРУГОЙ ГОРОД (ручной ввод)
  if (text === '📍 ДРУГОЙ ГОРОД') {
    await ctx.reply(
      '✏️ *Напишите название вашего города:*\n\n' +
      '_Например: Ростов-на-Дону, Владивосток, Минск_',
      { parse_mode: 'Markdown' }
    );
    // Сохраняем состояние ожидания ввода города
    userData.waitingForCity = true;
    userStorage.set(userId, userData);
    return;
  }
  
  // 📍 ОБРАБОТКА РУЧНОГО ВВОДА ГОРОДА
  if (userData.waitingForCity) {
    userData.waitingForCity = false;
    await saveCityAndShowMainMenu(ctx, userId, text, userName);
    return;
  }
  
  // 🏠 ГЛАВНОЕ МЕНЮ - ОСНОВНЫЕ КНОПКИ
  switch (text) {
    case '🌤️ ПОГОДА СЕЙЧАС':
      await showWeather(ctx, userData.city);
      break;
      
    case '👕 ЧТО НАДЕТЬ?':
      await showWardrobeAdviceForCity(ctx, userData.city);
      break;
      
    case '💬 ФРАЗА ДНЯ':
      await showDailyPhrase(ctx);
      break;
      
    case '📚 КАТЕГОРИИ ФРАЗ':
      await showCategoriesMenu(ctx);
      break;
      
    case '🏙️ СМЕНИТЬ ГОРОД':
      await showCitySelection(ctx);
      break;
      
    case 'ℹ️ ПОМОЩЬ':
      await showHelp(ctx);
      break;
      
    case '⭐ ИЗБРАННЫЕ ФРАЗЫ':
      await showFavoritePhrases(ctx, userId);
      break;
      
    case '↩️ НАЗАД В МЕНЮ':
      await showMainMenu(ctx, userData.city, userName);
      break;
      
    case '🎲 СЛУЧАЙНАЯ ФРАЗА':
      await showRandomPhrase(ctx);
      break;
      
    case '📊 СТАТИСТИКА':
      await showStatistics(ctx);
      break;
      
    default:
      // 📚 ОБРАБОТКА КАТЕГОРИЙ ФРАЗ
      const category = detectCategoryFromText(text);
      if (category) {
        await showPhraseByCategory(ctx, category);
        return;
      }
      
      // ❓ НЕИЗВЕСТНАЯ КОМАНДА
      await ctx.reply(
        '🤔 *Используйте кнопки меню для навигации*\n\n' +
        'Если хотите начать заново, нажмите /start',
        { 
          parse_mode: 'Markdown',
          reply_markup: mainMenuKeyboard 
        }
      );
  }
});

// ===================== ОСНОВНЫЕ ФУНКЦИИ ЭКРАНОВ =====================

// 🚀 СТАРТОВЫЙ ЭКРАН
async function showStartScreen(ctx) {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Друг';
  
  // Очищаем старые данные
  userStorage.delete(userId);
  
  await ctx.reply(
    `🎯 *ПРИВЕТ, ${userName.toUpperCase()}!*\n\n` +
    `🌟 *Weather & Phrase Bot* — твой персональный помощник!\n\n` +
    `📅 *ЕЖЕДНЕВНО ПОЛУЧАЙ:*\n` +
    `🌤️  Актуальную погоду с осадками\n` +
    `👕  Советы, что лучше надеть\n` +
    `💬  Новую фразу на английском с переводом\n\n` +
    `📚 *200+ ФРАЗ В БАЗЕ:*\n` +
    `• 🧳 Путешествия • 🛍️ Шопинг • 💼 Работа\n` +
    `• 👫 Друзья • 🍽️ Ресторан • 🏥 Здоровье\n\n` +
    `👇 *НАЖМИ КНОПКУ НИЖЕ, ЧТОБЫ НАЧАТЬ:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: startButtonKeyboard 
    }
  );
}

// 🏙️ ВЫБОР ГОРОДА
async function showCitySelection(ctx) {
  await ctx.reply(
    `🏙️ *ВЫБЕРИТЕ ВАШ ГОРОД*\n\n` +
    `Чтобы получать точные прогнозы погоды,\n` +
    `выберите город из списка или введите свой:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: cityKeyboard 
    }
  );
}

// 💾 СОХРАНЕНИЕ ГОРОДА
async function saveCityAndShowMainMenu(ctx, userId, city, userName) {
  userStorage.set(userId, { 
    city: city,
    waitingForCity: false,
    favoritePhrases: [],
    joinedAt: new Date().toISOString()
  });
  
  await ctx.reply(
    `✅ *ГОРОД СОХРАНЁН!*\n\n` +
    `📍 Теперь ваш город: *${city}*\n\n` +
    `Привет, ${userName}! Выберите действие:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// 🏠 ГЛАВНОЕ МЕНЮ
async function showMainMenu(ctx, city, userName) {
  await ctx.reply(
    `🏠 *ГЛАВНОЕ МЕНЮ*\n\n` +
    `👋 Привет, ${userName}!\n` +
    `📍 Ваш город: *${city}*\n\n` +
    `Выберите действие:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// 🌤️ ПОКАЗАТЬ ПОГОДУ
async function showWeather(ctx, city) {
  try {
    await ctx.reply('🌤️ *Загружаю погоду...*', { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(city);
    const icon = getWeatherIcon(weather.icon);
    const tempAdvice = getTemperatureAdvice(weather.temp);
    
    const weatherText = 
      `${icon} *ПОГОДА В ${weather.city.toUpperCase()}*\n\n` +
      `🌡️ Температура: *${weather.temp}°C*\n` +
      `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
      `📝 Описание: ${weather.description}\n` +
      `💨 Ветер: ${weather.wind} м/с\n` +
      `💧 Влажность: ${weather.humidity}%\n` +
      `🌧️ Осадки: ${weather.precipitation}\n\n` +
      `📌 *${tempAdvice.short}* ${tempAdvice.emoji}\n\n` +
      `_Обновлено: ${new Date().toLocaleTimeString('ru-RU')}_`;
    
    await ctx.reply(weatherText, { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    await ctx.reply(
      `❌ *Не удалось получить погоду для города ${city}*\n\n` +
      `Проверьте название города или попробуйте позже.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
}

// 👕 СОВЕТЫ ПО ОДЕЖДЕ
async function showWardrobeAdviceForCity(ctx, city) {
  try {
    await ctx.reply('👕 *Анализирую погоду для подбора одежды...*', { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(city);
    const advice = getWardrobeAdvice(weather);
    
    await ctx.reply(
      `👕 *ЧТО НАДЕТЬ В ${weather.city.toUpperCase()}?*\n\n` +
      `${advice}\n\n` +
      `_Рекомендация основана на текущей погоде_`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
    
  } catch (error) {
    await ctx.reply(
      `❌ *Не удалось получить рекомендации*\n\n` +
      `Сначала проверьте погоду для города ${city}`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
}

// 💬 ФРАЗА ДНЯ
async function showDailyPhrase(ctx) {
  const phrase = getPhraseOfDay();
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  const phraseText = 
    `💬 *ФРАЗА ДНЯ*\n\n` +
    `📅 ${new Date().toLocaleDateString('ru-RU')}\n\n` +
    `🇬🇧 *Английский:*\n"${phrase.english}"\n\n` +
    `🇷🇺 *Перевод:*\n${phrase.russian}\n\n` +
    `📚 *Объяснение:*\n${phrase.explanation}\n\n` +
    `🏷️ Категория: ${getCategoryEmoji(phrase.category)} ${phrase.category}\n` +
    `📊 Сложность: ${getDifficultyEmoji(phrase.difficulty)}\n\n` +
    `_Учите по одной фразе каждый день!_`;
  
  const keyboard = new Keyboard()
    .text('⭐ СОХРАНИТЬ В ИЗБРАННОЕ')
    .row()
    .text('🎲 СЛУЧАЙНАЯ ФРАЗА')
    .text('📚 КАТЕГОРИИ ФРАЗ')
    .row()
    .text('↩️ НАЗАД В МЕНЮ')
    .resized()
    .oneTime();
  
  // Сохраняем текущую фразу для пользователя
  if (userData) {
    userData.currentPhrase = phrase;
    userStorage.set(userId, userData);
  }
  
  await ctx.reply(phraseText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard 
  });
}

// 📚 МЕНЮ КАТЕГОРИЙ
async function showCategoriesMenu(ctx) {
  await ctx.reply(
    `📚 *ВЫБЕРИТЕ КАТЕГОРИЮ ФРАЗ*\n\n` +
    `Учите фразы по темам:\n\n` +
    `• 🧳 *ПУТЕШЕСТВИЯ* - для поездок\n` +
    `• 🛍️ *ШОПИНГ* - для покупок\n` +
    `• 💼 *РАБОТА* - для офиса\n` +
    `• 👫 *ДРУЗЬЯ* - для общения\n` +
    `• 🍽️ *РЕСТОРАН* - для еды\n` +
    `• 🏥 *ЗДОРОВЬЕ* - для врача\n` +
    `• 🚌 *ТРАНСПОРТ* - для дороги\n` +
    `• 😊 *ЭМОЦИИ* - для чувств`,
    { 
      parse_mode: 'Markdown',
      reply_markup: getCategoriesKeyboard()
    }
  );
}

// 🎲 СЛУЧАЙНАЯ ФРАЗА
async function showRandomPhrase(ctx) {
  const phrase = getRandomPhrase();
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  const phraseText = 
    `🎲 *СЛУЧАЙНАЯ ФРАЗА*\n\n` +
    `🇬🇧 *Английский:*\n"${phrase.english}"\n\n` +
    `🇷🇺 *Перевод:*\n${phrase.russian}\n\n` +
    `📚 *Объяснение:*\n${phrase.explanation}\n\n` +
    `🏷️ Категория: ${getCategoryEmoji(phrase.category)} ${phrase.category}\n` +
    `📊 Сложность: ${getDifficultyEmoji(phrase.difficulty)}\n\n` +
    `_Учите что-то новое каждый день!_`;
  
  const keyboard = new Keyboard()
    .text('⭐ СОХРАНИТЬ В ИЗБРАННОЕ')
    .row()
    .text('🎲 ЕЩЁ СЛУЧАЙНУЮ')
    .row()
    .text('📚 КАТЕГОРИИ ФРАЗ')
    .row()
    .text('↩️ НАЗАД В МЕНЮ')
    .resized()
    .oneTime();
  
  // Сохраняем текущую фразу
  if (userData) {
    userData.currentPhrase = phrase;
    userStorage.set(userId, userData);
  }
  
  await ctx.reply(phraseText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard 
  });
}

// 📚 ФРАЗА ПО КАТЕГОРИИ
async function showPhraseByCategory(ctx, category) {
  const phrase = getPhraseByCategory(category);
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  const phraseText = 
    `📚 *ФРАЗА ИЗ КАТЕГОРИИ: ${category.toUpperCase()}*\n\n` +
    `🇬🇧 *Английский:*\n"${phrase.english}"\n\n` +
    `🇷🇺 *Перевод:*\n${phrase.russian}\n\n` +
    `📚 *Объяснение:*\n${phrase.explanation}\n\n` +
    `🏷️ Категория: ${getCategoryEmoji(phrase.category)} ${phrase.category}\n` +
    `📊 Сложность: ${getDifficultyEmoji(phrase.difficulty)}\n\n` +
    `_Сохраните эту фразу в избранное!_`;
  
  const keyboard = new Keyboard()
    .text('⭐ СОХРАНИТЬ В ИЗБРАННОЕ')
    .row()
    .text(`🔁 ЕЩЁ ФРАЗУ ИЗ ${category.toUpperCase()}`)
    .row()
    .text('📚 ВСЕ КАТЕГОРИИ')
    .row()
    .text('↩️ НАЗАД В МЕНЮ')
    .resized()
    .oneTime();
  
  // Сохраняем текущую фразу
  if (userData) {
    userData.currentPhrase = phrase;
    userData.currentCategory = category;
    userStorage.set(userId, userData);
  }
  
  await ctx.reply(phraseText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard 
  });
}

// 📊 СТАТИСТИКА
async function showStatistics(ctx) {
  const stats = getPhraseStats();
  
  let statsText = `📊 *СТАТИСТИКА ФРАЗ*\n\n`;
  statsText += `Всего фраз в базе: *${stats.total}*\n\n`;
  
  statsText += `*По категориям:*\n`;
  for (const [category, count] of Object.entries(stats.byCategory)) {
    const emoji = getCategoryEmoji(category);
    statsText += `${emoji} ${category}: ${count} фраз\n`;
  }
  
  statsText += `\n*По сложности:*\n`;
  statsText += `🟢 Начинающий: ${stats.byDifficulty.beginner} фраз\n`;
  statsText += `🟡 Средний: ${stats.byDifficulty.intermediate} фраз\n`;
  statsText += `🔴 Продвинутый: ${stats.byDifficulty.advanced} фраз\n\n`;
  
  statsText += `_Каждый день новая фраза из базы!_`;
  
  await ctx.reply(statsText, { 
    parse_mode: 'Markdown',
    reply_markup: getCategoriesKeyboard()
  });
}

// ⭐ ИЗБРАННЫЕ ФРАЗЫ
async function showFavoritePhrases(ctx, userId) {
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.favoritePhrases || userData.favoritePhrases.length === 0) {
    await ctx.reply(
      `⭐ *ИЗБРАННЫЕ ФРАЗЫ*\n\n` +
      `У вас пока нет избранных фраз.\n\n` +
      `Добавляйте фразы, нажимая кнопку\n` +
      `"⭐ СОХРАНИТЬ В ИЗБРАННОЕ" после фразы.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
    return;
  }
  
  const phrasesText = userData.favoritePhrases
    .map((p, i) => 
      `${i + 1}. "${p.english}"\n   ${p.russian}\n   📍 ${getCategoryEmoji(p.category)} ${p.category}\n`
    )
    .join('\n');
  
  await ctx.reply(
    `⭐ *ВАШИ ИЗБРАННЫЕ ФРАЗЫ*\n\n` +
    `${phrasesText}\n\n` +
    `Всего сохранено: ${userData.favoritePhrases.length} фраз`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// ℹ️ ПОМОЩЬ
async function showHelp(ctx) {
  await ctx.reply(
    `ℹ️ *ПОМОЩЬ ПО БОТУ*\n\n` +
    `*ДОСТУПНЫЕ КНОПКИ:*\n\n` +
    `🌤️ ПОГОДА СЕЙЧАС - актуальная погода\n` +
    `👕 ЧТО НАДЕТЬ? - советы по одежде\n` +
    `💬 ФРАЗА ДНЯ - новая фраза каждый день\n` +
    `📚 КАТЕГОРИИ ФРАЗ - фразы по темам\n` +
    `🏙️ СМЕНИТЬ ГОРОД - изменить локацию\n` +
    `⭐ ИЗБРАННЫЕ ФРАЗЫ - ваша коллекция\n` +
    `ℹ️ ПОМОЩЬ - эта информация\n\n` +
    `*КОМАНДЫ:*\n` +
    `/start - перезапустить бота\n\n` +
    `_Все функции доступны через кнопки!_\n` +
    `_Бот бесплатно размещен на Vercel_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================

function getCategoryEmoji(category) {
  const emojis = {
    'travel': '🧳', 'shopping': '🛍️',
    'work': '💼', 'friends': '👫',
    'restaurant': '🍽️', 'health': '🏥',
    'transport': '🚌', 'emotions': '😊'
  };
  return emojis[category] || '📌';
}

function getDifficultyEmoji(difficulty) {
  const emojis = {
    'beginner': '🟢 Начинающий',
    'intermediate': '🟡 Средний',
    'advanced': '🔴 Продвинутый'
  };
  return emojis[difficulty] || difficulty;
}

function detectCategoryFromText(text) {
  const categories = getAllCategories();
  const cleanText = text.toLowerCase().replace(/[^a-zа-яё]/g, '');
  
  for (const category of categories) {
    if (cleanText.includes(category.toLowerCase())) {
      return category;
    }
  }
  
  return null;
}

// ===================== ОБРАБОТКА ДОПОЛНИТЕЛЬНЫХ КНОПОК =====================

// Обработка дополнительных кнопок
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData) return;
  
  // ⭐ СОХРАНИТЬ В ИЗБРАННОЕ
  if (text === '⭐ СОХРАНИТЬ В ИЗБРАННОЕ' && userData.currentPhrase) {
    if (!userData.favoritePhrases) {
      userData.favoritePhrases = [];
    }
    
    // Проверяем, не сохранена ли уже эта фраза
    const alreadySaved = userData.favoritePhrases.some(
      p => p.id === userData.currentPhrase.id
    );
    
    if (!alreadySaved) {
      userData.favoritePhrases.push(userData.currentPhrase);
      userStorage.set(userId, userData);
      await ctx.reply('✅ Фраза сохранена в избранное!', {
        reply_markup: mainMenuKeyboard
      });
    } else {
      await ctx.reply('ℹ️ Эта фраза уже в избранном!', {
        reply_markup: mainMenuKeyboard
      });
    }
    return;
  }
  
  // 🔁 ЕЩЁ ФРАЗУ ИЗ КАТЕГОРИИ
  if (text.startsWith('🔁 ЕЩЁ ФРАЗУ ИЗ ') && userData.currentCategory) {
    await showPhraseByCategory(ctx, userData.currentCategory);
    return;
  }
  
  // 🎲 ЕЩЁ СЛУЧАЙНУЮ
  if (text === '🎲 ЕЩЁ СЛУЧАЙНУЮ') {
    await showRandomPhrase(ctx);
    return;
  }
});

// ===================== ЗАПУСК БОТА =====================

// Для Vercel Serverless Function
export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      await bot.init();
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    }
    return res.status(200).json({ message: 'Bot is running' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Для локального тестирования
if (process.env.NODE_ENV !== 'production') {
  bot.start();
  console.log('🤖 Бот запущен локально...');
}
