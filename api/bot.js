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
  
  const directions = [
    'С', 'ССВ', 'СВ', 'ВСВ',
    'В', 'ВЮВ', 'ЮВ', 'ЮЮВ',
    'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ',
    'З', 'ЗСЗ', 'СЗ', 'ССЗ'
  ];
  
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

/**
 * Описание облачности
 */
function getCloudCoverDescription(cloudPercent) {
  if (cloudPercent === undefined || cloudPercent === null) return '—';
  
  if (cloudPercent < 10) return 'Ясно ☀️';
  if (cloudPercent < 30) return 'Малооблачно 🌤️';
  if (cloudPercent < 50) return 'Переменная облачность ⛅';
  if (cloudPercent < 70) return 'Облачно с прояснениями 🌥️';
  if (cloudPercent < 90) return 'Облачно ☁️';
  return 'Пасмурно ☁️';
}

/**
 * Описание видимости
 */
function getVisibilityDescription(visibilityMeters) {
  if (!visibilityMeters) return '—';
  
  const km = visibilityMeters / 1000;
  if (km > 20) return 'Отличная (>20 км)';
  if (km > 10) return 'Хорошая (10-20 км)';
  if (km > 5) return 'Средняя (5-10 км)';
  if (km > 2) return 'Пониженная (2-5 км)';
  if (km > 1) return 'Плохая (1-2 км)';
  return 'Очень плохая, туман (<1 км)';
}

/**
 * Описание УФ-индекса
 */
function getUVDescription(uvIndex) {
  if (uvIndex === undefined || uvIndex === null) return '—';
  
  if (uvIndex <= 2) return 'Низкий 🟢 (защита не нужна)';
  if (uvIndex <= 5) return 'Умеренный 🟡 (нужна защита)';
  if (uvIndex <= 7) return 'Высокий 🟠 (обязательна защита)';
  if (uvIndex <= 10) return 'Очень высокий 🔴 (избегайте солнца)';
  return 'Экстремальный 🟣 (опасность! )';
}

/**
 * Тип осадков
 */
function getPrecipitationType(rain, showers, snowfall) {
  if (snowfall > 0) {
    if (snowfall < 1) return 'Небольшой снег ❄️';
    if (snowfall < 3) return 'Снег ❄️';
    return 'Сильный снегопад ❄️❄️';
  }
  
  if (showers > 0) {
    if (showers < 2) return 'Небольшой ливень 🌧️';
    if (showers < 5) return 'Ливень 🌧️';
    return 'Сильный ливень 🌧️🌧️';
  }
  
  if (rain > 0) {
    if (rain < 1) return 'Небольшой дождь 🌦️';
    if (rain < 3) return 'Дождь 🌧️';
    return 'Сильный дождь 🌧️🌧️';
  }
  
  return 'Без осадков ✨';
}

/**
 * Комфортность погоды
 */
function getComfortLevel(temp, windSpeed, weatherCode, isDay) {
  let comfort = 100;
  
  // Температурный комфорт
  if (temp < -20) comfort -= 40;
  else if (temp < -10) comfort -= 30;
  else if (temp < 0) comfort -= 20;
  else if (temp < 10) comfort -= 10;
  else if (temp > 30) comfort -= 30;
  else if (temp > 25) comfort -= 15;
  
  // Ветер
  if (windSpeed > 15) comfort -= 30;
  else if (windSpeed > 10) comfort -= 20;
  else if (windSpeed > 5) comfort -= 10;
  
  // Осадки (коды погоды)
  const badWeather = [51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99];
  if (badWeather.includes(weatherCode)) comfort -= 30;
  
  // Ночью немного меньше комфорта для прогулок
  if (!isDay) comfort -= 5;
  
  if (comfort >= 80) return 'Отличная 🌟';
  if (comfort >= 60) return 'Хорошая 👍';
  if (comfort >= 40) return 'Средняя 👌';
  if (comfort >= 20) return 'Так себе 😐';
  return 'Плохая 👎';
}

/**
 * Тренд давления
 */
function getPressureTrend(currentPressure, previousPressure) {
  if (!currentPressure || !previousPressure) return 'стабильное';
  
  const diff = currentPressure - previousPressure;
  if (diff > 3) return 'резко растёт ⬆️';
  if (diff > 1) return 'растёт ↗️';
  if (diff < -3) return 'резко падает ⬇️';
  if (diff < -1) return 'падает ↘️';
  return 'стабильное →';
}

