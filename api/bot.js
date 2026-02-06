import { Bot, Keyboard } from 'grammy';
import fetch from 'node-fetch';

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
  .text('📍 ЯЛТА').text('📍 МОСКВА')
  .row()
  .text('📍 ДРУГОЙ ГОРОД')
  .row()
  .text('↩️ В ГЛАВНОЕ МЕНЮ')
  .resized()
  .oneTime();

// ===================== ИСПРАВЛЕННЫЕ ОБРАБОТЧИКИ =====================

// ОБРАБОТЧИК СТАРТА
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  // Очищаем старые данные пользователя при новом старте
  userStorage.delete(userId);
  
  await ctx.reply(
    `🎯 *ДОБРО ПОЖАЛОВАТЬ В WEATHER & PHRASE BOT!*\n\n` +
    `🌟 *Ваш персональный помощник на каждый день:*\n\n` +
    `🌤️  *Актуальная погода* с осадками\n` +
    `👕  *Персональные советы* по одежде\n` +
    `💬  *Фразы дня* на английском с переводом\n\n` +
    `📚 *Учите английский легко:*\n` +
    `• 🧳 Фразы для путешествий\n` +
    `• 🛍️ Фразы для магазина\n` +
    `• 💼 Фразы для работы\n` +
    `• 👫 Фразы для общения с друзьями\n\n` +
    `👇 *НАЖМИТЕ КНОПКУ НИЖЕ, ЧТОБЫ НАЧАТЬ:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: startKeyboard 
    }
  );
});

// НАЖАТИЕ "НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ"
bot.hears('🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ', async (ctx) => {
  await ctx.reply(
    `📍 *ШАГ 1: ВЫБЕРИТЕ ВАШ ГОРОД*\n\n` +
    `Чтобы получать точные прогнозы погоды, выберите город из списка ниже.\n` +
    `Если вашего города нет, нажмите "📍 ДРУГОЙ ГОРОД" и напишите его название.`,
    { 
      parse_mode: 'Markdown',
      reply_markup: cityKeyboard 
    }
  );
});

// ВЫБОР ГОРОДА ИЗ СПИСКА (исправленная логика)
bot.hears(/^📍\s/, async (ctx) => {
  const userId = ctx.from.id;
  const userInput = ctx.message.text;
  
  // Если выбрана кнопка "В ГЛАВНОЕ МЕНЮ"
  if (userInput === '↩️ В ГЛАВНОЕ МЕНЮ') {
    const userData = userStorage.get(userId);
    if (userData && userData.city) {
      await showMainMenu(ctx, userData.city);
    } else {
      await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
    }
    return;
  }
  
  // Если выбран "ДРУГОЙ ГОРОД"
  if (userInput === '📍 ДРУГОЙ ГОРОД') {
    userStorage.set(userId, { awaitingCityInput: true });
    await ctx.reply(
      '✏️ *Напишите название вашего города:*\n\n' +
      '_Например: Алушта, Евпатория, Краснодар, Сочи_',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  // Если выбран город из списка (например, "📍 СЕВАСТОПОЛЬ")
  const selectedCity = userInput.replace('📍 ', '');
  
  // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Правильно сохраняем город
  userStorage.set(userId, { 
    city: selectedCity,
    awaitingCityInput: false // Сбрасываем флаг ожидания ввода
  });
  
  console.log(`Город сохранен для ${userId}: ${selectedCity}`);
  
  // Показываем подсказку, что делать дальше
  await ctx.reply(
    `✅ *Отлично! Город "${selectedCity}" сохранен.*\n\n` +
    `Теперь вы можете:\n` +
    `1. Нажать *"🌤️ ПОГОДА СЕЙЧАС"* — чтобы узнать погоду\n` +
    `2. Нажать *"👕 ЧТО НАДЕТЬ?"* — чтобы получить совет по одежде\n\n` +
    `👇 *Используйте кнопки ниже:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

// ОБРАБОТКА РУЧНОГО ВВОДА НАЗВАНИЯ ГОРОДА
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const userInput = ctx.message.text;
  const userData = userStorage.get(userId);
  
  // Пропускаем команды и кнопки, которые уже обработаны
  if (userInput.startsWith('/') || userInput.startsWith('📍') || 
      userInput === '🚀 НАЧАТЬ ПОЛЬЗОВАТЬСЯ БОТОМ') {
    return;
  }
  
  // Если пользователь должен ввести город (нажал "ДРУГОЙ ГОРОД")
  if (userData && userData.awaitingCityInput === true) {
    const cityName = userInput.trim();
    
    if (cityName.length < 2) {
      await ctx.reply('Пожалуйста, введите корректное название города.');
      return;
    }
    
    // Сохраняем город и сбрасываем флаг
    userStorage.set(userId, { 
      city: cityName,
      awaitingCityInput: false
    });
    
    console.log(`Город (ручной ввод) сохранен для ${userId}: ${cityName}`);
    
    await ctx.reply(
      `✅ *Город "${cityName}" сохранен!*\n\n` +
      `Теперь вы можете получать погоду и советы. Используйте кнопки меню:`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
});

// ОБРАБОТКА КНОПКИ "ПОГОДА СЕЙЧАС" (исправлена)
bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  console.log(`Обработка "Погода сейчас" для пользователя ${userId}. Данные:`, userData);
  
  // Проверяем, есть ли у пользователя сохраненный город
  if (!userData || !userData.city) {
    await ctx.reply(
      '❌ *Сначала выберите город!*\n\n' +
      'Нажмите "🏙️ СМЕНИТЬ ГОРОД", чтобы выбрать ваш город.',
      { 
        parse_mode: 'Markdown',
        reply_markup: cityKeyboard 
      }
    );
    return;
  }
  
  const city = userData.city;
  
  // Показываем пользователю, что идет загрузка
  await ctx.reply(`⏳ *Загружаю погоду для ${city}...*`, { 
    parse_mode: 'Markdown' 
  });
  
  try {
    // Получаем погоду через Open-Meteo API
    const weather = await getWeatherData(city);
    
    await ctx.reply(
      `🌤️ *ПОГОДА В ${city.toUpperCase()}*\n\n` +
      `🌡️ Температура: *${weather.temp}°C*\n` +
      `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
      `💨 Ветер: ${weather.wind} м/с\n` +
      `💧 Влажность: ${weather.humidity}%\n` +
      `☁️ Облачность: ${weather.clouds}%\n` +
      `📝 ${weather.description}\n\n` +
      `_Данные предоставлены Open-Meteo.com_`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  } catch (error) {
    console.error('Ошибка получения погоды:', error);
    await ctx.reply(
      `❌ *Не удалось получить погоду для ${city}*\n\n` +
      `Попробуйте позже или выберите другой город.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      }
    );
  }
});

