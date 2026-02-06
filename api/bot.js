import { Bot, Keyboard } from 'grammy';

const bot = new Bot(process.env.BOT_TOKEN || '');
const userStorage = new Map();

// ===================== КЛАВИАТУРЫ =====================

// БОЛЬШАЯ СТАРТОВАЯ КНОПКА
const startKeyboard = new Keyboard()
  .text('🚀 НАЧАТЬ ИСПОЛЬЗОВАТЬ БОТА')
  .resized(); // Автоподгон размера

// ГЛАВНОЕ МЕНЮ (после старта)
const mainMenuKeyboard = new Keyboard()
  .text('🌤️ ПОГОДА СЕЙЧАС')
  .row()
  .text('👕 ЧТО НАДЕТЬ?')
  .text('💬 ФРАЗА ДНЯ')
  .row()
  .text('🏙️ СМЕНИТЬ ГОРОД')
  .text('ℹ️ ПОМОЩЬ')
  .row()
  .text('⭐ ИЗБРАННЫЕ ФРАЗЫ')
  .resized()
  .oneTime(); // Скрыть после нажатия

// КЛАВИАТУРА ВЫБОРА ГОРОДА
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

// КЛАВИАТУРА ДЛЯ ДРУГОГО ГОРОДА
const otherCityKeyboard = new Keyboard()
  .text('↩️ ОТМЕНИТЬ ВВОД')
  .resized();

// ===================== ОБРАБОТЧИКИ =====================

// Обработчик команды /start (можно вызвать вручную)
bot.command('start', async (ctx) => {
  await showStartScreen(ctx);
});

// Обработчик ВСЕХ текстовых сообщений
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  
  // 🚀 БОЛЬШАЯ СТАРТОВАЯ КНОПКА
  if (text === '🚀 НАЧАТЬ ИСПОЛЬЗОВАТЬ БОТА' || text === '/start') {
    await showStartScreen(ctx);
    return;
  }
  
  const userData = userStorage.get(userId);
  
  // Если пользователь новый и нажал "НАЧАТЬ"
  if (!userData) {
    if (text === '🚀 НАЧАТЬ ИСПОЛЬЗОВАТЬ БОТА') {
      await askForCity(ctx);
    }
    return;
  }
  
  // 📍 ВЫБОР ГОРОДА ИЗ СПИСКА
  if (text.startsWith('📍 ')) {
    const city = text.replace('📍 ', '');
    await saveCityAndShowMainMenu(ctx, userId, city);
    return;
  }
  
  // 📍 ВВОД ДРУГОГО ГОРОДА
  if (userData.awaitingCityInput) {
    if (text === '↩️ ОТМЕНИТЬ ВВОД') {
      await askForCity(ctx);
      return;
    }
    
    if (text.length >= 2 && text.length <= 50) {
      await saveCityAndShowMainMenu(ctx, userId, text);
    } else {
      await ctx.reply('Введите корректное название города (от 2 до 50 символов):', {
        reply_markup: otherCityKeyboard
      });
    }
    return;
  }
  
  // 🏠 ГЛАВНОЕ МЕНЮ
  switch (text) {
    case '🌤️ ПОГОДА СЕЙЧАС':
      await showWeather(ctx, userData.city);
      break;
      
    case '👕 ЧТО НАДЕТЬ?':
      await showWardrobeAdvice(ctx, userData.city);
      break;
      
    case '💬 ФРАЗА ДНЯ':
      await showDailyPhrase(ctx);
      break;
      
    case '🏙️ СМЕНИТЬ ГОРОД':
      await askForCity(ctx);
      break;
      
    case 'ℹ️ ПОМОЩЬ':
      await showHelp(ctx);
      break;
      
    case '⭐ ИЗБРАННЫЕ ФРАЗЫ':
      await showFavoritePhrases(ctx);
      break;
      
    case '↩️ НАЗАД В МЕНЮ':
      await showMainMenu(ctx, userData.city);
      break;
      
    case '📍 ДРУГОЙ ГОРОД':
      userData.awaitingCityInput = true;
      userStorage.set(userId, userData);
      await ctx.reply('Напишите название вашего города:', {
        reply_markup: otherCityKeyboard
      });
      break;
      
    default:
      await ctx.reply('Используйте кнопки меню для навигации 👇', {
        reply_markup: mainMenuKeyboard
      });
  }
});

