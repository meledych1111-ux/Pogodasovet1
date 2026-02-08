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
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const geoData = await response.json();
    
    if (!geoData.results || geoData.results.length === 0) {
      throw new Error(`Город "${cityName}" не найден`);
    }
    
    const result = geoData.results[0];
    
    return {
      latitude: result.latitude,
      longitude: result.longitude,
      name: result.name
    };
  } catch (error) {
    console.error('❌ Ошибка получения координат:', error.message);
    throw error;
  }
}

// Функция для получения текущей погоды
async function getWeatherData(cityName, forceRefresh = false) {
  const cacheKey = `current_${cityName.toLowerCase()}`;
  const now = Date.now();
  
  // Проверяем кэш (актуален 10 минут)
  if (!forceRefresh && weatherCache.has(cacheKey)) {
    const cached = weatherCache.get(cacheKey);
    if (now - cached.timestamp < 600000) {
      console.log(`🌤️ Использую кэшированную погоду для ${cityName}`);
      return cached.data;
    }
  }
  
  console.log(`🌤️ Запрашиваю погоду для: "${cityName}"`);
  
  try {
    const { latitude, longitude, name } = await getCityCoordinates(cityName);
    
    // Запрос для текущей погоды с почасовым прогнозом
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation,cloud_cover&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&wind_speed_unit=ms&timezone=auto&forecast_days=2`;
    
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    if (!weatherData.current) {
      throw new Error('Нет данных о погоде');
    }
    
    const current = weatherData.current;
    const todayPrecipitation = weatherData.daily?.precipitation_sum?.[0] || 0;
    
    // Получаем почасовой прогноз на сегодня
    const hourlyToday = getHourlyForecast(weatherData.hourly, 0, 24);
    
    const weatherResult = {
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m.toFixed(1),
      precipitation: todayPrecipitation > 0 ? `${todayPrecipitation.toFixed(1)} мм` : 'Без осадков',
      precipitation_value: todayPrecipitation,
      cloud_cover: current.cloud_cover,
      description: getDetailedWeatherDescription(current.weather_code, todayPrecipitation, current.cloud_cover),
      city: name,
      hourly: hourlyToday,
      max_temp: Math.round(weatherData.daily?.temperature_2m_max?.[0] || current.temperature_2m),
      min_temp: Math.round(weatherData.daily?.temperature_2m_min?.[0] || current.temperature_2m)
    };
    
    // Сохраняем в кэш
    weatherCache.set(cacheKey, {
      data: weatherResult,
      timestamp: now
    });
    
    return weatherResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения погоды:', error.message);
    
    // Если есть кэшированные данные, возвращаем их
    if (weatherCache.has(cacheKey)) {
      console.log('🔄 Использую кэшированные данные');
      return weatherCache.get(cacheKey).data;
    }
    
    // Fallback данные
    return {
      temp: 20,
      feels_like: 19,
      humidity: 65,
      wind: '3.0',
      precipitation: 'Без осадков',
      precipitation_value: 0,
      cloud_cover: 30,
      description: 'Ясно ☀️',
      city: cityName,
      hourly: [],
      max_temp: 22,
      min_temp: 15
    };
  }
}

// Функция для получения прогноза на завтра
async function getWeatherForecastDetailed(cityName) {
  const cacheKey = `forecast_${cityName.toLowerCase()}`;
  const now = Date.now();
  
  // Проверяем кэш (актуален 30 минут)
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
    
    // Запрос для прогноза на 2 дня
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=2`;
    
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();
    
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
      general: {
        temp_max: Math.round(daily.temperature_2m_max[tomorrowIndex]),
        temp_min: Math.round(daily.temperature_2m_min[tomorrowIndex]),
        precipitation: daily.precipitation_sum[tomorrowIndex] > 0 
          ? `${daily.precipitation_sum[tomorrowIndex].toFixed(1)} мм` 
          : 'Без осадков',
        weather_code: daily.weather_code[tomorrowIndex],
        description: getDetailedWeatherDescription(daily.weather_code[tomorrowIndex], daily.precipitation_sum[tomorrowIndex], 50)
      }
    };
    
    // Сохраняем в кэш
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
      general: {
        temp_max: 22,
        temp_min: 15,
        precipitation: 'Без осадков',
        description: 'Преимущественно солнечно 🌤️'
      }
    };
  }
}

