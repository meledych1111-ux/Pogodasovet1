import { Bot, Keyboard } from 'grammy';
import {
  saveUserCity,
  getUserCity,
  saveGameScore,
  getGameStats,
  getTopPlayers,
  checkDatabaseConnection
} from './db.js';

// ===================== КОНФИГУРАЦИЯ =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не найден! Задайте переменную BOT_TOKEN в Vercel.');
  throw new Error('BOT_TOKEN is required');
}

console.log('🤖 Создаю бота...');
const bot = new Bot(BOT_TOKEN);

// ===================== ИНИЦИАЛИЗАЦИЯ БОТА =====================
let botInitialized = false;

async function initializeBot() {
  if (botInitialized) return;
  
  console.log('🔧 Инициализирую бота...');
  try {
    await bot.init();
    botInitialized = true;
    console.log(`✅ Бот инициализирован: @${bot.botInfo.username}`);
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error.message);
  }
}

// Проверяем соединение с базой данных
async function initializeDatabase() {
  try {
    const dbCheck = await checkDatabaseConnection();
    if (dbCheck.success) {
      console.log(`✅ Подключение к базе данных: OK (${dbCheck.time})`);
    } else {
      console.warn(`⚠️ База данных: ${dbCheck.error}`);
    }
  } catch (error) {
    console.error('❌ Ошибка проверки БД:', error.message);
  }
}

// Инициализируем при запуске
initializeBot();
initializeDatabase();

// ===================== ХРАНИЛИЩЕ ДЛЯ СЕССИЙ =====================
const userStorage = new Map();
const rateLimit = new Map();

// Очистка старых сессий
function cleanupStorage() {
  const hourAgo = Date.now() - 3600000;
  for (const [userId, data] of userStorage.entries()) {
    if (data.lastActivity && data.lastActivity < hourAgo) {
      userStorage.delete(userId);
    }
  }
}

setInterval(cleanupStorage, 300000);

// Проверка ограничения запросов
function isRateLimited(userId) {
  const now = Date.now();
  const userLimit = rateLimit.get(userId) || { count: 0, lastRequest: 0 };
  
  if (now - userLimit.lastRequest > 60000) {
    userLimit.count = 0;
  }
  
  userLimit.count++;
  userLimit.lastRequest = now;
  rateLimit.set(userId, userLimit);
  
  if (userLimit.count > 20) {
    console.log(`⚠️ Ограничение запросов для ${userId}: ${userLimit.count}/мин`);
    return true;
  }
  
  return false;
}

// ===================== КЭШ ПОГОДЫ =====================
const weatherCache = new Map();

// Получение координат города
async function getCityCoordinates(cityName) {
  try {
    console.log(`📍 Запрашиваю координаты для города: "${cityName}"`);
    
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const response = await fetch(geoUrl);
    const geoData = await response.json();
    
    if (!geoData.results || geoData.results.length === 0) {
      throw new Error('Город не найден');
    }
    
    return {
      latitude: geoData.results[0].latitude,
      longitude: geoData.results[0].longitude,
      name: geoData.results[0].name
    };
  } catch (error) {
    console.error('❌ Ошибка получения координат:', error.message);
    throw error;
  }
}

