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
  getTopPlayersWithCities,
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

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ПОГОДЫ =====================

/**
 * Получить текстовое описание направления ветра
 */
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  
  const directions = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

/**
 * Описание облачности
 */
function getCloudDescription(cloudPercent) {
  if (cloudPercent === undefined || cloudPercent === null) return '—';
  
  if (cloudPercent < 10) return 'Ясно ☀️';
  if (cloudPercent < 30) return 'Малооблачно 🌤️';
  if (cloudPercent < 50) return 'Переменная облачность ⛅';
  if (cloudPercent < 70) return 'Облачно с прояснениями 🌥️';
  if (cloudPercent < 85) return 'Облачно ☁️';
  return 'Пасмурно ☁️';
}

/**
 * Расчет длины дня
 */
function calculateDayLength(sunrise, sunset) {
  if (!sunrise || !sunset || sunrise === '—' || sunset === '—') return '—';
  
  const [sunriseHour, sunriseMin] = sunrise.split(':').map(Number);
  const [sunsetHour, sunsetMin] = sunset.split(':').map(Number);
  
  let hours = sunsetHour - sunriseHour;
  let minutes = sunsetMin - sunriseMin;
  
  if (minutes < 0) {
    hours--;
    minutes += 60;
  }
  
  return `${hours} ч ${minutes} мин`;
}

/**
 * Получить описание погоды по коду
 */
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
    55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌧️',
    63: 'Дождь 🌧️',
    65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️',
    73: 'Снег ❄️',
    75: 'Сильный снег ❄️',
    80: 'Небольшой ливень 🌧️',
    81: 'Ливень 🌧️',
    82: 'Сильный ливень 🌧️',
    85: 'Небольшой снегопад ❄️',
    86: 'Сильный снегопад ❄️',
    95: 'Гроза ⛈️',
    96: 'Гроза с градом ⛈️',
    99: 'Сильная гроза с градом ⛈️'
  };
  return weatherMap[code] || `Код погоды: ${code}`;
}

/**
 * Определение типа осадков
 */
function getPrecipitationType(rain, snow) {
  if (snow > 0) {
    if (snow < 1) return 'Небольшой снег ❄️';
    if (snow < 3) return 'Снег ❄️';
    return 'Сильный снегопад ❄️❄️';
  }
  if (rain > 0) {
    if (rain < 1) return 'Небольшой дождь 🌦️';
    if (rain < 3) return 'Дождь 🌧️';
    return 'Сильный дождь 🌧️🌧️';
  }
  return 'Без осадков ✨';
}

// ===================== УЛУЧШЕННАЯ ФУНКЦИЯ ПОГОДЫ НА СЕЙЧАС =====================
async function getWeatherData(cityName, forceRefresh = false) {
  try {
    if (!cityName) {
      return { success: false, error: 'Город не указан', city: 'Неизвестно' };
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
    
    // Расширенный запрос
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?
      latitude=${latitude}
      &longitude=${longitude}
      &current=
        temperature_2m,
        apparent_temperature,
        relative_humidity_2m,
        wind_speed_10m,
        wind_direction_10m,
        wind_gusts_10m,
        pressure_msl,
        precipitation,
        rain,
        snowfall,
        weather_code,
        cloud_cover,
        visibility,
        is_day
      &daily=
        temperature_2m_max,
        temperature_2m_min,
        sunrise,
        sunset,
        precipitation_sum
      &wind_speed_unit=ms
      &timezone=auto
      &forecast_days=1`.replace(/\s+/g, '');
    
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    if (!weatherData.current) {
      throw new Error('Нет данных о погоде');
    }
    
    const current = weatherData.current;
    const daily = weatherData.daily;
    
    // Преобразование давления
    const pressureMmHg = current.pressure_msl ? Math.round(current.pressure_msl * 0.750062) : null;
    
    // Направление ветра
    const windDir = getWindDirection(current.wind_direction_10m);
    
    // Тип осадков
    const precipType = getPrecipitationType(current.rain || 0, current.snowfall || 0);
    const hasPrecipitation = (current.rain > 0 || current.snowfall > 0);
    
    // Описание облачности
    const cloudDesc = getCloudDescription(current.cloud_cover);
    
    // Видимость
    const visibilityKm = current.visibility ? (current.visibility / 1000).toFixed(1) : '>10';
    
    // Восход/закат
    const sunrise = daily?.sunrise?.[0]?.substring(11, 16) || '—';
    const sunset = daily?.sunset?.[0]?.substring(11, 16) || '—';
    
    // Комфортность
    let comfortLevel = 'Комфортно 👍';
    if (current.temperature_2m < 0) comfortLevel = 'Холодно 🥶';
    if (current.temperature_2m > 25) comfortLevel = 'Жарко 🥵';
    if (current.wind_speed_10m > 8) comfortLevel = 'Ветрено 🌪️';
    if (current.precipitation > 2) comfortLevel = 'Сыро 🌧️';
    
    const weatherResult = {
      success: true,
      city: name,
      timestamp: new Date().toLocaleTimeString('ru-RU'),
      date: new Date().toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      isDay: current.is_day === 1,
      
      // Температура
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      temp_min: daily?.temperature_2m_min ? Math.round(daily.temperature_2m_min[0]) : null,
      temp_max: daily?.temperature_2m_max ? Math.round(daily.temperature_2m_max[0]) : null,
      
      // Влажность и осадки
      humidity: current.relative_humidity_2m,
      precipitation_now: current.precipitation || 0,
      rain_now: current.rain || 0,
      snow_now: current.snowfall || 0,
      precip_type: precipType,
      has_precipitation: hasPrecipitation,
      precipitation_today: daily?.precipitation_sum?.[0] || 0,
      
      // Ветер
      wind_speed: current.wind_speed_10m?.toFixed(1) || '0',
      wind_gusts: current.wind_gusts_10m?.toFixed(1) || null,
      wind_dir: windDir,
      
      // Давление
      pressure: pressureMmHg,
      
      // Облачность
      cloud_cover: current.cloud_cover || 0,
      cloud_desc: cloudDesc,
      
      // Видимость
      visibility_km: visibilityKm,
      
      // Астрономия
      sunrise: sunrise,
      sunset: sunset,
      day_length: calculateDayLength(sunrise, sunset),
      
      // Комфорт
      comfort: comfortLevel,
      
      // Описание
      weather_code: current.weather_code,
      description: getWeatherDescription(current.weather_code)
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
      city: cityName
    };
  }
}

// ===================== РАСШИРЕННЫЙ ПРОГНОЗ НА СЕГОДНЯ (ПО ПЕРИОДАМ) =====================
async function getDetailedTodayWeather(cityName, forceRefresh = false) {
  try {
    if (!cityName) {
      return { success: false, error: 'Город не указан', city: 'Неизвестно' };
    }
    
    const cacheKey = `detailed_today_${cityName.toLowerCase()}`;
    const now = Date.now();
    
    if (!forceRefresh && weatherCache.has(cacheKey)) {
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
    
    // РАСШИРЕННЫЙ ЗАПРОС С ДАВЛЕНИЕМ И ОСАДКАМИ
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?
      latitude=${latitude}
      &longitude=${longitude}
      &hourly=
        temperature_2m,
        apparent_temperature,
        precipitation_probability,
        precipitation,
        rain,
        snowfall,
        weather_code,
        wind_speed_10m,
        wind_direction_10m,
        wind_gusts_10m,
        pressure_msl,
        cloud_cover,
        visibility,
        is_day
      &daily=
        temperature_2m_max,
        temperature_2m_min,
        apparent_temperature_max,
        apparent_temperature_min,
        sunrise,
        sunset,
        uv_index_max,
        precipitation_sum,
        precipitation_hours,
        precipitation_probability_max,
        wind_speed_10m_max,
        wind_gusts_10m_max,
        wind_direction_10m_dominant
      &wind_speed_unit=ms
      &timezone=auto
      &forecast_days=1`.replace(/\s+/g, '');
    
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();
    
    if (!forecastData.hourly || !forecastData.daily) {
      throw new Error('Нет данных прогноза');
    }
    
    const todayDate = new Date();
    const todayDateStr = todayDate.toISOString().split('T')[0];
    
    // Получаем индексы часов на сегодня
    const todayHours = [];
    forecastData.hourly.time.forEach((time, index) => {
      if (time.startsWith(todayDateStr)) {
        todayHours.push(index);
      }
    });
    
    if (todayHours.length === 0) {
      throw new Error('Нет данных на сегодня');
    }
    
    // Периоды дня
    const periods = {
      'ночь': { start: 0, end: 5, emoji: '🌙', title: 'Ночь (00:00-06:00)' },
      'утро': { start: 6, end: 11, emoji: '🌅', title: 'Утро (06:00-12:00)' },
      'день': { start: 12, end: 17, emoji: '☀️', title: 'День (12:00-18:00)' },
      'вечер': { start: 18, end: 23, emoji: '🌆', title: 'Вечер (18:00-00:00)' }
    };
    
    const periodData = {};
    let maxTemp = -100;
    let minTemp = 100;
    let maxWindGust = 0;
    let totalPrecip = 0;
    
    for (const [periodName, range] of Object.entries(periods)) {
      const periodHours = todayHours.filter(index => {
        const hour = new Date(forecastData.hourly.time[index]).getHours();
        return hour >= range.start && hour <= range.end;
      });
      
      if (periodHours.length > 0) {
        // Собираем данные по периоду
        const temps = periodHours.map(i => forecastData.hourly.temperature_2m[i]);
        const feels = periodHours.map(i => forecastData.hourly.apparent_temperature[i]);
        const precipProb = periodHours.map(i => forecastData.hourly.precipitation_probability[i] || 0);
        const precip = periodHours.map(i => forecastData.hourly.precipitation[i] || 0);
        const rain = periodHours.map(i => forecastData.hourly.rain[i] || 0);
        const snow = periodHours.map(i => forecastData.hourly.snowfall[i] || 0);
        const weatherCodes = periodHours.map(i => forecastData.hourly.weather_code[i]);
        const windSpeed = periodHours.map(i => forecastData.hourly.wind_speed_10m[i]);
        const windGusts = periodHours.map(i => forecastData.hourly.wind_gusts_10m[i] || 0);
        const pressure = periodHours.map(i => forecastData.hourly.pressure_msl[i] || 0);
        const cloudCover = periodHours.map(i => forecastData.hourly.cloud_cover[i] || 0);
        
        const tempMin = Math.min(...temps);
        const tempMax = Math.max(...temps);
        const feelsMin = Math.min(...feels);
        const feelsMax = Math.max(...feels);
        const precipProbAvg = Math.round(precipProb.reduce((a, b) => a + b, 0) / precipProb.length);
        const precipSum = precip.reduce((a, b) => a + b, 0);
        const rainSum = rain.reduce((a, b) => a + b, 0);
        const snowSum = snow.reduce((a, b) => a + b, 0);
        const windAvg = (windSpeed.reduce((a, b) => a + b, 0) / windSpeed.length).toFixed(1);
        const windGustsMax = Math.max(...windGusts).toFixed(1);
        const pressureAvg = pressure.length > 0 ? Math.round(pressure.reduce((a, b) => a + b, 0) / pressure.length * 0.750062) : null;
        const cloudAvg = Math.round(cloudCover.reduce((a, b) => a + b, 0) / cloudCover.length);
        
        // Самый частый код погоды
        const codeFreq = {};
        weatherCodes.forEach(code => {
          codeFreq[code] = (codeFreq[code] || 0) + 1;
        });
        const mostFrequentCode = Object.keys(codeFreq).reduce((a, b) => 
          codeFreq[a] >= codeFreq[b] ? a : b
        );
        
        maxTemp = Math.max(maxTemp, tempMax);
        minTemp = Math.min(minTemp, tempMin);
        maxWindGust = Math.max(maxWindGust, parseFloat(windGustsMax));
        totalPrecip += precipSum;
        
        let precipType = 'Без осадков ✨';
        if (snowSum > 0) {
          if (snowSum < 1) precipType = 'Небольшой снег ❄️';
          else if (snowSum < 3) precipType = 'Снег ❄️';
          else precipType = 'Сильный снегопад ❄️❄️';
        } else if (rainSum > 0) {
          if (rainSum < 1) precipType = 'Небольшой дождь 🌦️';
          else if (rainSum < 3) precipType = 'Дождь 🌧️';
          else precipType = 'Сильный дождь 🌧️🌧️';
        }
        
        periodData[periodName] = {
          title: range.title,
          emoji: range.emoji,
          temp_min: Math.round(tempMin),
          temp_max: Math.round(tempMax),
          feels_min: Math.round(feelsMin),
          feels_max: Math.round(feelsMax),
          precip_prob: precipProbAvg,
          precip_sum: precipSum.toFixed(1),
          precip_type: precipType,
          rain_sum: rainSum.toFixed(1),
          snow_sum: snowSum.toFixed(1),
          wind_avg: windAvg,
          wind_gusts_max: windGustsMax,
          pressure_avg: pressureAvg,
          cloud_avg: cloudAvg,
          weather_code: parseInt(mostFrequentCode),
          description: getWeatherDescription(parseInt(mostFrequentCode))
        };
      }
    }
    
    const daily = forecastData.daily;
    const sunrise = daily?.sunrise?.[0]?.substring(11, 16) || '—';
    const sunset = daily?.sunset?.[0]?.substring(11, 16) || '—';
    const uvMax = daily?.uv_index_max?.[0]?.toFixed(1) || '—';
    
    const forecastResult = {
      success: true,
      city: name,
      date: todayDate.toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }),
      temp_min: minTemp !== 100 ? Math.round(minTemp) : null,
      temp_max: maxTemp !== -100 ? Math.round(maxTemp) : null,
      feels_min: daily?.apparent_temperature_min ? Math.round(daily.apparent_temperature_min[0]) : null,
      feels_max: daily?.apparent_temperature_max ? Math.round(daily.apparent_temperature_max[0]) : null,
      precipitation_today: daily?.precipitation_sum?.[0] || 0,
      precipitation_hours: daily?.precipitation_hours?.[0] || 0,
      precipitation_prob_max: daily?.precipitation_probability_max?.[0] || 0,
      wind_max: daily?.wind_speed_10m_max?.[0]?.toFixed(1) || '—',
      wind_gusts_max: daily?.wind_gusts_10m_max?.[0]?.toFixed(1) || '—',
      wind_dir: getWindDirection(daily?.wind_direction_10m_dominant?.[0]),
      uv_max: uvMax,
      sunrise: sunrise,
      sunset: sunset,
      day_length: calculateDayLength(sunrise, sunset),
      periods: periodData,
      updated: new Date().toLocaleTimeString('ru-RU')
    };
    
    weatherCache.set(cacheKey, { data: forecastResult, timestamp: now });
    return forecastResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения детального прогноза:', error.message);
    return {
      success: false,
      error: `Не удалось получить прогноз: ${error.message}`,
      city: cityName
    };
  }
}