// Вспомогательная функция для получения почасового прогноза
function getHourlyForecast(hourlyData, startHour, endHour) {
  if (!hourlyData || !hourlyData.time) return [];
  
  const result = [];
  for (let i = startHour; i < endHour && i < hourlyData.time.length; i++) {
    const time = new Date(hourlyData.time[i]);
    result.push({
      hour: time.getHours(),
      time: time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      temp: Math.round(hourlyData.temperature_2m[i]),
      feels_like: Math.round(hourlyData.apparent_temperature[i]),
      weather_code: hourlyData.weather_code[i],
      precipitation_probability: hourlyData.precipitation_probability[i] || 0,
      description: getWeatherEmoji(hourlyData.weather_code[i])
    });
  }
  return result;
}

// Упрощенная функция для эмодзи погоды
function getWeatherEmoji(code) {
  const emojiMap = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
    45: '🌫️', 48: '🌫️',
    51: '🌦️', 53: '🌦️', 55: '🌦️',
    61: '🌧️', 63: '🌧️', 65: '🌧️',
    71: '❄️', 73: '❄️', 75: '❄️',
    80: '🌧️', 81: '🌧️', 82: '🌧️',
    85: '❄️', 86: '❄️',
    95: '⛈️', 96: '⛈️', 99: '⛈️'
  };
  return emojiMap[code] || '🌀';
}

// ===================== ФУНКЦИИ СТАТИСТИКИ =====================
async function getGameStatsMessage(userId) {
  try {
    const stats = await getGameStats(userId, 'tetris');
    
    // Улучшенная проверка
    if (!stats || !stats.games_played || stats.games_played === 0) {
      return "📊 *Статистика игры*\n\n🎮 Вы ещё не играли в тетрис!\n\nНажмите 🎮 ИГРАТЬ В ТЕТРИС чтобы начать!";
    }
    
    // Форматируем дату последней игры
    const lastPlayed = stats.last_played 
      ? new Date(stats.last_played).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'неизвестно';
    
    // Используем значения по умолчанию если null
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
      message += `   👤 ID: ${player.user_id} | 📈 Уровень: ${player.level} | 📊 Линии: ${player.lines} | 🕹️ Игр: ${player.games_played}\n\n`;
    });
    
    message += `🎯 Соревнуйтесь с другими игроками!`;
    return message;
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error);
    return "❌ Не удалось загрузить топ игроков. Попробуйте позже.";
  }
}

// ===================== ФУНКЦИИ ПОГОДЫ =====================
function getDetailedWeatherDescription(code, precipitationMm = 0, cloudCover = 50) {
  if (code === undefined || code === null) {
    return 'Погодные данные';
  }
  
  const weatherMap = {
    0: `Ясно ${cloudCover < 20 ? '☀️' : '🌤️'}`,
    1: `В основном ясно ${cloudCover < 40 ? '🌤️' : '⛅'}`,
    2: `Переменная облачность ⛅`,
    3: `Пасмурно ☁️`,
    45: `Туман ${precipitationMm > 0 ? '🌫️💧' : '🌫️'}`,
    48: `Изморозь 🌫️❄️`,
    51: `Легкая морось 🌦️`,
    53: `Морось 🌧️`,
    55: `Сильная морось 🌧️`,
    61: `Небольшой дождь 🌦️`,
    63: `Дождь 🌧️`,
    65: `Сильный дождь 🌧️💦`,
    71: `Небольшой снег ❄️`,
    73: `Снег ❄️`,
    75: `Сильный снег ❄️❄️`,
    77: `Снежная крупа ❄️🌀`,
    80: `Небольшой ливень 🌧️`,
    81: `Умеренный ливень 🌧️💦`,
    82: `Сильный ливень 🌧️💦🌀`,
    85: `Небольшой снегопад ❄️`,
    86: `Сильный снегопад ❄️❄️`,
    95: `Гроза ${precipitationMm > 5 ? '⛈️💦' : '⛈️'}`,
    96: `Гроза с небольшим градом ⛈️🌀`,
    99: `Гроза с сильным градом ⛈️🌀❄️`
  };
  
  let description = weatherMap[code] || `Код погоды: ${code}`;
  
  // Добавляем детали по осадкам
  if (precipitationMm > 0) {
    if (precipitationMm < 0.5) {
      description += ` (легкие осадки)`;
    } else if (precipitationMm < 2) {
      description += ` (слабые осадки)`;
    } else if (precipitationMm < 10) {
      description += ` (умеренные осадки)`;
    } else {
      description += ` (сильные осадки)`;
    }
  }
  
  // Добавляем информацию об облачности
  if ([0, 1, 2, 3].includes(code)) {
    if (cloudCover < 20) {
      description = `Ясно ☀️`;
    } else if (cloudCover < 60) {
      description = `Малооблачно 🌤️`;
    } else if (cloudCover < 90) {
      description = `Облачно ⛅`;
    } else {
      description = `Пасмурно ☁️`;
    }
  }
  
  return description;
}