// ===================== ФУНКЦИИ ЭКРАНОВ =====================

// СТАРТОВЫЙ ЭКРАН с большой кнопкой
async function showStartScreen(ctx) {
  await ctx.reply(
    `🎯 *ДОБРО ПОЖАЛОВАТЬ!*\n\n` +
    `*Weather & Language Bot* — ваш персональный помощник:\n\n` +
    `🌤️  *Актуальная погода* с осадками\n` +
    `👕  *Персональные советы* по одежде\n` +
    `💬  *Фразы дня* на английском с переводом\n\n` +
    `_Выучите 365 полезных фраз за год!_\n\n` +
    `👇 НАЖМИТЕ КНОПКУ НИЖЕ, ЧТОБЫ НАЧАТЬ:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: startKeyboard 
    }
  );
}

// ЗАПРОС ВЫБОРА ГОРОДА
async function askForCity(ctx) {
  const userId = ctx.from.id;
  
  // Если пользователь уже выбирал город, очищаем старые данные
  if (userStorage.has(userId)) {
    userStorage.delete(userId);
  }
  
  await ctx.reply(
    `📍 *ШАГ 1: ВЫБЕРИТЕ ВАШ ГОРОД*\n\n` +
    `Чтобы получать точные прогнозы погоды,\n` +
    `выберите город из списка или введите свой:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: cityKeyboard 
    }
  );
}

