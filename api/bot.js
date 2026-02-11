import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
  saveGameScore,
  getGameStats as fetchGameStats,
  getTopPlayers as fetchTopPlayers,
  saveGameProgress,
  getGameProgress,
  deleteGameProgress,
  checkDatabaseConnection,
  debugDatabase,
  pool,
  saveOrUpdateUser,
  getUserProfile,
  getGameStats
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '..', '.env.local');
console.log('🔧 Загружаю переменные окружения из:', envPath);

dotenv.config();
dotenv.config({ path: envPath });

console.log('✅ Переменные окружения загружены');
console.log('🔑 BOT_TOKEN найден?', !!process.env.BOT_TOKEN);
console.log('🗄️ DATABASE_URL найден?', !!process.env.DATABASE_URL);

// ===================== КОНФИГУРАЦИЯ =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: BOT_TOKEN не найден!');
  throw new Error('BOT_TOKEN is required');
}

console.log('🤖 Создаю бота...');
const bot = new Bot(BOT_TOKEN);

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
  try {
    if (!cityName) {
      return { success: false, error: 'Город не указан', city: 'Неизвестно' };
    }
    
    if (typeof cityName !== 'string') {
      cityName = String(cityName);
    }
    
    const cacheKey = `current_${cityName.toLowerCase()}`;
    const now = Date.now();
    
    if (!forceRefresh && weatherCache.has(cacheKey)) {
      const cached = weatherCache.get(cacheKey);
      if (now - cached.timestamp < 600000) {
        return cached.data;
      }
    }
    
    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    
    if (!geoData.results || geoData.results.length === 0) {
      throw new Error('Город не найден');
    }
    
    const { latitude, longitude, name } = geoData.results[0];
    
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=precipitation_sum&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    if (!weatherData.current) {
      throw new Error('Нет данных о погоде');
    }
    
    const current = weatherData.current;
    const todayPrecipitation = weatherData.daily?.precipitation_sum[0] || 0;
    
    const weatherResult = {
      success: true,
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
    
    weatherCache.set(cacheKey, { data: weatherResult, timestamp: now });
    return weatherResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения погоды:', error.message);
    if (weatherCache.has(cityName?.toLowerCase())) {
      return weatherCache.get(cityName.toLowerCase()).data;
    }
    return {
      success: false,
      error: `Не удалось получить погоду: ${error.message}`,
      city: typeof cityName === 'string' ? cityName : String(cityName)
    };
  }
}