// ===================== ОДЕЖДА И СОВЕТЫ =====================
function getWardrobeAdvice(weatherData) {
  const { temp, description, wind, precipitation, humidity } = weatherData;
  let advice = [];

  // Основные рекомендации по температуре
  if (temp >= 25) {
    advice.push('• 👕 *Базовый слой:* майка, футболка из хлопка или льна');
    advice.push('• 👖 *Верх:* шорты, легкие брюки из льна, юбка');
    advice.push('• 👟 *Обувь:* сандалии, кеды, открытая обувь');
  } else if (temp >= 18) {
    advice.push('• 👕 *Базовый слой:* футболка или тонкая рубашка');
    advice.push('• 🧥 *Верх:* джинсы, брюки, легкая куртка/ветровка на вечер');
    advice.push('• 👟 *Обувь:* кроссовки, кеды, мокасины');
  } else if (temp >= 10) {
    advice.push('• 👕 *Базовый слой:* лонгслив, тонкое термобелье');
    advice.push('• 🧥 *Верх:* свитер, толстовка, ветровка, джинсы');
    advice.push('• 👟 *Обувь:* кроссовки, ботинки');
  } else if (temp >= 0) {
    advice.push('• 👕 *Базовый слой:* теплое термобелье или флис');
    advice.push('• 🧥 *Верх:* утепленный свитер, зимняя куртка, теплые брюки');
    advice.push('• 👟 *Обувь:* утепленные ботинки');
  } else {
    advice.push('• 👕 *Базовый слой:* плотное термобелье, флис');
    advice.push('• 🧥 *Верх:* пуховик, утепленные штаны, зимняя куртка');
    advice.push('• 👟 *Обувь:* зимние ботинки с мехом');
  }

  // Дополнительные рекомендации
  if (description.toLowerCase().includes('дождь') || description.includes('🌧️')) {
    advice.push('• ☔ *Дождевая защита:* дождевик, зонт, непромокаемая обувь');
    advice.push('• 🎒 *Сумка:* водонепроницаемая или с защитой от дождя');
  }
  
  if (description.toLowerCase().includes('снег') || description.includes('❄️')) {
    advice.push('• ❄️ *Зимняя защита:* непромокаемая обувь, варежки, шапка');
    advice.push('• 👢 *Обувь:* с противоскользящей подошвой');
  }
  
  if (parseFloat(wind) > 7) {
    advice.push('• 💨 *Ветрозащита:* ветровка с капюшоном, шарф');
    advice.push('• 👒 *Головной убор:* плотно сидящая шапка/кепка');
  }
  
  if (parseFloat(wind) > 12) {
    advice.push('• ⚠️ *Внимание:* сильный ветер, одевайтесь теплее!');
  }
  
  if (description.includes('☀️') || description.includes('ясно')) {
    advice.push('• 🕶️ *Солнцезащита:* солнцезащитные очки, головной убор');
    if (temp > 20) {
      advice.push('• 🧴 *Крем:* солнцезащитный крем SPF 30+');
    }
  }

  // Общие советы по влажности
  if (humidity > 80) {
    advice.push('• 💧 *Высокая влажность:* выбирайте дышащие ткани');
  }
  
  if (humidity < 30) {
    advice.push('• 🏜️ *Низкая влажность:* увлажняющий крем для кожи');
  }

  // Общие советы по температуре
  if (temp < 15) {
    advice.push('• 🧣 *Аксессуары:* шапка, шарф, перчатки');
  }
  
  if (temp < 5) {
    advice.push('• 🧤 *Тепло:* теплые носки, несколько слоев одежды');
  }

  advice.push('\n🎒 *Рекомендации:*');
  advice.push('• Слои одежды удобнее одного теплого слоя');
  advice.push('• Учитывайте, что вечером может быть прохладнее');
  advice.push('• Берите с собой сумку для снятых слоев одежды');

  return advice.join('\n');
}

