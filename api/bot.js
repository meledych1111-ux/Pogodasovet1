import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
  saveOrUpdateUser,
  generateAnonymousName
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config();
dotenv.config({ path: envPath });

const bot = new Bot(process.env.BOT_TOKEN || 'dummy');

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================
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

    // Форматируем периоды в текст для вывода
    let periodsText = "";
    for (const p of Object.values(periodData)) {
      periodsText += `${p.emoji} *${p.title}:* ${p.temp_min}°...${p.temp_max}°C, ${p.description}\n`;
    }

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
      periods: periodsText,
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

    for (const [periodName, range] of Object.entries(periods)) {
      const periodHours = tomorrowHours.filter(index => {
        const hour = new Date(forecastData.hourly.time[index]).getHours();
        return hour >= range.start && hour <= range.end;
      });

      if (periodHours.length > 0) {
        const temps = periodHours.map(i => forecastData.hourly.temperature_2m[i]);
        const weatherCodes = periodHours.map(i => forecastData.hourly.weather_code[i]);
        const tempMin = Math.min(...temps);
        const tempMax = Math.max(...temps);

        const codeFreq = {};
        weatherCodes.forEach(code => codeFreq[code] = (codeFreq[code] || 0) + 1);
        const mostFrequentCode = Object.keys(codeFreq).reduce((a, b) => codeFreq[a] >= codeFreq[b] ? a : b);

        maxTemp = Math.max(maxTemp, tempMax);
        minTemp = Math.min(minTemp, tempMin);

        periodData[periodName] = {
          title: range.title,
          emoji: range.emoji,
          temp_min: Math.round(tempMin),
          temp_max: Math.round(tempMax),
          description: getWeatherDescription(parseInt(mostFrequentCode))
        };
      }
    }

    let periodsText = "";
    for (const p of Object.values(periodData)) {
      periodsText += `${p.emoji} *${p.title}:* ${p.temp_min}°...${p.temp_max}°C, ${p.description}\n`;
    }

    const forecastResult = {
      success: true,
      city: name,
      periods: periodsText
    };

    weatherCache.set(cacheKey, { data: forecastResult, timestamp: now });
    return forecastResult;

  } catch (error) {
    return { success: false, error: error.message };
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
    } else if (rain_now > 0) {
      advice.push('   • ☔ Зонт или дождевик');
      advice.push('   • 👢 Непромокаемая обувь');
    }
  }

  // Рекомендации по ветру
  if (wind_speed && parseFloat(wind_speed) > 5) {
    advice.push('\n💨 *Ветрено:*');
    advice.push('   • 🧥 Непродуваемая куртка');
  }

  return advice.join('\n');
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
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').text('💬 ФРАЗА ДНЯ').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ').resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row()
    .text('📍 СЕВАСТОПОЛЬ').text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ =====================
bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: ctx.from.id.toString(), chat_id: ctx.chat.id, city: 'Не указан' });
  await ctx.reply(`👋 Привет! Я — твой личный ассистент.\n\nТвое анонимное имя: *${name}*\n\nЧтобы я мог показывать погоду, нажми кнопку ниже и выбери город.`, {
    parse_mode: 'Markdown',
    reply_markup: new Keyboard().text('🚀 НАЧАТЬ РАБОТУ').resized()
  });
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', (ctx) => ctx.reply('🏙️ Выбери город или напиши название:', { reply_markup: cityKeyboard }));

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка: ' + w.error);
  await ctx.reply(`🌤️ *Погода в ${w.city}:*\n🌡️ ${w.temp}°C (ощущается как ${w.feels_like}°C)\n📝 ${w.description}\n💨 Ветер: ${w.wind_speed} м/с (${w.wind_dir})\n📊 Давление: ${w.pressure} мм рт.ст.\n💧 Влажность: ${w.humidity}%`, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажи город!');
  const f = await getDetailedTodayWeather(res.city);
  if (!f.success) return ctx.reply('❌ Ошибка: ' + f.error);
  await ctx.reply(`📅 *Прогноз в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Укажи город!');
  const f = await getWeatherForecast(res.city);
  if (!f.success) return ctx.reply('❌ Ошибка: ' + f.error);
  await ctx.reply(`📅 *Прогноз в ${f.city} на завтра:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Выберите город!');
  const w = await getWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 \`${p.english}\`\n🇷🇺 ${p.russian}\n\n💡 Категория: ${p.explanation}`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ ФРАЗА', (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  ctx.reply(`🎲 *Случайная фраза*\n\n🇬🇧 \`${p.english}\`\n🇷🇺 ${p.russian}\n\n💡 Категория: ${p.explanation}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const cityRes = await getUserCity(ctx.from.id);
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(cityRes.city || 'Не указан')}`;
  await ctx.reply(`🕹️ *Тетрис 3D*\n\nТвое игровое имя: *${name}*\n\nГотов побить рекорд своего города? Жми на кнопку!`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выберите город или напишите новый:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(ctx.from.id.toString(), city);
  await ctx.reply(`✅ Город *${city}* сохранен! Теперь я буду присылать прогнозы для него.`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => {
  const help = `📖 *Как пользоваться ботом:*\n\n` +
    `1. *🌤️ Погода сейчас* — подробные данные (температура, ветер, давление).\n` +
    `2. *📅 Сегодня/Завтра* — прогноз по 4-м периодам суток.\n` +
    `3. *👕 Что надеть?* — умные советы на основе температуры, ветра и осадков.\n` +
    `4. *💬 Английский* — пополняй словарный запас фразами для поездок и общения.\n` +
    `5. *🎮 Тетрис* — играй анонимно, соревнуйся в лидерборде своего города.\n\n` +
    `📍 Если города нет в кнопках, просто *напиши его название* сообщением.`;
  ctx.reply(help, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const city = ctx.message.text.trim();
  try {
    const check = await getWeatherData(city);
    if (!check.success) throw new Error();
    await saveUserCity(ctx.from.id.toString(), check.city);
    await ctx.reply(`✅ Город *${check.city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ Город не найден. Напишите название правильно (например: Москва).', { reply_markup: cityKeyboard });
  }
});

// ===================== ЭКСПОРТ ДЛЯ VERCEL =====================
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      if (!bot.isInited()) await bot.init();
      await bot.handleUpdate(req.body);
    } catch (e) { console.error('Bot Error:', e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'running' });
}
