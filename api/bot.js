import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv'; // <-- ДОБАВЬТЕ ЭТОТ ИМПОРТ
import path from 'path';
import { fileURLToPath } from 'url';
// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
  saveGameScore,
  getGameStats as fetchGameStats,  // <-- переименовываем, чтобы избежать конфликта имен
  getTopPlayers as fetchTopPlayers,  // <-- переименовываем
  saveGameProgress,
  getGameProgress,
  deleteGameProgress,
  checkDatabaseConnection,
  debugDatabase
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
// Получаем путь к текущему файлу
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загружаем .env.local из корневой директории проекта
const envPath = path.join(__dirname, '..', '.env.local');
console.log('🔧 Загружаю переменные окружения из:', envPath);

// Загружаем .env и .env.local
dotenv.config(); // Загружает .env (если есть)
dotenv.config({ path: envPath }); // Загружает .env.local

console.log('✅ Переменные окружения загружены');
console.log('🔑 BOT_TOKEN найден?', !!process.env.BOT_TOKEN);
console.log('🗄️ DATABASE_URL найден?', !!process.env.DATABASE_URL);

// ===================== КОНФИГУРАЦИЯ =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: BOT_TOKEN не найден!');
  console.error('Проверьте файл .env.local в корне проекта:');
  console.error('Путь:', envPath);
  console.error('Содержимое файла должен содержать:');
  console.error('BOT_TOKEN="ваш_токен_бота"');
  throw new Error('BOT_TOKEN is required');
}

console.log('🤖 Создаю бота...');
const bot = new Bot(BOT_TOKEN);

// ===================== ИНИЦИАЛИЗАЦИЯ БОТА =====================
let botInitialized = false;


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

// ===================== ФУНКЦИИ ПОГОДЫ =====================
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
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    
    if (!geoData.results || geoData.results.length === 0) {
      throw new Error('Город не найден');
    }
    
    const { latitude, longitude, name } = geoData.results[0];
    
    // Запрос для текущей погоды
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=precipitation_sum&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
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
      precipitation_value: todayPrecipitation,
      description: getDetailedWeatherDescription(current.weather_code, todayPrecipitation),
      city: name,
      timestamp: new Date().toLocaleTimeString('ru-RU')
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
      description: 'Ясно ☀️',
      city: cityName,
      timestamp: new Date().toLocaleTimeString('ru-RU')
    };
  }
}