// ===================== ФРАЗЫ =====================
const dailyPhrases = [
  // Путешествия и транспорт
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
  // Еда и рестораны
  {
    english: "Could I see the menu, please?",
    russian: "Можно меню, пожалуйста?",
    explanation: "Просим меню в ресторане",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "I'm allergic to nuts",
    russian: "У меня аллергия на орехи",
    explanation: "Важная информация об аллергии",
    category: "Еда",
    level: "Начальный"
  },
  // Покупки и шоппинг
  {
    english: "How much does this cost?",
    russian: "Сколько это стоит?",
    explanation: "Самый частый вопрос в магазине",
    category: "Шоппинг",
    level: "Начальный"
  },
  {
    english: "Do you have this in a larger size?",
    russian: "Есть ли это в большем размере?",
    explanation: "Примерка одежды",
    category: "Шоппинг",
    level: "Начальный"
  },
  // Здоровье и медицина
  {
    english: "I need to see a doctor",
    russian: "Мне нужно к врачу",
    explanation: "Экстренная ситуация",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "Where is the nearest pharmacy?",
    russian: "Где ближайшая аптека?",
    explanation: "Ищем лекарства",
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
      `👋 *Добро пожаловать в бота погоды, английских фраз и игр!*\n\n` +
      `🎮 *Да, здесь есть тетрис со статистикой и топом игроков!*\n\n` +
      `👇 *ШАГ 1: Нажмите кнопку ниже чтобы начать*`,
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
      `📍 *ШАГ 2: Выберите ваш город*\n\n` +
      `Бот будет показывать погоду для выбранного города.`,
      { parse_mode: 'Markdown', reply_markup: cityKeyboard }
    );
  } catch (error) {
    console.error('❌ Ошибка в НАЧАТЬ РАБОТУ:', error);
  }
});

