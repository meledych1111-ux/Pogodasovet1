import { Bot, Keyboard, InlineKeyboard } from 'grammy';
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
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    
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

// Функция для получения подробной погоды на сегодня
async function getWeatherData(cityName, forceRefresh = false) {
  const cacheKey = cityName.toLowerCase();
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
    const todayPrecipitation = weatherData.daily?.precipitation_sum[0] || 0;
    
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
    
    // Если есть кэшированные данные, возвращаем их даже если устарели
    if (weatherCache.has(cacheKey)) {
      console.log('🔄 Использую устаревшие кэшированные данные');
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

// Функция для получения подробного прогноза на завтра (утро, день, вечер, ночь)
async function getWeatherForecastDetailed(cityName) {
  const cacheKey = `${cityName.toLowerCase()}_detailed_forecast`;
  const now = Date.now();
  
  // Проверяем кэш (актуален 30 минут)
  if (weatherCache.has(cacheKey)) {
    const cached = weatherCache.get(cacheKey);
    if (now - cached.timestamp < 1800000) {
      console.log(`📅 Использую кэшированный подробный прогноз для ${cityName}`);
      return cached.data;
    }
  }
  
  console.log(`📅 Запрашиваю подробный прогноз погоды для: "${cityName}"`);
  
  try {
    const { latitude, longitude, name } = await getCityCoordinates(cityName);
    
    // Запрос для прогноза на 2 дня с почасовыми данными
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=2`;
    
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();
    
    if (!forecastData.hourly || !forecastData.hourly.time) {
      throw new Error('Нет данных о прогнозе');
    }
    
    // Получаем почасовой прогноз на завтра (часы 24-47)
    const hourlyTomorrow = getHourlyForecast(forecastData.hourly, 24, 48);
    
    // Группируем по времени суток
    const timeSlots = {
      morning: hourlyTomorrow.filter(h => h.hour >= 6 && h.hour < 12),
      afternoon: hourlyTomorrow.filter(h => h.hour >= 12 && h.hour < 18),
      evening: hourlyTomorrow.filter(h => h.hour >= 18 && h.hour < 24),
      night: hourlyTomorrow.filter(h => h.hour >= 0 && h.hour < 6)
    };
    
    // Рассчитываем средние значения для каждого периода
    const calculatePeriodStats = (period) => {
      if (period.length === 0) return null;
      
      const avgTemp = Math.round(period.reduce((sum, h) => sum + h.temp, 0) / period.length);
      const maxTemp = Math.max(...period.map(h => h.temp));
      const minTemp = Math.min(...period.map(h => h.temp));
      const avgFeelsLike = Math.round(period.reduce((sum, h) => sum + h.feels_like, 0) / period.length);
      
      // Наиболее частый код погоды
      const weatherCodes = period.map(h => h.weather_code);
      const mostCommonCode = weatherCodes.sort((a,b) => 
        weatherCodes.filter(v => v === a).length - 
        weatherCodes.filter(v => v === b).length
      ).pop();
      
      const avgPrecipitation = period.reduce((sum, h) => sum + h.precipitation_probability, 0) / period.length;
      
      return {
        temp: avgTemp,
        feels_like: avgFeelsLike,
        temp_range: `${minTemp}°C - ${maxTemp}°C`,
        weather_code: mostCommonCode,
        description: getDetailedWeatherDescription(mostCommonCode, 0, 50),
        precipitation_probability: Math.round(avgPrecipitation),
        hours: period.map(h => h.hour)
      };
    };
    
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
      },
      periods: {
        morning: calculatePeriodStats(timeSlots.morning),
        afternoon: calculatePeriodStats(timeSlots.afternoon),
        evening: calculatePeriodStats(timeSlots.evening),
        night: calculatePeriodStats(timeSlots.night)
      },
      hourly: hourlyTomorrow
    };
    
    // Сохраняем в кэш
    weatherCache.set(cacheKey, {
      data: forecastResult,
      timestamp: now
    });
    
    return forecastResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения подробного прогноза:', error.message);
    
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
      },
      periods: {
        morning: { temp: 16, feels_like: 15, description: 'Ясно ☀️', precipitation_probability: 10 },
        afternoon: { temp: 22, feels_like: 21, description: 'Солнечно ☀️', precipitation_probability: 5 },
        evening: { temp: 18, feels_like: 17, description: 'Малооблачно 🌤️', precipitation_probability: 15 },
        night: { temp: 14, feels_like: 13, description: 'Ясно 🌙', precipitation_probability: 5 }
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
  // Путешествия и транспорт (10 фраз)
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
    english: "Is this seat taken?",
    russian: "Это место занято?",
    explanation: "Вежливый вопрос в транспорте",
    category: "Путешествия", 
    level: "Начальный"
  },
  {
    english: "Could you tell me the way to the railway station?",
    russian: "Не подскажете дорогу до вокзала?",
    explanation: "Просим указать направление",
    category: "Путешествия",
    level: "Средний"
  },
  {
    english: "I'd like to rent a car for three days",
    russian: "Я хотел бы арендовать машину на три дня",
    explanation: "Фраза для аренды автомобиля",
    category: "Путешествия",
    level: "Средний"
  },
  {
    english: "Does this train go to the city center?",
    russian: "Этот поезд идет в центр города?",
    explanation: "Уточнение маршрута",
    category: "Путешествия",
    level: "Начальный"
  },
  {
    english: "Where can I buy a metro card?",
    russian: "Где я могу купить карту метро?",
    explanation: "Вопрос о проездных",
    category: "Путешествия",
    level: "Начальный"
  },
  {
    english: "What time does the last bus leave?",
    russian: "Во сколько уходит последний автобус?",
    explanation: "Уточнение расписания",
    category: "Путешествия",
    level: "Начальный"
  },
  {
    english: "I need a taxi, please",
    russian: "Мне нужно такси, пожалуйста",
    explanation: "Простая просьба вызвать такси",
    category: "Путешествия",
    level: "Начальный"
  },
  {
    english: "Is there a direct flight to London?",
    russian: "Есть прямой рейс в Лондон?",
    explanation: "Вопрос о авиаперелетах",
    category: "Путешествия",
    level: "Средний"
  },

  // Еда и рестораны (10 фраз)
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
  {
    english: "Is this dish spicy?",
    russian: "Это блюдо острое?",
    explanation: "Уточнение о специях",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "Could we have the bill, please?",
    russian: "Можем мы получить счет, пожалуйста?",
    explanation: "Просим счет в ресторане",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "I'd like to make a reservation for two",
    russian: "Я хотел бы зарезервировать столик на двоих",
    explanation: "Бронирование столика",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "This is delicious!",
    russian: "Это очень вкусно!",
    explanation: "Комплимент повару",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "Could I have some water, please?",
    russian: "Можно мне воды, пожалуйста?",
    explanation: "Простая просьба",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "Is service included?",
    russian: "Обслуживание включено?",
    explanation: "Вопрос о чаевых",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "I'll have the same",
    russian: "Я возьму то же самое",
    explanation: "Заказ в ресторане",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "Could you recommend something?",
    russian: "Не могли бы вы что-нибудь порекомендовать?",
    explanation: "Просим рекомендацию",
    category: "Еда",
    level: "Средний"
  },

  // Покупки и шоппинг (10 фраз)
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
  {
    english: "Where are the fitting rooms?",
    russian: "Где примерочные?",
    explanation: "Ищем где примерить",
    category: "Шоппинг",
    level: "Начальный"
  },
  {
    english: "I'm just looking, thank you",
    russian: "Я просто смотрю, спасибо",
    explanation: "Отказ от помощи продавца",
    category: "Шоппинг",
    level: "Начальный"
  },
  {
    english: "Can I pay by credit card?",
    russian: "Могу я оплатить кредитной картой?",
    explanation: "Вопрос о способе оплаты",
    category: "Шоппинг",
    level: "Начальный"
  },
  {
    english: "Is there a warranty?",
    russian: "Есть гарантия?",
    explanation: "Важный вопрос при покупке",
    category: "Шоппинг",
    level: "Средний"
  },
  {
    english: "Could I have a receipt, please?",
    russian: "Можно чек, пожалуйста?",
    explanation: "Просим чек",
    category: "Шоппинг",
    level: "Начальный"
  },
  {
    english: "Do you offer discounts?",
    russian: "У вас есть скидки?",
    explanation: "Вопрос о скидках",
    category: "Шоппинг",
    level: "Средний"
  },
  {
    english: "I'd like to return this item",
    russian: "Я хотел бы вернуть этот товар",
    explanation: "Возврат покупки",
    category: "Шоппинг",
    level: "Средний"
  },
  {
    english: "Where is the cash desk?",
    russian: "Где касса?",
    explanation: "Ищем где оплатить",
    category: "Шоппинг",
    level: "Начальный"
  },

  // Здоровье и медицина (10 фраз)
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
  },
  {
    english: "I have a headache",
    russian: "У меня болит голова",
    explanation: "Описание симптомов",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "I feel sick",
    russian: "Мне плохо",
    explanation: "Общее недомогание",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "Do I need a prescription?",
    russian: "Мне нужен рецепт?",
    explanation: "Вопрос в аптеке",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I've cut my finger",
    russian: "Я порезал палец",
    explanation: "Описание травмы",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "Call an ambulance, please",
    russian: "Вызовите скорую, пожалуйста",
    explanation: "Экстренный вызов",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "I have a temperature",
    russian: "У меня температура",
    explanation: "Сообщаем о температуре",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "How should I take this medicine?",
    russian: "Как мне принимать это лекарство?",
    explanation: "Вопрос о дозировке",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I'm diabetic",
    russian: "У меня диабет",
    explanation: "Важная медицинская информация",
    category: "Здоровье",
    level: "Средний"
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

const forecastDetailKeyboard = new Keyboard()
    .text('🌅 УТРО (6-12)')
    .text('🌞 ДЕНЬ (12-18)').row()
    .text('🌆 ВЕЧЕР (18-24)')
    .text('🌙 НОЧЬ (0-6)').row()
    .text('📊 ОБЩИЙ ПРОГНОЗ')
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
    
    await ctx.reply(
      `📱 *Что умеет бот:*\n\n` +
      `🌤️ *Погода:*\n` +
      `• Текущая погода в вашем городе\n` +
      `• Подробный прогноз на завтра (утро/день/вечер/ночь)\n` +
      `• Совет, что надеть\n\n` +
      `🇬🇧 *Английский:*\n` +
      `• Фраза дня\n` +
      `• Случайные полезные фразы\n\n` +
      `🎮 *Игры (с полноценной статистикой):*\n` +
      `• Тетрис в мини-приложении\n` +
      `• 📊 Ваша статистика\n` +
      `• 🏆 Топ игроков\n\n` +
      `👉 *Чтобы продолжить, нажмите "🚀 НАЧАТЬ РАБОТУ"*`,
      { parse_mode: 'Markdown' }
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
    await saveUserCity(userId, city);
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
    await ctx.reply('Не удалось сохранить город в базу данных. Попробуйте еще раз.');
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

// ===================== ПОГОДА СЕЙЧАС (ПОДРОБНАЯ) =====================
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
    
    await ctx.reply(`⏳ Запрашиваю подробную погоду для ${city}...`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(city);
    console.log('🌤️ Получена подробная погода:', weather);
    
    let message = `🌤️ *Подробная погода в ${weather.city}*\n\n`;
    message += `🌡️ Температура: *${weather.temp}°C*\n`;
    message += `🤔 Ощущается как: *${weather.feels_like}°C*\n`;
    message += `📊 Диапазон: *${weather.min_temp}°C - ${weather.max_temp}°C*\n`;
    message += `💨 Ветер: ${weather.wind} м/с\n`;
    message += `💧 Влажность: ${weather.humidity}%\n`;
    message += `☁️ Облачность: ${weather.cloud_cover}%\n`;
    message += `📝 ${weather.description}\n`;
    message += `🌧️ Осадки: ${weather.precipitation}\n\n`;
    
    // Добавляем почасовой прогноз (ближайшие 6 часов)
    if (weather.hourly && weather.hourly.length > 0) {
      message += `⏱️ *Ближайшие часы:*\n`;
      const nextHours = weather.hourly.slice(0, 6);
      nextHours.forEach(hour => {
        message += `• ${hour.time}: ${hour.temp}°C ${hour.description} (ощущ. ${hour.feels_like}°C)\n`;
      });
    }
    
    message += `\n👕 *Рекомендации по одежде:*\n`;
    const adviceLines = getWardrobeAdvice(weather).split('\n').slice(0, 8);
    message += adviceLines.join('\n');
    message += `\n\n...и другие рекомендации в разделе "👕 ЧТО НАДЕТЬ?"`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА СЕЙЧАС:', error);
    await ctx.reply('❌ Не удалось получить данные о погоде или обработать ваш запрос.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

// ===================== ПОГОДА НА ЗАВТРА (ПОДРОБНАЯ) =====================
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
    
    await ctx.reply(`⏳ Запрашиваю подробный прогноз погоды для ${city}...`, { 
      parse_mode: 'Markdown' 
    });
    
    const forecast = await getWeatherForecastDetailed(city);
    console.log('📅 Получен подробный прогноз:', forecast);
    
    // Сохраняем прогноз в хранилище пользователя
    userStorage.set(userId, { 
      ...userStorage.get(userId), 
      detailedForecast: forecast,
      lastActivity: Date.now() 
    });
    
    let message = `📅 *Прогноз погоды в ${forecast.city} на ${forecast.date_tomorrow}*\n\n`;
    message += `🌡️ Температура: *${forecast.general.temp_min}°C - ${forecast.general.temp_max}°C*\n`;
    message += `📝 ${forecast.general.description}\n`;
    message += `🌧️ Осадки: ${forecast.general.precipitation}\n\n`;
    message += `⏰ *Подробный прогноз по времени суток:*\n\n`;
    
    // Добавляем информацию по периодам
    if (forecast.periods.morning) {
      message += `🌅 *Утро (6:00-12:00):*\n`;
      message += `• Температура: ${forecast.periods.morning.temp}°C (ощущ. ${forecast.periods.morning.feels_like}°C)\n`;
      message += `• Погода: ${forecast.periods.morning.description}\n`;
      message += `• Вероятность осадков: ${forecast.periods.morning.precipitation_probability}%\n\n`;
    }
    
    if (forecast.periods.afternoon) {
      message += `🌞 *День (12:00-18:00):*\n`;
      message += `• Температура: ${forecast.periods.afternoon.temp}°C (ощущ. ${forecast.periods.afternoon.feels_like}°C)\n`;
      message += `• Погода: ${forecast.periods.afternoon.description}\n`;
      message += `• Вероятность осадков: ${forecast.periods.afternoon.precipitation_probability}%\n\n`;
    }
    
    message += `👇 *Выберите период для детальной информации:*`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: forecastDetailKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА ЗАВТРА:', error);
    await ctx.reply('❌ Не удалось получить прогноз погоды. Попробуйте позже.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

// ===================== ОБРАБОТКА ДЕТАЛЬНОГО ПРОГНОЗА =====================
bot.hears('🌅 УТРО (6-12)', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`🌅 УТРО от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const userData = userStorage.get(userId);
    if (!userData || !userData.detailedForecast || !userData.detailedForecast.periods.morning) {
      await ctx.reply('Сначала запросите прогноз погоды на завтра.', { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    const period = userData.detailedForecast.periods.morning;
    const city = userData.detailedForecast.city;
    const date = userData.detailedForecast.date_tomorrow;
    
    let message = `🌅 *Утро в ${city} на ${date} (6:00-12:00)*\n\n`;
    message += `🌡️ Температура: *${period.temp}°C*\n`;
    message += `🤔 Ощущается как: *${period.feels_like}°C*\n`;
    message += `📊 Диапазон: ${period.temp_range}\n`;
    message += `📝 Погода: ${period.description}\n`;
    message += `🌧️ Вероятность осадков: ${period.precipitation_probability}%\n\n`;
    
    // Рекомендации по одежде для утра
    message += `👕 *Рекомендации на утро:*\n`;
    message += `• Легкая куртка или ветровка\n`;
    message += `• Футболка или рубашка\n`;
    message += `• Джинсы или брюки\n`;
    message += `• Удобная обувь\n`;
    
    if (period.precipitation_probability > 30) {
      message += `• ☔ Возьмите зонт или дождевик\n`;
    }
    
    if (period.temp < 15) {
      message += `• 🧣 Теплая кофта или свитер\n`;
    }
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: forecastDetailKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в УТРО:', error);
    await ctx.reply('❌ Не удалось получить информацию.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.hears('🌞 ДЕНЬ (12-18)', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`🌞 ДЕНЬ от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const userData = userStorage.get(userId);
    if (!userData || !userData.detailedForecast || !userData.detailedForecast.periods.afternoon) {
      await ctx.reply('Сначала запросите прогноз погоды на завтра.', { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    const period = userData.detailedForecast.periods.afternoon;
    const city = userData.detailedForecast.city;
    const date = userData.detailedForecast.date_tomorrow;
    
    let message = `🌞 *День в ${city} на ${date} (12:00-18:00)*\n\n`;
    message += `🌡️ Температура: *${period.temp}°C*\n`;
    message += `🤔 Ощущается как: *${period.feels_like}°C*\n`;
    message += `📊 Диапазон: ${period.temp_range}\n`;
    message += `📝 Погода: ${period.description}\n`;
    message += `🌧️ Вероятность осадков: ${period.precipitation_probability}%\n\n`;
    
    // Рекомендации по одежде для дня
    message += `👕 *Рекомендации на день:*\n`;
    
    if (period.temp >= 20) {
      message += `• Футболка или майка\n`;
      message += `• Шорты или легкие брюки\n`;
      message += `• Сандалии или кеды\n`;
      if (period.description.includes('☀️')) {
        message += `• 🕶️ Солнцезащитные очки\n`;
        message += `• 🧢 Головной убор от солнца\n`;
      }
    } else if (period.temp >= 15) {
      message += `• Футболка или рубашка\n`;
      message += `• Джинсы или брюки\n`;
      message += `• Легкая куртка\n`;
      message += `• Кроссовки\n`;
    } else {
      message += `• Кофта или свитер\n`;
      message += `• Джинсы или теплые брюки\n`;
      message += `• Куртка\n`;
      message += `• Кроссовки или ботинки\n`;
    }
    
    if (period.precipitation_probability > 30) {
      message += `• ☔ Дождевик или зонт\n`;
    }
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: forecastDetailKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ДЕНЬ:', error);
    await ctx.reply('❌ Не удалось получить информацию.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.hears('🌆 ВЕЧЕР (18-24)', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`🌆 ВЕЧЕР от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const userData = userStorage.get(userId);
    if (!userData || !userData.detailedForecast || !userData.detailedForecast.periods.evening) {
      await ctx.reply('Сначала запросите прогноз погоды на завтра.', { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    const period = userData.detailedForecast.periods.evening;
    const city = userData.detailedForecast.city;
    const date = userData.detailedForecast.date_tomorrow;
    
    let message = `🌆 *Вечер в ${city} на ${date} (18:00-24:00)*\n\n`;
    message += `🌡️ Температура: *${period.temp}°C*\n`;
    message += `🤔 Ощущается как: *${period.feels_like}°C*\n`;
    message += `📊 Диапазон: ${period.temp_range}\n`;
    message += `📝 Погода: ${period.description}\n`;
    message += `🌧️ Вероятность осадков: ${period.precipitation_probability}%\n\n`;
    
    // Рекомендации по одежде для вечера
    message += `👕 *Рекомендации на вечер:*\n`;
    message += `• Теплее, чем днем!\n`;
    message += `• Свитер или толстовка\n`;
    message += `• Джинсы или брюки\n`;
    message += `• Куртка или ветровка\n`;
    message += `• Закрытая обувь\n`;
    
    if (period.temp < 15) {
      message += `• 🧣 Шарф или легкая шапка\n`;
    }
    
    if (period.precipitation_probability > 30) {
      message += `• ☔ Зонт или дождевик\n`;
      message += `• Водонепроницаемая обувь\n`;
    }
    
    message += `\n⚠️ *Важно:* Вечером обычно прохладнее, чем днем!`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: forecastDetailKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ВЕЧЕР:', error);
    await ctx.reply('❌ Не удалось получить информацию.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.hears('🌙 НОЧЬ (0-6)', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`🌙 НОЧЬ от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const userData = userStorage.get(userId);
    if (!userData || !userData.detailedForecast || !userData.detailedForecast.periods.night) {
      await ctx.reply('Сначала запросите прогноз погоды на завтра.', { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    const period = userData.detailedForecast.periods.night;
    const city = userData.detailedForecast.city;
    const date = userData.detailedForecast.date_tomorrow;
    
    let message = `🌙 *Ночь в ${city} на ${date} (0:00-6:00)*\n\n`;
    message += `🌡️ Температура: *${period.temp}°C*\n`;
    message += `🤔 Ощущается как: *${period.feels_like}°C*\n`;
    message += `📊 Диапазон: ${period.temp_range}\n`;
    message += `📝 Погода: ${period.description}\n`;
    message += `🌧️ Вероятность осадков: ${period.precipitation_probability}%\n\n`;
    
    // Рекомендации по одежде для ночи
    message += `👕 *Если выходите ночью:*\n`;
    
    if (period.temp >= 15) {
      message += `• Легкая куртка или ветровка\n`;
      message += `• Джинсы или брюки\n`;
      message += `• Футболка с длинным рукавом\n`;
    } else if (period.temp >= 10) {
      message += `• Теплая куртка\n`;
      message += `• Джинсы или теплые брюки\n`;
      message += `• Свитер или толстовка\n`;
      message += `• 🧣 Шарф (по желанию)\n`;
    } else if (period.temp >= 0) {
      message += `• Зимняя куртка\n`;
      message += `• Теплые брюки\n`;
      message += `• Термобелье или теплый свитер\n`;
      message += `• 🧣 Шарф и перчатки\n`;
      message += `• 🧢 Теплая шапка\n`;
    } else {
      message += `• ⚠️ Очень холодно! Одевайтесь очень тепло\n`;
      message += `• Пуховик или теплая зимняя куртка\n`;
      message += `• Термобелье\n`;
      message += `• Теплые штаны\n`;
      message += `• 🧤 Варежки или теплые перчатки\n`;
      message += `• 🧣 Шарф и теплая шапка\n`;
    }
    
    message += `\n👟 *Обувь:* закрытая, по погоде\n`;
    message += `🎒 *Совет:* ночью всегда холоднее, одевайтесь теплее!`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: forecastDetailKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в НОЧЬ:', error);
    await ctx.reply('❌ Не удалось получить информацию.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.hears('📊 ОБЩИЙ ПРОГНОЗ', async (ctx) => {
  // Возвращаемся к общему прогнозу
  await ctx.reply('Возвращаю общий прогноз...', { 
    reply_markup: forecastDetailKeyboard 
  });
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
    console.log(`💬 Выбрана фраза #${phraseIndex}: "${phrase.english}"`);
    
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
      `📂 *Категория:* ${phrase.category || "Общие"}\n` +
      `📊 *Уровень:* ${phrase.level || "Средний"}\n\n` +
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
  console.log(`✏️ ДРУГОЙ ГОРОД от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('Напишите название вашего города:');
    const userId = ctx.from.id;
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
      `• 📅 ПОГОДА ЗАВТРА - подробный прогноз на завтра (утро/день/вечер/ночь)\n` +
      `• 👕 ЧТО НАДЕТЬ? - подробные рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня с объяснением\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная английская фраза\n` +
      `• 📊 МОЯ СТАТИСТИКА - ваша статистика в игре тетрис\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки в тетрис\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город для погоды\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n` +
      `• 📋 ПОКАЗАТЬ КОМАНДЫ - убрать кнопки и использовать команды\n\n` +
      `*Игра Тетрис:*\n` +
      `• Доступна через меню ботов Telegram (кнопка "🎮 Играть в тетрис")\n` +
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
      `📂 *Категория:* ${phrase.category || "Общие"}\n` +
      `📊 *Уровень:* ${phrase.level || "Средний"}`;
    
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
      `• 📅 ПОГОДА ЗАВТРА - подробный прогноз на завтра (утро/день/вечер/ночь)\n` +
      `• 👕 ЧТО НАДЕТЬ? - подробные рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня с объяснением\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная английская фраза\n` +
      `• 📊 МОЯ СТАТИСТИКА - ваша статистика в игре тетрис\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки в тетрис\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город для погоды\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n` +
      `• 📋 ПОКАЗАТЬ КОМАНДЫ - убрать кнопки и использовать команды\n\n` +
      `*Текстовые команды (доступны после нажатия "📋 ПОКАЗАТЬ КОМАНДЫ"):*\n` +
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

// ===================== ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ =====================
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
      ['🚀 НАЧАТЬ РАБОТУ', '🌤️ ПОГОДА СЕЙЧАС', '📅 ПОГОДА ЗАВТРА', '👕 ЧТО НАДЕТЬ?', 
       '💬 ФРАЗА ДНЯ', '🎲 СЛУЧАЙНАЯ ФРАЗА', '📊 МОЯ СТАТИСТИКА', '🏆 ТОП ИГРОКОВ',
       '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '📋 ПОКАЗАТЬ КОМАНДЫ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД',
       '🌅 УТРО (6-12)', '🌞 ДЕНЬ (12-18)', '🌆 ВЕЧЕР (18-24)', '🌙 НОЧЬ (0-6)', '📊 ОБЩИЙ ПРОГНОЗ'].includes(text) ||
      text.startsWith('📍 ')) {
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
      userStorage.set(userId, { city, lastActivity: Date.now(), awaitingCity: false });
      
      if (saved) {
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
      await ctx.reply('Не удалось сохранить город. Попробуйте еще раз.');
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