async function getWeatherForecast(cityName) {
  const cacheKey = `forecast_${cityName.toLowerCase()}`;
  const now = Date.now();
  
  // Проверяем кэш (актуален 30 минут для прогноза)
  if (weatherCache.has(cacheKey)) {
    const cached = weatherCache.get(cacheKey);
    if (now - cached.timestamp < 1800000) {
      console.log(`🌤️ Использую кэшированный прогноз для ${cityName}`);
      return cached.data;
    }
  }
  
  console.log(`🌤️ Запрашиваю прогноз на завтра для: "${cityName}"`);
  
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    
    if (!geoData.results || geoData.results.length === 0) {
      throw new Error('Город не найден');
    }
    
    const { latitude, longitude, name } = geoData.results[0];
    
    // Запрос расширенного прогноза на завтра с почасовыми данными
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,wind_speed_10m_max&wind_speed_unit=ms&timezone=auto&forecast_days=2`;
    
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();
    
    if (!forecastData.hourly || !forecastData.daily) {
      throw new Error('Нет данных прогноза');
    }
    
    // Получаем данные на завтра
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowDateStr = tomorrowDate.toISOString().split('T')[0];
    
    // Находим индексы времени для завтра
    const tomorrowIndexes = [];
    forecastData.hourly.time.forEach((time, index) => {
      if (time.startsWith(tomorrowDateStr)) {
        tomorrowIndexes.push(index);
      }
    });
    
    if (tomorrowIndexes.length === 0) {
      throw new Error('Нет данных на завтра');
    }
    
    // Группируем по времени суток
    const periods = {
      'ночь': { start: 0, end: 5 },
      'утро': { start: 6, end: 11 },
      'день': { start: 12, end: 17 },
      'вечер': { start: 18, end: 23 }
    };
    
    const periodData = {};
    
    for (const [periodName, range] of Object.entries(periods)) {
      const periodHours = tomorrowIndexes.filter(index => {
        const hour = new Date(forecastData.hourly.time[index]).getHours();
        return hour >= range.start && hour <= range.end;
      });
      
      if (periodHours.length > 0) {
        const temps = periodHours.map(index => forecastData.hourly.temperature_2m[index]);
        const feels = periodHours.map(index => forecastData.hourly.apparent_temperature[index]);
        const precip = periodHours.map(index => forecastData.hourly.precipitation_probability[index]);
        const weatherCodes = periodHours.map(index => forecastData.hourly.weather_code[index]);
        const winds = periodHours.map(index => forecastData.hourly.wind_speed_10m[index]);
        
        // Находим наиболее частый код погоды
        const mostFrequentCode = weatherCodes.reduce((a, b, i, arr) => 
          arr.filter(v => v === a).length >= arr.filter(v => v === b).length ? a : b
        );
        
        periodData[periodName] = {
          temp_min: Math.round(Math.min(...temps)),
          temp_max: Math.round(Math.max(...temps)),
          feels_min: Math.round(Math.min(...feels)),
          feels_max: Math.round(Math.max(...feels)),
          precip_max: Math.max(...precip),
          precip_avg: Math.round(precip.reduce((a, b) => a + b, 0) / precip.length),
          wind_avg: (winds.reduce((a, b) => a + b, 0) / winds.length).toFixed(1),
          weather_code: mostFrequentCode,
          description: getWeatherDescription(mostFrequentCode)
        };
      }
    }
    
    // Данные за весь день
    const tomorrowDailyIndex = 1; // индекс 0 - сегодня, 1 - завтра
    
    const forecastResult = {
      city: name,
      date: tomorrowDateStr,
      temp_max: Math.round(forecastData.daily.temperature_2m_max[tomorrowDailyIndex]),
      temp_min: Math.round(forecastData.daily.temperature_2m_min[tomorrowDailyIndex]),
      precipitation: forecastData.daily.precipitation_sum[tomorrowDailyIndex],
      wind_max: forecastData.daily.wind_speed_10m_max[tomorrowDailyIndex].toFixed(1),
      sunrise: forecastData.daily.sunrise[tomorrowDailyIndex].substring(11, 16),
      sunset: forecastData.daily.sunset[tomorrowDailyIndex].substring(11, 16),
      periods: periodData,
      updated: new Date().toLocaleTimeString('ru-RU')
    };
    
    // Сохраняем в кэш
    weatherCache.set(cacheKey, {
      data: forecastResult,
      timestamp: now
    });
    
    return forecastResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения прогноза:', error.message);
    
    // Если есть кэшированные данные, возвращаем их
    if (weatherCache.has(cacheKey)) {
      console.log('🔄 Использую устаревшие кэшированные данные прогноза');
      return weatherCache.get(cacheKey).data;
    }
    
    // Fallback данные
    const tomorrowDate = new Date(Date.now() + 86400000);
    const tomorrowDateStr = tomorrowDate.toISOString().split('T')[0];
    
    return {
      city: cityName,
      date: tomorrowDateStr,
      temp_max: 20,
      temp_min: 10,
      precipitation: 0,
      wind_max: '3.0',
      sunrise: '07:00',
      sunset: '19:00',
      periods: {
        'ночь': {
          temp_min: 10,
          temp_max: 12,
          feels_min: 9,
          feels_max: 11,
          precip_max: 10,
          precip_avg: 5,
          wind_avg: '2.5',
          description: 'Ясно 🌙'
        },
        'утро': {
          temp_min: 12,
          temp_max: 16,
          feels_min: 11,
          feels_max: 15,
          precip_max: 20,
          precip_avg: 10,
          wind_avg: '3.0',
          description: 'Переменная облачность ⛅'
        },
        'день': {
          temp_min: 18,
          temp_max: 22,
          feels_min: 17,
          feels_max: 21,
          precip_max: 15,
          precip_avg: 5,
          wind_avg: '3.5',
          description: 'Ясно ☀️'
        },
        'вечер': {
          temp_min: 14,
          temp_max: 18,
          feels_min: 13,
          feels_max: 17,
          precip_max: 30,
          precip_avg: 15,
          wind_avg: '2.8',
          description: 'Пасмурно ☁️'
        }
      },
      updated: new Date().toLocaleTimeString('ru-RU')
    };
  }
}

// Вспомогательная функция для описания погоды
function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно ☀️',
    1: 'В основном ясно 🌤️',
    2: 'Переменная облачность ⛅',
    3: 'Пасмурно ☁️',
    45: 'Туман 🌫️',
    48: 'Изморозь 🌫️',
    51: 'Лёгкая морось 🌧️',
    53: 'Морось 🌧️',
    61: 'Небольшой дождь 🌧️',
    63: 'Дождь 🌧️',
    65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️',
    73: 'Снег ❄️',
    75: 'Сильный снег ❄️',
    80: 'Ливень 🌧️',
    81: 'Сильный ливень 🌧️',
    82: 'Очень сильный ливень 🌧️',
    95: 'Гроза ⛈️',
    96: 'Гроза с градом ⛈️',
    99: 'Сильная гроза с градом ⛈️'
  };
  
  return weatherMap[code] || 'Облачно ⛅';
}

function getDetailedWeatherDescription(code, precipitationMm = 0) {
  if (code === undefined || code === null) {
    return 'Погодные данные';
  }
  
  const weatherMap = {
    0: 'Ясно ☀️', 
    1: 'В основном ясно 🌤️', 
    2: 'Переменная облачность ⛅',
    3: 'Пасмурно ☁️', 
    45: 'Туман 🌫️', 
    48: 'Изморозь 🌫️',
    51: 'Легкая морось 🌧️', 
    53: 'Морось 🌧️', 
    61: 'Небольшой дождь 🌧️',
    63: 'Дождь 🌧️', 
    65: 'Сильный дождь 🌧️', 
    71: 'Небольшой снег ❄️',
    73: 'Снег ❄️', 
    75: 'Сильный снег ❄️',
    80: 'Небольшой ливень 🌧️',
    81: 'Умеренный ливень 🌧️',
    82: 'Сильный ливень 🌧️',
    85: 'Небольшой снегопад ❄️',
    86: 'Сильный снегопад ❄️',
    95: 'Гроза ⛈️',
    96: 'Гроза с небольшим градом ⛈️',
    99: 'Гроза с сильным градом ⛈️'
  };
  
  let description = weatherMap[code] || `Код погоды: ${code}`;
  
  // Улучшенная логика с учетом осадков
  if (precipitationMm > 0) {
    if ([0, 1, 2, 3, 45, 48].includes(code)) {
      if (precipitationMm < 0.5) {
        description = `Пасмурно, возможны кратковременные осадки 🌦️`;
      } else if (precipitationMm < 2) {
        description = `Пасмурно, возможна слабая морось 🌦️ (${precipitationMm.toFixed(1)} мм)`;
      } else if (precipitationMm < 10) {
        description = `Пасмурно, возможен дождь 🌧️ (${precipitationMm.toFixed(1)} мм)`;
      } else {
        description = `Пасмурно, возможен сильный дождь 🌧️ (${precipitationMm.toFixed(1)} мм)`;
      }
    } else if ([51, 53, 61, 63, 65, 71, 73, 75, 80, 81, 82, 85, 86].includes(code)) {
      description += ` (${precipitationMm.toFixed(1)} мм)`;
    }
  } else if (precipitationMm === 0 && [3].includes(code)) {
    description = 'Пасмурно, без осадков ☁️';
  }
  
  return description;
}

// ===================== ФУНКЦИИ СТАТИСТИКИ И ТОПА =====================
async function getUserGameStats(userId) {
  try {
    console.log(`📊 Получение статистики для пользователя: ${userId}`);
    
    const stats = await fetchGameStats(userId, 'tetris');
    
    console.log(`📊 Статистика получена:`, stats);
    
    return stats;
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    return null;
  }
}

async function getGameStatsMessage(userId) {
  try {
    const stats = await getUserGameStats(userId);
    
    // Проверяем, есть ли вообще какие-то данные в stats
    if (!stats) {
      return `📊 *Статистика игры*\n\n` +
             `🎮 Данные не найдены или произошла ошибка.\n\n` +
             `Нажмите 🎮 ИГРАТЬ В ТЕТРИС чтобы начать!`;
    }
    
    // Проверяем, играл ли пользователь
    const hasPlayed = stats.games_played > 0;
    const hasScore = stats.best_score > 0;
    
    if (!hasPlayed && !hasScore) {
      return `📊 *Статистика игры*\n\n` +
             `🎮 Вы ещё не играли в тетрис!\n\n` +
             `Нажмите 🎮 ИГРАТЬ В ТЕТРИС чтобы начать!`;
    }
    
    // Форматируем дату последней игры
    let lastPlayedFormatted = 'ещё не играл';
    if (stats.last_played) {
      try {
        const lastPlayedDate = new Date(stats.last_played);
        if (!isNaN(lastPlayedDate.getTime())) {
          lastPlayedFormatted = lastPlayedDate.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      } catch (dateError) {
        console.error('❌ Ошибка форматирования даты:', dateError);
      }
    }
    
    // Собираем сообщение
    let message = `📊 *Ваша статистика в тетрисе*\n\n`;
    message += `🎮 Игр сыграно: *${stats.games_played || 0}*\n`;
    message += `🏆 Лучший счёт: *${stats.best_score || 0}*\n`;
    message += `📈 Лучший уровень: *${stats.best_level || 1}*\n`;
    message += `📊 Лучшие линии: *${stats.best_lines || 0}*\n`;
    
    if (stats.games_played > 0) {
      message += `📉 Средний счёт: *${Math.round(stats.avg_score || 0)}*\n`;
    }
    
    message += `⏰ Последняя игра: ${lastPlayedFormatted}\n\n`;
    
    // Проверяем, есть ли незавершенная игра
    if (stats.current_progress) {
      const progress = stats.current_progress;
      message += `🔄 *Незавершенная игра:*\n`;
      message += `• Текущий счёт: ${progress.score || 0}\n`;
      message += `• Текущий уровень: ${progress.level || 1}\n`;
      message += `• Текущие линии: ${progress.lines || 0}\n`;
      message += `• Сохранено: ${progress.last_saved ? new Date(progress.last_saved).toLocaleTimeString('ru-RU') : 'недавно'}\n\n`;
    }
    
    message += `💪 Продолжайте играть и улучшайте свои рекорды!`;
    
    return message;
  } catch (error) {
    console.error('❌ Ошибка формирования сообщения статистики:', error);
    
    return `❌ Не удалось получить статистику.\n\n` +
           `*Возможные причины:*\n` +
           `• Проблема с подключением к базе данных\n` +
           `• Вы ещё не играли в тетрис\n` +
           `• Технические работы\n\n` +
           `Попробуйте позже или начните новую игру!`;
  }
}

async function getTopPlayersList(limit = 10) {
  try {
    console.log(`🏆 Получение топа игроков, лимит: ${limit}`);
    
    const topPlayers = await fetchTopPlayers('tetris', limit);
    
    console.log(`🏆 Игроков в топе: ${topPlayers ? topPlayers.length : 0}`);
    
    return topPlayers || [];
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error);
    return [];
  }
}

async function getTopPlayersMessage(limit = 10, ctx = null) {
  try {
    const topPlayers = await getTopPlayersList(limit);
    
    // Если нет данных или пустой массив
    if (!topPlayers || topPlayers.length === 0) {
      return `🏆 *Топ игроков*\n\n` +
             `📊 Пока никто не играл в тетрис или данные временно недоступны!\n\n` +
             `🎮 *Будьте первым!*\n\n` +
             `Нажмите 🎮 ИГРАТЬ В ТЕТРИС чтобы начать и попасть в топ!`;
    }
    
    // Проверяем, есть ли реальные данные (не нулевые очки)
    const validPlayers = topPlayers.filter(player => 
      player && player.score !== undefined && player.score > 0
    );
    
    if (validPlayers.length === 0) {
      return `🏆 *Топ игроков*\n\n` +
             `📊 Пока нет игроков с результатами!\n\n` +
             `🎮 *Будьте первым!*\n\n` +
             `Нажмите 🎮 ИГРАТЬ В ТЕТРИС чтобы начать и попасть в топ!`;
    }
    
    let message = `🏆 *Топ ${Math.min(validPlayers.length, limit)} игроков в тетрисе*\n\n`;
    
    validPlayers.forEach((player, index) => {
      // Получаем медаль
      let medal;
      switch(index) {
        case 0: medal = '🥇'; break;
        case 1: medal = '🥈'; break;
        case 2: medal = '🥉'; break;
        default: medal = `${index + 1}.`;
      }
      
      const score = player.score || 0;
      const level = player.level || 1;
      const lines = player.lines || 0;
      const gamesPlayed = player.games_played || 1;
      
      // Форматируем имя пользователя
      let username;
      if (player.username && player.username !== `Игрок ${index + 1}`) {
        username = player.username;
      } else if (player.user_id) {
        username = `Игрок #${String(player.user_id).slice(-4)}`;
      } else {
        username = `Игрок ${index + 1}`;
      }
      
      message += `${medal} *${username}*\n`;
      message += `   🎯 Очки: *${score}*\n`;
      message += `   📊 Уровень: ${level} | 📈 Линии: ${lines}\n`;
      message += `   🕹️ Игр: ${gamesPlayed}\n\n`;
    });
    
    // Добавляем информацию о текущем пользователе
    if (ctx && ctx.from) {
      const currentUserId = ctx.from.id;
      const currentPlayerIndex = validPlayers.findIndex(p => p.user_id === currentUserId);
      
      if (currentPlayerIndex !== -1) {
        const currentPlayer = validPlayers[currentPlayerIndex];
        message += `👤 *Ваше место:* ${currentPlayerIndex + 1}\n`;
        message += `🎯 *Ваш лучший счёт:* ${currentPlayer.score}\n\n`;
      } else {
        message += `👤 *Вы пока не в топе*\n`;
        message += `🎯 Играйте больше, чтобы попасть в рейтинг!\n\n`;
      }
    }
    
    message += `🎯 *Как попасть в топ?*\n`;
    message += `• Играйте в тетрис 🎮\n`;
    message += `• Набирайте очки и сохраняйте результаты\n`;
    message += `• Улучшайте свои рекорды!\n\n`;
    
    message += `🔄 Обновляется автоматически после каждой игры`;
    
    return message;
  } catch (error) {
    console.error('❌ Ошибка формирования сообщения топа:', error);
    
    return `❌ Не удалось загрузить топ игроков.\n\n` +
           `*Возможные причины:*\n` +
           `• Проблема с подключением к базе данных\n` +
           `• Технические работы\n` +
           `• Топ игроков пока пуст\n\n` +
           `Попробуйте позже или станьте первым игроком!`;
  }
}