// ===================== УЛУЧШЕННАЯ ФУНКЦИЯ ПОГОДЫ НА СЕЙЧАС =====================
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
      if (now - cached.timestamp < 600000) { // 10 минут кэш
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
    
    const { latitude, longitude, name, country, admin1 } = geoData.results[0];
    
    // 🌟 РАСШИРЕННЫЙ ЗАПРОС - ВСЕ ДОСТУПНЫЕ ПАРАМЕТРЫ
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
        surface_pressure,
        precipitation,
        rain,
        showers,
        snowfall,
        weather_code,
        cloud_cover,
        cloud_cover_low,
        cloud_cover_mid,
        cloud_cover_high,
        visibility,
        uv_index,
        is_day
      &hourly=
        temperature_2m,
        apparent_temperature,
        precipitation_probability,
        weather_code,
        wind_speed_10m,
        uv_index
      &daily=
        temperature_2m_max,
        temperature_2m_min,
        sunrise,
        sunset,
        uv_index_max,
        precipitation_sum,
        precipitation_hours,
        precipitation_probability_max,
        wind_speed_10m_max,
        wind_gusts_10m_max,
        apparent_temperature_max,
        apparent_temperature_min,
        weather_code
      &wind_speed_unit=ms
      &timezone=auto
      &forecast_days=2
      &past_days=0`.replace(/\s+/g, '');
    
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    if (!weatherData.current) {
      throw new Error('Нет данных о погоде');
    }
    
    const current = weatherData.current;
    const todayPrecipitation = weatherData.daily?.precipitation_sum[0] || 0;
    const todayPrecipitationHours = weatherData.daily?.precipitation_hours[0] || 0;
    const todayPrecipitationProb = weatherData.daily?.precipitation_probability_max[0] || 0;
    
    // 🌡️ ТЕКУЩИЙ ЧАС ДЛЯ ПОЧАСОВЫХ ДАННЫХ
    const currentHour = new Date().getHours();
    const hourlyIndex = weatherData.hourly?.time?.findIndex(
      time => new Date(time).getHours() === currentHour
    ) || 0;
    
    const precipitationProb = weatherData.hourly?.precipitation_probability?.[hourlyIndex] || 0;
    
    // 💨 ОПРЕДЕЛЕНИЕ НАПРАВЛЕНИЯ ВЕТРА
    const windDir = getWindDirection(current.wind_direction_10m);
    const windDirFull = current.wind_direction_10m ? `${windDir} (${current.wind_direction_10m}°)` : '—';
    
    // ☁️ ОПИСАНИЕ ОБЛАЧНОСТИ
    const cloudDesc = getCloudCoverDescription(current.cloud_cover);
    
    // 👁️ ВИДИМОСТЬ
    const visibilityKm = current.visibility ? (current.visibility / 1000).toFixed(1) : '>10';
    const visibilityDesc = getVisibilityDescription(current.visibility);
    
    // 🌡️ ДАВЛЕНИЕ (гПа → мм рт.ст.)
    const pressureHpa = current.pressure_msl ? Math.round(current.pressure_msl) : null;
    const pressureMmHg = current.pressure_msl ? Math.round(current.pressure_msl * 0.750062) : null;
    
    // 📊 ТРЕНД ДАВЛЕНИЯ (для реального тренда нужно предыдущее значение, пока заглушка)
    const pressureTrend = 'стабильное →';
    
    // ☀️ УФ-ИНДЕКС
    const uvIndex = current.uv_index || 0;
    const uvDesc = getUVDescription(uvIndex);
    const uvMaxToday = weatherData.daily?.uv_index_max[0]?.toFixed(1) || '—';
    
    // 🕐 ВРЕМЯ ВОСХОДА/ЗАКАТА
    const sunrise = weatherData.daily?.sunrise[0]?.substring(11, 16) || '—';
    const sunset = weatherData.daily?.sunset[0]?.substring(11, 16) || '—';
    
    // 🎯 КОМФОРТНОСТЬ ПОГОДЫ
    const comfortLevel = getComfortLevel(
      current.temperature_2m,
      current.wind_speed_10m,
      current.weather_code,
      current.is_day
    );
    
    // 🌡️ ТЕМПЕРАТУРНЫЙ КОНТРАСТ
    const tempDiff = Math.abs(current.temperature_2m - current.apparent_temperature).toFixed(1);
    
    // 🌧️ ТИП ОСАДКОВ
    const precipType = getPrecipitationType(current.rain, current.showers, current.snowfall);
    
    // 🎯 ПОЛНОЕ ОПИСАНИЕ ПОГОДЫ
    const detailedDescription = getDetailedWeatherDescription(
      current.weather_code, 
      current.precipitation,
      current.cloud_cover,
      current.is_day
    );
    
    // 🏔️ ВЫСОТА НАД УРОВНЕМ МОРЯ
    const elevation = geoData.results[0]?.elevation || '—';
    
    // 📝 ФОРМИРУЕМ ТЕКСТ ДЛЯ ОТОБРАЖЕНИЯ
    const displayText = formatCurrentWeatherDisplay({
      city: name,
      country,
      region: admin1,
      date: new Date().toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      time: new Date().toLocaleTimeString('ru-RU'),
      isDay: current.is_day === 1,
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      temp_diff: tempDiff,
      temp_min: Math.round(weatherData.daily?.temperature_2m_min[0] || current.temperature_2m),
      temp_max: Math.round(weatherData.daily?.temperature_2m_max[0] || current.temperature_2m),
      pressure: pressureMmGiya,
      pressure_hpa: pressureHpa,
      pressure_trend: pressureTrend,
      humidity: current.relative_humidity_2m,
      wind_speed: current.wind_speed_10m?.toFixed(1) || '0',
      wind_gusts: current.wind_gusts_10m?.toFixed(1) || '0',
      wind_dir: windDir,
      wind_dir_full: windDirFull,
      precipitation: current.precipitation || 0,
      precipitation_prob: precipitationProb,
      precipitation_today: todayPrecipitation,
      precipitation_hours: todayPrecipitationHours,
      precipitation_prob_today: todayPrecipitationProb,
      rain: current.rain || 0,
      showers: current.showers || 0,
      snowfall: current.snowfall || 0,
      precip_type: precipType,
      cloud_cover: current.cloud_cover || 0,
      cloud_desc: cloudDesc,
      cloud_low: current.cloud_cover_low || 0,
      cloud_mid: current.cloud_cover_mid || 0,
      cloud_high: current.cloud_cover_high || 0,
      visibility_km: visibilityKm,
      visibility_desc: visibilityDesc,
      uv_index: uvIndex.toFixed(1),
      uv_desc: uvDesc,
      uv_max: uvMaxToday,
      sunrise: sunrise,
      sunset: sunset,
      comfort: comfortLevel,
      description: detailedDescription,
      weather_code: current.weather_code,
      elevation: elevation
    });
    
    // 🎯 ИТОГОВЫЙ ОБЪЕКТ С ДАННЫМИ
    const weatherResult = {
      success: true,
      
      // 📍 ОСНОВНАЯ ИНФОРМАЦИЯ
      city: name,
      country: country || '—',
      region: admin1 || '—',
      elevation: elevation,
      
      // 🕐 ВРЕМЯ
      timestamp: new Date().toLocaleTimeString('ru-RU'),
      date: new Date().toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      isDay: current.is_day === 1,
      
      // 🌡️ ТЕМПЕРАТУРА
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      temp_diff: tempDiff,
      temp_min: Math.round(weatherData.daily?.temperature_2m_min[0] || current.temperature_2m),
      temp_max: Math.round(weatherData.daily?.temperature_2m_max[0] || current.temperature_2m),
      
      // 💧 ВЛАЖНОСТЬ И ОСАДКИ
      humidity: current.relative_humidity_2m,
      precipitation: current.precipitation || 0,
      precipitation_prob: precipitationProb,
      precipitation_today: todayPrecipitation,
      precipitation_hours: todayPrecipitationHours,
      precipitation_prob_today: todayPrecipitationProb,
      rain: current.rain || 0,
      showers: current.showers || 0,
      snowfall: current.snowfall || 0,
      precip_type: precipType,
      
      // 💨 ВЕТЕР
      wind: {
        speed: current.wind_speed_10m?.toFixed(1) || '0',
        gusts: current.wind_gusts_10m?.toFixed(1) || '0',
        direction: windDir,
        direction_deg: current.wind_direction_10m || 0,
        direction_full: windDirFull
      },
      
      // 🌡️ ДАВЛЕНИЕ
      pressure: {
        hpa: pressureHpa,
        mmhg: pressureMmHg,
        trend: pressureTrend
      },
      
      // ☁️ ОБЛАЧНОСТЬ
      clouds: {
        total: current.cloud_cover || 0,
        description: cloudDesc,
        low: current.cloud_cover_low || 0,
        mid: current.cloud_cover_mid || 0,
        high: current.cloud_cover_high || 0
      },
      
      // 👁️ ВИДИМОСТЬ
      visibility: {
        meters: current.visibility || 20000,
        km: visibilityKm,
        description: visibilityDesc
      },
      
      // ☀️ УФ-ИНДЕКС
      uv: {
        index: uvIndex,
        description: uvDesc,
        max_today: uvMaxToday
      },
      
      // 🌅 АСТРОНОМИЯ
      astronomy: {
        sunrise: sunrise,
        sunset: sunset,
        day_length: calculateDayLength(sunrise, sunset)
      },
      
      // 📊 КОМФОРТ
      comfort: comfortLevel,
      
      // 📝 ОПИСАНИЕ
      description: detailedDescription,
      weather_code: current.weather_code,
      
      // 📄 ТЕКСТ ДЛЯ ОТОБРАЖЕНИЯ
      display: displayText
    };
    
    // Сохраняем в кэш
    weatherCache.set(cacheKey, { data: weatherResult, timestamp: now });
    return weatherResult;
    
  } catch (error) {
    console.error('❌ Ошибка получения погоды:', error.message);
    
    // Пробуем вернуть из кэша если есть
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

/**
 * Форматирование отображения текущей погоды
 */
function formatCurrentWeatherDisplay(data) {
  const dayNight = data.isDay ? '☀️ День' : '🌙 Ночь';
  
  let message = `🌤️ *Погода в ${data.city}*\n`;
  message += `📅 ${data.date} | ${data.time} | ${dayNight}\n\n`;
  
  message += `🌡️ *Температура:* ${data.temp}°C`;
  if (data.temp_min && data.temp_max) {
    message += ` (мин ${data.temp_min}°C, макс ${data.temp_max}°C)\n`;
  } else {
    message += '\n';
  }
  message += `🤔 *Ощущается как:* ${data.feels_like}°C`;
  if (data.temp_diff > 2) {
    message += ` (на ${data.temp_diff}°C ${data.temp > data.feels_like ? 'холоднее' : 'теплее'})\n`;
  } else {
    message += '\n';
  }
  
  // ДАВЛЕНИЕ
  if (data.pressure) {
    message += `📊 *Давление:* ${data.pressure} мм рт.ст. (${data.pressure_hpa} гПа) | ${data.pressure_trend}\n`;
  }
  
  // ВЛАЖНОСТЬ
  message += `💧 *Влажность:* ${data.humidity}%\n`;
  
  // ВЕТЕР
  message += `💨 *Ветер:* ${data.wind_speed} м/с`;
  if (data.wind_gusts > data.wind_speed) {
    message += `, порывы до ${data.wind_gusts} м/с`;
  }
  message += `, направление ${data.wind_dir_full}\n`;
  
  // ОСАДКИ
  message += `🌧️ *Осадки:* ${data.precip_type}`;
  if (data.precipitation > 0) {
    message += ` (${data.precipitation} мм/час)`;
  }
  if (data.precipitation_prob > 0) {
    message += ` | Вероятность: ${data.precipitation_prob}%`;
  }
  message += '\n';
  
  if (data.precipitation_today > 0) {
    message += `   За день: ${data.precipitation_today} мм`;
    if (data.precipitation_hours > 0) {
      message += ` (${data.precipitation_hours} ч с осадками)`;
    }
    message += '\n';
  }
  
  // ОБЛАЧНОСТЬ
  message += `☁️ *Облачность:* ${data.cloud_desc} (${data.cloud_cover}%)`;
  if (data.cloud_low > 0 || data.cloud_mid > 0 || data.cloud_high > 0) {
    message += ` [н:${data.cloud_low}%, ср:${data.cloud_mid}%, в:${data.cloud_high}%]`;
  }
  message += '\n';
  
  // ВИДИМОСТЬ
  message += `👁️ *Видимость:* ${data.visibility_desc} (${data.visibility_km} км)\n`;
  
  // УФ-ИНДЕКС
  message += `☀️ *УФ-индекс:* ${data.uv_index} — ${data.uv_desc}`;
  if (data.uv_max && data.uv_max !== data.uv_index) {
    message += ` (макс сегодня ${data.uv_max})`;
  }
  message += '\n';
  
  // ВОСХОД/ЗАКАТ
  message += `🌅 *Восход:* ${data.sunrise} | 🌇 *Закат:* ${data.sunset}\n`;
  
  // КОМФОРТ
  message += `✨ *Комфортность:* ${data.comfort}\n\n`;
  
  // ОПИСАНИЕ
  message += `📝 ${data.description}\n`;
  
  return message;
}

/**
 * Расчет длины дня
 */
function calculateDayLength(sunrise, sunset) {
  if (sunrise === '—' || sunset === '—') return '—';
  
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

// ===================== УЛУЧШЕННАЯ ФУНКЦИЯ ПРОГНОЗА НА ЗАВТРА =====================
async function getWeatherForecast(cityName, forceRefresh = false) {
  try {
    if (!cityName) {
      return { success: false, error: 'Город не указан', city: 'Неизвестно' };
    }
    
    if (typeof cityName !== 'string') {
      cityName = String(cityName);
    }
    
    const cacheKey = `forecast_${cityName.toLowerCase()}`;
    const now = Date.now();
    
    if (!forceRefresh && weatherCache.has(cacheKey)) {
      const cached = weatherCache.get(cacheKey);
      if (now - cached.timestamp < 1800000) { // 30 минут кэш
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
    
    // 🌟 РАСШИРЕННЫЙ ЗАПРОС ДЛЯ ПРОГНОЗА
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?
      latitude=${latitude}
      &longitude=${longitude}
      &hourly=
        temperature_2m,
        apparent_temperature,
        precipitation_probability,
        precipitation,
        rain,
        showers,
        snowfall,
        weather_code,
        wind_speed_10m,
        wind_direction_10m,
        wind_gusts_10m,
        cloud_cover,
        visibility,
        uv_index,
        pressure_msl,
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
        wind_direction_10m_dominant,
        weather_code
      &wind_speed_unit=ms
      &timezone=auto
      &forecast_days=3`.replace(/\s+/g, '');
    
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();
    
    if (!forecastData.hourly || !forecastData.daily) {
      throw new Error('Нет данных прогноза');
    }
    
    // 📅 ДАННЫЕ НА ЗАВТРА (индекс 1)
    const tomorrowIndex = 1;
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowDateStr = tomorrowDate.toISOString().split('T')[0];
    
    // 🔍 ПОЛУЧАЕМ ПОЧАСОВЫЕ ДАННЫЕ НА ЗАВТРА
    const tomorrowHours = [];
    forecastData.hourly.time.forEach((time, index) => {
      if (time.startsWith(tomorrowDateStr)) {
        tomorrowHours.push(index);
      }
    });
    
    if (tomorrowHours.length === 0) {
      throw new Error('Нет данных на завтра');
    }
    
    // 🕒 РАЗБИВКА ПО ПЕРИОДАМ ДНЯ
    const periods = {
      'ночь': { start: 0, end: 5, emoji: '🌙' },
      'утро': { start: 6, end: 11, emoji: '🌅' },
      'день': { start: 12, end: 17, emoji: '☀️' },
      'вечер': { start: 18, end: 23, emoji: '🌆' }
    };
    
    const periodData = {};
    let maxTemp = -100;
    let minTemp = 100;
    let maxWindGust = 0;
    let totalPrecip = 0;
    let maxPrecipProb = 0;
    let dominantWeatherCode = 0;
    const weatherCodeCount = {};
    
    for (const [periodName, range] of Object.entries(periods)) {
      const periodHours = tomorrowHours.filter(index => {
        const hour = new Date(forecastData.hourly.time[index]).getHours();
        return hour >= range.start && hour <= range.end;
      });
      
      if (periodHours.length > 0) {
        const temps = periodHours.map(index => forecastData.hourly.temperature_2m[index]);
        const feels = periodHours.map(index => forecastData.hourly.apparent_temperature[index]);
        const precipProb = periodHours.map(index => forecastData.hourly.precipitation_probability[index]);
        const precip = periodHours.map(index => forecastData.hourly.precipitation[index] || 0);
        const rain = periodHours.map(index => forecastData.hourly.rain[index] || 0);
        const snow = periodHours.map(index => forecastData.hourly.snowfall[index] || 0);
        const weatherCodes = periodHours.map(index => forecastData.hourly.weather_code[index]);
        const windSpeed = periodHours.map(index => forecastData.hourly.wind_speed_10m[index]);
        const windGusts = periodHours.map(index => forecastData.hourly.wind_gusts_10m[index] || 0);
        const cloudCover = periodHours.map(index => forecastData.hourly.cloud_cover[index] || 0);
        const pressure = periodHours.map(index => forecastData.hourly.pressure_msl[index] || 0);
        
        // Средние/макс/мин значения
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
        const cloudAvg = Math.round(cloudCover.reduce((a, b) => a + b, 0) / cloudCover.length);
        const pressureAvg = pressure.length > 0 ? Math.round(pressure.reduce((a, b) => a + b, 0) / pressure.length * 0.750062) : null;
        
        // Самый частый код погоды в периоде
        const codeFreq = {};
        weatherCodes.forEach(code => {
          codeFreq[code] = (codeFreq[code] || 0) + 1;
          weatherCodeCount[code] = (weatherCodeCount[code] || 0) + 1;
        });
        const mostFrequentCode = Object.keys(codeFreq).reduce((a, b) => 
          codeFreq[a] >= codeFreq[b] ? a : b
        );
        
        // Обновляем общие максимумы/минимумы
        maxTemp = Math.max(maxTemp, tempMax);
        minTemp = Math.min(minTemp, tempMin);
        maxWindGust = Math.max(maxWindGust, parseFloat(windGustsMax));
        totalPrecip += precipSum;
        maxPrecipProb = Math.max(maxPrecipProb, precipProbAvg);
        
        // Тип осадков для периода
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
          temp_min: Math.round(tempMin),
          temp_max: Math.round(tempMax),
          feels_min: Math.round(feelsMin),
          feels_max: Math.round(feelsMax),
          precip_prob: precipProbAvg,
          precip_sum: precipSum.toFixed(1),
          rain_sum: rainSum.toFixed(1),
          snow_sum: snowSum.toFixed(1),
          precip_type: precipType,
          wind_avg: windAvg,
          wind_gusts_max: windGustsMax,
          cloud_avg: cloudAvg,
          pressure_avg: pressureAvg,
          weather_code: parseInt(mostFrequentCode),
          description: getWeatherDescription(parseInt(mostFrequentCode)),
          emoji: range.emoji
        };
      }
    }
    
    // Определяем доминирующий код погоды на день
    dominantWeatherCode = parseInt(Object.keys(weatherCodeCount).reduce((a, b) => 
      weatherCodeCount[a] >= weatherCodeCount[b] ? a : b
    ));
    
    // Дневные данные из daily
    const tomorrowDaily = forecastData.daily;
    const tempMax = Math.round(tomorrowDaily.temperature_2m_max[tomorrowIndex]);
    const tempMin = Math.round(tomorrowDaily.temperature_2m_min[tomorrowIndex]);
    const feelsMax = Math.round(tomorrowDaily.apparent_temperature_max[tomorrowIndex]);
    const feelsMin = Math.round(tomorrowDaily.apparent_temperature_min[tomorrowIndex]);
    const precipSum = tomorrowDaily.precipitation_sum[tomorrowIndex];
    const precipHours = tomorrowDaily.precipitation_hours[tomorrowIndex];
    const precipProb = tomorrowDaily.precipitation_probability_max[tomorrowIndex];
    const windMax = tomorrowDaily.wind_speed_10m_max[tomorrowIndex].toFixed(1);
    const windGustsMax = tomorrowDaily.wind_gusts_10m_max[tomorrowIndex]?.toFixed(1) || windMax;
    const windDir = getWindDirection(tomorrowDaily.wind_direction_10m_dominant?.[tomorrowIndex]);
    const uvMax = tomorrowDaily.uv_index_max[tomorrowIndex]?.toFixed(1) || '—';
    const sunrise = tomorrowDaily.sunrise[tomorrowIndex]?.substring(11, 16) || '—';
    const sunset = tomorrowDaily.sunset[tomorrowIndex]?.substring(11, 16) || '—';
    
    // Определяем общий тип осадков на день
    let dayPrecipType = 'Без осадков ✨';
    if (precipSum > 0) {
      // Проверяем по периодам, были ли снег или дождь
      let hasSnow = false;
      let hasRain = false;
      Object.values(periodData).forEach(period => {
        if (period.snow_sum > 0) hasSnow = true;
        if (period.rain_sum > 0) hasRain = true;
      });
      
      if (hasSnow && hasRain) dayPrecipType = 'Смешанные осадки 🌨️';
      else if (hasSnow) {
        if (precipSum < 2) dayPrecipType = 'Небольшой снег ❄️';
        else if (precipSum < 5) dayPrecipType = 'Снег ❄️';
        else dayPrecipType = 'Сильный снегопад ❄️❄️';
      } else if (hasRain) {
        if (precipSum < 2) dayPrecipType = 'Небольшой дождь 🌦️';
        else if (precipSum < 7) dayPrecipType = 'Дождь 🌧️';
        else dayPrecipType = 'Сильный дождь 🌧️🌧️';
      }
    }
    
    // 📝 ФОРМИРУЕМ ТЕКСТ ДЛЯ ОТОБРАЖЕНИЯ
    const displayText = formatForecastDisplay({
      city: name,
      date: tomorrowDate,
      temp_min: tempMin,
      temp_max: tempMax,
      feels_min: feelsMin,
      feels_max: feelsMax,
      precip_sum: precipSum,
      precip_hours: precipHours,
      precip_prob: precipProb,
      precip_type: dayPrecipType,
      wind_max: windMax,
      wind_gusts_max: windGustsMax,
      wind_dir: windDir,
      uv_max: uvMax,
      sunrise: sunrise,
      sunset: sunset,
      periods: periodData
    });
    
    // 🎯 ИТОГОВЫЙ ОБЪЕКТ
    const forecastResult = {
      success: true,
      city: name,
      date: tomorrowDateStr,
      date_formatted: tomorrowDate.toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }),
      
      // ОБЩИЕ ДАННЫЕ
      temp_min: tempMin,
      temp_max: tempMax,
      feels_min: feelsMin,
      feels_max: feelsMax,
      precipitation: precipSum,
      precipitation_hours: precipHours,
      precipitation_prob: precipProb,
      precipitation_type: dayPrecipType,
      wind_max: windMax,
      wind_gusts_max: windGustsMax,
      wind_dir: windDir,
      uv_max: uvMax,
      sunrise: sunrise,
      sunset: sunset,
      day_length: calculateDayLength(sunrise, sunset),
      weather_code: dominantWeatherCode,
      description: getWeatherDescription(dominantWeatherCode),
      
      // ПОДРОБНЫЙ ПОЧАСОВОЙ ПРОГНОЗ
      periods: periodData,
      
      // ОТОБРАЖЕНИЕ
      display: displayText,
      
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