// СОХРАНЕНИЕ ГОРОДА И ПОКАЗ ГЛАВНОГО МЕНЮ
async function saveCityAndShowMainMenu(ctx, userId, city) {
  userStorage.set(userId, { 
    city: city,
    awaitingCityInput: false,
    joinedAt: new Date().toISOString(),
    favoritePhrases: []
  });
  
  await ctx.reply(
    `✅ *ГОРОД СОХРАНЁН!*\n\n` +
    `📍 Теперь ваш город: *${city}*\n\n` +
    `_Бот готов к работе! Выберите действие:_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// ПОКАЗАТЬ ПОГОДУ
async function showWeather(ctx, city) {
  const weather = await getWeatherData(city);
  
  await ctx.reply(
    `🌤️ *ПОГОДА В ${city.toUpperCase()}*\n\n` +
    `🌡️ Температура: *${weather.temp}°C*\n` +
    `☔ Осадки: ${weather.precipitation}\n` +
    `💧 Влажность: ${weather.humidity}%\n` +
    `💨 Ветер: ${weather.wind} м/с\n\n` +
    `_Обновлено: ${new Date().toLocaleTimeString('ru-RU')}_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// СОВЕТЫ ПО ОДЕЖДЕ
async function showWardrobeAdvice(ctx, city) {
  const advice = await getWardrobeAdvice(city);
  
  await ctx.reply(
    `👕 *ЧТО НАДЕТЬ В ${city.toUpperCase()}?*\n\n` +
    `${advice}\n\n` +
    `_Рекомендация основана на текущей погоде_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// ФРАЗА ДНЯ
async function showDailyPhrase(ctx) {
  const phrase = getDailyPhrase();
  
  await ctx.reply(
    `💬 *ФРАЗА ДНЯ*\n\n` +
    `🇬🇧 *Английский:*\n${phrase.english}\n\n` +
    `🇷🇺 *Перевод:*\n${phrase.russian}\n\n` +
    `📚 *Объяснение:*\n${phrase.explanation}\n\n` +
    `_Запоминайте по одной фразе каждый день!_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: new Keyboard()
        .text('⭐ ДОБАВИТЬ В ИЗБРАННОЕ')
        .row()
        .text('↩️ НАЗАД В МЕНЮ')
        .resized()
    }
  );
}

// ПОМОЩЬ
async function showHelp(ctx) {
  await ctx.reply(
    `ℹ️ *ПОМОЩЬ ПО БОТУ*\n\n` +
    `*ДОСТУПНЫЕ КНОПКИ:*\n\n` +
    `🌤️ ПОГОДА СЕЙЧАС - актуальная погода\n` +
    `👕 ЧТО НАДЕТЬ? - советы по одежде\n` +
    `💬 ФРАЗА ДНЯ - новая фраза каждый день\n` +
    `🏙️ СМЕНИТЬ ГОРОД - изменить локацию\n` +
    `⭐ ИЗБРАННЫЕ ФРАЗЫ - ваша коллекция\n` +
    `ℹ️ ПОМОЩЬ - эта информация\n\n` +
    `_Все функции доступны через кнопки!_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// ИЗБРАННЫЕ ФРАЗЫ
async function showFavoritePhrases(ctx) {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || userData.favoritePhrases.length === 0) {
    await ctx.reply(
      `⭐ *ИЗБРАННЫЕ ФРАЗЫ*\n\n` +
      `У вас пока нет избранных фраз.\n` +
      `Добавляйте фразы, нажимая кнопку\n` +
      `"⭐ ДОБАВИТЬ В ИЗБРАННОЕ" после фразы дня.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
    return;
  }
  
  const phrasesText = userData.favoritePhrases
    .map((p, i) => `${i+1}. ${p.english}\n   ${p.russian}`)
    .join('\n\n');
  
  await ctx.reply(
    `⭐ *ВАШИ ИЗБРАННЫЕ ФРАЗЫ*\n\n` +
    `${phrasesText}\n\n` +
    `_Всего фраз: ${userData.favoritePhrases.length}_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// ГЛАВНОЕ МЕНЮ
async function showMainMenu(ctx, city) {
  await ctx.reply(
    `🏠 *ГЛАВНОЕ МЕНЮ*\n\n` +
    `📍 Ваш город: *${city}*\n\n` +
    `Выберите действие:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// ===================== ЗАГЛУШКИ API =====================

async function getWeatherData(city) {
  // Подключите OpenWeatherMap API здесь
  return {
    temp: '+18°C',
    precipitation: 'Лёгкий дождь',
    humidity: '78',
    wind: '4.2'
  };
}

async function getWardrobeAdvice(city) {
  // Логика рекомендаций на основе погоды
  return `• Наденьте лёгкую куртку\n• Возьмите зонт\n• Обувь на непромокаемой подошве\n• Шапка не требуется`;
}

function getDailyPhrase() {
  const phrases = [
    {
      english: "Every cloud has a silver lining",
      russian: "Нет худа без добра",
      explanation: "В любой плохой ситуации есть что-то хорошее"
    },
    {
      english: "It's raining cats and dogs",
      russian: "Льёт как из ведра",
      explanation: "Очень сильный дождь"
    },
    {
      english: "Break the ice",
      russian: "Растопить лёд",
      explanation: "Начать разговор в неловкой ситуации"
    }
  ];
  
  // Выбор фразы по дню месяца
  const dayOfMonth = new Date().getDate();
  return phrases[dayOfMonth % phrases.length];
}

// ===================== ЗАПУСК БОТА =====================

// Для Vercel Serverless Function
export default async function handler(req, res) {
  try {
    await bot.init();
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error handling update:', error);
    res.status(500).json({ error: error.message });
  }
}

// Для локального тестирования
if (process.env.NODE_ENV !== 'production') {
  bot.start();
  console.log('🤖 Бот запущен локально...');
}