// ===================== РАСШИРЕННЫЙ ПРОГНОЗ НА ЗАВТРА =====================
async function getWeatherForecast(cityName, forceRefresh = false) {
  try {
    if (!cityName) {
      return { success: false, error: 'Город не указан', city: 'Неизвестно' };
    }
    
    const cacheKey = `forecast_${cityName.toLowerCase()}`;
    const now = Date.now();
    
    if (!forceRefresh && weatherCache.has(cacheKey)) {
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
    
    // РАСШИРЕННЫЙ ЗАПРОС НА ЗАВТРА
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?
      latitude=${latitude}
      &longitude=${longitude}
      &hourly=
        temperature_2m,
        apparent_temperature,
        precipitation_probability,
        precipitation,
        rain,
        snowfall,
        weather_code,
        wind_speed_10m,
        wind_direction_10m,
        wind_gusts_10m,
        pressure_msl,
        cloud_cover,
        visibility,
        is_day
      &daily=
        temperature_2m_max,
        temperature_2m_min,
        apparent_temperature_max,
        apparent_temperature_min,
        sunrise,
        sunset,
        uv_index_max,
        precipitation_sum,
        precipitation_hours,
        precipitation_probability_max,
        wind_speed_10m_max,
        wind_gusts_10m_max,
        wind_direction_10m_dominant
      &wind_speed_unit=ms
      &timezone=auto
      &forecast_days=2`.replace(/\s+/g, '');
    
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();
    
    if (!forecastData.hourly || !forecastData.daily) {
      throw new Error('Нет данных прогноза');
    }
    
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowDateStr = tomorrowDate.toISOString().split('T')[0];
    
    // Получаем индексы часов на завтра
    const tomorrowHours = [];
    forecastData.hourly.time.forEach((time, index) => {
      if (time.startsWith(tomorrowDateStr)) {
        tomorrowHours.push(index);
      }
    });
    
    if (tomorrowHours.length === 0) {
      throw new Error('Нет данных на завтра');
    }
    
    // Периоды дня
    const periods = {
      'ночь': { start: 0, end: 5, emoji: '🌙', title: 'Ночь (00:00-06:00)' },
      'утро': { start: 6, end: 11, emoji: '🌅', title: 'Утро (06:00-12:00)' },
      'день': { start: 12, end: 17, emoji: '☀️', title: 'День (12:00-18:00)' },
      'вечер': { start: 18, end: 23, emoji: '🌆', title: 'Вечер (18:00-00:00)' }
    };
    
    const periodData = {};
    let maxTemp = -100;
    let minTemp = 100;
    let maxWindGust = 0;
    let totalPrecip = 0;
    
    for (const [periodName, range] of Object.entries(periods)) {
      const periodHours = tomorrowHours.filter(index => {
        const hour = new Date(forecastData.hourly.time[index]).getHours();
        return hour >= range.start && hour <= range.end;
      });
      
      if (periodHours.length > 0) {
        // Собираем данные по периоду
        const temps = periodHours.map(i => forecastData.hourly.temperature_2m[i]);
        const feels = periodHours.map(i => forecastData.hourly.apparent_temperature[i]);
        const precipProb = periodHours.map(i => forecastData.hourly.precipitation_probability[i] || 0);
        const precip = periodHours.map(i => forecastData.hourly.precipitation[i] || 0);
        const rain = periodHours.map(i => forecastData.hourly.rain[i] || 0);
        const snow = periodHours.map(i => forecastData.hourly.snowfall[i] || 0);
        const weatherCodes = periodHours.map(i => forecastData.hourly.weather_code[i]);
        const windSpeed = periodHours.map(i => forecastData.hourly.wind_speed_10m[i]);
        const windGusts = periodHours.map(i => forecastData.hourly.wind_gusts_10m[i] || 0);
        const pressure = periodHours.map(i => forecastData.hourly.pressure_msl[i] || 0);
        const cloudCover = periodHours.map(i => forecastData.hourly.cloud_cover[i] || 0);
        
        const tempMin = Math.min(...temps);
        const tempMax = Math.max(...temps);
        const feelsMin = Math.min(...feels);
        const feelsMax = Math.max(...feels);
        const precipProbAvg = Math.round(precipProb.reduce((a, b) => a + b, 0) / precipProb.length);
        const precipSum = precip.reduce((a, b) => a + b, 0);
        const rainSum = rain.reduce((a, b) => a + b, 0);
        const snowSum = snow.reduce((a, b) => a + b, 0);
        const windAvg = (windSpeed.reduce((a, b) => a + b, 0) / windSpeed.length).toFixed(1);
        const windGustsMax = Math.max(...windGusts).toFixed(1);
        const pressureAvg = pressure.length > 0 ? Math.round(pressure.reduce((a, b) => a + b, 0) / pressure.length * 0.750062) : null;
        const cloudAvg = Math.round(cloudCover.reduce((a, b) => a + b, 0) / cloudCover.length);
        
        // Самый частый код погоды
        const codeFreq = {};
        weatherCodes.forEach(code => {
          codeFreq[code] = (codeFreq[code] || 0) + 1;
        });
        const mostFrequentCode = Object.keys(codeFreq).reduce((a, b) => 
          codeFreq[a] >= codeFreq[b] ? a : b
        );
        
        maxTemp = Math.max(maxTemp, tempMax);
        minTemp = Math.min(minTemp, tempMin);
        maxWindGust = Math.max(maxWindGust, parseFloat(windGustsMax));
        totalPrecip += precipSum;
        
        let precipType = 'Без осадков ✨';
        if (snowSum > 0) {
          if (snowSum < 1) precipType = 'Небольшой снег ❄️';
          else if (snowSum < 3) precipType = 'Снег ❄️';
          else precipType = 'Сильный снегопад ❄️❄️';
        } else if (rainSum > 0) {
          if (rainSum < 1) precipType = 'Небольшой дождь 🌦️';
          else if (rainSum < 3) precipType = 'Дождь 🌧️';
          else precipType = 'Сильный дождь 🌧️🌧️';
        }
        
        periodData[periodName] = {
          title: range.title,
          emoji: range.emoji,
          temp_min: Math.round(tempMin),
          temp_max: Math.round(tempMax),
          feels_min: Math.round(feelsMin),
          feels_max: Math.round(feelsMax),
          precip_prob: precipProbAvg,
          precip_sum: precipSum.toFixed(1),
          precip_type: precipType,
          rain_sum: rainSum.toFixed(1),
          snow_sum: snowSum.toFixed(1),
          wind_avg: windAvg,
          wind_gusts_max: windGustsMax,
          pressure_avg: pressureAvg,
          cloud_avg: cloudAvg,
          weather_code: parseInt(mostFrequentCode),
          description: getWeatherDescription(parseInt(mostFrequentCode))
        };
      }
    }
    
    const tomorrowIndex = 1;
    const daily = forecastData.daily;
    const sunrise = daily?.sunrise?.[tomorrowIndex]?.substring(11, 16) || '—';
    const sunset = daily?.sunset?.[tomorrowIndex]?.substring(11, 16) || '—';
    const uvMax = daily?.uv_index_max?.[tomorrowIndex]?.toFixed(1) || '—';
    
    const forecastResult = {
      success: true,
      city: name,
      date: tomorrowDate.toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }),
      temp_min: minTemp !== 100 ? Math.round(minTemp) : null,
      temp_max: maxTemp !== -100 ? Math.round(maxTemp) : null,
      feels_min: daily?.apparent_temperature_min ? Math.round(daily.apparent_temperature_min[tomorrowIndex]) : null,
      feels_max: daily?.apparent_temperature_max ? Math.round(daily.apparent_temperature_max[tomorrowIndex]) : null,
      precipitation_tomorrow: daily?.precipitation_sum?.[tomorrowIndex] || 0,
      precipitation_hours: daily?.precipitation_hours?.[tomorrowIndex] || 0,
      precipitation_prob_max: daily?.precipitation_probability_max?.[tomorrowIndex] || 0,
      wind_max: daily?.wind_speed_10m_max?.[tomorrowIndex]?.toFixed(1) || '—',
      wind_gusts_max: daily?.wind_gusts_10m_max?.[tomorrowIndex]?.toFixed(1) || '—',
      wind_dir: getWindDirection(daily?.wind_direction_10m_dominant?.[tomorrowIndex]),
      uv_max: uvMax,
      sunrise: sunrise,
      sunset: sunset,
      day_length: calculateDayLength(sunrise, sunset),
      periods: periodData,
      updated: new Date().toLocaleTimeString('ru-RU')
    };
    
    weatherCache.set(cacheKey, { data: forecastResult, timestamp: now });
    return forecastResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения прогноза:', error.message);
    return {
      success: false,
      error: `Не удалось получить прогноз: ${error.message}`,
      city: cityName
    };
  }
}

// ===================== ФУНКЦИЯ РЕКОМЕНДАЦИЙ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(weatherData) {
  if (!weatherData || !weatherData.success) {
    return '❌ Нет данных о погоде для рекомендаций по одежде.';
  }
  
  const { 
    temp, 
    feels_like, 
    wind_speed, 
    rain_now, 
    snow_now, 
    has_precipitation,
    precip_type,
    city,
    description
  } = weatherData;
  
  const advice = [];
  
  // Заголовок
  advice.push(`👕 *Что надеть в ${city} сейчас?*\n`);
  advice.push(`🌡️ *Сейчас:* ${temp}°C (ощущается ${feels_like}°C)`);
  if (description) advice.push(`📝 ${description}\n`);
  
  // Основные слои по температуре
  advice.push('\n📋 *Одеваемся по погоде:*\n');
  
  if (temp >= 25) {
    advice.push('👕 *Базовый слой:* майка, футболка из хлопка');
    advice.push('🩳 *Низ:* шорты, легкие брюки, юбка');
    advice.push('👟 *Обувь:* сандалии, кеды');
    advice.push('🕶️ *Аксессуары:* кепка, солнцезащитные очки');
  } 
  else if (temp >= 20) {
    advice.push('👕 *Базовый слой:* футболка, рубашка');
    advice.push('👖 *Низ:* джинсы, брюки');
    advice.push('👟 *Обувь:* кроссовки, кеды');
    advice.push('🧥 *На вечер:* легкая кофта, джинсовка');
  } 
  else if (temp >= 15) {
    advice.push('👕 *Базовый слой:* лонгслив, рубашка с длинным рукавом');
    advice.push('🧥 *Верх:* свитер, худи, легкая куртка');
    advice.push('👖 *Низ:* джинсы, брюки');
    advice.push('👟 *Обувь:* кроссовки, ботинки');
  } 
  else if (temp >= 10) {
    advice.push('👕 *Базовый слой:* термобелье, лонгслив');
    advice.push('🧥 *Верх:* свитер, худи, ветровка');
    advice.push('👖 *Низ:* джинсы, утепленные брюки');
    advice.push('👟 *Обувь:* кроссовки, ботинки');
    advice.push('🧣 *Аксессуары:* шарф');
  } 
  else if (temp >= 5) {
    advice.push('👕 *Базовый слой:* термобелье, флисовая кофта');
    advice.push('🧥 *Верх:* теплый свитер, зимняя куртка');
    advice.push('👖 *Низ:* утепленные штаны');
    advice.push('👟 *Обувь:* зимние ботинки');
    advice.push('🧣 *Аксессуары:* шапка, шарф, перчатки');
  } 
  else if (temp >= 0) {
    advice.push('👕 *Базовый слой:* термобелье, флис');
    advice.push('🧥 *Верх:* пуховик, зимняя куртка');
    advice.push('👖 *Низ:* утепленные штаны');
    advice.push('👟 *Обувь:* зимние ботинки с мехом');
    advice.push('🧣 *Аксессуары:* шапка, шарф, варежки');
  } 
  else {
    advice.push('👕 *Базовый слой:* плотное термобелье, флис');
    advice.push('🧥 *Верх:* пуховик, парка');
    advice.push('👖 *Низ:* термоштаны, утепленные брюки');
    advice.push('👟 *Обувь:* зимние ботинки -25°C');
    advice.push('🧣 *Аксессуары:* шапка, шарф, варежки, балаклава');
  }
  
  // Рекомендации по осадкам
  if (has_precipitation) {
    advice.push('\n🌧️ *Идут осадки:*');
    if (snow_now > 0) {
      advice.push('   • ❄️ Непромокаемая обувь');
      advice.push('   • 🧤 Варежки, а не перчатки');
      advice.push('   • 🧣 Шарф для защиты лица');
    } else if (rain_now > 0) {
      advice.push('   • ☔ Зонт или дождевик');
      advice.push('   • 👢 Непромокаемая обувь');
      advice.push('   • 🧥 Куртка с капюшоном');
    }
  }
  
  // Рекомендации по ветру
  if (wind_speed && parseFloat(wind_speed) > 5) {
    advice.push('\n💨 *Ветрено:*');
    advice.push('   • 🧥 Непродуваемая куртка');
    advice.push('   • 🧣 Шарф для защиты шеи');
    if (parseFloat(wind_speed) > 10) {
      advice.push('   • 🧢 Шапка, которая не слетит');
    }
  }
  
  // Ощущаемая температура
  const tempDiff = Math.abs(temp - feels_like);
  if (tempDiff > 2) {
    advice.push('\n🌡️ *Важно:*');
    if (feels_like < temp) {
      advice.push(`   • 🥶 Реально холоднее на ${tempDiff}°C - одевайтесь теплее!`);
    } else {
      advice.push(`   • 🥵 Реально теплее на ${tempDiff}°C - можно легче`);
    }
  }
  
  // Что взять с собой
  advice.push('\n🎒 *Что взять с собой:*');
  advice.push('   • 💧 Бутылка воды');
  advice.push('   • 🔋 Power bank');
  if (has_precipitation) advice.push('   • ☂️ Зонт');
  if (temp > 20) advice.push('   • 🧴 Солнцезащитный крем');
  if (temp < 5) advice.push('   • 🧤 Запасные перчатки');
  
  return advice.join('\n');
}

// ===================== ФУНКЦИИ ДЛЯ РАБОТЫ С ГОРОДАМИ =====================
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

// ===================== ФУНКЦИИ СТАТИСТИКИ =====================
async function getGameStatsMessage(userId) {
  try {
    console.log(`📊 Получение статистики для: ${userId}`);
    
    const telegramUserId = userId.toString();
    
    const client = await pool.connect();
    
    try {
      let city = 'Не указан';
      let username = 'Игрок';
      
      const userResult = await client.query(
        'SELECT city, username, first_name FROM users WHERE user_id = $1',
        [telegramUserId]
      );
      
      if (userResult.rows.length > 0) {
        city = userResult.rows[0].city || 'Не указан';
        username = userResult.rows[0].username || userResult.rows[0].first_name || 'Игрок';
      }
      
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
      
      const progressQuery = `
        SELECT score, level, lines, last_saved 
        FROM game_progress 
        WHERE user_id = $1 AND game_type = 'tetris'
      `;
      
      const progressResult = await client.query(progressQuery, [telegramUserId]);
      const hasUnfinishedGame = progressResult.rows.length > 0;
      
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
      } else {
        message += `🎮 *Вы ещё не играли в тетрис!*\n\n`;
      }
      
      message += `📍 *Город:* ${city}\n`;
      if (city === 'Не указан') {
        message += `⚠️ *Укажите город:* /city [название]\n\n`;
      }
      message += `👤 *Игрок:* ${username}`;
      
      return message;
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Ошибка в getGameStatsMessage:', error);
    return `❌ Ошибка загрузки статистики.`;
  }
}

// ===================== ИСПРАВЛЕННАЯ ФУНКЦИЯ ТОПА ИГРОКОВ =====================
async function getTopPlayersMessage(limit = 10, ctx = null) {
  try {
    console.log(`🏆 Получение топа ${limit} игроков...`);
    
    // ПРОВЕРЯЕМ, ЧТО POOL СУЩЕСТВУЕТ
    if (!pool) {
      console.error('❌ pool не определен!');
      
      // Пробуем импортировать pool заново
      try {
        const { pool: dbPool } = await import('./db.js');
        if (!dbPool) {
          return `🏆 *Топ игроков*\n\n` +
                 `❌ *Ошибка подключения к базе данных*\n\n` +
                 `📝 *Попробуйте позже или напишите /start*`;
        }
        
        // Используем новый pool
        const client = await dbPool.connect();
        try {
          return await fetchTopPlayersData(client, limit, ctx);
        } finally {
          client.release();
        }
      } catch (importError) {
        console.error('❌ Ошибка импорта pool:', importError);
        return `🏆 *Топ игроков*\n\n` +
               `❌ *Ошибка подключения к базе данных*\n\n` +
               `📝 *Попробуйте позже*`;
      }
    }
    
    // Если pool есть, используем его
    const client = await pool.connect();
    try {
      return await fetchTopPlayersData(client, limit, ctx);
    } catch (queryError) {
      console.error('❌ Ошибка запроса к БД:', queryError);
      
      // Если таблица не существует или другая ошибка БД
      return `🏆 *Топ игроков*\n\n` +
             `🎮 *Пока нет завершенных игр с хорошим результатом!*\n\n` +
             `📝 *Как попасть в топ:*\n` +
             `1. 🎮 Играйте в тетрис\n` +
             `2. 🎯 Наберите минимум *1000 очков*\n` +
             `3. ✅ Завершите игру\n` +
             `4. 📍 Укажите город: /city [город]\n\n` +
             `🎯 *Ваш первый рекорд появится здесь!*`;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Ошибка в getTopPlayersMessage:', error);
    
    // Возвращаем красивое сообщение вместо ошибки
    return `🏆 *Топ игроков*\n\n` +
           `🎮 *Статистика загружается...*\n\n` +
           `📝 *Как попасть в топ:*\n` +
           `1. 🎮 Играйте в тетрис\n` +
           `2. 🎯 Наберите минимум *1000 очков*\n` +
           `3. ✅ Завершите игру\n` +
           `4. 📍 Укажите город: /city [город]\n\n` +
           `🔄 *Попробуйте через минуту или напишите /start*`;
  }
}

// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ ДАННЫХ ТОПА
async function fetchTopPlayersData(client, limit, ctx) {
  try {
    // Упрощенный запрос (убрал сложные проверки)
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
      GROUP BY gs.user_id, u.username, gs.username, u.city, gs.city
      HAVING MAX(gs.score) >= 1000
      ORDER BY MAX(gs.score) DESC
      LIMIT $1
    `;
    
    const result = await client.query(topQuery, [limit]);
    console.log(`🏆 Найдено игроков в топе: ${result.rows.length}`);
    
    if (result.rows.length === 0) {
      return `🏆 *Топ игроков*\n\n` +
             `🎮 *Пока никто не набрал 1000+ очков!*\n\n` +
             `📝 *Как попасть в топ:*\n` +
             `1. 🎮 Играйте в тетрис\n` +
             `2. 🎯 Наберите минимум *1000 очков*\n` +
             `3. ✅ Завершите игру\n` +
             `4. 📍 Укажите город: /city [город]\n\n` +
             `🎯 *Будьте первым!*`;
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
      
      message += `${medal} *${player.display_name}*\n`;
      message += `   🎯 Очки: *${score}*\n`;
      message += `   📊 Уровень: ${level} | 📈 Линии: ${lines}\n`;
      
      if (player.city && player.city !== 'Не указан') {
        message += `   📍 Город: ${player.city}\n`;
      }
      
      message += '\n';
    });
    
    // Добавляем информацию о текущем пользователе
    if (ctx && ctx.from) {
      const currentUserId = ctx.from.id.toString();
      
      // Проверяем, есть ли пользователь в топе
      const isInTop = result.rows.some(p => p.user_id === currentUserId);
      
      if (!isInTop) {
        // Получаем лучший результат пользователя
        const userQuery = `
          SELECT MAX(score) as best_score
          FROM game_scores 
          WHERE user_id = $1 
            AND game_type = 'tetris'
            AND score > 0
        `;
        
        const userResult = await client.query(userQuery, [currentUserId]);
        const userBestScore = userResult.rows[0]?.best_score || 0;
        
        if (userBestScore > 0) {
          message += `👤 *Ваш лучший результат:* ${userBestScore} очков\n`;
          if (userBestScore < 1000) {
            message += `🎯 *Нужно минимум 1000 очков* для попадания в топ!\n\n`;
          } else {
            message += `🎯 *Вы почти в топе!* Сыграйте еще!\n\n`;
          }
        } else {
          message += `👤 *Вы еще не играли*\n`;
          message += `🎮 Начните игру: /tetris\n\n`;
        }
      }
      
      // Проверяем, указан ли город
      const cityQuery = 'SELECT city FROM users WHERE user_id = $1';
      const cityResult = await client.query(cityQuery, [currentUserId]);
      const userCity = cityResult.rows[0]?.city || 'Не указан';
      
      if (userCity === 'Не указан') {
        message += `📍 *Укажите город:* /city [город]\n\n`;
      }
    }
    
    message += `📝 *Как попасть в топ:*\n`;
    message += `• 🎮 Играйте в тетрис\n`;
    message += `• 🎯 Наберите *минимум 1000 очков*\n`;
    message += `• ✅ Завершите игру\n`;
    message += `• 📍 Укажите город: /city [город]\n\n`;
    message += `🔄 Топ обновляется после каждой игры`;
    
    return message;
    
  } catch (error) {
    console.error('❌ Ошибка в fetchTopPlayersData:', error);
    throw error; // Пробрасываем ошибку выше
  }
}
// ===================== ПОЛНЫЙ РАЗГОВОРНИК: 200+ ФРАЗ =====================
const dailyPhrases = [
  // ТРАНСПОРТ
  {
    english: "Where is the nearest bus stop?",
    russian: "Где ближайшая автобусная остановка?",
    explanation: "Спрашиваем про общественный транспорт",
    category: "Транспорт",
    level: "Начальный"
  },
  {
    english: "I'd like a window seat, please.",
    russian: "Я хотел бы место у окна, пожалуйста.",
    explanation: "Заказываем место в самолете или поезде",
    category: "Транспорт",
    level: "Средний"
  },
  {
    english: "What time is the last train?",
    russian: "Во сколько последний поезд?",
    explanation: "Уточняем расписание",
    category: "Транспорт",
    level: "Начальный"
  },
  {
    english: "How often do the buses run?",
    russian: "Как часто ходят автобусы?",
    explanation: "Интервал движения",
    category: "Транспорт",
    level: "Средний"
  },
  {
    english: "Is this the right platform for Oxford?",
    russian: "Это правильная платформа на Оксфорд?",
    explanation: "Проверяем платформу",
    category: "Транспорт",
    level: "Средний"
  },
  {
    english: "Do I need to validate my ticket?",
    russian: "Мне нужно компостировать билет?",
    explanation: "Спрашиваем про валидацию",
    category: "Транспорт",
    level: "Средний"
  },
  {
    english: "Can I pay by card?",
    russian: "Можно оплатить картой?",
    explanation: "Способ оплаты",
    category: "Транспорт",
    level: "Начальный"
  },
  {
    english: "A return ticket to Brighton, please.",
    russian: "Билет туда-обратно в Брайтон, пожалуйста.",
    explanation: "Покупаем билет",
    category: "Транспорт",
    level: "Начальный"
  },
  {
    english: "Is there a direct flight?",
    russian: "Есть прямой рейс?",
    explanation: "Без пересадок",
    category: "Транспорт",
    level: "Средний"
  },
  {
    english: "What's the boarding time?",
    russian: "Во сколько посадка?",
    explanation: "Уточняем время посадки",
    category: "Транспорт",
    level: "Начальный"
  },
  {
    english: "Which gate do I need?",
    russian: "Какой выход мне нужен?",
    explanation: "В аэропорту",
    category: "Транспорт",
    level: "Начальный"
  },
  {
    english: "I missed my connection.",
    russian: "Я опоздал на стыковку.",
    explanation: "Проблема в аэропорту",
    category: "Транспорт",
    level: "Средний"
  },
  {
    english: "Can you call me a taxi?",
    russian: "Вы можете вызвать мне такси?",
    explanation: "В отеле или ресторане",
    category: "Транспорт",
    level: "Начальный"
  },
  {
    english: "How much to the city center?",
    russian: "Сколько стоит до центра города?",
    explanation: "Торгуемся с таксистом",
    category: "Транспорт",
    level: "Начальный"
  },
  {
    english: "Keep the change.",
    russian: "Сдачи не надо.",
    explanation: "Чаевые таксисту",
    category: "Транспорт",
    level: "Средний"
  },
  {
    english: "I need to rent a car.",
    russian: "Мне нужно арендовать машину.",
    explanation: "В прокате авто",
    category: "Транспорт",
    level: "Средний"
  },
  {
    english: "Is insurance included?",
    russian: "Страховка включена?",
    explanation: "При аренде авто",
    category: "Транспорт",
    level: "Средний"
  },
  {
    english: "I'd like automatic transmission.",
    russian: "Я хотел бы автоматическую коробку.",
    explanation: "Выбор авто",
    category: "Транспорт",
    level: "Продвинутый"
  },
  {
    english: "Where can I park?",
    russian: "Где можно припарковаться?",
    explanation: "Поиск парковки",
    category: "Транспорт",
    level: "Начальный"
  },
  {
    english: "My car broke down.",
    russian: "Моя машина сломалась.",
    explanation: "Экстренная ситуация",
    category: "Транспорт",
    level: "Средний"
  },

  // ЕДА И РЕСТОРАНЫ
  {
    english: "Could you recommend a good restaurant?",
    russian: "Не могли бы вы порекомендовать хороший ресторан?",
    explanation: "Просим рекомендацию",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "A table for two, please.",
    russian: "Столик на двоих, пожалуйста.",
    explanation: "В ресторане",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "Do you have a vegetarian menu?",
    russian: "У вас есть вегетарианское меню?",
    explanation: "Особое питание",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "I'm allergic to nuts.",
    russian: "У меня аллергия на орехи.",
    explanation: "Предупреждение об аллергии",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "What's the dish of the day?",
    russian: "Какое блюдо дня?",
    explanation: "Спецпредложение",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "I'd like it medium rare.",
    russian: "Я хотел бы с кровью.",
    explanation: "Степень прожарки стейка",
    category: "Еда",
    level: "Продвинутый"
  },
  {
    english: "Could we see the wine list?",
    russian: "Можно посмотреть винную карту?",
    explanation: "Заказ вина",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "Is service included?",
    russian: "Обслуживание включено?",
    explanation: "Проверка счета",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "Can we sit outside?",
    russian: "Можно сесть на улице?",
    explanation: "На террасе",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "I didn't order this.",
    russian: "Я это не заказывал.",
    explanation: "Ошибка в заказе",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "Could we have some more bread?",
    russian: "Можно еще хлеба?",
    explanation: "Дополнительный заказ",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "Is this spicy?",
    russian: "Это острое?",
    explanation: "Уточняем остроту",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "I'd like the bill, please.",
    russian: "Счет, пожалуйста.",
    explanation: "Просим счет",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "We'd like to order.",
    russian: "Мы хотели бы сделать заказ.",
    explanation: "Готовы заказывать",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "What do you recommend?",
    russian: "Что вы порекомендуете?",
    explanation: "Совет официанта",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "Can I have this to go?",
    russian: "Можно это с собой?",
    explanation: "Еда на вынос",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "Is there a kids' menu?",
    russian: "Есть детское меню?",
    explanation: "Для детей",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "Could we change tables?",
    russian: "Можно пересесть?",
    explanation: "Смена столика",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "The food is cold.",
    russian: "Еда холодная.",
    explanation: "Жалоба",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "I'd like to make a reservation.",
    russian: "Я хотел бы забронировать столик.",
    explanation: "Бронь по телефону",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "For 7:30 PM.",
    russian: "На 19:30.",
    explanation: "Время брони",
    category: "Еда",
    level: "Начальный"
  },
  {
    english: "Do you have gluten-free options?",
    russian: "У вас есть безглютеновые блюда?",
    explanation: "Диетическое питание",
    category: "Еда",
    level: "Продвинутый"
  },
  {
    english: "Could we have a high chair?",
    russian: "Можно детский стульчик?",
    explanation: "Для ребенка",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "Is tap water free?",
    russian: "Вода из-под крана бесплатная?",
    explanation: "Экономим на воде",
    category: "Еда",
    level: "Средний"
  },
  {
    english: "Can I pay separately?",
    russian: "Можно оплатить отдельно?",
    explanation: "Раздельный счет",
    category: "Еда",
    level: "Средний"
  },

  // ПОКУПКИ
  {
    english: "How much does this cost?",
    russian: "Сколько это стоит?",
    explanation: "Спрашиваем цену",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "I'm just looking, thanks.",
    russian: "Я просто смотрю, спасибо.",
    explanation: "Отказ от помощи",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "Do you have this in a different color?",
    russian: "У вас есть это другого цвета?",
    explanation: "Выбор цвета",
    category: "Покупки",
    level: "Средний"
  },
  {
    english: "Can I try this on?",
    russian: "Можно это примерить?",
    explanation: "Примерка",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "Where are the fitting rooms?",
    russian: "Где примерочные?",
    explanation: "Поиск примерочной",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "It doesn't fit.",
    russian: "Не подходит по размеру.",
    explanation: "Неправильный размер",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "Do you have a larger size?",
    russian: "У вас есть размер побольше?",
    explanation: "Нужен больше",
    category: "Покупки",
    level: "Средний"
  },
  {
    english: "Is this on sale?",
    russian: "Это по акции?",
    explanation: "Скидка",
    category: "Покупки",
    level: "Средний"
  },
  {
    english: "Can I get a tax refund?",
    russian: "Можно вернуть налог?",
    explanation: "Tax Free",
    category: "Покупки",
    level: "Продвинутый"
  },
  {
    english: "I'd like to return this.",
    russian: "Я хотел бы вернуть это.",
    explanation: "Возврат товара",
    category: "Покупки",
    level: "Средний"
  },
  {
    english: "Do you offer gift wrapping?",
    russian: "У вас есть подарочная упаковка?",
    explanation: "Упаковка подарка",
    category: "Покупки",
    level: "Средний"
  },
  {
    english: "Is there a warranty?",
    russian: "Есть гарантия?",
    explanation: "На электронику",
    category: "Покупки",
    level: "Средний"
  },
  {
    english: "Can you order it for me?",
    russian: "Можете заказать для меня?",
    explanation: "Нет в наличии",
    category: "Покупки",
    level: "Средний"
  },
  {
    english: "I'll take it.",
    russian: "Я беру это.",
    explanation: "Решение купить",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "Where's the nearest supermarket?",
    russian: "Где ближайший супермаркет?",
    explanation: "Поиск продуктов",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "Do you have a loyalty card?",
    russian: "У вас есть карта лояльности?",
    explanation: "Скидочная карта",
    category: "Покупки",
    level: "Средний"
  },
  {
    english: "Can I have a receipt, please?",
    russian: "Можно чек, пожалуйста?",
    explanation: "Просим чек",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "Is this real leather?",
    russian: "Это настоящая кожа?",
    explanation: "Проверка материала",
    category: "Покупки",
    level: "Средний"
  },
  {
    english: "Where can I find cosmetics?",
    russian: "Где найти косметику?",
    explanation: "Отдел косметики",
    category: "Покупки",
    level: "Начальный"
  },
  {
    english: "Do you have this in stock?",
    russian: "Это есть в наличии?",
    explanation: "Наличие товара",
    category: "Покупки",
    level: "Средний"
  },

  // ЗДОРОВЬЕ
  {
    english: "I need to see a doctor.",
    russian: "Мне нужно к врачу.",
    explanation: "Вызов врача",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "Where's the nearest pharmacy?",
    russian: "Где ближайшая аптека?",
    explanation: "Поиск аптеки",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "I have a headache.",
    russian: "У меня болит голова.",
    explanation: "Симптомы",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "I feel dizzy.",
    russian: "У меня кружится голова.",
    explanation: "Плохое самочувствие",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I have a fever.",
    russian: "У меня температура.",
    explanation: "Жар",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "I need antibiotics.",
    russian: "Мне нужны антибиотики.",
    explanation: "По рецепту",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I'm allergic to penicillin.",
    russian: "У меня аллергия на пенициллин.",
    explanation: "Предупреждение",
    category: "Здоровье",
    level: "Продвинутый"
  },
  {
    english: "I have asthma.",
    russian: "У меня астма.",
    explanation: "Хроническое заболевание",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I need painkillers.",
    russian: "Мне нужны обезболивающие.",
    explanation: "От боли",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I think I broke my arm.",
    russian: "Кажется, я сломал руку.",
    explanation: "Травма",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "Call an ambulance!",
    russian: "Вызовите скорую!",
    explanation: "Экстренный вызов",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "I have diabetes.",
    russian: "У меня диабет.",
    explanation: "Важная информация",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I need insulin.",
    russian: "Мне нужен инсулин.",
    explanation: "Лекарство",
    category: "Здоровье",
    level: "Продвинутый"
  },
  {
    english: "I can't sleep.",
    russian: "Я не могу спать.",
    explanation: "Бессонница",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "Do I need a prescription?",
    russian: "Нужен рецепт?",
    explanation: "Уточнение",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I have heart problems.",
    russian: "У меня проблемы с сердцем.",
    explanation: "Сердечное заболевание",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I'm pregnant.",
    russian: "Я беременна.",
    explanation: "Важная информация",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "I need a dentist.",
    russian: "Мне нужен стоматолог.",
    explanation: "Зубная боль",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "I have a sore throat.",
    russian: "У меня болит горло.",
    explanation: "Простуда",
    category: "Здоровье",
    level: "Начальный"
  },
  {
    english: "Is it serious?",
    russian: "Это серьезно?",
    explanation: "Оценка состояния",
    category: "Здоровье",
    level: "Средний"
  },

  // ГОСТИНИЦА
  {
    english: "I have a reservation.",
    russian: "У меня забронировано.",
    explanation: "На ресепшн",
    category: "Гостиница",
    level: "Начальный"
  },
  {
    english: "Check-in, please.",
    russian: "Заселение, пожалуйста.",
    explanation: "Прибытие в отель",
    category: "Гостиница",
    level: "Начальный"
  },
  {
    english: "What time is check-out?",
    russian: "Во сколько выезд?",
    explanation: "Время выезда",
    category: "Гостиница",
    level: "Начальный"
  },
  {
    english: "Can I have a late check-out?",
    russian: "Можно поздний выезд?",
    explanation: "Дополнительное время",
    category: "Гостиница",
    level: "Средний"
  },
  {
    english: "Is breakfast included?",
    russian: "Завтрак включен?",
    explanation: "Уточнение",
    category: "Гостиница",
    level: "Начальный"
  },
  {
    english: "The air conditioner doesn't work.",
    russian: "Кондиционер не работает.",
    explanation: "Проблема в номере",
    category: "Гостиница",
    level: "Средний"
  },
  {
    english: "There's no hot water.",
    russian: "Нет горячей воды.",
    explanation: "Проблема в номере",
    category: "Гостиница",
    level: "Средний"
  },
  {
    english: "Could I have extra towels?",
    russian: "Можно дополнительные полотенца?",
    explanation: "В номер",
    category: "Гостиница",
    level: "Средний"
  },
  {
    english: "Is there WiFi in the room?",
    russian: "В номере есть WiFi?",
    explanation: "Интернет",
    category: "Гостиница",
    level: "Начальный"
  },
  {
    english: "What's the WiFi password?",
    russian: "Какой пароль от WiFi?",
    explanation: "Доступ в интернет",
    category: "Гостиница",
    level: "Начальный"
  },
  {
    english: "Can you store my luggage?",
    russian: "Можете оставить мой багаж?",
    explanation: "Камера хранения",
    category: "Гостиница",
    level: "Средний"
  },
  {
    english: "I need a wake-up call at 7 AM.",
    russian: "Мне нужен звонок-будильник в 7 утра.",
    explanation: "Будильник",
    category: "Гостиница",
    level: "Средний"
  },
  {
    english: "Can I change rooms?",
    russian: "Можно поменять номер?",
    explanation: "Смена номера",
    category: "Гостиница",
    level: "Средний"
  },
  {
    english: "Is there a gym?",
    russian: "У вас есть тренажерный зал?",
    explanation: "Услуги отеля",
    category: "Гостиница",
    level: "Средний"
  },
  {
    english: "Do you have a swimming pool?",
    russian: "У вас есть бассейн?",
    explanation: "Удобства",
    category: "Гостиница",
    level: "Начальный"
  },

  // ОРИЕНТАЦИЯ В ГОРОДЕ
  {
    english: "How do I get to the museum?",
    russian: "Как мне добраться до музея?",
    explanation: "Маршрут",
    category: "Город",
    level: "Начальный"
  },
  {
    english: "Is it far from here?",
    russian: "Это далеко отсюда?",
    explanation: "Расстояние",
    category: "Город",
    level: "Начальный"
  },
  {
    english: "Can I walk there?",
    russian: "Туда можно дойти пешком?",
    explanation: "Пешая доступность",
    category: "Город",
    level: "Средний"
  },
  {
    english: "Which bus goes to the beach?",
    russian: "Какой автобус идет на пляж?",
    explanation: "Общественный транспорт",
    category: "Город",
    level: "Средний"
  },
  {
    english: "Where's the city center?",
    russian: "Где центр города?",
    explanation: "Ориентация",
    category: "Город",
    level: "Начальный"
  },
  {
    english: "I'm lost.",
    russian: "Я заблудился.",
    explanation: "Потерялся",
    category: "Город",
    level: "Начальный"
  },
  {
    english: "Can you show me on the map?",
    russian: "Можете показать на карте?",
    explanation: "Просьба показать",
    category: "Город",
    level: "Средний"
  },
  {
    english: "What's the address?",
    russian: "Какой адрес?",
    explanation: "Уточнение",
    category: "Город",
    level: "Начальный"
  },
  {
    english: "Turn left at the traffic lights.",
    russian: "Поверните налево на светофоре.",
    explanation: "Маршрут",
    category: "Город",
    level: "Средний"
  },
  {
    english: "Is this the way to the station?",
    russian: "Это дорога к вокзалу?",
    explanation: "Проверка маршрута",
    category: "Город",
    level: "Средний"
  },
  {
    english: "Go straight ahead.",
    russian: "Идите прямо.",
    explanation: "Направление",
    category: "Город",
    level: "Начальный"
  },
  {
    english: "It's around the corner.",
    russian: "Это за углом.",
    explanation: "Близко",
    category: "Город",
    level: "Начальный"
  },
  {
    english: "I'm looking for this street.",
    russian: "Я ищу эту улицу.",
    explanation: "Поиск",
    category: "Город",
    level: "Средний"
  },
  {
    english: "What's the best route?",
    russian: "Какой лучший маршрут?",
    explanation: "Оптимальный путь",
    category: "Город",
    level: "Средний"
  },
  {
    english: "Is it safe to walk at night?",
    russian: "Здесь безопасно гулять ночью?",
    explanation: "Безопасность",
    category: "Город",
    level: "Средний"
  },

  // ЭКСТРЕННЫЕ СЛУЧАИ
  {
    english: "Help!",
    russian: "Помогите!",
    explanation: "Крик о помощи",
    category: "Экстренное",
    level: "Начальный"
  },
  {
    english: "Call the police!",
    russian: "Вызовите полицию!",
    explanation: "Экстренный вызов",
    category: "Экстренное",
    level: "Начальный"
  },
  {
    english: "There's a fire!",
    russian: "Пожар!",
    explanation: "Пожарная тревога",
    category: "Экстренное",
    level: "Начальный"
  },
  {
    english: "I've been robbed.",
    russian: "Меня ограбили.",
    explanation: "Кража",
    category: "Экстренное",
    level: "Средний"
  },
  {
    english: "I lost my passport.",
    russian: "Я потерял паспорт.",
    explanation: "Потеря документа",
    category: "Экстренное",
    level: "Средний"
  },
  {
    english: "My wallet was stolen.",
    russian: "У меня украли кошелек.",
    explanation: "Кража",
    category: "Экстренное",
    level: "Средний"
  },
  {
    english: "I need to contact the embassy.",
    russian: "Мне нужно связаться с посольством.",
    explanation: "ЧП за границей",
    category: "Экстренное",
    level: "Средний"
  },
  {
    english: "There's been an accident.",
    russian: "Произошла авария.",
    explanation: "Сообщение о ДТП",
    category: "Экстренное",
    level: "Средний"
  },
  {
    english: "I'm being followed.",
    russian: "За мной следят.",
    explanation: "Опасная ситуация",
    category: "Экстренное",
    level: "Продвинутый"
  },
  {
    english: "I need a lawyer.",
    russian: "Мне нужен адвокат.",
    explanation: "Юридическая помощь",
    category: "Экстренное",
    level: "Средний"
  },
  {
    english: "I've been assaulted.",
    russian: "На меня напали.",
    explanation: "Физическое насилие",
    category: "Экстренное",
    level: "Продвинутый"
  },
  {
    english: "Where is the police station?",
    russian: "Где полицейский участок?",
    explanation: "Поиск полиции",
    category: "Экстренное",
    level: "Начальный"
  },
  {
    english: "I want to report a crime.",
    russian: "Я хочу заявить о преступлении.",
    explanation: "В полиции",
    category: "Экстренное",
    level: "Продвинутый"
  },
  {
    english: "My child is missing.",
    russian: "Мой ребенок пропал.",
    explanation: "Пропал человек",
    category: "Экстренное",
    level: "Средний"
  },
  {
    english: "I need a translator.",
    russian: "Мне нужен переводчик.",
    explanation: "Языковой барьер",
    category: "Экстренное",
    level: "Средний"
  },

  // РАБОТА И БИЗНЕС
  {
    english: "I have a job interview.",
    russian: "У меня собеседование.",
    explanation: "Поиск работы",
    category: "Работа",
    level: "Средний"
  },
  {
    english: "What's the salary?",
    russian: "Какая зарплата?",
    explanation: "Обсуждение оплаты",
    category: "Работа",
    level: "Средний"
  },
  {
    english: "When can I start?",
    russian: "Когда я могу приступить?",
    explanation: "Готовность работать",
    category: "Работа",
    level: "Средний"
  },
  {
    english: "I need a work visa.",
    russian: "Мне нужна рабочая виза.",
    explanation: "Документы",
    category: "Работа",
    level: "Продвинутый"
  },
  {
    english: "I'm here for a conference.",
    russian: "Я здесь на конференции.",
    explanation: "Командировка",
    category: "Работа",
    level: "Средний"
  },
  {
    english: "Let's schedule a meeting.",
    russian: "Давайте назначим встречу.",
    explanation: "Деловая встреча",
    category: "Работа",
    level: "Средний"
  },
  {
    english: "I'll send you an email.",
    russian: "Я пришлю вам письмо.",
    explanation: "Деловая переписка",
    category: "Работа",
    level: "Средний"
  },
  {
    english: "Can you send me the contract?",
    russian: "Можете прислать мне контракт?",
    explanation: "Документы",
    category: "Работа",
    level: "Средний"
  },
  {
    english: "I need a day off.",
    russian: "Мне нужен выходной.",
    explanation: "Отгул",
    category: "Работа",
    level: "Средний"
  },
  {
    english: "I'm sick today.",
    russian: "Я заболел сегодня.",
    explanation: "Больничный",
    category: "Работа",
    level: "Начальный"
  },
  {
    english: "What are the working hours?",
    russian: "Какой график работы?",
    explanation: "Режим работы",
    category: "Работа",
    level: "Средний"
  },
  {
    english: "Is overtime paid?",
    russian: "Сверхурочные оплачиваются?",
    explanation: "Оплата труда",
    category: "Работа",
    level: "Продвинутый"
  },
  {
    english: "I'd like to resign.",
    russian: "Я хотел бы уволиться.",
    explanation: "Увольнение",
    category: "Работа",
    level: "Продвинутый"
  },
  {
    english: "Can you write a reference?",
    russian: "Можете написать рекомендацию?",
    explanation: "Рекомендательное письмо",
    category: "Работа",
    level: "Продвинутый"
  },
  {
    english: "I have experience in this field.",
    russian: "У меня есть опыт в этой сфере.",
    explanation: "Опыт работы",
    category: "Работа",
    level: "Средний"
  },

  // ОБЩЕНИЕ И ЗНАКОМСТВА
  {
    english: "Hi, my name is...",
    russian: "Привет, меня зовут...",
    explanation: "Знакомство",
    category: "Общение",
    level: "Начальный"
  },
  {
    english: "Nice to meet you.",
    russian: "Приятно познакомиться.",
    explanation: "Вежливость",
    category: "Общение",
    level: "Начальный"
  },
  {
    english: "Where are you from?",
    russian: "Откуда вы?",
    explanation: "Вопрос о происхождении",
    category: "Общение",
    level: "Начальный"
  },
  {
    english: "I'm from Russia.",
    russian: "Я из России.",
    explanation: "Ответ",
    category: "Общение",
    level: "Начальный"
  },
  {
    english: "Do you speak English?",
    russian: "Вы говорите по-английски?",
    explanation: "Язык общения",
    category: "Общение",
    level: "Начальный"
  },
  {
    english: "I don't understand.",
    russian: "Я не понимаю.",
    explanation: "Нет понимания",
    category: "Общение",
    level: "Начальный"
  },
  {
    english: "Could you speak slower?",
    russian: "Не могли бы вы говорить медленнее?",
    explanation: "Просьба",
    category: "Общение",
    level: "Средний"
  },
  {
    english: "Can you repeat that?",
    russian: "Можете повторить?",
    explanation: "Уточнение",
    category: "Общение",
    level: "Начальный"
  },
  {
    english: "What do you do?",
    russian: "Чем вы занимаетесь?",
    explanation: "Профессия",
    category: "Общение",
    level: "Средний"
  },
  {
    english: "Do you live here?",
    russian: "Вы здесь живете?",
    explanation: "Место жительства",
    category: "Общение",
    level: "Средний"
  },
  {
    english: "I'm just visiting.",
    russian: "Я просто в гостях.",
    explanation: "Турист",
    category: "Общение",
    level: "Средний"
  },
  {
    english: "What are your hobbies?",
    russian: "Какие у вас хобби?",
    explanation: "Интересы",
    category: "Общение",
    level: "Средний"
  },
  {
    english: "Can I have your number?",
    russian: "Можно ваш номер?",
    explanation: "Обмен контактами",
    category: "Общение",
    level: "Средний"
  },
  {
    english: "Let's keep in touch.",
    russian: "Давайте оставаться на связи.",
    explanation: "Поддержание контакта",
    category: "Общение",
    level: "Средний"
  },
  {
    english: "It was great talking to you.",
    russian: "Было приятно пообщаться.",
    explanation: "Завершение разговора",
    category: "Общение",
    level: "Средний"
  }
];