// ===================== ОДЕЖДА И СОВЕТЫ =====================
function getWardrobeAdvice(weatherData) {
  const { temp, description, wind, precipitation } = weatherData;
  let advice = [];

  // Основные рекомендации по температуре
  if (temp >= 25) {
    advice.push('• 👕 *Базовый слой:* майка, футболка из хлопка или льна');
    advice.push('• 👖 *Верх:* шорты, легкие брюки из льна, юбка');
  } else if (temp >= 18) {
    advice.push('• 👕 *Базовый слой:* футболка или тонкая рубашка');
    advice.push('• 🧥 *Верх:* джинсы, брюки, легкая куртка на вечер');
  } else if (temp >= 10) {
    advice.push('• 👕 *Базовый слой:* лонгслив, тонкое термобелье');
    advice.push('• 🧥 *Верх:* свитер, толстовка, ветровка');
  } else if (temp >= 0) {
    advice.push('• 👕 *Базовый слой:* теплое термобелье или флис');
    advice.push('• 🧥 *Верх:* утепленный свитер, зимняя куртка');
  } else {
    advice.push('• 👕 *Базовый слой:* плотное термобелье, флис');
    advice.push('• 🧥 *Верх:* пуховик, утепленные штаны');
  }

  // Дополнительные рекомендации
  if (description.toLowerCase().includes('дождь') || description.includes('🌧️')) {
    advice.push('• ☔ *При дожде:* дождевик, зонт, непромокаемая обувь');
  }
  if (description.toLowerCase().includes('снег') || description.includes('❄️')) {
    advice.push('• ❄️ *При снеге:* непромокаемая обувь, варежки');
  }
  if (parseFloat(wind) > 7) {
    advice.push('• 💨 *При ветре:* ветровка с капюшоном, шарф');
  }
  if (description.includes('☀️') || description.includes('ясно')) {
    advice.push('• 🕶️ *При солнце:* солнцезащитные очки, головной убор');
  }

  // Общие советы
  if (temp < 15) {
    advice.push('• 🧣 *Аксессуары:* шапка, шарф, перчатки');
  }
  if (temp > 20 && description.includes('☀️')) {
    advice.push('• 🧴 *Защита:* солнцезащитный крем SPF 30+');
  }

  advice.push('\n👟 *Обувь:* выбирайте по погоде');
  advice.push('🎒 *С собой:* сумка для снятых слоев одежды');

  return advice.join('\n');
}