// Функция для получения погоды на сегодня
async function getWeatherData(cityName) {
  const cacheKey = cityName.toLowerCase();
  const now = Date.now();
  
  // Проверяем кэш (актуален 10 минут)
  if (weatherCache.has(cacheKey)) {
    const cached = weatherCache.get(cacheKey);
    if (now - cached.timestamp < 600000) {
      console.log(`🌤️ Использую кэшированную погоду для ${cityName}`);
      return cached.data;
    }
  }
  
  console.log(`🌤️ Запрашиваю погоду для: "${cityName}"`);
  
  try {
    const { latitude, longitude, name } = await getCityCoordinates(cityName);
    
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&wind_speed_unit=ms&timezone=auto&forecast_days=2`;
    
    const response = await fetch(weatherUrl);
    const weatherData = await response.json();
    
    if (!weatherData.current) {
      throw new Error('Нет данных о погоде');
    }
    
    const current = weatherData.current;
    const todayPrecipitation = weatherData.daily?.precipitation_sum[0] || 0;
    
    const weatherResult = {
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m.toFixed(1),
      precipitation: todayPrecipitation > 0 ? `${todayPrecipitation.toFixed(1)} мм` : 'Без осадков',
      description: getWeatherDescription(current.weather_code),
      city: name,
      max_temp: Math.round(weatherData.daily?.temperature_2m_max[0] || current.temperature_2m),
      min_temp: Math.round(weatherData.daily?.temperature_2m_min[0] || current.temperature_2m)
    };
    
    // Сохраняем в кэш
    weatherCache.set(cacheKey, {
      data: weatherResult,
      timestamp: now
    });
    
    return weatherResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения погоды:', error.message);
    
    // Fallback данные
    return {
      temp: 20,
      feels_like: 19,
      humidity: 65,
      wind: '3.0',
      precipitation: 'Без осадков',
      description: 'Ясно ☀️',
      city: cityName,
      max_temp: 22,
      min_temp: 15
    };
  }
}

// Функция для получения прогноза на завтра
async function getWeatherForecast(cityName) {
  const cacheKey = `${cityName.toLowerCase()}_forecast`;
  const now = Date.now();
  
  if (weatherCache.has(cacheKey)) {
    const cached = weatherCache.get(cacheKey);
    if (now - cached.timestamp < 1800000) {
      console.log(`📅 Использую кэшированный прогноз для ${cityName}`);
      return cached.data;
    }
  }
  
  console.log(`📅 Запрашиваю прогноз погоды для: "${cityName}"`);
  
  try {
    const { latitude, longitude, name } = await getCityCoordinates(cityName);
    
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=2`;
    
    const response = await fetch(forecastUrl);
    const forecastData = await response.json();
    
    if (!forecastData.daily || !forecastData.daily.time) {
      throw new Error('Нет данных о прогнозе');
    }
    
    const daily = forecastData.daily;
    const tomorrowIndex = 1; // завтра
    
    const forecastResult = {
      city: name,
      date_tomorrow: new Date(Date.now() + 86400000).toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }),
      temp_max: Math.round(daily.temperature_2m_max[tomorrowIndex]),
      temp_min: Math.round(daily.temperature_2m_min[tomorrowIndex]),
      precipitation: daily.precipitation_sum[tomorrowIndex] > 0 
        ? `${daily.precipitation_sum[tomorrowIndex].toFixed(1)} мм` 
        : 'Без осадков',
      description: getWeatherDescription(daily.weather_code[tomorrowIndex])
    };
    
    weatherCache.set(cacheKey, {
      data: forecastResult,
      timestamp: now
    });
    
    return forecastResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения прогноза:', error.message);
    
    // Fallback данные
    const tomorrow = new Date(Date.now() + 86400000);
    return {
      city: cityName,
      date_tomorrow: tomorrow.toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }),
      temp_max: 22,
      temp_min: 15,
      precipitation: 'Без осадков',
      description: 'Преимущественно солнечно 🌤️'
    };
  }
}

// Функция для описания погоды
function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно ☀️',
    1: 'В основном ясно 🌤️',
    2: 'Переменная облачность ⛅',
    3: 'Пасмурно ☁️',
    45: 'Туман 🌫️',
    48: 'Изморозь 🌫️',
    51: 'Легкая морось 🌦️',
    53: 'Морось 🌧️',
    55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌦️',
    63: 'Дождь 🌧️',
    65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️',
    73: 'Снег ❄️',
    75: 'Сильный снег ❄️',
    77: 'Снежная крупа ❄️',
    80: 'Небольшой ливень 🌧️',
    81: 'Умеренный ливень 🌧️',
    82: 'Сильный ливень 🌧️',
    85: 'Небольшой снегопад ❄️',
    86: 'Сильный снегопад ❄️',
    95: 'Гроза ⛈️',
    96: 'Гроза с градом ⛈️',
    99: 'Сильная гроза ⛈️'
  };
  
  return weatherMap[code] || 'Погодные данные';
}

// ===================== ФУНКЦИИ СТАТИСТИКИ =====================
async function getGameStatsMessage(userId) {
  try {
    const stats = await getGameStats(userId, 'tetris');
    
    if (!stats || !stats.games_played || stats.games_played === 0) {
      return "📊 *Статистика игры*\n\n🎮 Вы ещё не играли в тетрис!\n\nНажмите 🎮 ИГРАТЬ В ТЕТРИС чтобы начать!";
    }
    
    const lastPlayed = stats.last_played 
      ? new Date(stats.last_played).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'неизвестно';
    
    return `📊 *Ваша статистика в тетрисе*\n\n` +
           `🎮 Игр сыграно: *${stats.games_played || 0}*\n` +
           `🏆 Лучший счёт: *${stats.best_score || 0}*\n` +
           `📈 Лучший уровень: *${stats.best_level || 1}*\n` +
           `📊 Лучшие линии: *${stats.best_lines || 0}*\n` +
           `📉 Средний счёт: *${Math.round(stats.avg_score || 0)}*\n` +
           `⏰ Последняя игра: ${lastPlayed}\n\n` +
           `💪 Продолжайте играть!`;
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    return "❌ Не удалось получить статистику. Попробуйте позже.";
  }
}