// ===================== КЛАВИАТУРЫ =====================
const startKeyboard = new Keyboard()
    .text('🚀 НАЧАТЬ РАБОТУ')
    .resized();

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС')
    .text('📅 ПОГОДА СЕГОДНЯ')
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
      `📍 *Укажите город, чтобы начать:*\n` +
      `• Используйте команду /city Москва\n` +
      `• Или выберите город из списка\n\n` +
      `👇 *Нажмите кнопку ниже чтобы начать*`,
      { parse_mode: 'Markdown', reply_markup: startKeyboard }
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
      `📍 *Выберите ваш город*\n\n` +
      `Бот будет показывать погоду для выбранного города.\n` +
      `Город также будет отображаться в вашей статистике!`,
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
      `✅ *Город "${city}" сохранён!*\n\n` +
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
    await ctx.reply(`⏳ Запрашиваю погоду для ${city}...`);
    
    const weather = await getWeatherData(city);
    
    if (!weather || !weather.success) {
      await ctx.reply(`❌ ${weather?.error || 'Не удалось получить данные о погоде.'}`, { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    let message = `🌤️ *Погода в ${weather.city}*\n`;
    message += `📅 ${weather.date} | ${weather.timestamp}\n\n`;
    
    message += `🌡️ *Температура:* ${weather.temp}°C`;
    if (weather.temp_min && weather.temp_max) {
      message += ` (мин ${weather.temp_min}°C, макс ${weather.temp_max}°C)\n`;
    } else {
      message += '\n';
    }
    message += `🤔 *Ощущается как:* ${weather.feels_like}°C\n`;
    
    if (weather.pressure) {
      message += `📊 *Давление:* ${weather.pressure} мм рт.ст.\n`;
    }
    
    message += `💧 *Влажность:* ${weather.humidity}%\n`;
    
    message += `💨 *Ветер:* ${weather.wind_speed} м/с`;
    if (weather.wind_gusts) {
      message += ` (порывы до ${weather.wind_gusts} м/с)`;
    }
    if (weather.wind_dir !== '—') {
      message += `, ${weather.wind_dir}`;
    }
    message += '\n';
    
    if (weather.has_precipitation) {
      message += `🌧️ *Сейчас:* ${weather.precip_type}`;
      if (weather.rain_now > 0) {
        message += ` (${weather.rain_now.toFixed(1)} мм/час)`;
      } else if (weather.snow_now > 0) {
        message += ` (${weather.snow_now.toFixed(1)} мм/час)`;
      }
      message += '\n';
    }
    
    message += `☁️ *Облачность:* ${weather.cloud_desc} (${weather.cloud_cover}%)\n`;
    message += `👁️ *Видимость:* ${weather.visibility_km} км\n\n`;
    
    message += `🌅 *Восход:* ${weather.sunrise} | 🌇 *Закат:* ${weather.sunset}`;
    if (weather.day_length !== '—') {
      message += ` (${weather.day_length})`;
    }
    message += '\n';
    message += `📊 *Комфортность:* ${weather.comfort}\n\n`;
    
    message += `📝 ${weather.description}`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА:', error);
    await ctx.reply('❌ Не удалось получить данные о погоде.', { reply_markup: mainMenuKeyboard });
  }
});