/**
 * Форматирование отображения прогноза
 */
function formatForecastDisplay(data) {
  const dateFormatted = data.date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  
  let message = `📅 *Прогноз на ${dateFormatted}*\n`;
  message += `📍 *${data.city}*\n\n`;
  
  message += `📊 *Общий прогноз:*\n`;
  message += `🌡️ *Температура:* ${data.temp_min}°C ... ${data.temp_max}°C\n`;
  message += `🤔 *Ощущается:* ${data.feels_min}°C ... ${data.feels_max}°C\n`;
  message += `💨 *Ветер:* ${data.wind_max} м/с`;
  if (data.wind_gusts_max > data.wind_max) {
    message += `, порывы до ${data.wind_gusts_max} м/с`;
  }
  message += `, ${data.wind_dir}\n`;
  
  message += `🌧️ *Осадки:* ${data.precipitation_type}`;
  if (data.precipitation > 0) {
    message += ` (${data.precipitation.toFixed(1)} мм)`;
    if (data.precipitation_hours > 0) {
      message += `, ${data.precipitation_hours} ч`;
    }
  }
  if (data.precipitation_prob > 0) {
    message += ` | Вероятность: ${data.precipitation_prob}%`;
  }
  message += '\n';
  
  message += `☀️ *УФ-индекс:* ${data.uv_max} (макс)\n`;
  message += `🌅 *Восход:* ${data.sunrise} | 🌇 *Закат:* ${data.sunset} (${data.day_length})\n\n`;
  
  message += `⏰ *Подробный прогноз по времени суток:*\n\n`;
  
  const periodsOrder = ['ночь', 'утро', 'день', 'вечер'];
  
  for (const period of periodsOrder) {
    if (data.periods[period]) {
      const p = data.periods[period];
      
      message += `${p.emoji} *${period.charAt(0).toUpperCase() + period.slice(1)}*\n`;
      message += `   🌡️ ${p.temp_min}°C...${p.temp_max}°C`;
      if (p.feels_min !== p.temp_min || p.feels_max !== p.temp_max) {
        message += ` (ош. ${p.feels_min}°C...${p.feels_max}°C)`;
      }
      message += '\n';
      
      message += `   ${p.description}\n`;
      message += `   💨 Ветер: ${p.wind_avg} м/с`;
      if (p.wind_gusts_max > p.wind_avg) {
        message += `, порывы до ${p.wind_gusts_max} м/с`;
      }
      message += '\n';
      
      message += `   ${p.precip_type}`;
      if (p.precip_sum > 0) {
        message += ` (${p.precip_sum} мм)`;
      }
      if (p.precip_prob > 0) {
        message += ` | ☔️ ${p.precip_prob}%`;
      }
      message += '\n';
      
      if (p.cloud_avg > 0) {
        message += `   ☁️ Облачность: ${p.cloud_avg}%\n`;
      }
      
      if (p.pressure_avg) {
        message += `   📊 Давление: ${p.pressure_avg} мм рт.ст.\n`;
      }
      
      message += '\n';
    }
  }
  
  message += `🕒 Обновлено: ${data.updated || new Date().toLocaleTimeString('ru-RU')}`;
  
  return message;
}

