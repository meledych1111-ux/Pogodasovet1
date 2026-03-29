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

    let textOutput = "";

    for (const [periodName, range] of Object.entries(periods)) {
      const periodHours = todayHours.filter(index => {
        const hour = new Date(forecastData.hourly.time[index]).getHours();
        return hour >= range.start && hour <= range.end;
      });

      if (periodHours.length > 0) {
        const temps = periodHours.map(i => forecastData.hourly.temperature_2m[i]);
        const weatherCodes = periodHours.map(i => forecastData.hourly.weather_code[i]);
        
        const tempMin = Math.round(Math.min(...temps));
        const tempMax = Math.round(Math.max(...temps));
        
        const codeFreq = {};
        weatherCodes.forEach(code => codeFreq[code] = (codeFreq[code] || 0) + 1);
        const commonCode = Object.keys(codeFreq).reduce((a, b) => codeFreq[a] >= codeFreq[b] ? a : b);
        
        textOutput += `${range.emoji} *${range.title}:* ${tempMin}°...${tempMax}°C, ${getWeatherDescription(parseInt(commonCode))}\n`;
      }
    }

    const forecastResult = {
      success: true,
      city: name,
      periods: textOutput
    };

    weatherCache.set(cacheKey, { data: forecastResult, timestamp: now });
    return forecastResult;

  } catch (error) {
    console.error('❌ Ошибка получения детального прогноза:', error.message);
    return { success: false, error: error.message };
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

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,weather_code&timezone=auto&forecast_days=2`;
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();

    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

    const periods = {
      'ночь': { start: 0, end: 5, emoji: '🌙', title: 'Ночь' },
      'утро': { start: 6, end: 11, emoji: '🌅', title: 'Утро' },
      'день': { start: 12, end: 17, emoji: '☀️', title: 'День' },
      'вечер': { start: 18, end: 23, emoji: '🌆', title: 'Вечер' }
    };

    let textOutput = "";
    const tomorrowHours = forecastData.hourly.time.map((t, i) => t.startsWith(tomorrowStr) ? i : -1).filter(i => i !== -1);

    for (const [pName, range] of Object.entries(periods)) {
        const pHours = tomorrowHours.filter(i => {
            const h = new Date(forecastData.hourly.time[i]).getHours();
            return h >= range.start && h <= range.end;
        });
        if (pHours.length > 0) {
            const temps = pHours.map(i => forecastData.hourly.temperature_2m[i]);
            textOutput += `${range.emoji} *${range.title}:* ${Math.round(Math.min(...temps))}°...${Math.round(Math.max(...temps))}°C\n`;
        }
    }

    const res = { success: true, city: name, periods: textOutput };
    weatherCache.set(cacheKey, { data: res, timestamp: now });
    return res;
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

// ===================== ПОЛНЫЙ РАЗГОВОРНИК =====================
const dailyPhrases = [
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая автобусная остановка?", explanation: "Транспорт", category: "Транспорт", level: "Начальный" },
  { english: "Could you recommend a good restaurant?", russian: "Не могли бы вы порекомендовать хороший ресторан?", explanation: "Еда", category: "Еда", level: "Средний" },
  { english: "How much does this cost?", russian: "Сколько это стоит?", explanation: "Покупки", category: "Покупки", level: "Начальный" },
  { english: "I need to see a doctor.", russian: "Мне нужно к врачу.", explanation: "Здоровье", category: "Здоровье", level: "Начальный" },
  { english: "What time is check-out?", russian: "Во сколько выезд?", explanation: "Отель", category: "Отель", level: "Начальный" }
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
  const help = `📖 *Как пользоваться ботом:*\n\n1. *🌤️ Погода сейчас* — подробные данные.\n2. *📅 Сегодня/Завтра* — прогноз по периодам.\n3. *👕 Что надеть?* — умные советы.\n4. *💬 Английский* — фраза дня.\n5. *🎮 Тетрис* — играй анонимно.`;
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
    ctx.reply('❌ Город не найден. Напишите название правильно.', { reply_markup: cityKeyboard });
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