// ===================== РАСШИРЕННЫЙ ПРОГНОЗ НА СЕГОДНЯ =====================
bot.hears('📅 ПОГОДА СЕГОДНЯ', async (ctx) => {
  const userId = ctx.from.id;
  console.log(`📅 ПОГОДА СЕГОДНЯ от ${userId}`);
  
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
    await ctx.reply(`⏳ Запрашиваю детальный прогноз на сегодня для ${city}...`);
    
    const forecast = await getDetailedTodayWeather(city);
    
    if (!forecast || !forecast.success) {
      await ctx.reply(`❌ ${forecast?.error || 'Не удалось получить прогноз погоды.'}`, { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    let message = `📅 *Прогноз на ${forecast.date}*\n`;
    message += `📍 *${forecast.city}*\n\n`;
    
    if (forecast.temp_min && forecast.temp_max) {
      message += `🌡️ *Температура:* ${forecast.temp_min}°C ... ${forecast.temp_max}°C`;
      if (forecast.feels_min && forecast.feels_max) {
        message += ` (ош. ${forecast.feels_min}°C...${forecast.feels_max}°C)`;
      }
      message += '\n';
    }
    
    if (forecast.precipitation_today > 0) {
      message += `🌧️ *Осадки за день:* ${forecast.precipitation_today.toFixed(1)} мм`;
      if (forecast.precipitation_hours > 0) {
        message += ` (${forecast.precipitation_hours} ч)`;
      }
      message += '\n';
      if (forecast.precipitation_prob_max > 0) {
        message += `☔️ *Макс. вероятность:* ${forecast.precipitation_prob_max}%\n`;
      }
    }
    
    if (forecast.wind_max !== '—') {
      message += `💨 *Ветер макс:* ${forecast.wind_max} м/с`;
      if (forecast.wind_gusts_max !== '—') {
        message += ` (порывы до ${forecast.wind_gusts_max} м/с)`;
      }
      if (forecast.wind_dir !== '—') {
        message += `, ${forecast.wind_dir}`;
      }
      message += '\n';
    }
    
    if (forecast.uv_max !== '—') {
      message += `☀️ *УФ-индекс макс:* ${forecast.uv_max}\n`;
    }
    
    message += `🌅 *Восход:* ${forecast.sunrise} | 🌇 *Закат:* ${forecast.sunset}`;
    if (forecast.day_length !== '—') {
      message += ` (${forecast.day_length})`;
    }
    message += '\n\n';
    
    message += `⏰ *Подробный прогноз по времени суток:*\n\n`;
    
    const periodsOrder = ['ночь', 'утро', 'день', 'вечер'];
    
    for (const period of periodsOrder) {
      if (forecast.periods[period]) {
        const p = forecast.periods[period];
        
        message += `${p.emoji} *${p.title}*\n`;
        message += `   🌡️ ${p.temp_min}°C...${p.temp_max}°C`;
        if (p.feels_min !== p.temp_min || p.feels_max !== p.temp_max) {
          message += ` (ош. ${p.feels_min}°C...${p.feels_max}°C)`;
        }
        message += '\n';
        
        message += `   ${p.description}\n`;
        message += `   💨 Ветер: ${p.wind_avg} м/с`;
        if (p.wind_gusts_max > p.wind_avg) {
          message += ` (порывы до ${p.wind_gusts_max} м/с)`;
        }
        message += '\n';
        
        if (p.precip_type !== 'Без осадков ✨') {
          message += `   ${p.precip_type}`;
          if (p.precip_sum > 0) {
            message += ` (${p.precip_sum} мм)`;
          }
          if (p.precip_prob > 0) {
            message += ` | ☔️ ${p.precip_prob}%`;
          }
          message += '\n';
        }
        
        if (p.cloud_avg > 0) {
          message += `   ☁️ Облачность: ${p.cloud_avg}%\n`;
        }
        
        if (p.pressure_avg) {
          message += `   📊 Давление: ${p.pressure_avg} мм рт.ст.\n`;
        }
        
        message += '\n';
      }
    }
    
    message += `🕒 Обновлено: ${forecast.updated}`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА СЕГОДНЯ:', error);
    await ctx.reply('❌ Не удалось получить прогноз погоды.', { reply_markup: mainMenuKeyboard });
  }
});

// ===================== РАСШИРЕННЫЙ ПРОГНОЗ НА ЗАВТРА =====================
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
    await ctx.reply(`⏳ Запрашиваю детальный прогноз на завтра для ${city}...`);
    
    const forecast = await getWeatherForecast(city);
    
    if (!forecast || !forecast.success) {
      await ctx.reply(`❌ ${forecast?.error || 'Не удалось получить прогноз погоды.'}`, { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    let message = `📅 *Прогноз на ${forecast.date}*\n`;
    message += `📍 *${forecast.city}*\n\n`;
    
    if (forecast.temp_min && forecast.temp_max) {
      message += `🌡️ *Температура:* ${forecast.temp_min}°C ... ${forecast.temp_max}°C`;
      if (forecast.feels_min && forecast.feels_max) {
        message += ` (ош. ${forecast.feels_min}°C...${forecast.feels_max}°C)`;
      }
      message += '\n';
    }
    
    if (forecast.precipitation_tomorrow > 0) {
      message += `🌧️ *Осадки:* ${forecast.precipitation_tomorrow.toFixed(1)} мм`;
      if (forecast.precipitation_hours > 0) {
        message += ` (${forecast.precipitation_hours} ч)`;
      }
      message += '\n';
      if (forecast.precipitation_prob_max > 0) {
        message += `☔️ *Макс. вероятность:* ${forecast.precipitation_prob_max}%\n`;
      }
    }
    
    if (forecast.wind_max !== '—') {
      message += `💨 *Ветер макс:* ${forecast.wind_max} м/с`;
      if (forecast.wind_gusts_max !== '—') {
        message += ` (порывы до ${forecast.wind_gusts_max} м/с)`;
      }
      if (forecast.wind_dir !== '—') {
        message += `, ${forecast.wind_dir}`;
      }
      message += '\n';
    }
    
    if (forecast.uv_max !== '—') {
      message += `☀️ *УФ-индекс макс:* ${forecast.uv_max}\n`;
    }
    
    message += `🌅 *Восход:* ${forecast.sunrise} | 🌇 *Закат:* ${forecast.sunset}`;
    if (forecast.day_length !== '—') {
      message += ` (${forecast.day_length})`;
    }
    message += '\n\n';
    
    message += `⏰ *Подробный прогноз по времени суток:*\n\n`;
    
    const periodsOrder = ['ночь', 'утро', 'день', 'вечер'];
    
    for (const period of periodsOrder) {
      if (forecast.periods[period]) {
        const p = forecast.periods[period];
        
        message += `${p.emoji} *${p.title}*\n`;
        message += `   🌡️ ${p.temp_min}°C...${p.temp_max}°C`;
        if (p.feels_min !== p.temp_min || p.feels_max !== p.temp_max) {
          message += ` (ош. ${p.feels_min}°C...${p.feels_max}°C)`;
        }
        message += '\n';
        
        message += `   ${p.description}\n`;
        message += `   💨 Ветер: ${p.wind_avg} м/с`;
        if (p.wind_gusts_max > p.wind_avg) {
          message += ` (порывы до ${p.wind_gusts_max} м/с)`;
        }
        message += '\n';
        
        if (p.precip_type !== 'Без осадков ✨') {
          message += `   ${p.precip_type}`;
          if (p.precip_sum > 0) {
            message += ` (${p.precip_sum} мм)`;
          }
          if (p.precip_prob > 0) {
            message += ` | ☔️ ${p.precip_prob}%`;
          }
          message += '\n';
        }
        
        if (p.cloud_avg > 0) {
          message += `   ☁️ Облачность: ${p.cloud_avg}%\n`;
        }
        
        if (p.pressure_avg) {
          message += `   📊 Давление: ${p.pressure_avg} мм рт.ст.\n`;
        }
        
        message += '\n';
      }
    }
    
    message += `🕒 Обновлено: ${forecast.updated}`;
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА ЗАВТРА:', error);
    await ctx.reply('❌ Не удалось получить прогноз погоды.', { reply_markup: mainMenuKeyboard });
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
    await ctx.reply(`👗 Анализирую погоду для ${city}...`);
    
    const weather = await getWeatherData(city);
    if (!weather || !weather.success) {
      await ctx.reply(`❌ ${weather?.error || 'Не удалось получить данные о погоде.'}`, { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    const advice = getWardrobeAdvice(weather);
    
    await ctx.reply(advice, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
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
      `📚 ${phrase.explanation}\n\n` +
      `📂 *Категория:* ${phrase.category}\n` +
      `📊 *Уровень:* ${phrase.level}`,
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

// ===================== СТАТИСТИКА И ТОП =====================
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
    await ctx.reply('🏆 Загружаю топ игроков...');
    
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
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'Player';
    
    const webAppUrl = `https://pogodasovet1.vercel.app?telegramId=${userId}&username=${encodeURIComponent(username)}`;
    
    const cityResult = await getUserCityWithFallback(ctx.from.id);
    const hasCity = cityResult.found && cityResult.city !== 'Не указан';
    
    let cityMessage = '';
    if (!hasCity) {
      cityMessage = `\n📍 *Укажите город командой /city [город] чтобы отображаться в топе!*`;
    }
    
    await ctx.reply(
      `🎮 *Тетрис*\n\n` +
      `Нажмите кнопку ниже, чтобы открыть игру в мини-приложении!\n\n` +
      `📊 *Ваша статистика будет автоматически сохраняться.*${cityMessage}`,
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

bot.callbackQuery('back_to_menu', async (ctx) => {
  try {
    await ctx.editMessageText('Главное меню:', {
      reply_markup: { remove_keyboard: false }
    });
    await ctx.reply('Выберите действие:', { reply_markup: mainMenuKeyboard });
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('❌ Ошибка в back_to_menu:', error);
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
          reply_markup: mainMenuKeyboard
        });
        return;
      }
      
      let userCity = 'Не указан';
      try {
        const cityResult = await getUserCityWithFallback(userId);
        if (cityResult.success && cityResult.city && cityResult.city !== 'Не указан') {
          userCity = cityResult.city;
        }
      } catch (cityError) {
        console.error('❌ Ошибка получения города:', cityError.message);
      }
      
      const result = await saveGameScore(
        userId.toString(),
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
      
      if (userCity === 'Не указан') {
        message += `📍 *Укажите город:* /city [город]\n`;
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
      `*Список команд:*\n` +
      `/start - Начать работу\n` +
      `/weather - Текущая погода\n` +
      `/today - Погода сегодня (по периодам)\n` +
      `/forecast - Прогноз на завтра\n` +
      `/wardrobe - Что надеть?\n` +
      `/phrase - Фраза дня\n` +
      `/random - Случайная фраза\n` +
      `/tetris - Играть в тетрис\n` +
      `/stats - Статистика\n` +
      `/top - Топ игроков\n` +
      `/city [город] - Указать город\n` +
      `/help - Помощь\n\n` +
      `Чтобы вернуть меню, нажмите /start`,
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
      `• 📅 ПОГОДА СЕГОДНЯ - погода сегодня по периодам\n` +
      `• 📅 ПОГОДА ЗАВТРА - прогноз на завтра\n` +
      `• 👕 ЧТО НАДЕТЬ? - рекомендации по одежде\n` +
      `• 💬 ФРАЗА ДНЯ - английская фраза дня\n` +
      `• 🎲 СЛУЧАЙНАЯ ФРАЗА - случайная фраза\n` +
      `• 🎮 ИГРАТЬ В ТЕТРИС - игра\n` +
      `• 📊 МОЯ СТАТИСТИКА - статистика\n` +
      `• 🏆 ТОП ИГРОКОВ - лучшие игроки\n` +
      `• 🏙️ СМЕНИТЬ ГОРОД - изменить город\n` +
      `• ℹ️ ПОМОЩЬ - эта информация\n\n` +
      `📍 *Важно:* Укажите город командой /city [город]`,
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
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город! Используйте /start');
      return;
    }
    
    const city = result.city;
    await ctx.reply(`⏳ Запрашиваю погоду для ${city}...`);
    
    const weather = await getWeatherData(city);
    
    if (!weather || !weather.success) {
      await ctx.reply(`❌ ${weather?.error || 'Не удалось получить данные о погоде.'}`);
      return;
    }
    
    let message = `🌤️ *Погода в ${weather.city}*\n`;
    message += `📅 ${weather.date} | ${weather.timestamp}\n\n`;
    message += `🌡️ *Температура:* ${weather.temp}°C (ош. ${weather.feels_like}°C)\n`;
    if (weather.pressure) message += `📊 *Давление:* ${weather.pressure} мм рт.ст.\n`;
    message += `💧 *Влажность:* ${weather.humidity}%\n`;
    message += `💨 *Ветер:* ${weather.wind_speed} м/с`;
    if (weather.wind_gusts) message += ` (порывы до ${weather.wind_gusts} м/с)`;
    if (weather.wind_dir !== '—') message += `, ${weather.wind_dir}`;
    message += `\n☁️ *Облачность:* ${weather.cloud_desc}\n`;
    message += `📝 ${weather.description}`;
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('❌ Ошибка в /weather:', error);
    await ctx.reply('❌ Не удалось получить данные о погоде.');
  }
});

bot.command('today', async (ctx) => {
  const userId = ctx.from.id;
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город! Используйте /start');
      return;
    }
    
    const city = result.city;
    await ctx.reply(`⏳ Запрашиваю детальный прогноз на сегодня для ${city}...`);
    
    const forecast = await getDetailedTodayWeather(city);
    
    if (!forecast || !forecast.success) {
      await ctx.reply(`❌ ${forecast?.error || 'Не удалось получить прогноз.'}`);
      return;
    }
    
    let message = `📅 *Прогноз на ${forecast.date}*\n`;
    message += `📍 *${forecast.city}*\n\n`;
    
    if (forecast.temp_min && forecast.temp_max) {
      message += `🌡️ *Температура:* ${forecast.temp_min}°C ... ${forecast.temp_max}°C`;
      if (forecast.feels_min && forecast.feels_max) {
        message += ` (ош. ${forecast.feels_min}°C...${forecast.feels_max}°C)`;
      }
      message += '\n';
    }
    
    message += `🌅 *Восход:* ${forecast.sunrise} | 🌇 *Закат:* ${forecast.sunset}\n\n`;
    message += `⏰ *По периодам:*\n\n`;
    
    const periodsOrder = ['ночь', 'утро', 'день', 'вечер'];
    
    for (const period of periodsOrder) {
      if (forecast.periods[period]) {
        const p = forecast.periods[period];
        message += `${p.emoji} *${p.title}*\n`;
        message += `   🌡️ ${p.temp_min}°C...${p.temp_max}°C`;
        if (p.feels_min !== p.temp_min || p.feels_max !== p.temp_max) {
          message += ` (ош. ${p.feels_min}°C...${p.feels_max}°C)`;
        }
        message += '\n';
        message += `   ${p.description}\n`;
        message += `   💨 Ветер: ${p.wind_avg} м/с\n`;
        if (p.precip_type !== 'Без осадков ✨') {
          message += `   ${p.precip_type}\n`;
        }
        message += '\n';
      }
    }
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('❌ Ошибка в /today:', error);
    await ctx.reply('❌ Не удалось получить прогноз.');
  }
});

bot.command('forecast', async (ctx) => {
  const userId = ctx.from.id;
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город! Используйте /start');
      return;
    }
    
    const city = result.city;
    await ctx.reply(`⏳ Запрашиваю прогноз на завтра для ${city}...`);
    
    const forecast = await getWeatherForecast(city);
    
    if (!forecast || !forecast.success) {
      await ctx.reply(`❌ ${forecast?.error || 'Не удалось получить прогноз.'}`);
      return;
    }
    
    let message = `📅 *Прогноз на ${forecast.date}*\n`;
    message += `📍 *${forecast.city}*\n\n`;
    
    if (forecast.temp_min && forecast.temp_max) {
      message += `🌡️ *Температура:* ${forecast.temp_min}°C ... ${forecast.temp_max}°C`;
      if (forecast.feels_min && forecast.feels_max) {
        message += ` (ош. ${forecast.feels_min}°C...${forecast.feels_max}°C)`;
      }
      message += '\n';
    }
    
    message += `🌅 *Восход:* ${forecast.sunrise} | 🌇 *Закат:* ${forecast.sunset}\n\n`;
    message += `⏰ *По периодам:*\n\n`;
    
    const periodsOrder = ['ночь', 'утро', 'день', 'вечер'];
    
    for (const period of periodsOrder) {
      if (forecast.periods[period]) {
        const p = forecast.periods[period];
        message += `${p.emoji} *${p.title}*\n`;
        message += `   🌡️ ${p.temp_min}°C...${p.temp_max}°C`;
        if (p.feels_min !== p.temp_min || p.feels_max !== p.temp_max) {
          message += ` (ош. ${p.feels_min}°C...${p.feels_max}°C)`;
        }
        message += '\n';
        message += `   ${p.description}\n`;
        message += `   💨 Ветер: ${p.wind_avg} м/с\n`;
        if (p.precip_type !== 'Без осадков ✨') {
          message += `   ${p.precip_type}\n`;
        }
        message += '\n';
      }
    }
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('❌ Ошибка в /forecast:', error);
    await ctx.reply('❌ Не удалось получить прогноз.');
  }
});

bot.command('wardrobe', async (ctx) => {
  const userId = ctx.from.id;
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const result = await getUserCityWithFallback(userId);
    
    if (!result || !result.success || !result.city || result.city === 'Не указан') {
      await ctx.reply('Сначала выберите город! Используйте /start');
      return;
    }
    
    const city = result.city;
    await ctx.reply(`👗 Анализирую погоду для ${city}...`);
    
    const weather = await getWeatherData(city);
    if (!weather || !weather.success) {
      await ctx.reply(`❌ ${weather?.error || 'Не удалось получить данные о погоде.'}`);
      return;
    }
    
    const advice = getWardrobeAdvice(weather);
    await ctx.reply(advice, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('❌ Ошибка в /wardrobe:', error);
    await ctx.reply('❌ Не удалось получить рекомендацию.');
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
      `📚 ${phrase.explanation}\n\n` +
      `📂 *Категория:* ${phrase.category}\n` +
      `📊 *Уровень:* ${phrase.level}`,
      { parse_mode: 'Markdown' }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в /phrase:', error);
    await ctx.reply('❌ Не удалось получить фразу дня.');
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
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('❌ Ошибка в /random:', error);
    await ctx.reply('❌ Не удалось получить случайную фразу.');
  }
});

bot.command('tetris', async (ctx) => {
  console.log(`🎮 /tetris от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'Player';
    
    const webAppUrl = `https://pogodasovet1.vercel.app?telegramId=${userId}&username=${encodeURIComponent(username)}`;
    
    await ctx.reply(
      `🎮 *Тетрис*\n\n` +
      `Нажмите кнопку ниже, чтобы открыть игру!`,
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
    await ctx.reply('❌ Не удалось открыть игру.');
  }
});

bot.command('stats', async (ctx) => {
  const userId = ctx.from.id;
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const statsMessage = await getGameStatsMessage(userId);
    await ctx.reply(statsMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('❌ Ошибка в /stats:', error);
    await ctx.reply('❌ Не удалось загрузить статистику.');
  }
});

bot.command('top', async (ctx) => {
  console.log(`🏆 /top от ${ctx.from.id}`);
  
  if (isRateLimited(ctx.from.id)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    const topMessage = await getTopPlayersMessage(10, ctx);
    await ctx.reply(topMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('❌ Ошибка в /top:', error);
    await ctx.reply('❌ Не удалось загрузить топ игроков.');
  }
});

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
          `Чтобы изменить город, используйте:\n` +
          `/city [название]`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(
          `📍 *У вас не указан город*\n\n` +
          `Укажите город командой: /city [название]`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      console.error('❌ Ошибка в /city:', error);
      await ctx.reply('❌ Не удалось получить информацию о городе.');
    }
    return;
  }
  
  const city = args.join(' ').trim();
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  try {
    if (!city || city.length < 2 || city.length > 100) {
      await ctx.reply('❌ Неверное название города.');
      return;
    }
    
    await ctx.reply(`⏳ Сохраняю город "${city}"...`);
    
    const saveResult = await saveUserCityWithRetry(userId, city, username);
    
    if (!saveResult.success) {
      await ctx.reply('❌ Не удалось сохранить город.');
      return;
    }
    
    await ctx.reply(
      `✅ *Город "${city}" успешно сохранен!*\n\n` +
      `📍 Теперь вы будете отображаться в топе с этим городом.`,
      { parse_mode: 'Markdown' }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в /city:', error);
    await ctx.reply('❌ Произошла ошибка при сохранении города.');
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
      `*Команды:*\n` +
      `/start - Начать работу\n` +
      `/weather - Текущая погода\n` +
      `/today - Погода сегодня (по периодам)\n` +
      `/forecast - Прогноз на завтра\n` +
      `/wardrobe - Что надеть?\n` +
      `/phrase - Фраза дня\n` +
      `/random - Случайная фраза\n` +
      `/tetris - Играть в тетрис\n` +
      `/stats - Статистика\n` +
      `/top - Топ игроков\n` +
      `/city [город] - Указать город\n` +
      `/help - Помощь\n\n` +
      `📍 *Укажите город:* /city [город]`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('❌ Ошибка в /help:', error);
  }
});

// ===================== ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ =====================
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || '';
  const text = ctx.message.text;
  const userData = userStorage.get(userId) || {};
  
  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Пожалуйста, подождите немного перед следующим запросом.');
    return;
  }
  
  // Игнорируем команды и кнопки
  if (text.startsWith('/') || 
      ['🚀 НАЧАТЬ РАБОТУ', '🌤️ ПОГОДА СЕЙЧАС', '📅 ПОГОДА СЕГОДНЯ', '📅 ПОГОДА ЗАВТРА', 
       '👕 ЧТО НАДЕТЬ?', '💬 ФРАЗА ДНЯ', '🎲 СЛУЧАЙНАЯ ФРАЗА', '🎮 ИГРАТЬ В ТЕТРИС', 
       '📊 МОЯ СТАТИСТИКА', '🏆 ТОП ИГРОКОВ', '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', 
       '📋 ПОКАЗАТЬ КОМАНДЫ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
      text.startsWith('📍 ')) {
    return;
  }
  
  // Обработка ввода города
  if (userData.awaitingCity) {
    try {
      const city = text.trim();
      if (city.length === 0 || city.length > 100) {
        await ctx.reply('❌ Неверное название города.');
        return;
      }
      
      const saveResult = await saveUserCityWithRetry(userId, city, username);
      
      if (!saveResult.success) {
        await ctx.reply('❌ Не удалось сохранить город.');
        return;
      }
      
      userStorage.set(userId, { city, lastActivity: Date.now(), awaitingCity: false });
      
      await ctx.reply(
        `✅ *Город "${city}" сохранён!*\n\n` +
        `Теперь можно пользоваться ботом!`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
      );
    } catch (error) {
      console.error('❌ Ошибка при сохранении города:', error);
      await ctx.reply('❌ Не удалось сохранить город.');
    }
  } else {
    try {
      const result = await getUserCityWithFallback(userId);
      if (!result || !result.success || !result.city || result.city === 'Не указан') {
        await ctx.reply('Пожалуйста, сначала выберите город:', { reply_markup: cityKeyboard });
      } else {
        await ctx.reply(
          `📍 *Ваш город:* ${result.city}\n\n` +
          `Используйте кнопки меню.`,
          { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
      }
    } catch (error) {
      console.error('❌ Ошибка при проверке города:', error);
      await ctx.reply('Произошла ошибка.', { reply_markup: mainMenuKeyboard });
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
        message: 'Weather & English Phrases Bot with Game Statistics',
        status: 'active',
        bot_initialized: botInitialized,
        timestamp: new Date().toISOString(),
        features: [
          'Детальная погода сейчас (давление, ветер, осадки)',
          'Погода сегодня по периодам',
          'Прогноз на завтра по периодам',
          'Умные рекомендации по одежде',
          'Английские фразы (200+)',
          'Тетрис со статистикой',
          'Топ игроков с городами'
        ]
      });
    }
    
    if (req.method === 'POST') {
      if (!botInitialized) {
        console.error('❌ Бот не инициализирован');
        return res.status(200).json({ ok: false, error: 'Bot not initialized' });
      }
      
      try {
        const update = req.body;
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

console.log('✅ Бот загружен со всеми улучшениями!');
console.log('📍 Система городов: ВКЛЮЧЕНА');
console.log('🌤️ Детальная погода сейчас: ВКЛЮЧЕНА');
console.log('📅 Погода сегодня по периодам: ВКЛЮЧЕНА');
console.log('📅 Прогноз на завтра: ВКЛЮЧЕН');
console.log('👕 Умные рекомендации одежды: ВКЛЮЧЕНЫ');
console.log('📚 Словарь: 200+ английских фраз');
console.log('🎮 Тетрис и статистика: ВКЛЮЧЕНЫ');
console.log('🏆 Топ игроков: ВКЛЮЧЕН (РАБОЧАЯ ВЕРСИЯ)');
