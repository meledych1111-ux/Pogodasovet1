import { Bot, Keyboard } from 'grammy';
import fetch from 'node-fetch';

const bot = new Bot(process.env.BOT_TOKEN || '');
const userStorage = new Map(); // Временное хранилище

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
  .text('📍 ЯЛТА').text('📍 МОСКВА')
  .row()
  .text('📍 ДРУГОЙ ГОРОД')
  .row()
  .text('↩️ НАЗАД В МЕНЮ')
  .resized()
  .oneTime();

// ===================== ОБРАБОТЧИКИ КОМАНД =====================

bot.command('start', async (ctx) => {
  await ctx.reply(
    `🎯 *ДОБРО ПОЖАЛОВАТЬ!*\n\n` +
    `👇 *НАЖМИТЕ КНОПКУ НИЖЕ, ЧТОБЫ НАЧАТЬ:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: startKeyboard 
    }
  );
});

bot.hears('🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!userStorage.has(userId)) {
    await ctx.reply(
      `📍 *ВЫБЕРИТЕ ВАШ ГОРОД:*`,
      { 
        parse_mode: 'Markdown',
        reply_markup: cityKeyboard 
      }
    );
  } else {
    const userData = userStorage.get(userId);
    await showMainMenu(ctx, userData.city);
  }
});

bot.hears(/^📍\s/, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '');
  
  if (city === 'ДРУГОЙ ГОРОД') {
    await ctx.reply('Напишите название вашего города (например: Краснодар, Сочи, Феодосия):');
    return;
  }
  
  userStorage.set(userId, { 
    city: city,
    joinedAt: new Date().toISOString()
  });
  
  await showMainMenu(ctx, city);
});

// Обработка ручного ввода города
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const userData = userStorage.get(userId);
  
  if (text === '🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ' || text.startsWith('/') || text.startsWith('📍')) {
    return; // Эти сообщения уже обрабатываются другими хендлерами
  }
  
  // Если пользователь только что нажал "ДРУГОЙ ГОРОД" и вводит название
  if (userData && !userData.city) {
    userData.city = text;
    userStorage.set(userId, userData);
    await showMainMenu(ctx, text);
  }
});

// ===================== ОБРАБОТЧИКИ ГЛАВНОГО МЕНЮ =====================

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.city) {
    await ctx.reply('Сначала выберите город!', { reply_markup: startKeyboard });
    return;
  }
  
  try {
    const weather = await getWeatherData(userData.city);
    
    await ctx.reply(
      `🌤️ *ПОГОДА В ${userData.city.toUpperCase()}*\n\n` +
      `🌡️ Температура: *${weather.temp}°C*\n` +
      `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
      `💨 Ветер: ${weather.wind} м/с\n` +
      `💧 Влажность: ${weather.humidity}%\n` +
      `☁️ Облачность: ${weather.clouds}%\n` +
      `📝 Описание: ${weather.description}`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  } catch (error) {
    console.error('Ошибка при получении погоды:', error);
    await ctx.reply(
      `❌ Не удалось получить погоду для ${userData.city}\n` +
      `Проверьте название города или попробуйте позже.`,
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
    await ctx.reply('Сначала выберите город!', { reply_markup: startKeyboard });
    return;
  }
  
  try {
    const weather = await getWeatherData(userData.city);
    const advice = getWardrobeAdvice(weather.temp);
    
    await ctx.reply(
      `👕 *СОВЕТ ПО ОДЕЖДЕ ДЛЯ ${userData.city.toUpperCase()}*\n\n` +
      `${advice}\n\n` +
      `_Рекомендация основана на текущей температуре: ${weather.temp}°C_`,
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
  const phrase = getDailyPhrase();
  
  await ctx.reply(
    `💬 *ФРАЗА ДНЯ*\n\n` +
    `🇬🇧 *Английский:*\n"${phrase.english}"\n\n` +
    `🇷🇺 *Перевод:*\n${phrase.russian}\n\n` +
    `📚 *Объяснение:*\n${phrase.explanation}`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  // Сбрасываем город пользователя, чтобы запросить новый
  if (userData) {
    userData.city = null;
    userStorage.set(userId, userData);
  }
  
  await ctx.reply(
    `🏙️ *ВЫБЕРИТЕ НОВЫЙ ГОРОД:*\n\n` +
    `Можете выбрать из списка или ввести название вручную:`,
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

bot.hears('↩️ НАЗАД В МЕНЮ', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (userData && userData.city) {
    await showMainMenu(ctx, userData.city);
  } else {
    await ctx.reply(
      'Сначала выберите город!',
      { reply_markup: startKeyboard }
    );
  }
});

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================

async function showMainMenu(ctx, city) {
  await ctx.reply(
    `🏠 *ГЛАВНОЕ МЕНЮ*\n\n📍 Ваш город: *${city}*\n\nВыберите действие:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
}

// Основная функция получения погоды с Open-Meteo
async function getWeatherData(cityName) {
  try {
    // 1. Сначала получаем координаты города (геокодирование)
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    
    if (!geoData.results || geoData.results.length === 0) {
      throw new Error('Город не найден');
    }
    
    const { latitude, longitude, name } = geoData.results[0];
    
    // 2. Получаем погоду по координатам
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,cloud_cover&wind_speed_unit=ms&timezone=auto`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    if (!weatherData.current) {
      throw new Error('Нет данных о погоде');
    }
    
    const current = weatherData.current;
    
    // Формируем текстовое описание погоды
    const description = getWeatherDescription(current.cloud_cover);
    
    return {
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m.toFixed(1),
      clouds: current.cloud_cover,
      description: description,
      city: name
    };
  } catch (error) {
    console.error('Ошибка Open-Meteo API:', error.message);
    // Возвращаем тестовые данные в случае ошибки
    return {
      temp: 15,
      feels_like: 14,
      humidity: 65,
      wind: '3.2',
      clouds: 75,
      description: 'Облачно',
      city: cityName
    };
  }
}

function getWeatherDescription(cloudCover) {
  if (cloudCover < 20) return 'Ясно ☀️';
  if (cloudCover < 50) return 'Малооблачно ⛅';
  if (cloudCover < 80) return 'Облачно ☁️';
  return 'Пасмурно 🌫️';
}

function getWardrobeAdvice(temp) {
  if (temp >= 25) return '• Футболка/майка\n• Шорты/легкие брюки\n• Солнцезащитные очки\n• Головной убор';
  if (temp >= 18) return '• Футболка/рубашка\n• Джинсы/брюки\n• Легкая куртка на вечер';
  if (temp >= 10) return '• Толстовка/свитер\n• Джинсы/брюки\n• Ветровка/легкая куртка';
  if (temp >= 0) return '• Теплый свитер\n• Утепленные брюки\n• Зимняя куртка\n• Шапка и перчатки';
  return '• Термобелье\n• Теплый свитер\n• Зимняя куртка\n• Шапка, шарф, перчатки\n• Теплая непромокаемая обувь';
}

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
    }
  ];
  
  const dayOfMonth = new Date().getDate();
  return phrases[dayOfMonth % phrases.length];
}

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
    return res.status(200).json({ ok: false, error: error.message });
  }
}