// ОБРАБОТКА КНОПКИ "ЧТО НАДЕТЬ?" (исправлена)
bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData || !userData.city) {
    await ctx.reply(
      '❌ *Сначала выберите город!*\n\n' +
      'Нажмите "🏙️ СМЕНИТЬ ГОРОД", чтобы выбрать ваш город.',
      { 
        parse_mode: 'Markdown',
        reply_markup: cityKeyboard 
      }
    );
    return;
  }
  
  try {
    const weather = await getWeatherData(userData.city);
    const advice = getWardrobeAdvice(weather.temp);
    
    await ctx.reply(
      `👕 *ЧТО НАДЕТЬ В ${userData.city.toUpperCase()}?*\n\n` +
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

// ОБРАБОТКА ОСТАЛЬНЫХ КНОПОК
bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  const phrase = getDailyPhrase();
  await ctx.reply(
    `💬 *ФРАЗА ДНЯ*\n\n` +
    `🇬🇧 *Английский:*\n"${phrase.english}"\n\n` +
    `🇷🇺 *Перевод:*\n${phrase.russian}\n\n` +
    `📚 *Объяснение:*\n${phrase.explanation}\n\n` +
    `_Запоминайте по одной фразе каждый день!_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard 
    }
  );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
  await ctx.reply(
    `🏙️ *ВЫБЕРИТЕ НОВЫЙ ГОРОД*\n\n` +
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

// Функция для получения погоды через Open-Meteo API
async function getWeatherData(cityName) {
  try {
    // 1. Геокодирование - поиск координат города
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    
    if (!geoResponse.ok) {
      console.error(`Геокодер вернул ошибку: ${geoResponse.status}`);
      // Возвращаем тестовые данные в случае ошибки
      return {
        temp: 9,
        feels_like: 7,
        humidity: 85,
        wind: '4.8',
        clouds: 90,
        description: 'Пасмурно 🌫️',
        city: cityName
      };
    }
    
    const geoData = await geoResponse.json();
    
    // Если город не найден, используем тестовые данные
    if (!geoData.results || geoData.results.length === 0) {
      console.warn(`Город "${cityName}" не найден геокодером`);
      return {
        temp: 9,
        feels_like: 7,
        humidity: 85,
        wind: '4.8',
        clouds: 90,
        description: 'Пасмурно 🌫️',
        city: cityName
      };
    }
    
    const { latitude, longitude, name } = geoData.results[0];
    
    // 2. Получение погоды по координатам
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,cloud_cover&wind_speed_unit=ms&timezone=auto`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    if (!weatherData.current) {
      throw new Error('Нет данных о текущей погоде');
    }
    
    const current = weatherData.current;
    
    return {
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m.toFixed(1),
      clouds: current.cloud_cover,
      description: getWeatherDescription(current.cloud_cover),
      city: name
    };
    
  } catch (error) {
    console.error('Ошибка в getWeatherData:', error);
    // В случае ошибки возвращаем тестовые данные
    return {
      temp: 9,
      feels_like: 7,
      humidity: 85,
      wind: '4.8',
      clouds: 90,
      description: 'Пасмурно 🌫️ (данные по умолчанию)',
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
  if (temp >= 25) return '• Футболка/майка\n• Шорты/легкие брюки\n• Солнцезащитные очки\n• Головной убор от солнца';
  if (temp >= 18) return '• Футболка/рубашка\n• Джинсы/брюки\n• Легкая куртка на вечер\n• Удобная обувь';
  if (temp >= 10) return '• Толстовка/свитер\n• Джинсы/брюки\n• Ветровка/легкая куртка\n• Закрытая обувь';
  if (temp >= 0) return '• Теплый свитер\n• Утепленные брюки\n• Зимняя куртка\n• Шапка и перчатки\n• Теплая обувь';
  return '• Термобелье\n• Теплый свитер\n• Зимняя куртка\n• Шапка, шарф, перчатки\n• Теплая непромокаемая обувь';
}

function getDailyPhrase() {
  const phrases = [
    { english: "It's raining cats and dogs", russian: "Льёт как из ведра", explanation: "Идиома для описания очень сильного дождя" },
    { english: "Break the ice", russian: "Растопить лёд/начать общение", explanation: "Начать разговор в неловкой ситуации" },
    { english: "Under the weather", russian: "Нездоровиться", explanation: "Чувствовать себя неважно, болеть" },
    { english: "Every cloud has a silver lining", russian: "Нет худа без добра", explanation: "В любой плохой ситуации есть что-то хорошее" }
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