/**
 * Описание погоды по коду
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
    56: 'Лёгкая ледяная морось 🌧️❄️',
    57: 'Сильная ледяная морось 🌧️❄️',
    61: 'Небольшой дождь 🌧️',
    63: 'Дождь 🌧️',
    65: 'Сильный дождь 🌧️',
    66: 'Ледяной дождь 🌧️❄️',
    67: 'Сильный ледяной дождь 🌧️❄️',
    71: 'Небольшой снег ❄️',
    73: 'Снег ❄️',
    75: 'Сильный снег ❄️',
    77: 'Снежная крупа ❄️',
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

function getDetailedWeatherDescription(code, precipitationMm = 0, cloudCover = 0, isDay = 1) {
  if (code === undefined || code === null) {
    return 'Погодные данные';
  }
  
  let description = getWeatherDescription(code);
  
  // Добавляем детализацию по осадкам
  if (precipitationMm > 0) {
    if ([0, 1, 2, 3, 45, 48].includes(code)) {
      if (precipitationMm < 0.5) {
        description = `Пасмурно, возможны кратковременные осадки 🌦️`;
      } else if (precipitationMm < 2) {
        description = `Пасмурно, морось 🌧️ (${precipitationMm.toFixed(1)} мм)`;
      } else if (precipitationMm < 10) {
        description = `Пасмурно, дождь 🌧️ (${precipitationMm.toFixed(1)} мм)`;
      } else {
        description = `Пасмурно, сильный дождь 🌧️ (${precipitationMm.toFixed(1)} мм)`;
      }
    } else {
      description += ` (${precipitationMm.toFixed(1)} мм)`;
    }
  }
  
  // Добавляем время суток
  if (isDay === 0 && description.includes('☀️')) {
    description = description.replace('☀️', '🌙');
  }
  
  return description;
}

// ===================== ОСТАЛЬНАЯ ЧАСТЬ КОДА (КЛАВИАТУРЫ, КОМАНДЫ) =====================
// ВАШ СУЩЕСТВУЮЩИЙ КОД НИЖЕ БЕЗ ИЗМЕНЕНИЙ
// ...

// ===================== ОБНОВЛЕННЫЕ ОБРАБОТЧИКИ ПОГОДЫ =====================

// 🌤️ ПОГОДА СЕЙЧАС - используем улучшенную функцию
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
    await ctx.reply(`⏳ Запрашиваю детальную погоду для ${city}...`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(city);
    
    if (!weather || !weather.success) {
      await ctx.reply(`❌ ${weather?.error || 'Не удалось получить данные о погоде.'}`, { 
        parse_mode: 'Markdown', 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    // Используем готовый отформатированный текст из weather.display
    await ctx.reply(weather.display, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА:', error);
    await ctx.reply('❌ Не удалось получить данные о погоде.', { reply_markup: mainMenuKeyboard });
  }
});

// 📅 ПОГОДА ЗАВТРА - используем улучшенную функцию
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
    await ctx.reply(`⏳ Запрашиваю детальный прогноз на завтра для ${city}...`, { parse_mode: 'Markdown' });
    
    const forecast = await getWeatherForecast(city);
    
    if (!forecast || !forecast.success) {
      await ctx.reply(`❌ ${forecast?.error || 'Не удалось получить прогноз погоды.'}`, { 
        reply_markup: mainMenuKeyboard 
      });
      return;
    }
    
    // Используем готовый отформатированный текст из forecast.display
    await ctx.reply(forecast.display, { 
      parse_mode: 'Markdown', 
      reply_markup: mainMenuKeyboard 
    });
    
  } catch (error) {
    console.error('❌ Ошибка в ПОГОДА ЗАВТРА:', error);
    await ctx.reply('❌ Не удалось получить прогноз погоды.', { reply_markup: mainMenuKeyboard });
  }
});

// 👕 ЧТО НАДЕТЬ? - обновляем с учетом новых данных
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
    
    // Улучшенная функция рекомендаций с учетом новых данных
    const advice = getEnhancedWardrobeAdvice(weather);
    
    await ctx.reply(
      `👕 *Что надеть в ${weather.city}?*\n\n${advice}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    
  } catch (error) {
    console.error('❌ Ошибка в ЧТО НАДЕТЬ:', error);
    await ctx.reply('❌ Не удалось получить рекомендацию.', { reply_markup: mainMenuKeyboard });
  }
});

// Улучшенная функция рекомендаций по одежде
function getEnhancedWardrobeAdvice(weather) {
  if (!weather || !weather.success) {
    return '❌ Нет данных о погоде для рекомендаций по одежде.';
  }
  
  const { temp, feels_like, wind, precipitation, uv, clouds, description } = weather;
  let advice = [];
  let layers = [];

  // 🌡️ ОСНОВНЫЕ СЛОИ ПО ТЕМПЕРАТУРЕ
  if (temp >= 25) {
    layers.push('👕 *Базовый слой:* футболка, майка из хлопка или льна');
    layers.push('👖 *Низ:* шорты, легкие брюки, юбка');
    layers.push('👟 *Обувь:* сандалии, кеды, легкие кроссовки');
  } else if (temp >= 18) {
    layers.push('👕 *Базовый слой:* футболка, рубашка с коротким рукавом');
    layers.push('🧥 *Верх:* легкая кофта, джинсовка на вечер');
    layers.push('👖 *Низ:* джинсы, брюки, леггинсы');
  } else if (temp >= 10) {
    layers.push('👕 *Базовый слой:* лонгслив, водолазка, тонкое термобелье');
    layers.push('🧥 *Верх:* свитер, худи, ветровка');
    layers.push('👖 *Низ:* джинсы, утепленные брюки');
  } else if (temp >= 0) {
    layers.push('👕 *Базовый слой:* термобелье, флисовая кофта');
    layers.push('🧥 *Верх:* утепленный свитер, зимняя куртка');
    layers.push('👖 *Низ:* утепленные штаны, джинсы с подкладом');
    layers.push('🧣 *Аксессуары:* шарф, перчатки, шапка');
  } else {
    layers.push('👕 *Базовый слой:* плотное термобелье, флис');
    layers.push('🧥 *Верх:* пуховик, парка с мехом');
    layers.push('👖 *Низ:* утепленные штаны, термоштаны');
    layers.push('🧣 *Аксессуары:* теплая шапка, варежки, шарф, балаклава');
  }

  // 💨 УЧЕТ ВЕТРА
  if (wind && parseFloat(wind.speed) > 5) {
    layers.push('💨 *От ветра:* непродуваемая куртка, ветровка с капюшоном');
    if (parseFloat(wind.speed) > 10) {
      layers.push('🌪️ *Сильный ветер:* дополнительный слой, защита для лица');
    }
  }

  // 🌧️ УЧЕТ ОСАДКОВ
  if (precipitation && precipitation.total > 0) {
    if (precipitation.snow > 0) {
      layers.push('❄️ *От снега:* непромокаемая обувь, варежки, термобелье');
      if (precipitation.snow > 2) {
        layers.push('☃️ *Сильный снегопад:* снегозащитные штаны, бахилы');
      }
    } else if (precipitation.rain > 0) {
      layers.push('☔ *От дождя:* дождевик, зонт, непромокаемая обувь');
      if (precipitation.rain > 3) {
        layers.push('🌊 *Сильный дождь:* водонепроницаемый костюм, бахилы');
      }
    }
  }

  // ☀️ УЧЕТ УФ-ИНДЕКСА
  if (uv && uv.index > 3) {
    layers.push('🕶️ *Защита от солнца:* солнцезащитные очки, кепка/панама');
    if (uv.index > 6) {
      layers.push('🧴 *Солнцезащитный крем:* SPF 30+ (обновлять каждые 2 часа)');
    }
    if (uv.index > 8) {
      layers.push('🎭 *Экстремальный УФ:* закрытая одежда, тент/навес');
    }
  }

  // ☁️ УЧЕТ ОБЛАЧНОСТИ
  if (clouds && clouds.total > 70) {
    layers.push('🌫️ *Пасмурно:* светоотражающие элементы на одежде');
  }

  // 🌡️ УЧЕТ ОЩУЩАЕМОЙ ТЕМПЕРАТУРЫ
  const tempDiff = Math.abs(temp - feels_like);
  if (tempDiff > 3) {
    if (feels_like < temp) {
      layers.push(`🥶 *Ощущается холоднее:* добавьте слой (реально ${feels_like}°C)`);
    } else {
      layers.push(`🥵 *Ощущается теплее:* можно снять слой (реально ${feels_like}°C)`);
    }
  }

  // 🎒 ДОПОЛНИТЕЛЬНЫЕ СОВЕТЫ
  advice.push('📋 *Одеваемся по погоде:*\n');
  advice.push(...layers);
  
  advice.push('\n🎒 *Что взять с собой:*');
  if (precipitation && precipitation.prob > 30) {
    advice.push('• ☂️ Зонт или дождевик');
  }
  if (uv && uv.index > 5) {
    advice.push('• 🧴 Солнцезащитный крем');
  }
  if (wind && parseFloat(wind.speed) > 8) {
    advice.push('• 🧣 Шарф для защиты от ветра');
  }
  advice.push('• 💧 Бутылка воды');
  advice.push('• 🔋 Power bank для телефона');

  return advice.join('\n');
}

// ===================== ОСТАЛЬНАЯ ЧАСТЬ ВАШЕГО СУЩЕСТВУЮЩЕГО КОДА =====================
// (команды /start, /city, /stats, /top, /tetris и т.д.)
// ВСЕ ОСТАЛЬНЫЕ ФУНКЦИИ И КОМАНДЫ ОСТАЮТСЯ БЕЗ ИЗМЕНЕНИЙ

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
          'Детальная погода сейчас (давление, ветер, осадки, УФ, видимость)',
          'Подробный прогноз на завтра по периодам',
          'Умные рекомендации по одежде',
          'Английские фразы (200+)',
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
console.log('⚡ Бот загружен с УЛУЧШЕННОЙ системой погоды!');
console.log('📍 Система городов: ВКЛЮЧЕНА');
console.log('🌤️ Детальная погода сейчас: ВКЛЮЧЕНА (давление, ветер, осадки, УФ)');
console.log('📅 Прогноз на завтра: ВКЛЮЧЕН (по периодам)');
console.log('🏆 Топ игроков: ВКЛЮЧЕН');