async function getWeatherForecast(cityName) {
  try {
    if (!cityName) {
      return { success: false, error: 'Город не указан', city: 'Неизвестно' };
    }
    
    if (typeof cityName !== 'string') {
      cityName = String(cityName);
    }
    
    const cacheKey = `forecast_${cityName.toLowerCase()}`;
    const now = Date.now();
    
    if (weatherCache.has(cacheKey)) {
      const cached = weatherCache.get(cacheKey);
      if (now - cached.timestamp < 1800000) {
        return cached.data;
      }
    }
    
    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    
    if (!geoData.results || geoData.results.length === 0) {
      throw new Error('Город не найден');
    }
    
    const { latitude, longitude, name } = geoData.results[0];
    
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,wind_speed_10m_max&wind_speed_unit=ms&timezone=auto&forecast_days=2`;
    
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();
    
    if (!forecastData.hourly || !forecastData.daily) {
      throw new Error('Нет данных прогноза');
    }
    
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowDateStr = tomorrowDate.toISOString().split('T')[0];
    
    const tomorrowIndexes = [];
    forecastData.hourly.time.forEach((time, index) => {
      if (time.startsWith(tomorrowDateStr)) {
        tomorrowIndexes.push(index);
      }
    });
    
    if (tomorrowIndexes.length === 0) {
      throw new Error('Нет данных на завтра');
    }
    
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
    
    const tomorrowDailyIndex = 1;
    
    const forecastResult = {
      success: true,
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
    
    weatherCache.set(cacheKey, { data: forecastResult, timestamp: now });
    return forecastResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения прогноза:', error.message);
    if (weatherCache.has(cityName?.toLowerCase())) {
      return weatherCache.get(cityName.toLowerCase()).data;
    }
    return {
      success: false,
      error: `Не удалось получить прогноз: ${error.message}`,
      city: typeof cityName === 'string' ? cityName : String(cityName)
    };
  }
}

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
    95: 'Гроза ⛈️',
    96: 'Гроза с небольшим градом ⛈️',
    99: 'Гроза с сильным градом ⛈️'
  };
  
  let description = weatherMap[code] || `Код погоды: ${code}`;
  
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
    } else {
      description += ` (${precipitationMm.toFixed(1)} мм)`;
    }
  } else if (precipitationMm === 0 && [3].includes(code)) {
    description = 'Пасмурно, без осадков ☁️';
  }
  
  return description;
}

// ===================== ФУНКЦИИ ОДЕЖДЫ =====================
function getWardrobeAdvice(weatherData) {
  if (!weatherData || !weatherData.success) {
    return '❌ Нет данных о погоде для рекомендаций по одежде.';
  }
  
  const { temp, description, wind, precipitation } = weatherData;
  let advice = [];

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

  if (description && (description.toLowerCase().includes('дождь') || description.includes('🌧️'))) {
    advice.push('• ☔ *При дожде:* дождевик, зонт, непромокаемая обувь');
  }
  if (description && (description.toLowerCase().includes('снег') || description.includes('❄️'))) {
    advice.push('• ❄️ *При снеге:* непромокаемая обувь, варежки');
  }
  if (wind && parseFloat(wind) > 7) {
    advice.push('• 💨 *При ветре:* ветровка с капюшоном, шарф');
  }
  if (description && (description.includes('☀️') || description.includes('ясно'))) {
    advice.push('• 🕶️ *При солнце:* солнцезащитные очки, головной убор');
  }

  if (temp < 15) {
    advice.push('• 🧣 *Аксессуары:* шапка, шарф, перчатки');
  }
  if (temp > 20 && description && description.includes('☀️')) {
    advice.push('• 🧴 *Защита:* солнцезащитный крем SPF 30+');
  }

  advice.push('\n👟 *Обувь:* выбирайте по погоде');
  advice.push('🎒 *С собой:* сумка для снятых слоев одежды');

  return advice.join('\n');
}

// ===================== ФРАЗЫ ДНЯ =====================
const dailyPhrases = [
  {
    english: "Where is the nearest bus stop?",
    russian: "Где ближайшая автобусная остановка?",
    explanation: "Спрашиваем про общественный транспорт",
    category: "Путешествия",
    level: "Начальный"
  },
  {
    english: "I'd like a window seat, please.",
    russian: "Я хотел бы место у окна, пожалуйста.",
    explanation: "Заказываем место в самолете или поезде",
    category: "Путешествия",
    level: "Средний"
  },
  {
    english: "Could you recommend a good restaurant?",
    russian: "Не могли бы вы порекомендовать хороший ресторан?",
    explanation: "Просим рекомендацию по питанию",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "How much does this cost?",
    russian: "Сколько это стоит?",
    explanation: "Спрашиваем цену товара",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "I need to see a doctor.",
    russian: "Мне нужно к врачу.",
    explanation: "Выражаем потребность в медицинской помощи",
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
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
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

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================
async function saveUserCityWithRetry(userId, city, username = null, retries = 3) {
  const dbUserId = userId.toString();
  console.log(`📍 Сохраняем город для ${dbUserId}: "${city}"`);
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const chatId = userId === dbUserId ? userId : null;
      
      const result = await saveOrUpdateUser({
        user_id: dbUserId,
        username: username || '',
        first_name: username || 'Игрок',
        city: city || 'Не указан',
        chat_id: chatId,
        source: 'telegram'
      });
      
      if (result) {
        console.log(`✅ Город успешно сохранен (попытка ${attempt})`);
        try {
          await saveUserCity(userId, city, username);
        } catch (sessionError) {
          console.log('⚠️ Ошибка сохранения в сессию:', sessionError.message);
        }
        return { success: true, user_id: dbUserId, city: city, db_id: result };
      }
    } catch (error) {
      console.error(`❌ Ошибка сохранения города (попытка ${attempt}):`, error.message);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  return { success: false, error: 'Не удалось сохранить город после всех попыток', user_id: dbUserId };
}

async function getUserCityWithFallback(userId) {
  const dbUserId = userId.toString();
  console.log(`📍 Запрашиваем город для ${dbUserId}`);
  
  try {
    const result = await getUserCity(userId);
    
    if (result && result.success) {
      const city = result.city || 'Не указан';
      console.log(`✅ Город получен: "${city}" (источник: ${result.source || 'unknown'})`);
      return { success: true, city: city, found: result.found || false, source: result.source };
    }
    
    console.log('🔄 Город не найден через getUserCity, пробуем getUserProfile...');
    const profile = await getUserProfile(userId);
    if (profile && profile.city && profile.city !== 'Не указан') {
      console.log(`✅ Город найден через профиль: "${profile.city}"`);
      return { success: true, city: profile.city, found: true, source: 'profile' };
    }
    
    return { success: true, city: 'Не указан', found: false, source: 'none' };
    
  } catch (error) {
    console.error('❌ Ошибка получения города:', error.message);
    return { success: false, error: error.message, city: 'Не указан', found: false };
  }
}
// ===================== 🔴 ИСПРАВЛЕННАЯ ФУНКЦИЯ СТАТИСТИКИ =====================
async function getGameStatsMessage(userId) {
  try {
    console.log(`📊 Получение статистики для: ${userId}`);
    
    const telegramUserId = userId.toString();
    console.log(`🔧 ID пользователя: ${telegramUserId}`);
    
    const client = await pool.connect();
    
    try {
      // 1. ПОЛУЧАЕМ ГОРОД ИЗ ТАБЛИЦЫ users
      let city = 'Не указан';
      let username = 'Игрок';
      
      const userResult = await client.query(
        'SELECT city, username, first_name FROM users WHERE user_id = $1',
        [telegramUserId]
      );
      
      if (userResult.rows.length > 0) {
        city = userResult.rows[0].city || 'Не указан';
        username = userResult.rows[0].username || userResult.rows[0].first_name || 'Игрок';
        console.log(`🏙️ Найден город из users: "${city}"`);
      } else {
        console.log(`❌ Пользователь ${telegramUserId} не найден в таблице users`);
      }
      
      // 2. ПОЛУЧАЕМ СТАТИСТИКУ ИЗ game_scores
      const scoresQuery = `
        SELECT 
          COUNT(*) as games_played,
          COALESCE(MAX(score), 0) as best_score,
          COALESCE(MAX(level), 1) as best_level,
          COALESCE(MAX(lines), 0) as best_lines,
          COALESCE(AVG(score), 0) as avg_score,
          COALESCE(SUM(score), 0) as total_score,
          MAX(created_at) as last_played,
          COUNT(CASE WHEN is_win = true THEN 1 END) as wins,
          COUNT(CASE WHEN is_win = false THEN 1 END) as losses
        FROM game_scores 
        WHERE user_id = $1 
          AND game_type = 'tetris'
          AND score > 0
      `;
      
      const scoresResult = await client.query(scoresQuery, [telegramUserId]);
      const stats = scoresResult.rows[0];
      
      console.log(`🎮 Статистика из game_scores:`, {
        games_played: parseInt(stats.games_played) || 0,
        best_score: parseInt(stats.best_score) || 0
      });
      
      // 3. 🔴 ИСПРАВЛЕНО: ИСПОЛЬЗУЕМ ПРАВИЛЬНОЕ НАЗВАНИЕ КОЛОНКИ
      const progressQuery = `
        SELECT score, level, lines, last_saved 
        FROM game_progress 
        WHERE user_id = $1 AND game_type = 'tetris'
      `;
      
      const progressResult = await client.query(progressQuery, [telegramUserId]);
      const hasUnfinishedGame = progressResult.rows.length > 0;
      
      // 4. ФОРМИРУЕМ СООБЩЕНИЕ
      const gamesPlayed = parseInt(stats.games_played) || 0;
      const bestScore = parseInt(stats.best_score) || 0;
      const avgScore = Math.round(parseFloat(stats.avg_score) || 0);
      const bestLevel = parseInt(stats.best_level) || 1;
      const bestLines = parseInt(stats.best_lines) || 0;
      const wins = parseInt(stats.wins) || 0;
      const losses = parseInt(stats.losses) || 0;
      const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
      
      let message = `🎮 *Статистика в тетрисе*\n\n`;
      
      if (gamesPlayed > 0) {
        message += `📊 *Всего игр:* ${gamesPlayed}\n`;
        message += `🏆 *Лучший счёт:* ${bestScore}\n`;
        message += `📈 *Лучший уровень:* ${bestLevel}\n`;
        message += `🧱 *Лучшие линии:* ${bestLines}\n`;
        message += `📉 *Средний счёт:* ${avgScore}\n`;
        message += `🎯 *Побед:* ${wins}\n`;
        message += `💔 *Поражений:* ${losses}\n`;
        message += `📊 *Процент побед:* ${winRate}%\n\n`;
        
        if (stats.last_played) {
          try {
            const date = new Date(stats.last_played);
            message += `⏰ *Последняя игра:* ${date.toLocaleDateString('ru-RU')}\n\n`;
          } catch (e) {}
        }
      } else if (hasUnfinishedGame && progressResult.rows[0]) {
        const progress = progressResult.rows[0];
        message += `🔄 *Незавершенная игра:*\n`;
        message += `• Текущие очки: ${progress.score}\n`;
        message += `• Текущий уровень: ${progress.level}\n`;
        message += `• Собрано линий: ${progress.lines}\n`;
        message += `💾 *Прогресс сохранён*\n\n`;
        message += `🎮 *Завершите игру, чтобы результат попал в статистику!*\n\n`;
      } else {
        message += `🎮 *Вы ещё не играли в тетрис!*\n`;
        message += `👇 *Нажмите кнопку ниже, чтобы начать!*\n\n`;
      }
      
      message += `📍 *Город:* ${city}\n`;
      message += `👤 *Игрок:* ${username}\n\n`;
      
      if (gamesPlayed === 0 && !hasUnfinishedGame) {
        message += `🎮 *Сыграйте свою первую игру прямо сейчас!*`;
      } else if (gamesPlayed > 0) {
        message += `🎯 *Цель:* Попасть в топ игроков!\n`;
        message += `🏆 *Топ игроков:* /top`;
      }
      
      return message;
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Ошибка в getGameStatsMessage:', error);
    
    // 🔴 ВОЗВРАЩАЕМ ПРОСТОЕ СООБЩЕНИЕ БЕЗ MARKDOWN СИНТАКСИСА
    return `❌ Ошибка загрузки статистики. Пожалуйста, попробуйте позже.`;
  }
}
// ===================== 🔴 ИСПРАВЛЕННАЯ ФУНКЦИЯ ТОПА ИГРОКОВ =====================
// ==================== РАБОЧАЯ ФУНКЦИЯ ТОПА ДЛЯ БОТА ====================
async function getTopPlayersMessage(limit = 10, ctx = null) {
  try {
    console.log(`🏆 Получение топа ${limit} игроков...`);
    
    const client = await pool.connect();
    
    try {
      // 🔴 ВОЗВРАЩАЕМ СТАРЫЙ ПРОВЕРЕННЫЙ SQL-ЗАПРОС!
      const topQuery = `
        SELECT 
          gs.user_id,
          COALESCE(u.username, gs.username, 'Игрок') as display_name,
          COALESCE(u.city, gs.city, 'Не указан') as city,
          MAX(gs.score) as best_score,
          COUNT(*) as games_played,
          MAX(gs.level) as best_level,
          MAX(gs.lines) as best_lines
        FROM game_scores gs
        LEFT JOIN users u ON gs.user_id = u.user_id
        WHERE gs.game_type = 'tetris' 
          AND gs.score > 0
          AND gs.is_win = true
          AND gs.user_id NOT LIKE 'test_%'
          AND gs.user_id NOT LIKE 'web_%'
          AND gs.user_id ~ '^[0-9]+$'
        GROUP BY gs.user_id, u.username, gs.username, u.city, gs.city
        ORDER BY MAX(gs.score) DESC, COUNT(*) DESC
        LIMIT $1
      `;
      
      const result = await client.query(topQuery, [limit]);
      console.log(`🏆 Найдено игроков в топе: ${result.rows.length}`);
      
      if (result.rows.length === 0) {
        return `🏆 *Топ игроков*\n\n` +
               `🎮 *Пока никто не завершил игру с хорошим результатом!*\n\n` +
               `📝 *Как попасть в топ:*\n` +
               `1. 🎮 Играйте в тетрис\n` +
               `2. 🎯 Наберите минимум *1000 очков*\n` +
               `3. ✅ Завершите игру\n` +
               `4. 📍 Укажите город: /city [город]\n\n` +
               `🎯 *Текущие рекорды появятся здесь!*`;
      }
      
      let message = `🏆 *Топ ${Math.min(result.rows.length, limit)} игроков в тетрисе*\n\n`;
      
      result.rows.forEach((player, index) => {
        let medal;
        switch(index) {
          case 0: medal = '🥇'; break;
          case 1: medal = '🥈'; break;
          case 2: medal = '🥉'; break;
          default: medal = `${index + 1}.`;
        }
        
        const score = player.best_score || 0;
        const level = player.best_level || 1;
        const lines = player.best_lines || 0;
        const gamesPlayed = player.games_played || 1;
        
        message += `${medal} *${player.display_name}*\n`;
        message += `   🎯 Очки: *${score}*\n`;
        message += `   📊 Уровень: ${level} | 📈 Линии: ${lines}\n`;
        
        if (player.city && player.city !== 'Не указан') {
          message += `   📍 Город: ${player.city}\n`;
        }
        
        message += `   🕹️ Игр завершено: ${gamesPlayed}\n\n`;
      });
      
      // Добавляем информацию о текущем пользователе
      if (ctx && ctx.from) {
        const currentUserId = ctx.from.id.toString();
        message += `👤 *Ваш ID:* ${currentUserId.slice(-4)}\n`;
        message += `📍 *Ваш город:* ${await getUserCityName(currentUserId)}\n\n`;
      }
      
      message += `📝 *Как попасть в топ:*\n`;
      message += `• 🎮 Играйте в тетрис\n`;
      message += `• 🎯 Наберите *минимум 1000 очков*\n`;
      message += `• ✅ Завершите игру\n`;
      message += `• 📍 Укажите город: /city [город]`;
      
      return message;
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Ошибка в getTopPlayersMessage:', error);
    return `❌ Ошибка загрузки топа игроков. Пожалуйста, попробуйте позже.`;
  }
}

// Вспомогательная функция для получения города
async function getUserCityName(userId) {
  try {
    const result = await getUserCityWithFallback(userId);
    return result.city || 'Не указан';
  } catch {
    return 'Не указан';
  }
}
// ===================== ОСНОВНЫЕ КОМАНДЫ =====================
bot.command('start', async (ctx) => {
  console.log(`🚀 /start от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    await saveOrUpdateUser({
      user_id: ctx.from.id.toString(),
      chat_id: ctx.chat.id,
      username: ctx.from.username || '',
      first_name: ctx.from.first_name || '',
      city: 'Не указан',
      source: 'telegram'
    });
    
    await ctx.reply(
      `👋 *Добро пожаловать в бота погоды, английских фраз и игр!*\n\n` +
      `🎮 *Да, здесь есть тетрис со статистикой и топом игроков!*\n\n` +
      `📍 *Укажите город, чтобы увидеть его в статистике:*\n` +
      `• Используйте команду /city Москва\n` +
      `• Или выберите город из списка\n\n` +
      `👇 *ШАГ 1: Нажмите кнопку ниже чтобы начать*`,
      { parse_mode: 'Markdown', reply_markup: startKeyboard }
    );
    
    await ctx.reply(
      `📱 *Что умеет бот:*\n\n` +
      `🌤️ *Погода:*\n` +
      `• Текущая погода в вашем городе\n` +
      `• Подробный прогноз на завтра\n\n` +
      `🇬🇧 *Английский:*\n` +
      `• Фраза дня\n` +
      `• Случайные полезные фразы\n\n` +
      `🎮 *Игры (с полноценной статистикой):*\n` +
      `• Тетрис в мини-приложении\n` +
      `• 📊 Ваша статистика с городом\n` +
      `• 🏆 Топ игроков с городами\n\n` +
      `📍 *Важно:* Укажите город командой /city [город] чтобы отображаться в топе!\n\n` +
      `👉 *Чтобы продолжить, нажмите "🚀 НАЧАТЬ РАБОТА"*`,
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
      `Бот будет показывать погоду для выбранного города.\n\n` +
      `*Также город будет отображаться в вашей статистике и топе игроков!*`,
      { parse_mode: 'Markdown', reply_markup: cityKeyboard }
    );
  } catch (error) {
    console.error('❌ Ошибка в НАЧАТЬ РАБОТУ:', error);
  }
});