async function getTopPlayersMessage(limit = 10) {
  try {
    const topPlayers = await getTopPlayers('tetris', limit);
    
    if (!topPlayers || topPlayers.length === 0) {
      return "🏆 *Топ игроков*\n\n📊 Пока никто не играл в тетрис!\n\nБудьте первым!";
    }
    
    let message = `🏆 *Топ ${topPlayers.length} игроков в тетрисе*\n\n`;
    
    topPlayers.forEach((player, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      message += `${medal} *${player.score} очков*\n`;
      message += `   👤 ID: ${player.user_id} | 📈 Уровень: ${player.level} | 📊 Линии: ${player.lines}\n\n`;
    });
    
    message += `🎯 Соревнуйтесь с другими игроками!`;
    return message;
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error);
    return "❌ Не удалось загрузить топ игроков. Попробуйте позже.";
  }
}

// ===================== ОДЕЖДА И СОВЕТЫ =====================
function getWardrobeAdvice(weatherData) {
  const { temp, description } = weatherData;
  let advice = [];

  if (temp >= 25) {
    advice.push('• 👕 Легкая одежда: майка, футболка, шорты');
    advice.push('• 👟 Сандалии или кеды');
    advice.push('• 🧢 Головной убор от солнца');
  } else if (temp >= 18) {
    advice.push('• 👕 Футболка с рубашкой или легкой курткой');
    advice.push('• 👖 Джинсы или брюки');
    advice.push('• 👟 Кроссовки или кеды');
  } else if (temp >= 10) {
    advice.push('• 👕 Свитер или толстовка');
    advice.push('• 🧥 Ветровка или легкая куртка');
    advice.push('• 👖 Джинсы');
    advice.push('• 👟 Кроссовки');
  } else if (temp >= 0) {
    advice.push('• 👕 Теплый свитер');
    advice.push('• 🧥 Зимняя куртка');
    advice.push('• 👖 Теплые брюки');
    advice.push('• 👟 Утепленные ботинки');
    advice.push('• 🧣 Шарф и шапка');
  } else {
    advice.push('• 👕 Термобелье и теплый свитер');
    advice.push('• 🧥 Пуховик или теплая зимняя куртка');
    advice.push('• 👖 Утепленные штаны');
    advice.push('• 👟 Зимние ботинки');
    advice.push('• 🧣 Шарф, шапка, перчатки');
  }

  if (description.includes('🌧️') || description.includes('🌦️')) {
    advice.push('• ☔ Дождевик или зонт');
    advice.push('• 👢 Водонепроницаемая обувь');
  }
  
  if (description.includes('❄️')) {
    advice.push('• ❄️ Непромокаемая обувь');
    advice.push('• 🧤 Теплые перчатки');
  }
  
  if (description.includes('☀️')) {
    advice.push('• 🕶️ Солнцезащитные очки');
  }

  return advice.join('\n');
}

// ===================== ФРАЗЫ =====================
const dailyPhrases = [
  {
    english: "Where is the nearest bus stop?",
    russian: "Где ближайшая автобусная остановка?",
    explanation: "Спрашиваем про общественный транспорт",
    category: "Путешествия",
    level: "Начальный"
  },
  {
    english: "How much is a ticket to the airport?",
    russian: "Сколько стоит билет до аэропорта?",
    explanation: "Узнаем цену проезда",
    category: "Путешествия",
    level: "Начальный"
  },
  {
    english: "Could I see the menu, please?",
    russian: "Можно меню, пожалуйста?",
    explanation: "Просим меню в ресторане",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "How much does this cost?",
    russian: "Сколько это стоит?",
    explanation: "Самый частый вопрос в магазине",
    category: "Шоппинг",
    level: "Начальный"
  },
  {
    english: "I need to see a doctor",
    russian: "Мне нужно к врачу",
    explanation: "Экстренная ситуация",
    category: "Здоровье",
    level: "Начальный"
  }
];