// ===================== ОБРАБОТКА ВЫБОРА ГОРОДА =====================
bot.hears(/^📍 /, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '').trim();
  console.log(`📍 Выбран город: "${city}" для ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const saved = await saveUserCity(userId, city);
    
    if (!saved) {
      await ctx.reply('❌ Не удалось сохранить город в базу данных. Попробуйте еще раз.');
      return;
    }
    
    userStorage.set(userId, { city, lastActivity: Date.now(), awaitingCity: false });
    
    await ctx.reply(
      `✅ *ШАГ 3: Готово! Город "${city}" сохранён!*\n\n` +
      `🎉 *Теперь доступны все функции бота:*\n\n` +
      `• Узнать погоду сейчас и на завтра 🌤️\n` +
      `• Подробный прогноз на завтра по времени суток 📅\n` +
      `• Получить совет по одежде 👕\n` +
      `• Изучать английские фразы 🇬🇧\n` +
      `• Играть в тетрис с полной статистикой 🎮\n` +
      `• Смотреть свою статистику 📊\n` +
      `• Соревноваться в топе игроков 🏆\n\n` +
      `👇 *Используйте кнопки ниже:*`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  } catch (error) {
    console.error('❌ Ошибка при выборе города:', error);
    await ctx.reply('❌ Ошибка при сохранении города. Попробуйте еще раз.');
  }
});

// ===================== СТАТИСТИКА И ТОП ИГРОКОВ =====================
bot.hears('📊 МОЯ СТАТИСТИКА', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`📊 МОЯ СТАТИСТИКА от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('⏳ Загружаю вашу статистику...', { parse_mode: 'Markdown' });
    
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
    await ctx.reply('🏆 Загружаю топ игроков...', { parse_mode: 'Markdown' });
    
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

// ===================== ПОГОДА СЕЙЧАС =====================
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
    
    await ctx.reply(`⏳ Запрашиваю погоду для ${city}...`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(city);
    console.log('🌤️ Получена погода:', weather);
    
    let message = `🌤️ *Погода в ${weather.city}*\n\n`;
    message += `🌡️ Температура: *${weather.temp}°C*\n`;
    message += `🤔 Ощущается как: *${weather.feels_like}°C*\n`;
    message += `💨 Ветер: ${weather.wind} м/с\n`;
    message += `💧 Влажность: ${weather.humidity}%\n`;
    message += `☁️ Облачность: ${weather.cloud_cover}%\n`;
    message += `📝 ${weather.description}\n`;
    message += `🌧️ Осадки: ${weather.precipitation}\n\n`;
    
    // Добавляем почасовой прогноз (ближайшие 4 часа)
    if (weather.hourly && weather.hourly.length > 0) {
      message += `⏱️ *Ближайшие часы:*\n`;
      const nextHours = weather.hourly.slice(0, 4);
      nextHours.forEach(hour => {
        message += `• ${hour.time}: ${hour.temp}°C ${hour.description}\n`;
      });
    }
    
    message += `\n👕 *Краткие рекомендации:*\n`;
    
    if (weather.temp >= 20) {
      message += `• Футболка/майка\n• Шорты/легкие брюки\n• Сандалии/кеды`;
    } else if (weather.temp >= 15) {
      message += `• Футболка с рубашкой\n• Джинсы/брюки\n• Легкая куртка`;
    } else if (weather.temp >= 10) {
      message += `• Свитер/толстовка\n• Джинсы\n• Куртка`;
    } else {
      message += `• Теплая куртка\n• Термобелье\n• Шарф/шапка`;
    }
    
    if (weather.description.includes('🌧️')) {
      message += `\n• ☔ Возьмите зонт`;
    }
    
    if (weather.description.includes('☀️')) {
      message += `\n• 🕶️ Солнцезащитные очки`;
    }
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА СЕЙЧАС:', error);
    await ctx.reply('❌ Не удалось получить данные о погоде. Попробуйте позже.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

// ===================== ПОГОДА НА ЗАВТРА =====================
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
    
    await ctx.reply(`⏳ Запрашиваю прогноз погоды для ${city}...`, { 
      parse_mode: 'Markdown' 
    });
    
    const forecast = await getWeatherForecastDetailed(city);
    console.log('📅 Получен прогноз:', forecast);
    
    let message = `📅 *Прогноз погоды в ${forecast.city} на ${forecast.date_tomorrow}*\n\n`;
    message += `🌡️ Максимальная: *${forecast.general.temp_max}°C*\n`;
    message += `🌡️ Минимальная: *${forecast.general.temp_min}°C*\n`;
    message += `📝 ${forecast.general.description}\n`;
    message += `🌧️ Осадки: ${forecast.general.precipitation}\n\n`;
    
    message += `👕 *Рекомендации на завтра:*\n`;
    
    if (forecast.general.temp_max >= 20) {
      message += `• Легкая одежда\n• Головной убор от солнца\n• Солнцезащитные очки`;
    } else if (forecast.general.temp_max >= 15) {
      message += `• Футболка с кофтой\n• Джинсы/брюки\n• Легкая куртка на вечер`;
    } else if (forecast.general.temp_max >= 10) {
      message += `• Свитер/толстовка\n• Джинсы\n• Куртка`;
    } else {
      message += `• Теплая куртка\n• Термобелье\n• Шарф и шапка`;
    }
    
    if (forecast.general.description.includes('🌧️')) {
      message += `\n• ☔ Дождевик или зонт`;
    }
    
    if (forecast.general.description.includes('❄️')) {
      message += `\n• ❄️ Непромокаемая обувь`;
    }
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА ЗАВТРА:', error);
    await ctx.reply('❌ Не удалось получить прогноз погоды. Попробуйте позже.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

// ===================== ОСТАЛЬНЫЕ КНОПКИ =====================
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
    
    await ctx.reply(`👗 Анализирую погоду для ${city}...`, { parse_mode: 'Markdown' });
    
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
    if (!dailyPhrases || dailyPhrases.length === 0) {
      await ctx.reply('Фразы не загружены.', { reply_markup: mainMenuKeyboard });
      return;
    }
    
    const dayOfMonth = new Date().getDate();
    const phraseIndex = (dayOfMonth - 1) % dailyPhrases.length;
    const phrase = dailyPhrases[phraseIndex];
    
    await ctx.reply(
      `💬 *Фраза дня*\n\n` +
      `🇬🇧 *${phrase.english}*\n\n` +
      `🇷🇺 *${phrase.russian}*\n\n` +
      `📚 *Объяснение:* ${phrase.explanation}\n\n` +
      `📂 *Категория:* ${phrase.category}\n` +
      `📊 *Уровень сложности:* ${phrase.level}\n\n` +
      `🔄 Завтра новая фраза!`,
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
    if (!dailyPhrases || dailyPhrases.length === 0) {
      await ctx.reply('Фразы не загружены. Попробуйте позже.', { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    const randomIndex = Math.floor(Math.random() * dailyPhrases.length);
    const phrase = dailyPhrases[randomIndex];
    
    const message = 
      `🎲 *Случайная английская фраза*\n\n` +
      `🇬🇧 *${phrase.english}*\n\n` +
      `🇷🇺 *${phrase.russian}*\n\n` +
      `📚 *Объяснение:* ${phrase.explanation}\n\n` +
      `📂 *Категория:* ${phrase.category}\n` +
      `📊 *Уровень:* ${phrase.level}\n\n` +
      `🔄 Нажмите кнопку для новой случайной фразы!`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в СЛУЧАЙНАЯ ФРАЗА:', error);
    await ctx.reply('❌ Не удалось получить случайную фразу. Попробуйте еще раз.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

// ===================== ВСПОМОГАТЕЛЬНЫЕ КНОПКИ =====================
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
      `📋 *Клавиатура скрыта. Теперь доступны команды!*\n\n` +
      `Нажмите / или введите команду вручную:\n\n` +
      `*Список команд:*\n` +
      `/start - Начать работу с ботом\n` +
      `/weather - Текущая погода в вашем городе\n` +
      `/forecast - Прогноз погоды на завтра\n` +
      `/wardrobe - Что надеть по погоде сегодня\n` +
      `/phrase - Английская фраза дня\n` +
      `/random - Случайная английская фраза\n` +
      `/stats - Ваша статистика в игре\n` +
      `/top - Топ игроков\n` +
      `/city - Сменить город\n` +
      `/help - Помощь и список команд\n\n` +
      `Чтобы вернуть меню кнопок, нажмите /start`,
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
      `• 🌤️ ПОГОДА СЕЙЧАС - текущая погода с почасовым прогнозом\n` +
      `• 📅 ПОГОДА ЗАВТРА - подробный прогноз на завтра\n` +
      `• 👕 ЧТО НАДЕТЬ? - подробные рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня с объяснением\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная английская фраза\n` +
      `• 📊 МОЯ СТАТИСТИКА - ваша статистика в игре тетрис\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки в тетрис\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город для погоды\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n` +
      `• 📋 ПОКАЗАТЬ КОМАНДЫ - убрать кнопки и использовать команды\n\n` +
      `*Игра Тетрис:*\n` +
      `• Доступна через меню ботов Telegram\n` +
      `• Ваш прогресс автоматически сохраняется\n` +
      `• Смотрите статистику в разделе "📊 МОЯ СТАТИСТИКА"\n` +
      `• Соревнуйтесь с другими в "🏆 ТОП ИГРОКОВ"\n\n` +
      `Чтобы использовать текстовые команды, нажмите "📋 ПОКАЗАТЬ КОМАНДЫ".`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  } catch (error) {
    console.error('❌ Ошибка в ПОМОЩЬ:', error);
  }
});

// ===================== ОБРАБОТКА РУЧНОГО ВВОДА ГОРОДА =====================
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const userData = userStorage.get(userId) || {};
  
  console.log(`📝 Текст от ${userId}: "${text}"`);
  
  // Игнорируем команды
  if (text.startsWith('/')) return;
  
  // Игнорируем кнопки
  const buttonTexts = [
    '🚀 НАЧАТЬ РАБОТУ', '🌤️ ПОГОДА СЕЙЧАС', '📅 ПОГОДА ЗАВТРА', 
    '👕 ЧТО НАДЕТЬ?', '💬 ФРАЗА ДНЯ', '🎲 СЛУЧАЙНАЯ ФРАЗА', 
    '📊 МОЯ СТАТИСТИКА', '🏆 ТОП ИГРОКОВ', '🏙️ СМЕНИТЬ ГОРОД',
    'ℹ️ ПОМОЩЬ', '📋 ПОКАЗАТЬ КОМАНДЫ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'
  ];
  
  if (buttonTexts.includes(text) || text.startsWith('📍 ')) {
    return;
  }
  
  // Если пользователь вводит город вручную
  if (userData.awaitingCity) {
    if (isRateLimited(userId)) {
      await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
      return;
    }
    
    try {
      const city = text.trim();
      if (city.length === 0 || city.length > 100) {
        await ctx.reply('❌ Неверное название города. Попробуйте еще раз.');
        return;
      }
      
      console.log(`🏙️ Сохраняю город "${city}" для ${userId}`);
      
      // Сохраняем город в БД
      const saved = await saveUserCity(userId, city);
      
      if (saved) {
        userStorage.set(userId, { 
          city, 
          lastActivity: Date.now(), 
          awaitingCity: false 
        });
        
        await ctx.reply(
          `✅ *Город "${city}" успешно сохранён!*\n\n` +
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
    // Если просто текст, а не город
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
      await ctx.reply('Сначала выберите город! Используйте /start', { reply_markup: cityKeyboard });
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
      await ctx.reply('Сначала выберите город! Используйте /start', { reply_markup: cityKeyboard });
      return;
    }
    
    await ctx.reply(`⏳ Запрашиваю прогноз погоды для ${city}...`);
    
    const forecast = await getWeatherForecastDetailed(city);
    
    let message = `📅 *Прогноз погоды в ${forecast.city} на ${forecast.date_tomorrow}*\n\n`;
    message += `🌡️ Максимальная: *${forecast.general.temp_max}°C*\n`;
    message += `🌡️ Минимальная: *${forecast.general.temp_min}°C*\n`;
    message += `📝 ${forecast.general.description}\n`;
    message += `🌧️ Осадки: ${forecast.general.precipitation}`;
    
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
      await ctx.reply('Сначала выберите город! Используйте /start', { reply_markup: cityKeyboard });
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
    if (!dailyPhrases || dailyPhrases.length === 0) {
      await ctx.reply('Фразы не загружены.', { reply_markup: mainMenuKeyboard });
      return;
    }
    
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
    if (!dailyPhrases || dailyPhrases.length === 0) {
      await ctx.reply('Фразы не загружены. Попробуйте позже.', { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
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
    await ctx.reply('❌ Не удалось получить случайную фразу. Попробуйте еще раз.', { 
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
      `*Кнопки в меню:*\n` +
      `• 🌤️ ПОГОДА СЕЙЧАС - текущая погода с почасовым прогнозом\n` +
      `• 📅 ПОГОДА ЗАВТРА - прогноз на завтра\n` +
      `• 👕 ЧТО НАДЕТЬ? - подробные рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня с объяснением\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная английская фраза\n` +
      `• 📊 МОЯ СТАТИСТИКА - ваша статистика в игре тетрис\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки в тетрис\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город для погоды\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n` +
      `• 📋 ПОКАЗАТЬ КОМАНДЫ - убрать кнопки и использовать команды\n\n` +
      `*Текстовые команды:*\n` +
      `/start - начать работу с ботом\n` +
      `/weather - текущая погода\n` +
      `/forecast - прогноз на завтра\n` +
      `/wardrobe - что надеть?\n` +
      `/phrase - фраза дня\n` +
      `/random - случайная фраза\n` +
      `/stats - ваша статистика в игре\n` +
      `/top - топ игроков\n` +
      `/city - сменить город\n` +
      `/help - помощь\n\n` +
      `Чтобы вернуть меню кнопок, нажмите /start`,
      { 
        parse_mode: 'Markdown', 
        reply_markup: { remove_keyboard: true }
      }
    );
  } catch (error) {
    console.error('❌ Ошибка в /help:', error);
  }
});

// ===================== ОБРАБОТЧИК ДАННЫХ ИЗ ИГРЫ =====================
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
      
      let message = '';
      if (data.gameOver) {
        message = `🎮 *Игра окончена!*\n\n` +
                  `🏆 *Ваш результат:*\n` +
                  `• 🎯 Очки: *${data.score}*\n` +
                  `• 📊 Уровень: *${data.level}*\n` +
                  `• 📈 Линии: *${data.lines}*\n\n`;
      } else {
        message = `🎮 *Прогресс сохранён!*\n\n` +
                  `📈 *Текущий результат:*\n` +
                  `• 🎯 Очки: *${data.score}*\n` +
                  `• 📊 Уровень: *${data.level}*\n` +
                  `• 📈 Линии: *${data.lines}*\n\n` +
                  `💾 *Прогресс сохранён, можно продолжить позже!*\n\n`;
      }
      
      const statsMessage = await getGameStatsMessage(userId);
      message += statsMessage + `\n\n🔄 Продолжайте играть!`;
      
      await ctx.reply(message, { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка обработки данных игры:', error);
    await ctx.reply('Произошла ошибка при обработке данных игры. Попробуйте ещё раз.', {
      reply_markup: mainMenuKeyboard
    });
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
          'Погода с подробным прогнозом',
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
console.log('⚡ Бот загружен с полной системой погоды, фраз и статистики игр!');