// ===================== ФРАЗЫ ДНЯ =====================
const dailyPhrases = [
    // ===================== ПУТЕШЕСТВИЯ И ТРАНСПОРТ (30 фраз) =====================
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

    // ===================== ЕДА И РЕСТОРАНЫ (25 фраз) =====================
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

    // ===================== ПОКУПКИ И ШОППИНГ (20 фраз) =====================
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

    // ===================== ЗДОРОВЬЕ И МЕДИЦИНА (15 фраз) =====================
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
    },

    // ===================== РАБОЧИЕ И ДЕЛОВЫЕ СИТУАЦИИ (15 фраз) =====================
    {
        english: "Could I speak to the manager?",
        russian: "Могу я поговорить с менеджером?",
        explanation: "Просьба в бизнес-ситуации",
        category: "Бизнес",
        level: "Средний"
    },
    {
        english: "Let's schedule a meeting",
        russian: "Давайте назначим встречу",
        explanation: "Деловая фраза",
        category: "Бизнес",
        level: "Средний"
    },
    {
        english: "Could you send me an email with details?",
        russian: "Не могли бы вы отправить мне детали по email?",
        explanation: "Профессиональная просьба",
        category: "Бизнес",
        level: "Средний"
    },
    {
        english: "I'll get back to you on that",
        russian: "Я вернусь к вам по этому вопросу",
        explanation: "Деловой ответ",
        category: "Бизнес",
        level: "Средний"
    },
    {
        english: "What's your deadline?",
        russian: "Каков ваш дедлайн?",
        explanation: "Вопрос о сроках",
        category: "Бизнес",
        level: "Средний"
    },
    {
        english: "Let me think it over",
        russian: "Дайте мне подумать",
        explanation: "Взятие паузы в переговорах",
        category: "Бизнес",
        level: "Средний"
    },
    {
        english: "That's a reasonable offer",
        russian: "Это разумное предложение",
        explanation: "Положительный ответ",
        category: "Бизнес",
        level: "Средний"
    },
    {
        english: "I need it by Friday",
        russian: "Мне нужно это к пятнице",
        explanation: "Указание сроков",
        category: "Бизнес",
        level: "Начальный"
    },
    {
        english: "Could you clarify that point?",
        russian: "Не могли бы вы уточнить этот момент?",
        explanation: "Просьба о разъяснении",
        category: "Бизнес",
        level: "Средний"
    },
    {
        english: "Let's touch base next week",
        russian: "Давайте свяжемся на следующей неделе",
        explanation: "Деловая идиома",
        category: "Бизнес",
        level: "Продвинутый"
    },

    // ===================== СОЦИАЛЬНОЕ ОБЩЕНИЕ (25 фраз) =====================
    {
        english: "Nice to meet you!",
        russian: "Приятно познакомиться!",
        explanation: "Стандартное приветствие при знакомстве",
        category: "Общение",
        level: "Начальный"
    },
    {
        english: "What do you do for a living?",
        russian: "Чем вы занимаетесь?",
        explanation: "Вопрос о профессии",
        category: "Общение",
        level: "Начальный"
    },
    {
        english: "How was your day?",
        russian: "Как прошел твой день?",
        explanation: "Дружеский вопрос",
        category: "Общение",
        level: "Начальный"
    },
    {
        english: "Could you give me a hand?",
        russian: "Не мог бы ты мне помочь?",
        explanation: "Просьба о помощи",
        category: "Общение",
        level: "Начальный"
    },
    {
        english: "I'm really sorry about that",
        russian: "Мне очень жаль",
        explanation: "Извинение",
        category: "Общение",
        level: "Начальный"
    },
    {
        english: "What are your plans for the weekend?",
        russian: "Какие у тебя планы на выходные?",
        explanation: "Социальный вопрос",
        category: "Общение",
        level: "Начальный"
    },
    {
        english: "Let's keep in touch",
        russian: "Давайте оставаться на связи",
        explanation: "Прощание с намерением общаться",
        category: "Общение",
        level: "Средний"
    },
    {
        english: "I couldn't agree more",
        russian: "Не могу не согласиться",
        explanation: "Полное согласие",
        category: "Общение",
        level: "Средний"
    },
    {
        english: "That's beside the point",
        russian: "Это не относится к делу",
        explanation: "Возражение в дискуссии",
        category: "Общение",
        level: "Средний"
    },
    {
        english: "Let's agree to disagree",
        russian: "Давайте останемся при своем мнении",
        explanation: "Цивилизованное окончание спора",
        category: "Общение",
        level: "Продвинутый"
    },

    // ===================== АНГЛИЙСКИЕ ИДИОМЫ И ВЫРАЖЕНИЯ (20 фраз) =====================
    {
        english: "It's raining cats and dogs",
        russian: "Льёт как из ведра",
        explanation: "Сильный дождь",
        category: "Идиомы",
        level: "Средний"
    },
    {
        english: "Break the ice",
        russian: "Растопить лёд",
        explanation: "Начать общение в неловкой ситуации",
        category: "Идиомы",
        level: "Средний"
    },
    {
        english: "Bite the bullet",
        russian: "Стиснуть зубы",
        explanation: "Решиться на что-то неприятное",
        category: "Идиомы",
        level: "Средний"
    },
    {
        english: "Once in a blue moon",
        russian: "Раз в сто лет",
        explanation: "Очень редко",
        category: "Идиомы",
        level: "Средний"
    },
    {
        english: "The ball is in your court",
        russian: "Теперь твой ход",
        explanation: "Теперь ваша очередь решать",
        category: "Идиомы",
        level: "Средний"
    },
    {
        english: "Spill the beans",
        russian: "Выложить всё",
        explanation: "Раскрыть секрет",
        category: "Идиомы",
        level: "Средний"
    },
    {
        english: "Costs an arm and a leg",
        russian: "Стоит целое состояние",
        explanation: "Очень дорого",
        category: "Идиомы",
        level: "Средний"
    },
    {
        english: "Hit the nail on the head",
        russian: "Попасть в самую точку",
        explanation: "Точно угадать",
        category: "Идиомы",
        level: "Средний"
    },
    {
        english: "Let the cat out of the bag",
        russian: "Выпустить кота из мешка",
        explanation: "Выдать секрет",
        category: "Идиомы",
        level: "Средний"
    },
    {
        english: "A piece of cake",
        russian: "Проще простого",
        explanation: "Очень легко",
        category: "Идиомы",
        level: "Начальный"
    },

    // ===================== ЭКСТРЕННЫЕ СИТУАЦИИ (10 фраз) =====================
    {
        english: "Help!",
        russian: "Помогите!",
        explanation: "Критическая ситуация",
        category: "Экстренно",
        level: "Начальный"
    },
    {
        english: "Call the police!",
        russian: "Вызовите полицию!",
        explanation: "Экстренный вызов",
        category: "Экстренно",
        level: "Начальный"
    },
    {
        english: "I'm lost",
        russian: "Я заблудился",
        explanation: "Ситуация потерявшегося",
        category: "Экстренно",
        level: "Начальный"
    },
    {
        english: "My wallet was stolen",
        russian: "У меня украли кошелек",
        explanation: "Сообщение о краже",
        category: "Экстренно",
        level: "Средний"
    },
    {
        english: "There's been an accident",
        russian: "Произошел несчастный случай",
        explanation: "Сообщение о аварии",
        category: "Экстренно",
        level: "Средний"
    },
    {
        english: "I need a translator",
        russian: "Мне нужен переводчик",
        explanation: "Просьба в сложной ситуации",
        category: "Экстренно",
        level: "Начальный"
    },
    {
        english: "Where is the embassy?",
        russian: "Где посольство?",
        explanation: "Важный вопрос за границей",
        category: "Экстренно",
        level: "Средний"
    },
    {
        english: "I've lost my passport",
        russian: "Я потерял паспорт",
        explanation: "Серьезная проблема",
        category: "Экстренно",
        level: "Средний"
    },
    {
        english: "Is it safe here?",
        russian: "Здесь безопасно?",
        explanation: "Вопрос о безопасности",
        category: "Экстренно",
        level: "Начальный"
    },
    {
        english: "I need to contact my family",
        russian: "Мне нужно связаться с семьей",
        explanation: "Важная просьба",
        category: "Экстренно",
        level: "Средний"
    },

    // ===================== ПОГОДА И ПРИРОДА (10 фраз) =====================
    {
        english: "What's the weather like today?",
        russian: "Какая сегодня погода?",
        explanation: "Стандартный вопрос о погоде",
        category: "Погода",
        level: "Начальный"
    },
    {
        english: "It's freezing outside",
        russian: "На улице мороз",
        explanation: "Описание холодной погоды",
        category: "Погода",
        level: "Начальный"
    },
    {
        english: "What a beautiful day!",
        russian: "Какой прекрасный день!",
        explanation: "Комментарий о хорошей погоде",
        category: "Погода",
        level: "Начальный"
    },
    {
        english: "It looks like rain",
        russian: "Похоже на дождь",
        explanation: "Прогноз погоды",
        category: "Погода",
        level: "Начальный"
    },
    {
        english: "The sun is shining brightly",
        russian: "Солнце светит ярко",
        explanation: "Описание солнечного дня",
        category: "Погода",
        level: "Начальный"
    },
    {
        english: "There's a strong wind",
        russian: "Сильный ветер",
        explanation: "Описание ветреной погоды",
        category: "Погода",
        level: "Начальный"
    },
    {
        english: "It's humid today",
        russian: "Сегодня влажно",
        explanation: "Описание влажности",
        category: "Погода",
        level: "Средний"
    },
    {
        english: "The temperature is dropping",
        russian: "Температура падает",
        explanation: "Описание похолодания",
        category: "Погода",
        level: "Средний"
    },
    {
        english: "There's a thunderstorm coming",
        russian: "Надвигается гроза",
        explanation: "Прогноз непогоды",
        category: "Погода",
        level: "Средний"
    },
    {
        english: "The sky is clear",
        russian: "Небо ясное",
        explanation: "Описание хорошей погоды",
        category: "Погода",
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

// ===================== ПОГОДА СЕЙЧАС =====================
bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`🌤️ ПОГОДА от ${userId}`);
  
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
    
    await ctx.reply(
      `🌤️ *Погода в ${weather.city}*\n` +
      `🕒 Обновлено: ${weather.timestamp}\n\n` +
      `🌡️ Температура: *${weather.temp}°C*\n` +
      `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
      `💨 Ветер: ${weather.wind} м/с\n` +
      `💧 Влажность: ${weather.humidity}%\n` +
      `📝 ${weather.description}\n` +
      `🌧️ Осадки: ${weather.precipitation}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА:', error);
    await ctx.reply('❌ Не удалось получить данные о погоде или обработать ваш запрос.', { reply_markup: mainMenuKeyboard });
  }
});