// ===================== КЛАВИАТУРЫ =====================
const startKeyboard = new Keyboard()
    .text('🚀 НАЧАТЬ РАБОТУ')
    .resized();

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС')
    .text('📅 ПОГОДА ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?')
    .text('💬 ФРАЗА ДНЯ')
    .text('🎲 СЛУЧАЙНАЯ ФРАЗА').row()
    .text('📊 МОЯ СТАТИСТИКА')
    .text('🏆 ТОП ИГРОКОВ').row()
    .text('🏙️ СМЕНИТЬ ГОРОД')
    .text('ℹ️ ПОМОЩЬ')
    .text('📋 ПОКАЗАТЬ КОМАНДЫ').row()
    .resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА')
    .row()
    .text('📍 САНКТ-ПЕТЕРБУРГ')
    .row()
    .text('📍 СЕВАСТОПОЛЬ')
    .row()
    .text('✏️ ДРУГОЙ ГОРОД')
    .row()
    .text('🔙 НАЗАД')
    .resized();

// ===================== ОСНОВНЫЕ КОМАНДЫ =====================
bot.command('start', async (ctx) => {
  console.log(`🚀 /start от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply(
      `👋 *Добро пожаловать!*\n\n` +
      `🎮 *Тетрис со статистикой*\n\n` +
      `👇 *Нажмите кнопку чтобы начать*`,
      { 
        parse_mode: 'Markdown', 
        reply_markup: startKeyboard 
      }
    );
  } catch (error) {
    console.error('❌ Ошибка в /start:', error);
  }
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', async (ctx) => {
  console.log(`📍 НАЧАТЬ РАБОТУ от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply(
      `📍 *Выберите ваш город*`,
      { parse_mode: 'Markdown', reply_markup: cityKeyboard }
    );
  } catch (error) {
    console.error('❌ Ошибка в НАЧАТЬ РАБОТУ:', 
    }
}) ;

       // ===================== ВЫБОР ГОРОДА =====================
bot.hears(/^📍 /, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '').trim();
  console.log(`📍 Выбран город: "${city}" для ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    console.log(`📍 Пытаюсь сохранить город "${city}" для ${userId} в БД...`);
    const saved = await saveUserCity(userId, city);
    console.log(`📍 Результат сохранения города: ${saved} (тип: ${typeof saved})`);
    
    if (saved === true) {
      userStorage.set(userId, { city, lastActivity: Date.now(), awaitingCity: false });
      
      await ctx.reply(
        `✅ *Город "${city}" сохранён!*\n\n` +
        `Теперь доступны все функции бота.`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
      );
    } else {
      console.error(`❌ saveUserCity вернул: ${saved}`);
      await ctx.reply(
        '❌ Не удалось сохранить город в базу данных. Возможные причины:\n\n' +
        '1. Проблема с подключением к базе данных\n' +
        '2. База данных недоступна\n' +
        '3. Ошибка в конфигурации\n\n' +
        'Попробуйте еще раз или обратитесь к администратору.'
      );
    }
  } catch (error) {
    console.error('❌ Исключение при выборе города:', error);
    await ctx.reply(
      `❌ Произошла ошибка при сохранении города: ${error.message}\n\n` +
      'Попробуйте еще раз.'
    );
  }
});           
// ===================== СТАТИСТИКА =====================
bot.hears('📊 МОЯ СТАТИСТИКА', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`📊 МОЯ СТАТИСТИКА от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('⏳ Загружаю вашу статистику...');
    
    const statsMessage = await getGameStatsMessage(userId);
    await ctx.reply(statsMessage, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
  } catch (error) {
    console.error('❌ Ошибка в МОЯ СТАТИСТИКА:', error);
    await ctx.reply('❌ Не удалось загрузить вашу статистику.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.hears('🏆 ТОП ИГРОКОВ', async (ctx) => {
  console.log(`🏆 ТОП ИГРОКОВ от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('🏆 Загружаю топ игроков...');
    
    const topMessage = await getTopPlayersMessage(10);
    await ctx.reply(topMessage, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
  } catch (error) {
    console.error('❌ Ошибка в ТОП ИГРОКОВ:', error);
    await ctx.reply('❌ Не удалось загрузить топ игроков.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

// ===================== ПОГОДА =====================
bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`🌤️ ПОГОДА СЕЙЧАС от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const city = await getUserCity(userId);
    
    if (!city) {
      await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
      return;
    }
    
    await ctx.reply(`⏳ Запрашиваю погоду для ${city}...`);
    
    const weather = await getWeatherData(city);
    
    let message = `🌤️ *Погода в ${weather.city}*\n\n`;
    message += `🌡️ Температура: *${weather.temp}°C*\n`;
    message += `🤔 Ощущается как: *${weather.feels_like}°C*\n`;
    message += `💨 Ветер: ${weather.wind} м/с\n`;
    message += `💧 Влажность: ${weather.humidity}%\n`;
    message += `📝 ${weather.description}\n`;
    message += `🌧️ Осадки: ${weather.precipitation}`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА СЕЙЧАС:', error);
    await ctx.reply('❌ Не удалось получить данные о погоде.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`📅 ПОГОДА ЗАВТРА от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const city = await getUserCity(userId);
    
    if (!city) {
      await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
      return;
    }
    
    await ctx.reply(`⏳ Запрашиваю прогноз погоды для ${city}...`);
    
    const forecast = await getWeatherForecast(city);
    
    let message = `📅 *Прогноз погоды в ${forecast.city} на ${forecast.date_tomorrow}*\n\n`;
    message += `🌡️ Максимальная: *${forecast.temp_max}°C*\n`;
    message += `🌡️ Минимальная: *${forecast.temp_min}°C*\n`;
    message += `📝 ${forecast.description}\n`;
    message += `🌧️ Осадки: ${forecast.precipitation}`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА ЗАВТРА:', error);
    await ctx.reply('❌ Не удалось получить прогноз погоды.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

// ===================== ДРУГИЕ ФУНКЦИИ =====================
bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`👕 ЧТО НАДЕТЬ? от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const city = await getUserCity(userId);
    
    if (!city) {
      await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
      return;
    }
    
    await ctx.reply(`👗 Анализирую погоду для ${city}...`);
    
    const weather = await getWeatherData(city);
    const advice = getWardrobeAdvice(weather);
    
    await ctx.reply(
      `👕 *Что надеть в ${weather.city} сегодня?*\n\n${advice}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в ЧТО НАДЕТЬ:', error);
    await ctx.reply('❌ Не удалось получить рекомендацию.', { reply_markup: mainMenuKeyboard });
  }
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  console.log(`💬 ФРАЗА ДНЯ от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const dayOfMonth = new Date().getDate();
    const phraseIndex = (dayOfMonth - 1) % dailyPhrases.length;
    const phrase = dailyPhrases[phraseIndex];
    
    await ctx.reply(
      `💬 *Фраза дня*\n\n` +
      `🇬🇧 *${phrase.english}*\n\n` +
      `🇷🇺 *${phrase.russian}*\n\n` +
      `📚 *Объяснение:* ${phrase.explanation}\n\n` +
      `📂 *Категория:* ${phrase.category}\n` +
      `📊 *Уровень:* ${phrase.level}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в ФРАЗА ДНЯ:', error);
    await ctx.reply('❌ Не удалось получить фразу дня.', { reply_markup: mainMenuKeyboard });
  }
});

bot.hears('🎲 СЛУЧАЙНАЯ ФРАЗА', async (ctx) => {
  console.log(`🎲 СЛУЧАЙНАЯ ФРАЗА от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const randomIndex = Math.floor(Math.random() * dailyPhrases.length);
    const phrase = dailyPhrases[randomIndex];
    
    const message = 
      `🎲 *Случайная английская фраза*\n\n` +
      `🇬🇧 *${phrase.english}*\n\n` +
      `🇷🇺 *${phrase.russian}*\n\n` +
      `📚 *Объяснение:* ${phrase.explanation}\n\n` +
      `📂 *Категория:* ${phrase.category}\n` +
      `📊 *Уровень:* ${phrase.level}`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в СЛУЧАЙНАЯ ФРАЗА:', error);
    await ctx.reply('❌ Не удалось получить случайную фразу.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
  console.log(`🏙️ СМЕНИТЬ ГОРОД от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('Выберите новый город:', { reply_markup: cityKeyboard });
  } catch (error) {
    console.error('❌ Ошибка в СМЕНИТЬ ГОРОД:', error);
  }
});

bot.hears('✏️ ДРУГОЙ ГОРОД', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`✏️ ДРУГОЙ ГОРОД от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('Напишите название вашего города:');
    userStorage.set(userId, { awaitingCity: true, lastActivity: Date.now() });
  } catch (error) {
    console.error('❌ Ошибка в ДРУГОЙ ГОРОД:', error);
  }
});

bot.hears('🔙 НАЗАД', async (ctx) => {
  console.log(`🔙 НАЗАД от ${ctx.from.id}`);
  try {
    await ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard });
  } catch (error) {
    console.error('❌ Ошибка в НАЗАД:', error);
  }
});

bot.hears('📋 ПОКАЗАТЬ КОМАНДЫ', async (ctx) => {
  console.log(`📋 ПОКАЗАТЬ КОМАНДЫ от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply(
      `📋 *Доступные команды:*\n\n` +
      `/start - Начать работу с ботом\n` +
      `/weather - Текущая погода\n` +
      `/forecast - Прогноз погоды на завтра\n` +
      `/wardrobe - Что надеть\n` +
      `/phrase - Фраза дня\n` +
      `/random - Случайная фраза\n` +
      `/stats - Ваша статистика\n` +
      `/top - Топ игроков\n` +
      `/city - Сменить город\n` +
      `/help - Помощь`,
      { 
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
      }
    );
  } catch (error) {
    console.error('❌ Ошибка в ПОКАЗАТЬ КОМАНДЫ:', error);
  }
});

bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
  console.log(`ℹ️ ПОМОЩЬ от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply(
      `*Помощь по боту*\n\n` +
      `*Кнопки в меню:*\n` +
      `• 🌤️ ПОГОДА СЕЙЧАС - текущая погода\n` +
      `• 📅 ПОГОДА ЗАВТРА - прогноз на завтра\n` +
      `• 👕 ЧТО НАДЕТЬ? - рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная английская фраза\n` +
      `• 📊 МОЯ СТАТИСТИКА - ваша статистика в тетрис\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки в тетрис\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город для погоды\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n` +
      `• 📋 ПОКАЗАТЬ КОМАНДЫ - убрать кнопки и использовать команды`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  } catch (error) {
    console.error('❌ Ошибка в ПОМОЩЬ:', error);
  }
});

// ===================== РУЧНОЙ ВВОД ГОРОДА =====================
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const userData = userStorage.get(userId) || {};
  
  console.log(`📝 Текст от ${userId}: "${text}"`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  // Игнорируем команды и кнопки
  if (text.startsWith('/') || 
      text === '🚀 НАЧАТЬ РАБОТУ' || text === '🌤️ ПОГОДА СЕЙЧАС' || 
      text === '📅 ПОГОДА ЗАВТРА' || text === '👕 ЧТО НАДЕТЬ?' || 
      text === '💬 ФРАЗА ДНЯ' || text === '🎲 СЛУЧАЙНАЯ ФРАЗА' ||
      text === '📊 МОЯ СТАТИСТИКА' || text === '🏆 ТОП ИГРОКОВ' ||
      text === '🏙️ СМЕНИТЬ ГОРОД' || text === 'ℹ️ ПОМОЩЬ' || 
      text === '📋 ПОКАЗАТЬ КОМАНДЫ' || text === '🔙 НАЗАД' ||
      text === '✏️ ДРУГОЙ ГОРОД' || text.startsWith('📍 ')) {
    return;
  }
  
  // Если пользователь вводит город вручную
  if (userData.awaitingCity) {
    try {
      const city = text.trim();
      if (city.length === 0 || city.length > 100) {
        await ctx.reply('❌ Неверное название города. Попробуйте еще раз.');
        return;
      }
      
      console.log(`🏙️ Сохраняю город "${city}" для ${userId}`);
      
      const saved = await saveUserCity(userId, city);
      
      if (saved) {
        userStorage.set(userId, { 
          city, 
          lastActivity: Date.now(), 
          awaitingCity: false 
        });
        
        await ctx.reply(
          `✅ *Город "${city}" сохранён!*\n\n` +
          `Теперь вы можете использовать все функции бота.`,
          { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
      } else {
        await ctx.reply('❌ Не удалось сохранить город. Попробуйте еще раз.');
      }
    } catch (error) {
      console.error('❌ Ошибка при сохранении города:', error);
      await ctx.reply('❌ Ошибка при сохранении города. Попробуйте еще раз.');
    }
  } else {
    try {
      const city = await getUserCity(userId);
      if (!city) {
        await ctx.reply('Пожалуйста, сначала выберите город:', { reply_markup: cityKeyboard });
      } else {
        await ctx.reply(`Ваш город: ${city}. Используйте кнопки меню для получения информации.`, 
          { reply_markup: mainMenuKeyboard });
      }
    } catch (error) {
      console.error('❌ Ошибка при проверке города:', error);
      await ctx.reply('Произошла ошибка. Попробуйте еще раз.', { reply_markup: mainMenuKeyboard });
    }
  }
});

// ===================== ОБРАБОТЧИК ИГРЫ =====================
bot.filter(ctx => ctx.message?.web_app_data?.data, async (ctx) => {
  const userId = ctx.from.id;
  console.log(`📱 Получены данные от Mini App от пользователя ${userId}`);
  
  try {
    const webAppData = ctx.message.web_app_data;
    const data = JSON.parse(webAppData.data);
    console.log('🎮 Данные игры:', data);
    
    if (data.action === 'tetris_score') {
      console.log(`🎮 Счёт тетриса от ${userId}:`, data);
      
      try {
        await saveGameScore(userId, 'tetris', data.score, data.level, data.lines);
        console.log(`✅ Рекорд пользователя ${userId} сохранён`);
      } catch (dbError) {
        console.error('❌ Ошибка сохранения в БД:', dbError);
      }
      
      let message = `🎮 *Результат игры*\n\n`;
      message += `🎯 Очки: *${data.score}*\n`;
      message += `📊 Уровень: *${data.level}*\n`;
      message += `📈 Линии: *${data.lines}*\n\n`;
      
      if (data.gameOver) {
        message += `🏁 Игра окончена!`;
      } else {
        message += `💾 Прогресс сохранён!`;
      }
      
      await ctx.reply(message, { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка обработки данных игры:', error);
    await ctx.reply('Произошла ошибка при обработке данных игры.', {
      reply_markup: mainMenuKeyboard
    });
  }
});

// ===================== ТЕКСТОВЫЕ КОМАНДЫ =====================
bot.command('weather', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`🌤️ /weather от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const city = await getUserCity(userId);
    
    if (!city) {
      await ctx.reply('Сначала выберите город! Используйте /start');
      return;
    }
    
    await ctx.reply(`⏳ Запрашиваю погоду для ${city}...`);
    
    const weather = await getWeatherData(city);
    
    let message = `🌤️ *Погода в ${weather.city}*\n\n`;
    message += `🌡️ Температура: *${weather.temp}°C*\n`;
    message += `🤔 Ощущается как: *${weather.feels_like}°C*\n`;
    message += `💨 Ветер: ${weather.wind} м/с\n`;
    message += `💧 Влажность: ${weather.humidity}%\n`;
    message += `📝 ${weather.description}\n`;
    message += `🌧️ Осадки: ${weather.precipitation}`;
    
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
    
  } catch (error) {
    console.error('❌ Ошибка в /weather:', error);
    await ctx.reply('❌ Не удалось получить данные о погоде.', { reply_markup: mainMenuKeyboard });
  }
});

