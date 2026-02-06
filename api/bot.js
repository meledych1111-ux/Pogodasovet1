import { Bot, Keyboard } from 'grammy';
import fetch from 'node-fetch';

// Инициализация бота
const bot = new Bot(process.env.BOT_TOKEN || '');

// Временное хранилище пользователей (в продакшене замените на базу данных)
const userStorage = new Map();

// ===================== КЛАВИАТУРЫ =====================

// 🚀 БОЛЬШАЯ СТАРТОВАЯ КНОПКА
const startKeyboard = new Keyboard()
  .text('🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ')
  .resized()
  .oneTime();

// 🏠 ГЛАВНОЕ МЕНЮ (после старта)
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
  .oneTime();

// 🏙️ КЛАВИАТУРА ВЫБОРА ГОРОДА
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

// ===================== ОБРАБОТЧИКИ КОМАНД =====================

// Команда /start
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Друг';
  
  await ctx.reply(
    `🎯 *ДОБРО ПОЖАЛОВАТЬ, ${userName.toUpperCase()}!*\\n\\n` +
    `🌟 *Weather & Phrase Bot* — ваш персональный помощник!\\n\\n` +
    `📅 *ЕЖЕДНЕВНО ПОЛУЧАЙ:*\\n` +
    `🌤️  Актуальную погоду с осадками\\n` +
    `👕  Советы, что лучше надеть\\n` +
    `💬  Новую фразу на английском с переводом\\n\\n` +
    `👇 *НАЖМИТЕ КНОПКУ НИЖЕ, ЧТОБЫ НАЧАТЬ:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: startKeyboard 
    }
  );
});

// Обработка нажатия большой стартовой кнопки
bot.hears('🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ', async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Пользователь';
  
  // Если пользователь новый, просим выбрать город
  if (!userStorage.has(userId)) {
    await ctx.reply(
      `📍 *ШАГ 1: ВЫБЕРИТЕ ВАШ ГОРОД*\\n\\n` +
      `Чтобы получать точные прогнозы погоды,\\n` +
      `выберите город из списка или введите свой:`,
      { 
        parse_mode: 'Markdown',
        reply_markup: cityKeyboard 
      }
    );
  } else {
    // У пользователя уже есть город - показываем главное меню
    const userData = userStorage.get(userId);
    await showMainMenu(ctx, userData.city, userName);
  }
});

// Обработка выбора города из списка
bot.hears(/^📍\s/, async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Пользователь';
  const city = ctx.message.text.replace('📍 ', '');
  
  if (city === 'ДРУГОЙ ГОРОД') {
    await ctx.reply('Напишите название вашего города:');
    return;
  }
  
  // Сохраняем выбор пользователя
  userStorage.set(userId, { 
    city: city,
    favoritePhrases: [],
    joinedAt: new Date().toISOString()
  });
  
  await showMainMenu(ctx, city, userName);
});

// Обработка ручного ввода города
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const userData = userStorage.get(userId);
  
  // Если пользователь только что нажал "ДРУГОЙ ГОРОД" и вводит название
  if (userData && !userData.city && text.length > 1) {
    userData.city = text;
    userStorage.set(userId, userData);
    await showMainMenu(ctx, text, ctx.from.first_name || 'Пользователь');
  }
});

// Обработка главного меню
bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.city) {
    await ctx.reply('Сначала выберите город!', { reply_markup: startKeyboard });
    return;
  }
  
  const weather = await getWeatherData(userData.city);
  await ctx.reply(
    `🌤️ *ПОГОДА В ${userData.city.toUpperCase()}*\\n\\n` +
    `🌡️ Температура: *${weather.temp}°C*\\n` +
    `📝 ${weather.description}\\n` +
    `💨 Ветер: ${weather.wind} м/с\\n` +
    `💧 Влажность: ${weather.humidity}%\\n` +
    `🌧️ ${weather.precipitation}\\n\\n` +
    `_Обновлено: ${new Date().toLocaleTimeString('ru-RU')}_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.city) {
    await ctx.reply('Сначала выберите город!', { reply_markup: startKeyboard });
    return;
  }
  
  const advice = await getWardrobeAdvice(userData.city);
  await ctx.reply(
    `👕 *СОВЕТ ПО ОДЕЖДЕ ДЛЯ ${userData.city.toUpperCase()}*\\n\\n` +
    `${advice}\\n\\n` +
    `_Рекомендация основана на текущих погодных условиях_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const phrase = getDailyPhrase();
  await ctx.reply(
    `💬 *ФРАЗА ДНЯ*\\n\\n` +
    `🇬🇧 *Английский:*\\n${phrase.english}\\n\\n` +
    `🇷🇺 *Перевод:*\\n${phrase.russian}\\n\\n` +
    `📚 *Объяснение:*\\n${phrase.explanation}\\n\\n` +
    `_Запоминайте по одной фразе каждый день!_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
  await ctx.reply(
    `🏙️ *ВЫБЕРИТЕ НОВЫЙ ГОРОД*\\n\\n` +
    `Можете выбрать из популярных или ввести свой вариант:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: cityKeyboard 
    }
  );
});

bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
  await ctx.reply(
    `ℹ️ *ПОМОЩЬ ПО БОТУ*\\n\\n` +
    `*ДОСТУПНЫЕ КНОПКИ:*\\n\\n` +
    `🌤️ ПОГОДА СЕЙЧАС - актуальная погода\\n` +
    `👕 ЧТО НАДЕТЬ? - советы по одежде\\n` +
    `💬 ФРАЗА ДНЯ - новая фраза каждый день\\n` +
    `🏙️ СМЕНИТЬ ГОРОД - изменить локацию\\n` +
    `⭐ ИЗБРАННЫЕ ФРАЗЫ - ваша коллекция\\n` +
    `ℹ️ ПОМОЩЬ - эта информация\\n\\n` +
    `*КОМАНДЫ:*\\n` +
    `/start - перезапустить бота\\n\\n` +
    `_Все функции доступны через кнопки!_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.hears('⭐ ИЗБРАННЫЕ ФРАЗЫ', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.favoritePhrases || userData.favoritePhrases.length === 0) {
    await ctx.reply(
      `⭐ *ИЗБРАННЫЕ ФРАЗЫ*\\n\\n` +
      `У вас пока нет избранных фраз.\\n` +
      `Добавляйте фразы, нажимая кнопку\\n` +
      `"⭐ ДОБАВИТЬ В ИЗБРАННОЕ" после фразы дня.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
    return;
  }
  
  const phrasesText = userData.favoritePhrases
    .map((p, i) => `${i+1}. ${p.english}\\n   ${p.russian}`)
    .join('\\n\\n');
  
  await ctx.reply(
    `⭐ *ВАШИ ИЗБРАННЫЕ ФРАЗЫ*\\n\\n` +
    `${phrasesText}\\n\\n` +
    `Всего фраз: ${userData.favoritePhrases.length}`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.hears('↩️ НАЗАД В МЕНЮ', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  const userName = ctx.from.first_name || 'Пользователь';
  
  if (userData && userData.city) {
    await showMainMenu(ctx, userData.city, userName);
  } else {
    await ctx.reply(
      'Сначала выберите город!',
      { reply_markup: startKeyboard }
    );
  }
});

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================

// Функция показа главного меню
async function showMainMenu(ctx, city, userName) {
  await ctx.reply(
    `🏠 *ГЛАВНОЕ МЕНЮ*\\n\\n` +
    `👋 Привет, ${userName}!\\n` +
    `📍 Ваш город: *${city}*\\n\\n` +
    `Выберите действие:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// Получение погодных данных
async function getWeatherData(city) {
  const apiKey = process.env.WEATHER_API_KEY;
  
  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=ru`
    );
    
    if (!response.ok) {
      throw new Error('Город не найден');
    }
    
    const data = await response.json();
    
    return {
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      wind: data.wind.speed,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      precipitation: getPrecipitation(data),
      city: data.name
    };
  } catch (error) {
    console.error('Weather API error:', error);
    return getMockWeatherData(city);
  }
}

function getPrecipitation(data) {
  if (data.rain) {
    return `Дождь: ${data.rain['1h'] || 0} мм`;
  }
  if (data.snow) {
    return `Снег: ${data.snow['1h'] || 0} мм`;
  }
  return 'Без осадков';
}

function getMockWeatherData(city) {
  return {
    temp: 15,
    feels_like: 14,
    humidity: 65,
    wind: 3.2,
    description: 'Облачно',
    icon: '04d',
    precipitation: 'Лёгкий дождь',
    city: city
  };
}

// Советы по одежде
async function getWardrobeAdvice(city) {
  const weather = await getWeatherData(city);
  const temp = weather.temp;
  
  if (temp >= 25) {
    return '• Футболка/майка\\n• Шорты/легкие брюки\\n• Солнцезащитные очки\\n• Головной убор от солнца';
  } else if (temp >= 18) {
    return '• Футболка/рубашка\\n• Джинсы/брюки\\n• Легкая куртка на вечер\\n• Удобная обувь';
  } else if (temp >= 10) {
    return '• Толстовка/свитер\\n• Джинсы/брюки\\n• Ветровка/легкая куртка\\n• Закрытая обувь';
  } else if (temp >= 0) {
    return '• Теплый свитер\\n• Утепленные брюки\\n• Зимняя куртка\\n• Шапка и перчатки\\n• Теплая обувь';
  } else {
    return '• Термобелье\\n• Теплый свитер\\n• Зимняя куртка\\n• Шапка, шарф, перчатки\\n• Теплая непромокаемая обувь';
  }
}

// Фразы дня
function getDailyPhrase() {
  const phrases = [
    {
      english: "It's raining cats and dogs",
      russian: "Льёт как из ведра",
      explanation: "Идиома для описания очень сильного дождя"
    },
    {
      english: "Break the ice",
      russian: "Растопить лёд/начать общение",
      explanation: "Начать разговор в неловкой ситуации"
    },
    {
      english: "Under the weather",
      russian: "Нездоровиться",
      explanation: "Чувствовать себя неважно, болеть"
    },
    {
      english: "Every cloud has a silver lining",
      russian: "Нет худа без добра",
      explanation: "В любой плохой ситуации есть что-то хорошее"
    },
    {
      english: "Piece of cake",
      russian: "Проще простого",
      explanation: "Очень легко, не составляет труда"
    }
  ];
  
  // Выбор фразы по дню месяца
  const dayOfMonth = new Date().getDate();
  return phrases[dayOfMonth % phrases.length];
}

// ===================== ЗАПУСК БОТА ДЛЯ VERCEL =====================

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
    
    // Для других методов
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error in handler:', error);
    // ВСЕГДА возвращаем 200 Telegram, даже при ошибке
    return res.status(200).json({ ok: false, error: error.message });
  }
}