// ===================== ПОГОДА ЗАВТРА =====================
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
    
    await ctx.reply(`⏳ Запрашиваю прогноз на завтра для ${city}...`, { parse_mode: 'Markdown' });
    
    const forecast = await getWeatherForecast(city);
    
    // Форматируем дату
    const forecastDate = new Date(forecast.date);
    const dateFormatted = forecastDate.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    
    // Собираем сообщение
    let message = `📅 *Прогноз погоды на ${dateFormatted}*\n`;
    message += `📍 *${forecast.city}*\n`;
    message += `🕒 Обновлено: ${forecast.updated}\n\n`;
    
    // Общая информация
    message += `📊 *Общий прогноз:*\n`;
    message += `🌡️ Температура: *${forecast.temp_min}°C ... ${forecast.temp_max}°C*\n`;
    message += `💨 Макс. ветер: ${forecast.wind_max} м/с\n`;
    message += `🌧️ Осадки: ${forecast.precipitation > 0 ? forecast.precipitation.toFixed(1) + ' мм' : 'Нет'}\n`;
    message += `🌅 Восход: ${forecast.sunrise}\n`;
    message += `🌇 Закат: ${forecast.sunset}\n\n`;
    
    // Детали по времени суток
    message += `⏰ *Подробный прогноз по времени суток:*\n\n`;
    
    const periodsOrder = ['ночь', 'утро', 'день', 'вечер'];
    
    for (const period of periodsOrder) {
      if (forecast.periods[period]) {
        const data = forecast.periods[period];
        const precipText = data.precip_avg > 0 ? `💧 ${data.precip_avg}%` : 'Без осадков';
        
        message += `*${period.charAt(0).toUpperCase() + period.slice(1)}* (${data.temp_min}°C...${data.temp_max}°C)\n`;
        message += `${data.description}\n`;
        message += `🤔 Ощущается: ${data.feels_min}°C...${data.feels_max}°C\n`;
        message += `💨 Ветер: ${data.wind_avg} м/с | ${precipText}\n\n`;
      }
    }
    
    message += `📝 *Рекомендации:*\n`;
    
    // Добавляем рекомендации
    if (forecast.temp_max >= 25) {
      message += `• 🥵 Жарко: легкая одежда, головной убор\n`;
    } else if (forecast.temp_max >= 18) {
      message += `• 😊 Комфортно: легкая куртка на вечер\n`;
    } else if (forecast.temp_max >= 10) {
      message += `• 🧥 Прохладно: теплая одежда, ветровка\n`;
    } else {
      message += `• ❄️ Холодно: зимняя куртка, шапка, шарф\n`;
    }
    
    // Проверяем осадки
    if (forecast.precipitation > 5) {
      message += `• ☔ Возьмите зонт или дождевик\n`;
    }
    
    // Проверяем ветер
    if (parseFloat(forecast.wind_max) > 10) {
      message += `• 💨 Сильный ветер: ветровка с капюшоном\n`;
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
    await ctx.reply('❌ Произошла ошибка при загрузке статистики. Попробуйте позже.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.hears('🏆 ТОП ИГРОКОВ', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`🏆 ТОП ИГРОКОВ от ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('🏆 Загружаю топ игроков...', { parse_mode: 'Markdown' });
    
    const topMessage = await getTopPlayersMessage(10, ctx);
    await ctx.reply(topMessage, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
  } catch (error) {
    console.error('❌ Ошибка в ТОП ИГРОКОВ:', error);
    await ctx.reply('❌ Произошла ошибка при загрузке топа игроков. Попробуйте позже.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

// ===================== ИГРАТЬ В ТЕТРИС =====================
bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  console.log(`🎮 ИГРАТЬ В ТЕТРИС от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    // URL вашего мини-приложения с тетрисом
    const webAppUrl = 'https://pogodasovet1.vercel.app';
    
    await ctx.reply(
      `🎮 *Тетрис*\n\n` +
      `Нажмите кнопку ниже, чтобы открыть игру в мини-приложении!\n\n` +
      `📊 *Ваша статистика будет автоматически сохраняться.*\n` +
      `🏆 *Соревнуйтесь с другими игроками в топе!*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{
              text: '🎮 Открыть тетрис',
              web_app: { url: webAppUrl }
            }],
            [{
              text: '📊 Моя статистика',
              callback_data: 'my_stats'
            }],
            [{
              text: '🏆 Топ игроков',
              callback_data: 'top_players'
            }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('❌ Ошибка в ИГРАТЬ В ТЕТРИС:', error);
    await ctx.reply('❌ Не удалось открыть игру. Попробуйте позже.', {
      reply_markup: mainMenuKeyboard
    });
  }
});

// Обработчик callback для кнопок
bot.callbackQuery('my_stats', async (ctx) => {
  try {
    const statsMessage = await getGameStatsMessage(ctx.from.id);
    await ctx.editMessageText(statsMessage, { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('❌ Ошибка в callback my_stats:', error);
    await ctx.answerCallbackQuery('❌ Ошибка загрузки статистики');
  }
});

bot.callbackQuery('top_players', async (ctx) => {
  try {
    const topMessage = await getTopPlayersMessage(10, ctx);
    await ctx.editMessageText(topMessage, { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('❌ Ошибка в callback top_players:', error);
    await ctx.answerCallbackQuery('❌ Ошибка загрузки топа');
  }
});

// ===================== ОБРАБОТЧИК ДАННЫХ ИЗ ИГРЫ =====================
bot.filter(ctx => ctx.message?.web_app_data?.data, async (ctx) => {
  const userId = ctx.from.id;
  const userName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || `Игрок ${userId}`;
  
  console.log(`📱 Получены данные от Mini App от пользователя ${userId} (${userName})`);
  
  try {
    const webAppData = ctx.message.web_app_data;
    console.log(`📱 Raw data:`, webAppData.data);
    
    const data = JSON.parse(webAppData.data);
    console.log('🎮 Данные игры:', data);
    
    if (data.action === 'tetris_score' || data.gameType === 'tetris') {
      console.log(`🎮 Счёт тетриса от ${userId}:`, data);
      
      const score = parseInt(data.score) || 0;
      const level = parseInt(data.level) || 1;
      const lines = parseInt(data.lines) || 0;
      const gameOver = Boolean(data.gameOver);
      
      if (score === 0) {
        console.log(`⚠️ Нулевой счёт от ${userId}, пропускаем сохранение`);
        await ctx.reply(`🎮 Игра начата! Удачи! 🍀`, {
          parse_mode: 'Markdown',
          reply_markup: mainMenuKeyboard
        });
        return;
      }
      
      // Сохраняем результат в базу данных
      try {
        const saved = await saveGameScore(userId, 'tetris', score, level, lines);
        
        if (saved) {
          console.log(`✅ Рекорд пользователя ${userId} сохранён в БД`);
          
          // Получаем обновленную статистику
          const stats = await getUserGameStats(userId);
          const bestScore = stats?.best_score || 0;
          
          let message = '';
          if (gameOver) {
            message = `🎮 *Игра окончена!*\n\n`;
          } else {
            message = `🎮 *Прогресс сохранён!*\n\n`;
          }
          
          message += `👤 *Игрок:* ${userName}\n`;
          message += `🎯 *Результат:* ${score} очков\n`;
          message += `📊 *Уровень:* ${level}\n`;
          message += `📈 *Линии:* ${lines}\n\n`;
          
          // Проверяем, побит ли рекорд
          if (score > bestScore) {
            message += `🎉 *НОВЫЙ РЕКОРД!* 🎉\n`;
            message += `🏆 Предыдущий лучший: ${bestScore}\n\n`;
          } else if (bestScore > 0) {
            message += `🏆 *Ваш лучший результат:* ${bestScore}\n\n`;
          }
          
          message += `📊 *Теперь вы можете:*\n`;
          message += `• Посмотреть свою статистику 📊\n`;
          message += `• Проверить место в топе 🏆\n`;
          message += `• Продолжить играть 🎮\n\n`;
          
          if (gameOver) {
            message += `🔄 Нажмите "🎮 ИГРАТЬ В ТЕТРИС" для новой игры!`;
          } else {
            message += `💪 Продолжайте в том же духе!`;
          }
          
          await ctx.reply(message, { 
            parse_mode: 'Markdown',
            reply_markup: mainMenuKeyboard 
          });
          
        } else {
          console.error(`❌ Не удалось сохранить результат для пользователя ${userId}`);
          await ctx.reply(`❌ Не удалось сохранить ваш результат в базу данных. Попробуйте ещё раз.`, {
            reply_markup: mainMenuKeyboard
          });
        }
      } catch (dbError) {
        console.error('❌ Ошибка сохранения в БД:', dbError);
        await ctx.reply(`❌ Ошибка базы данных. Ваш результат не сохранён. Попробуйте позже.`, {
          reply_markup: mainMenuKeyboard
        });
      }
    } else {
      console.log(`📱 Неизвестный тип данных:`, data.action || data.gameType);
      await ctx.reply(`Получены игровые данные: ${JSON.stringify(data, null, 2)}`, {
        reply_markup: mainMenuKeyboard
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка обработки данных игры:', error);
    console.error('❌ Stack trace:', error.stack);
    
    await ctx.reply(`❌ Произошла ошибка при обработке данных игры. Попробуйте ещё раз.`, {
      reply_markup: mainMenuKeyboard
    });
  }
});

// ===================== ЧТО НАДЕТЬ =====================
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
      `👕 *Что надеть в ${weather.city}?*\n\n${advice}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в ЧТО НАДЕТЬ:', error);
    await ctx.reply('❌ Не удалось получить рекомендацию.', { reply_markup: mainMenuKeyboard });
  }
});

// ===================== ФРАЗА ДНЯ =====================
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
      `📚 ${phrase.explanation}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в ФРАЗА ДНЯ:', error);
    await ctx.reply('❌ Не удалось получить фразу дня.', { reply_markup: mainMenuKeyboard });
  }
});

// ===================== СЛУЧАЙНАЯ ФРАЗА =====================
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
      `/tetris - Играть в тетрис\n` +
      `/stats - Ваша статистика в игре\n` +
      `/top - Топ игроков\n` +
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
      `• 🌤️ ПОГОДА СЕЙЧАС - текущая погода\n` +
      `• 📅 ПОГОДА ЗАВТРА - подробный прогноз на завтра (утро/день/вечер/ночь)\n` +
      `• 👕 ЧТО НАДЕТЬ? - рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная английская фраза\n` +
      `• 🎮 ИГРАТЬ В ТЕТРИС - игра в мини-приложении\n` +
      `• 📊 МОЯ СТАТИСТИКА - ваша статистика в игре\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n` +
      `• 📋 ПОКАЗАТЬ КОМАНДЫ - убрать кнопки и использовать команды\n\n` +
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
    
    await ctx.reply(
      `🌤️ *Погода в ${weather.city}*\n` +
      `🕒 Обновлено: ${weather.timestamp}\n\n` +
      `🌡️ Температура: *${weather.temp}°C*\n` +
      `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
      `💨 Ветер: ${weather.wind} м/с\n` +
      `💧 Влажность: ${weather.humidity}%\n` +
      `📝 ${weather.description}\n` +
      `🌧️ Осадки: ${weather.precipitation}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
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
    
    await ctx.reply(`⏳ Запрашиваю прогноз на завтра для ${city}...`, { parse_mode: 'Markdown' });
    
    const forecast = await getWeatherForecast(city);
    
    // Форматируем дату
    const forecastDate = new Date(forecast.date);
    const dateFormatted = forecastDate.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    
    // Собираем сообщение
    let message = `📅 *Прогноз погоды на ${dateFormatted}*\n`;
    message += `📍 *${forecast.city}*\n`;
    message += `🕒 Обновлено: ${forecast.updated}\n\n`;
    
    // Общая информация
    message += `📊 *Общий прогноз:*\n`;
    message += `🌡️ Температура: *${forecast.temp_min}°C ... ${forecast.temp_max}°C*\n`;
    message += `💨 Макс. ветер: ${forecast.wind_max} м/с\n`;
    message += `🌧️ Осадки: ${forecast.precipitation > 0 ? forecast.precipitation.toFixed(1) + ' мм' : 'Нет'}\n`;
    message += `🌅 Восход: ${forecast.sunrise}\n`;
    message += `🌇 Закат: ${forecast.sunset}\n\n`;
    
    // Детали по времени суток
    message += `⏰ *Подробный прогноз по времени суток:*\n\n`;
    
    const periodsOrder = ['ночь', 'утро', 'день', 'вечер'];
    
    for (const period of periodsOrder) {
      if (forecast.periods[period]) {
        const data = forecast.periods[period];
        const precipText = data.precip_avg > 0 ? `💧 ${data.precip_avg}%` : 'Без осадков';
        
        message += `*${period.charAt(0).toUpperCase() + period.slice(1)}* (${data.temp_min}°C...${data.temp_max}°C)\n`;
        message += `${data.description}\n`;
        message += `🤔 Ощущается: ${data.feels_min}°C...${data.feels_max}°C\n`;
        message += `💨 Ветер: ${data.wind_avg} м/с | ${precipText}\n\n`;
      }
    }
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в /forecast:', error);
    await ctx.reply('❌ Не удалось получить прогноз погоды. Попробуйте позже.', { 
      reply_markup: mainMenuKeyboard 
    });
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
    
    await ctx.reply(`👗 Анализирую погоду для ${city}...`, { parse_mode: 'Markdown' });
    
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

bot.command('tetris', async (ctx) => {
  console.log(`🎮 /tetris от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    // URL вашего мини-приложения с тетрисом
    const webAppUrl = 'https://pogodasovet1.vercel.app';
    await ctx.reply(
      `🎮 *Тетрис*\n\n` +
      `Нажмите кнопку ниже, чтобы открыть игру в мини-приложении!\n\n` +
      `📊 *Ваша статистика будет автоматически сохраняться.*\n` +
      `🏆 *Соревнуйтесь с другими игроками в топе!*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{
              text: '🎮 Открыть тетрис',
              web_app: { url: webAppUrl }
            }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('❌ Ошибка в /tetris:', error);
    await ctx.reply('❌ Не удалось открыть игру. Попробуйте позже.', {
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
    await ctx.reply('⏳ Загружаю вашу статистику...', { parse_mode: 'Markdown' });
    
    const statsMessage = await getGameStatsMessage(userId);
    await ctx.reply(statsMessage, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
  } catch (error) {
    console.error('❌ Ошибка в /stats:', error);
    await ctx.reply('❌ Не удалось загрузить вашу статистику.', { 
      reply_markup: mainMenuKeyboard 
    });
  }
});

bot.command('top', async (ctx) => {
  console.log(`🏆 /top от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await ctx.reply('🏆 Загружаю топ игроков...', { parse_mode: 'Markdown' });
    
    const topMessage = await getTopPlayersMessage(10, ctx);
    await ctx.reply(topMessage, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
  } catch (error) {
    console.error('❌ Ошибка в /top:', error);
    await ctx.reply('❌ Не удалось загрузить топ игроков.', { 
      reply_markup: mainMenuKeyboard 
    });
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
      `• 🌤️ ПОГОДА СЕЙЧАС - текущая погода\n` +
      `• 📅 ПОГОДА ЗАВТРА - подробный прогноз на завтра (утро/день/вечер/ночь)\n` +
      `• 👕 ЧТО НАДЕТЬ? - рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная английская фраза\n` +
      `• 🎮 ИГРАТЬ В ТЕТРИС - игра в мини-приложении\n` +
      `• 📊 МОЯ СТАТИСТИКА - ваша статистика в игре\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n` +
      `• 📋 ПОКАЗАТЬ КОМАНДЫ - убрать кнопки и использовать команды\n\n` +
      `*Текстовые команды (доступны после нажатия "📋 ПОКАЗАТЬ КОМАНДЫ"):*\n` +
      `/start - начать работу с ботом\n` +
      `/weather - текущая погода\n` +
      `/forecast - подробный прогноз на завтра\n` +
      `/wardrobe - что надеть?\n` +
      `/phrase - фраза дня\n` +
      `/random - случайная фраза\n` +
      `/tetris - играть в тетрис\n` +
      `/stats - ваша статистика в игре\n` +
      `/top - топ игроков\n` +
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
       '💬 ФРАЗА ДНЯ', '🎲 СЛУЧАЙНАЯ ФРАЗА', '🎮 ИГРАТЬ В ТЕТРИС', '📊 МОЯ СТАТИСТИКА', 
       '🏆 ТОП ИГРОКОВ', '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '📋 ПОКАЗАТЬ КОМАНДЫ', 
       '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
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
          `✅ *Город "${city}" сохранён!*`,
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
          'Погода сейчас',
          'Подробный прогноз на завтра',
          'Рекомендации по одежде',
          'Английские фразы',
          'Тетрис со статистикой',
          'Топ игроков'
        ]
      });
    }
    
    if (req.method === 'POST') {
      
      console.log('📦 Получен update от Telegram');
      
      try {
        const update = req.body;
        await bot.handleUpdate(update);
        console.log('✅ Update успешно обработан');
        
        return res.status(200).json({ ok: true });
      } catch (error) {
        console.error('❌ Ошибка обработки update:', error);
        return res.status(200).json({ ok: false, error: 'Update processing failed' });
      }
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('🔥 Критическая ошибка в handler:', error);
    return res.status(200).json({ 
      ok: false, 
      error: 'Internal server error'
    });
  }
}

// Экспортируем бота для тестов
export { bot };
console.log('⚡ Бот загружен с полноценной системой прогноза погоды и статистикой игр!');