bot.command('forecast', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`📅 /forecast от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const city = await getUserCity(userId);
    
    if (!city) {
      await ctx.reply('Сначала выберите город! Используйте /start');
      return;
    }
    
    await ctx.reply(`⏳ Запрашиваю прогноз погоды для ${city}...`);
    
    const forecast = await getWeatherForecast(city);
    
    let message = `📅 *Прогноз погоды в ${forecast.city} на ${forecast.date_tomorrow}*\n\n`;
    message += `🌡️ Максимальная: *${forecast.temp_max}°C*\n`;
    message += `🌡️ Минимальная: *${forecast.temp_min}°C*\n`;
    message += `📝 ${forecast.description}\n`;
    message += `🌧️ Осадки: ${forecast.precipitation}`;
    
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
    
  } catch (error) {
    console.error('❌ Ошибка в /forecast:', error);
    await ctx.reply('❌ Не удалось получить прогноз погоды.', { reply_markup: mainMenuKeyboard });
  }
});

bot.command('wardrobe', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`👕 /wardrobe от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const city = await getUserCity(userId);
    
    if (!city) {
      await ctx.reply('Сначала выберите город! Используйте /start');
      return;
    }
    
    await ctx.reply(`👗 Анализирую погоду для ${city}...`);
    
    const weather = await getWeatherData(city);
    const advice = getWardrobeAdvice(weather);
    
    await ctx.reply(
      `👕 *Что надеть в ${weather.city}?*\n\n${advice}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в /wardrobe:', error);
    await ctx.reply('❌ Не удалось получить рекомендацию.', { reply_markup: mainMenuKeyboard });
  }
});

bot.command('phrase', async (ctx) => {
  console.log(`💬 /phrase от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const dayOfMonth = new Date().getDate();
    const phraseIndex = (dayOfMonth - 1) % dailyPhrases.length;
    const phrase = dailyPhrases[phraseIndex];
    
    await ctx.reply(
      `💬 *Фраза дня*\n\n` +
      `🇬🇧 *${phrase.english}*\n\n` +
      `🇷🇺 *${phrase.russian}*\n\n` +
      `📚 ${phrase.explanation}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в /phrase:', error);
    await ctx.reply('❌ Не удалось получить фразу дня.', { reply_markup: mainMenuKeyboard });
  }
});

bot.command('random', async (ctx) => {
  console.log(`🎲 /random от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const randomIndex = Math.floor(Math.random() * dailyPhrases.length);
    const phrase = dailyPhrases[randomIndex];
    
    const message = 
      `🎲 *Случайная английская фраза*\n\n` +
      `🇬🇧 *${phrase.english}*\n\n` +
      `🇷🇺 *${phrase.russian}*\n\n` +
      `📚 *Объяснение:* ${phrase.explanation}\n\n` +
      `📂 *Категория:* ${phrase.category}\n` +
      `📊 *Уровень:* ${phrase.level}`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в /random:', error);
    await ctx.reply('❌ Не удалось получить случайную фразу.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.command('stats', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`📊 /stats от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('⏳ Загружаю вашу статистику...');
    
    const statsMessage = await getGameStatsMessage(userId);
    await ctx.reply(statsMessage, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
  } catch (error) {
    console.error('❌ Ошибка в /stats:', error);
    await ctx.reply('❌ Не удалось загрузить статистику.', { reply_markup: mainMenuKeyboard });
  }
});

bot.command('top', async (ctx) => {
  console.log(`🏆 /top от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('🏆 Загружаю топ игроков...');
    
    const topMessage = await getTopPlayersMessage(10);
    await ctx.reply(topMessage, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
  } catch (error) {
    console.error('❌ Ошибка в /top:', error);
    await ctx.reply('❌ Не удалось загрузить топ игроков.', { reply_markup: mainMenuKeyboard });
  }
});

bot.command('city', async (ctx) => {
  console.log(`🏙️ /city от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('Выберите новый город:', { reply_markup: cityKeyboard });
  } catch (error) {
    console.error('❌ Ошибка в /city:', error);
  }
});

bot.command('help', async (ctx) => {
  console.log(`ℹ️ /help от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply(
      `*Помощь по боту*\n\n` +
      `*Доступные команды:*\n` +
      `/start - начать работу с ботом\n` +
      `/weather - текущая погода\n` +
      `/forecast - прогноз на завтра\n` +
      `/wardrobe - что надеть\n` +
      `/phrase - фраза дня\n` +
      `/random - случайная фраза\n` +
      `/stats - ваша статистика в игре\n` +
      `/top - топ игроков\n` +
      `/city - сменить город\n` +
      `/help - помощь\n\n` +
      `*Кнопки:*\n` +
      `Нажмите /start чтобы вернуть меню кнопок`,
      { 
        parse_mode: 'Markdown', 
        reply_markup: { remove_keyboard: true }
      }
    );
  } catch (error) {
    console.error('❌ Ошибка в /help:', error);
  }
});

// ===================== ОБРАБОТЧИК ОШИБОК =====================
bot.catch((err) => {
  console.error('🔥 Критическая ошибка бота:', err);
});

// ===================== ЭКСПОРТ ДЛЯ VERCEL =====================
export default async function handler(req, res) {
  console.log(`🌐 ${req.method} запрос к /api/bot в ${new Date().toISOString()}`);
  
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ 
        message: 'Weather & English Phrases Bot with Game Statistics is running',
        status: 'active',
        timestamp: new Date().toISOString(),
        bot: bot.botInfo?.username || 'не инициализирован',
        features: [
          'Погода с прогнозом',
          'Рекомендации по одежде',
          'Английские фразы',
          'Статистика игры тетрис',
          'Топ игроков'
        ]
      });
    }
    
    if (req.method === 'POST') {
      await initializeBot();
      
      console.log('📦 Получен update от Telegram');
      
      try {
        const update = req.body;
        await bot.handleUpdate(update);
        console.log('✅ Update успешно обработан');
        
        return res.status(200).json({ ok: true });
      } catch (error) {
        console.error('❌ Ошибка обработки update:', error);
        return res.status(200).json({ 
          ok: false, 
          error: 'Update processing failed',
          details: error.message 
        });
      }
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('🔥 Критическая ошибка в handler:', error);
    return res.status(200).json({ 
      ok: false, 
      error: 'Internal server error',
      message: error.message
    });
  }
}

// Экспортируем бота для тестов
export { bot };
console.log('⚡ Бот загружен!');