// ===================== ОБРАБОТКА ВЫБОРА ГОРОДА =====================
bot.hears(/^📍 /, async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || '';
  const city = ctx.message.text.replace('📍 ', '').trim();
  console.log(`📍 Выбран город: "${city}" для ${userId}`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const saveResult = await saveUserCityWithRetry(userId, city, username);
    
    if (!saveResult.success) {
      await ctx.reply('❌ Не удалось сохранить город. Попробуйте еще раз или используйте команду /city [город]');
      return;
    }
    
    userStorage.set(userId, { city, lastActivity: Date.now(), awaitingCity: false });
    
    await ctx.reply(
      `✅ *ШАГ 3: Готово! Город "${city}" сохранён!*\n\n` +
      `🎉 *Теперь доступны все функции бота:*\n\n` +
      `• Узнать погоду сейчас и на завтра 🌤️\n` +
      `• Получить совет по одежде 👕\n` +
      `• Изучать английские фразы 🇬🇧\n` +
      `• Играть в тетрис с полной статистикой 🎮\n` +
      `• Смотреть свою статистику с городом 📊\n` +
      `• Соревноваться в топе игроков 🏆\n\n` +
      `👇 *Используйте кнопки ниже:*`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка при выборе города:', error);
    await ctx.reply('❌ Не удалось сохранить город. Попробуйте еще раз или используйте команду /city [город]');
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
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
      return;
    }
    
    const city = result.city;
    await ctx.reply(`⏳ Запрашиваю погоду для ${city}...`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(city);
    
    if (!weather || !weather.success) {
      await ctx.reply(`❌ ${weather?.error || 'Не удалось получить данные о погоде.'}`, { 
        parse_mode: 'Markdown', 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
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
    await ctx.reply('❌ Не удалось получить данные о погоде.', { reply_markup: mainMenuKeyboard });
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
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
      return;
    }
    
    const city = result.city;
    await ctx.reply(`⏳ Запрашиваю прогноз на завтра для ${city}...`, { parse_mode: 'Markdown' });
    
    const forecast = await getWeatherForecast(city);
    
    if (!forecast || !forecast.success) {
      await ctx.reply(`❌ ${forecast?.error || 'Не удалось получить прогноз погоды.'}`, { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    const forecastDate = new Date(forecast.date);
    const dateFormatted = forecastDate.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    
    let message = `📅 *Прогноз погоды на ${dateFormatted}*\n`;
    message += `📍 *${forecast.city}*\n`;
    message += `🕒 Обновлено: ${forecast.updated}\n\n`;
    message += `📊 *Общий прогноз:*\n`;
    message += `🌡️ Температура: *${forecast.temp_min}°C ... ${forecast.temp_max}°C*\n`;
    message += `💨 Макс. ветер: ${forecast.wind_max} м/с\n`;
    message += `🌧️ Осадки: ${forecast.precipitation > 0 ? forecast.precipitation.toFixed(1) + ' мм' : 'Нет'}\n`;
    message += `🌅 Восход: ${forecast.sunrise}\n`;
    message += `🌇 Закат: ${forecast.sunset}\n\n`;
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
    console.error('❌ Ошибка в ПОГОДА ЗАВТРА:', error);
    await ctx.reply('❌ Не удалось получить прогноз погоды.', { reply_markup: mainMenuKeyboard });
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
    await ctx.reply('❌ Произошла ошибка при загрузке статистики.', { 
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
    await ctx.reply('❌ Произошла ошибка при загрузке топа игроков.', { 
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
    // 🔴 ПОЛУЧАЕМ РЕАЛЬНЫЙ TELEGRAM ID И ИМЯ ПОЛЬЗОВАТЕЛЯ
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'Player';
    
    console.log(`✅ Открываем игру для пользователя: ${userId} (${username})`);
    
    // 🔴 ПЕРЕДАЕМ ID И ИМЯ В URL ПАРАМЕТРАХ!
    const webAppUrl = `https://pogodasovet1.vercel.app?telegramId=${userId}&username=${encodeURIComponent(username)}`;
    
    // ПРОВЕРЯЕМ ЕСТЬ ЛИ У ПОЛЬЗОВАТЕЛЯ ГОРОД
    const cityResult = await getUserCityWithFallback(ctx.from.id);
    const hasCity = cityResult.found && cityResult.city !== 'Не указан';
    
    let cityMessage = '';
    if (!hasCity) {
      cityMessage = `\n📍 *Укажите город командой /city [город] чтобы отображаться в топе!*`;
    }
    
    await ctx.reply(
      `🎮 *Тетрис*\n\n` +
      `Нажмите кнопку ниже, чтобы открыть игру в мини-приложении!\n\n` +
      `📊 *Ваша статистика будет автоматически сохраняться.*${cityMessage}\n` +
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

// ===================== ОБРАБОТЧИКИ CALLBACK =====================
bot.callbackQuery('my_stats', async (ctx) => {
  try {
    const statsMessage = await getGameStatsMessage(ctx.from.id);
    await ctx.editMessageText(statsMessage, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🎮 ИГРАТЬ В ТЕТРИС',
            web_app: { 
              url: `https://pogodasovet1.vercel.app?telegramId=${ctx.from.id}&username=${encodeURIComponent(ctx.from.username || ctx.from.first_name || 'Player')}`
            }
          }],
          [{
            text: '◀️ В МЕНЮ',
            callback_data: 'back_to_menu'
          }]
        ]
      }
    });
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('❌ Ошибка в callback my_stats:', error);
    await ctx.answerCallbackQuery('❌ Ошибка загрузки статистики');
  }
});

bot.callbackQuery('top_players', async (ctx) => {
  try {
    const topMessage = await getTopPlayersMessage(10, ctx);
    await ctx.editMessageText(topMessage, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🎮 ИГРАТЬ В ТЕТРИС',
            web_app: { 
              url: `https://pogodasovet1.vercel.app?telegramId=${ctx.from.id}&username=${encodeURIComponent(ctx.from.username || ctx.from.first_name || 'Player')}`
            }
          }],
          [{
            text: '◀️ В МЕНЮ',
            callback_data: 'back_to_menu'
          }]
        ]
      }
    });
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
  
  console.log(`📱 Получены данные от Mini App от пользователя ${userId}`);
  
  try {
    const webAppData = ctx.message.web_app_data;
    const data = JSON.parse(webAppData.data);
    
    if (data.action === 'tetris_score' || data.gameType === 'tetris') {
      const score = parseInt(data.score) || 0;
      const level = parseInt(data.level) || 1;
      const lines = parseInt(data.lines) || 0;
      const gameOver = Boolean(data.gameOver);
      
      if (score === 0) {
        await ctx.reply(`🎮 Игра начата! Удачи! 🍀`, {
          parse_mode: 'Markdown',
          reply_markup: mainMenuKeyboard
        });
        return;
      }
      
      // 🔴 ПОЛУЧАЕМ ГОРОД ПОЛЬЗОВАТЕЛЯ
      let userCity = 'Не указан';
      try {
        const cityResult = await getUserCityWithFallback(userId);
        if (cityResult.success && cityResult.city && cityResult.city !== 'Не указан') {
          userCity = cityResult.city;
        }
      } catch (cityError) {
        console.error('❌ Ошибка получения города:', cityError.message);
      }
      
      // 🔴 СОХРАНЯЕМ ИГРУ С ЧИСЛОВЫМ ID
      const result = await saveGameScore(
        userId.toString(), // ТОЛЬКО ЧИСЛОВОЙ ID!
        'tetris', 
        score, 
        level, 
        lines, 
        userName, 
        gameOver
      );
      
      if (!result || !result.success) {
        await ctx.reply(`❌ Не удалось сохранить результат. Попробуйте ещё раз.`, {
          reply_markup: mainMenuKeyboard
        });
        return;
      }
      
      // 🔴 ПОЛУЧАЕМ ОБНОВЛЕННУЮ СТАТИСТИКУ
      const stats = await fetchGameStats(userId.toString(), 'tetris');
      const bestScore = stats?.success ? stats.stats?.best_score || 0 : 0;
      
      let message = gameOver 
        ? `🎮 *Игра окончена!*\n\n` 
        : `🎮 *Прогресс сохранён!*\n\n`;
      
      message += `👤 *Игрок:* ${userName}\n`;
      message += `🎯 *Результат:* ${score} очков\n`;
      message += `📊 *Уровень:* ${level}\n`;
      message += `📈 *Линии:* ${lines}\n`;
      message += `📍 *Город:* ${userCity}\n\n`;
      
      if (score > bestScore && bestScore > 0) {
        message += `🎉 *НОВЫЙ РЕКОРД!* 🎉\n`;
        message += `🏆 Предыдущий лучший: ${bestScore}\n\n`;
      } else if (bestScore > 0) {
        message += `🏆 *Ваш лучший результат:* ${bestScore}\n\n`;
      }
      
      message += `📊 *Теперь вы можете:*\n`;
      message += `• Посмотреть свою статистику 📊\n`;
      message += `• Проверить место в топе 🏆\n`;
      
      if (userCity === 'Не указан') {
        message += `• 📍 Указать город: /city [город]\n`;
      }
      
      await ctx.reply(message, { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard 
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка обработки данных игры:', error);
    await ctx.reply(`❌ Произошла ошибка при обработке данных игры.`, {
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
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
      return;
    }
    
    const city = result.city;
    await ctx.reply(`👗 Анализирую погоду для ${city}...`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(city);
    if (!weather || !weather.success) {
      await ctx.reply(`❌ ${weather?.error || 'Не удалось получить данные о погоде.'}`, { 
        parse_mode: 'Markdown', 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
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
    console.error('❌ Ошибка в СЛУЧАЙНАЯ ФРАЗА:', error);
    await ctx.reply('❌ Не удалось получить случайную фразу.', { 
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
    const currentCityResult = await getUserCityWithFallback(ctx.from.id);
    let currentCityMessage = '';
    
    if (currentCityResult.success && currentCityResult.city !== 'Не указан') {
      currentCityMessage = `\n📍 *Ваш текущий город:* ${currentCityResult.city}`;
    }
    
    await ctx.reply(
      `🏙️ *Выберите новый город*${currentCityMessage}\n\n` +
      `Или напишите название города вручную.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: cityKeyboard 
      }
    );
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
    await ctx.reply('Напишите название вашего города:\n\n*Например:* Москва, Санкт-Петербург, Екатеринбург', 
      { parse_mode: 'Markdown' }
    );
    userStorage.set(ctx.from.id, { awaitingCity: true, lastActivity: Date.now() });
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
      `/city [город] - Указать свой город\n` +
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
      `• 📅 ПОГОДА ЗАВТРА - подробный прогноз на завтра\n` +
      `• 👕 ЧТО НАДЕТЬ? - рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная английская фраза\n` +
      `• 🎮 ИГРАТЬ В ТЕТРИС - игра в мини-приложении\n` +
      `• 📊 МОЯ СТАТИСТИКА - ваша статистика в игре\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки с городами\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n` +
      `• 📋 ПОКАЗАТЬ КОМАНДЫ - убрать кнопки и использовать команды\n\n` +
      `*Текстовые команды:*\n` +
      `/start - начать работу\n` +
      `/weather - текущая погода\n` +
      `/forecast - прогноз на завтра\n` +
      `/wardrobe - что надеть?\n` +
      `/phrase - фраза дня\n` +
      `/random - случайная фраза\n` +
      `/tetris - играть в тетрис\n` +
      `/stats - ваша статистика\n` +
      `/top - топ игроков\n` +
      `/city [город] - указать свой город\n` +
      `/help - помощь\n\n` +
      `📍 *Важно:* Укажите город командой /city [город] чтобы отображаться в топе игроков!`,
      { 
        parse_mode: 'Markdown', 
        reply_markup: mainMenuKeyboard 
      }
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
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город! Используйте /start', { reply_markup: cityKeyboard });
      return;
    }
    
    const city = result.city;
    await ctx.reply(`⏳ Запрашиваю погоду для ${city}...`);
    
    const weather = await getWeatherData(city);
    
    if (!weather || !weather.success) {
      await ctx.reply(`❌ ${weather?.error || 'Не удалось получить данные о погоде.'}`, { 
        parse_mode: 'Markdown', 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
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
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город! Используйте /start', { reply_markup: cityKeyboard });
      return;
    }
    
    const city = result.city;
    await ctx.reply(`⏳ Запрашиваю прогноз на завтра для ${city}...`, { parse_mode: 'Markdown' });
    
    const forecast = await getWeatherForecast(city);
    
    if (!forecast || !forecast.success) {
      await ctx.reply(`❌ ${forecast?.error || 'Не удалось получить прогноз погоды.'}`, { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    const forecastDate = new Date(forecast.date);
    const dateFormatted = forecastDate.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    
    let message = `📅 *Прогноз погоды на ${dateFormatted}*\n`;
    message += `📍 *${forecast.city}*\n`;
    message += `🕒 Обновлено: ${forecast.updated}\n\n`;
    message += `📊 *Общий прогноз:*\n`;
    message += `🌡️ Температура: *${forecast.temp_min}°C ... ${forecast.temp_max}°C*\n`;
    message += `💨 Макс. ветер: ${forecast.wind_max} м/с\n`;
    message += `🌧️ Осадки: ${forecast.precipitation > 0 ? forecast.precipitation.toFixed(1) + ' мм' : 'Нет'}\n`;
    message += `🌅 Восход: ${forecast.sunrise}\n`;
    message += `🌇 Закат: ${forecast.sunset}\n\n`;
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
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город! Используйте /start', { reply_markup: cityKeyboard });
      return;
    }
    
    const city = result.city;
    await ctx.reply(`👗 Анализирую погоду для ${city}...`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(city);
    if (!weather || !weather.success) {
      await ctx.reply(`❌ ${weather?.error || 'Не удалось получить данные о погоде.'}`, { 
        parse_mode: 'Markdown', 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
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
      `📂 *Категория:* ${phrase.category || "Общие"}\n` +
      `📊 *Уровень:* ${phrase.level || "Средний"}`;
    
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

bot.command('tetris', async (ctx) => {
  console.log(`🎮 /tetris от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const webAppUrl = 'https://pogodasovet1.vercel.app';
    await ctx.reply(
      `🎮 *Тетрис*\n\n` +
      `Нажмите кнопку ниже, чтобы открыть игру в мини-приложении!\n\n` +
      `📊 *Ваша статистика будет автоматически сохраняться.*\n` +
      `📍 *Укажите город командой /city [город] чтобы отображаться в топе!*\n` +
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

// ===================== КОМАНДА /CITY =====================
bot.command('city', async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || '';
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length === 0) {
    try {
      const result = await getUserCityWithFallback(userId);
      
      if (result.success && result.city && result.city !== 'Не указан') {
        await ctx.reply(
          `📍 *Ваш текущий город:* ${result.city}\n\n` +
          `Чтобы изменить город, используйте команду:\n` +
          `/city [название города]\n\n` +
          `*Примеры:*\n` +
          `/city Москва\n` +
          `/city Санкт-Петербург`,
          { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
      } else {
        await ctx.reply(
          `📍 *У вас не указан город*\n\n` +
          `Укажите свой город, чтобы он отображался в статистике и топе игроков!\n\n` +
          `*Пример:*\n` +
          `/city Москва`,
          { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
      }
    } catch (error) {
      console.error('❌ Ошибка в /city:', error);
      await ctx.reply('❌ Не удалось получить информацию о городе.', { reply_markup: mainMenuKeyboard });
    }
    return;
  }
  
  const city = args.join(' ').trim();
  console.log(`📍 Команда /city: ${userId} -> "${city}"`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    if (!city || city.length < 2 || city.length > 100) {
      await ctx.reply('❌ Неверное название города. Город должен содержать от 2 до 100 символов.');
      return;
    }
    
    await ctx.reply(`⏳ Сохраняю город "${city}"...`, { parse_mode: 'Markdown' });
    
    const saveResult = await saveUserCityWithRetry(userId, city, username);
    
    if (!saveResult.success) {
      await ctx.reply('❌ Не удалось сохранить город. Попробуйте еще раз.');
      return;
    }
    
    await ctx.reply(
      `✅ *Город "${city}" успешно сохранен!*\n\n` +
      `📍 Теперь вы будете отображаться в топе игроков с этим городом.\n` +
      `📊 Ваша статистика будет показывать город: "${city}"\n\n` +
      `*Что теперь можно сделать:*\n` +
      `• Проверить статистику: /stats\n` +
      `• Посмотреть топ игроков: /top\n` +
      `• Сыграть в тетрис: /tetris`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в /city:', error);
    await ctx.reply('❌ Произошла ошибка при сохранении города. Попробуйте еще раз.');
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
      `• 📅 ПОГОДА ЗАВТРА - подробный прогноз на завтра\n` +
      `• 👕 ЧТО НАДЕТЬ? - рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная английская фраза\n` +
      `• 🎮 ИГРАТЬ В ТЕТРИС - игра в мини-приложении\n` +
      `• 📊 МОЯ СТАТИСТИКА - ваша статистика в игре\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки с городами\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n` +
      `• 📋 ПОКАЗАТЬ КОМАНДЫ - убрать кнопки и использовать команды\n\n` +
      `*Текстовые команды:*\n` +
      `/start - начать работу\n` +
      `/weather - текущая погода\n` +
      `/forecast - прогноз на завтра\n` +
      `/wardrobe - что надеть?\n` +
      `/phrase - фраза дня\n` +
      `/random - случайная фраза\n` +
      `/tetris - играть в тетрис\n` +
      `/stats - ваша статистика\n` +
      `/top - топ игроков\n` +
      `/city [город] - указать свой город\n` +
      `/help - помощь\n\n` +
      `📍 *Важно:* Укажите город командой /city [город] чтобы отображаться в топе игроков!`,
      { 
        parse_mode: 'Markdown', 
        reply_markup: { remove_keyboard: true }
      }
    );
  } catch (error) {
    console.error('❌ Ошибка в /help:', error);
  }
});

// ===================== УДАЛЯЕМ ВСЕ ТЕСТОВЫЕ КОМАНДЫ =====================
// ❌ Удалены: /test_api_endpoints, /db_check, /debug_db, /test_stats, /db_info

// ===================== ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ =====================
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || '';
  const text = ctx.message.text;
  const userData = userStorage.get(userId) || {};
  
  console.log(`📝 Текст от ${userId}: "${text}"`);
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  if (text.startsWith('/') || 
      ['🚀 НАЧАТЬ РАБОТУ', '🌤️ ПОГОДА СЕЙЧАС', '📅 ПОГОДА ЗАВТРА', '👕 ЧТО НАДЕТЬ?', 
       '💬 ФРАЗА ДНЯ', '🎲 СЛУЧАЙНАЯ ФРАЗА', '🎮 ИГРАТЬ В ТЕТРИС', '📊 МОЯ СТАТИСТИКА', 
       '🏆 ТОП ИГРОКОВ', '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '📋 ПОКАЗАТЬ КОМАНДЫ', 
       '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
      text.startsWith('📍 ')) {
    return;
  }
  
  if (userData.awaitingCity) {
    try {
      const city = text.trim();
      if (city.length === 0 || city.length > 100) {
        await ctx.reply('❌ Неверное название города. Город должен содержать от 2 до 100 символов.');
        return;
      }
      
      console.log(`🏙️ Сохраняю город "${city}" для ${userId}`);
      
      const saveResult = await saveUserCityWithRetry(userId, city, username);
      
      if (!saveResult.success) {
        await ctx.reply('❌ Не удалось сохранить город. Попробуйте еще раз или используйте команду /city [город]');
        return;
      }
      
      userStorage.set(userId, { city, lastActivity: Date.now(), awaitingCity: false });
      
      await ctx.reply(
        `✅ *Город "${city}" сохранён!*\n\n` +
        `📍 Теперь вы будете отображаться в топе игроков с этим городом.\n\n` +
        `*Проверьте:*\n` +
        `• /stats - ваша статистика\n` +
        `• /top - топ игроков`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
      );
    } catch (error) {
      console.error('❌ Ошибка при сохранении города:', error);
      await ctx.reply('❌ Не удалось сохранить город. Попробуйте еще раз или используйте команду /city [город]');
    }
  } else {
    try {
      const result = await getUserCityWithFallback(userId);
      if (!result || !result.success || !result.city || result.city === 'Не указан') {
        await ctx.reply('Пожалуйста, сначала выберите город:', { reply_markup: cityKeyboard });
      } else {
        await ctx.reply(
          `📍 *Ваш город:* ${result.city}\n\n` +
          `Используйте кнопки меню для получения информации.`,
          { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
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
let botInitialized = false;

async function initializeBot() {
  if (!botInitialized) {
    console.log('🤖 Инициализирую бота для Vercel...');
    try {
      await bot.init();
      console.log(`✅ Бот инициализирован: @${bot.botInfo.username}`);
      botInitialized = true;
    } catch (error) {
      console.error('❌ Ошибка инициализации бота:', error.message);
    }
  }
}

if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
  initializeBot().catch(console.error);
}

export default async function handler(req, res) {
  console.log(`🌐 ${req.method} запрос к /api/bot в ${new Date().toISOString()}`);
  
  if ((process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') && !botInitialized) {
    await initializeBot();
  }
  
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ 
        message: 'Weather & English Phrases Bot with Game Statistics is running',
        status: 'active',
        bot_initialized: botInitialized,
        timestamp: new Date().toISOString(),
        bot: bot.botInfo?.username || 'не инициализирован',
        features: [
          'Погода сейчас',
          'Подробный прогноз на завтра',
          'Рекомендации по одежде',
          'Английские фразы',
          'Тетрис со статистикой',
          'Топ игроков с городами'
        ]
      });
    }
    
    if (req.method === 'POST') {
      if (!botInitialized) {
        console.error('❌ Бот не инициализирован, пропускаем update');
        return res.status(200).json({ ok: false, error: 'Bot not initialized' });
      }
      
      try {
        const update = req.body;
        if (!update || typeof update !== 'object') {
          return res.status(400).json({ ok: false, error: 'Invalid update format' });
        }
        await bot.handleUpdate(update);
        return res.status(200).json({ ok: true });
      } catch (error) {
        console.error('❌ Ошибка обработки update:', error);
        return res.status(200).json({ ok: false, error: 'Update processing failed' });
      }
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('🔥 Критическая ошибка в handler:', error);
    return res.status(200).json({ ok: false, error: 'Internal server error' });
  }
}

export { bot };
console.log('⚡ Бот загружен с полноценной системой прогноза погоды и статистикой игр!');
console.log('📍 Система городов: ВКЛЮЧЕНА');
console.log('🏆 Топ игроков: ВКЛЮЧЕН');
console.log('❌ Тестовые команды: УДАЛЕНЫ');
