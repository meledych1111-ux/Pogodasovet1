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
const weatherCache = new Map();

/**
 * Получить текстовое описание направления ветра
 */
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = [
    'северный', 'северо-восточный', 'восточный', 'юго-восточный',
    'южный', 'юго-западный', 'западный', 'северо-западный'
  ];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
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
  if (minutes < 0) { hours--; minutes += 60; }
  return `${hours} ч ${minutes} мин`;
}

/**
 * Получить описание погоды по коду
 */
function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно, небо чистое ☀️',
    1: 'Преимущественно ясно 🌤️',
    2: 'Переменная облачность ⛅',
    3: 'Пасмурно и серо ☁️',
    45: 'На улице туман 🌫️',
    48: 'Густой иней или туман 🌫️',
    51: 'Легкая морось 🌧️',
    53: 'Умеренная морось 🌧️',
    55: 'Сильная морось 🌧️',
    61: 'Идет небольшой дождь 🌧️',
    63: 'Идет дождь 🌧️',
    65: 'Сильный проливной дождь 🌧️',
    71: 'Выпал небольшой снег ❄️',
    73: 'Идет снег ❄️',
    75: 'Сильный снегопад ❄️',
    80: 'Небольшой ливневый дождь 🌧️',
    81: 'Сильный ливень 🌧️',
    82: 'Очень сильный ливень 🌧️',
    85: 'Небольшой снежный заряд ❄️',
    86: 'Сильный снегопад ❄️',
    95: 'Возможна гроза ⛈️',
    96: 'Гроза с небольшим градом ⛈️',
    99: 'Сильная гроза с градом ⛈️'
  };
  return weatherMap[code] || `Код погоды: ${code}`;
}

/**
 * Генерирует текстовое резюме погоды
 */
function getWeatherSummary(w) {
  let summary = `Сейчас в городе ${w.description.toLowerCase()}. `;
  
  if (w.temp > 28) summary += "На улице очень жарко, старайтесь быть в тени. ";
  else if (w.temp < -15) summary += "Сильный мороз, одевайтесь максимально тепло! ";
  
  if (parseFloat(w.wind_speed) > 12) summary += "Внимание: дует сильный порывистый ветер. ";
  else if (parseFloat(w.wind_speed) > 6) summary += "Ощущается заметный ветер. ";
  
  if (w.has_precipitation) {
    if (w.rain_now > 0) summary += "Не забудьте зонт, идет дождь. ";
    if (w.snow_now > 0) summary += "На дорогах может быть скользко из-за снега. ";
  } else if (w.humidity > 85) {
    summary += "Воздух очень влажный. ";
  }
  
  return summary;
}

// ===================== УЛУЧШЕННАЯ ФУНКЦИЯ ПОГОДЫ НА СЕЙЧАС =====================
async function getWeatherData(cityName, forceRefresh = false) {
  try {
    if (!cityName) return { success: false, error: 'Город не указан' };
    const cacheKey = `current_${cityName.toLowerCase()}`;
    const now = Date.now();
    if (!forceRefresh && weatherCache.has(cacheKey)) {
      const cached = weatherCache.get(cacheKey);
      if (now - cached.timestamp < 600000) return cached.data;
    }

    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    if (!geoData.results || geoData.results.length === 0) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,precipitation,rain,snowfall,weather_code,is_day&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    const current = weatherData.current;
    const daily = weatherData.daily;

    const sunrise = daily?.sunrise?.[0]?.substring(11, 16) || '—';
    const sunset = daily?.sunset?.[0]?.substring(11, 16) || '—';

    const weatherResult = {
      success: true,
      city: name,
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind_speed: current.wind_speed_10m.toFixed(1),
      wind_dir: getWindDirection(current.wind_direction_10m),
      pressure: Math.round(current.pressure_msl * 0.750062),
      description: getWeatherDescription(current.weather_code),
      has_precipitation: (current.precipitation > 0),
      rain_now: current.rain || 0,
      snow_now: current.snowfall || 0,
      day_length: calculateDayLength(sunrise, sunset)
    };
    weatherCache.set(cacheKey, { data: weatherResult, timestamp: now });
    return weatherResult;
  } catch (error) { return { success: false, error: error.message }; }
}

// ===================== ПОЛНЫЙ ИНФОРМАТИВНЫЙ ПРОГНОЗ =====================
async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.[0]) throw new Error('Город не найден');

    const { latitude, longitude, name } = geoData.results[0];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,pressure_msl&daily=sunrise,sunset,uv_index_max&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    
    const response = await fetch(url);
    const data = await response.json();

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const dateStr = targetDate.toISOString().split('T')[0];

    const periods = [
      { name: 'Ночь', hours: [0, 1, 2, 3, 4, 5], emoji: '🌙' },
      { name: 'Утро', hours: [6, 7, 8, 9, 10, 11], emoji: '🌅' },
      { name: 'День', hours: [12, 13, 14, 15, 16, 17], emoji: '☀️' },
      { name: 'Вечер', hours: [18, 19, 20, 21, 22, 23], emoji: '🌆' }
    ];

    let output = "";
    periods.forEach(p => {
      const indices = data.hourly.time.map((t, i) => {
        const d = new Date(t);
        return (t.startsWith(dateStr) && p.hours.includes(d.getHours())) ? i : -1;
      }).filter(i => i !== -1);

      if (indices.length > 0) {
        const temps = indices.map(i => data.hourly.temperature_2m[i]);
        const feels = indices.map(i => data.hourly.apparent_temperature[i]);
        const codes = indices.map(i => data.hourly.weather_code[i]);
        const winds = indices.map(i => data.hourly.wind_speed_10m[i]);
        const probs = indices.map(i => data.hourly.precipitation_probability[i]);
        const hums = indices.map(i => data.hourly.relative_humidity_2m[i]);
        const pressures = indices.map(i => data.hourly.pressure_msl[i]);

        const avgFeel = Math.round(feels.reduce((a, b) => a + b) / feels.length);
        const maxProb = Math.max(...probs);
        const avgWind = (winds.reduce((a, b) => a + b) / winds.length).toFixed(1);
        const avgHum = Math.round(hums.reduce((a, b) => a + b) / hums.length);
        const avgPress = Math.round((pressures.reduce((a, b) => a + b) / pressures.length) * 0.750062);
        
        const counts = {}; codes.forEach(c => counts[c] = (counts[c] || 0) + 1);
        const mainCode = Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b);

        output += `${p.emoji} *${p.name}:* ${Math.min(...temps).toFixed(0)}°...${Math.max(...temps).toFixed(0)}°C\n`;
        output += `   ${getWeatherDescription(parseInt(mainCode))} (ощущ. ${avgFeel}°)\n`;
        output += `   💨 ${avgWind} м/с | 💧 ${avgHum}% | ☔ ${maxProb}%\n`;
        output += `   📊 ${avgPress} мм рт. ст.\n\n`;
      }
    });

    const daily = data.daily;
    const sunrise = daily?.sunrise?.[dayOffset]?.split('T')[1] || '—';
    const sunset = daily?.sunset?.[dayOffset]?.split('T')[1] || '—';
    const uv = daily?.uv_index_max?.[dayOffset] || 0;
    
    output += `🌅 Восход: ${sunrise} | 🌆 Закат: ${sunset}\n`;
    output += `☀️ УФ-индекс: ${uv.toFixed(1)}`;

    return { success: true, city: name, periods: output };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedTodayWeather(cityName) { return await getDetailedForecast(cityName, 0); }
async function getWeatherForecast(cityName) { return await getDetailedForecast(cityName, 1); }

// ===================== УЛУЧШЕННАЯ ФУНКЦИЯ РЕКОМЕНДАЦИЙ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(weatherData) {
  if (!weatherData || !weatherData.success) return '❌ Нет данных о погоде для рекомендаций.';
  
  const { temp, feels_like, wind_speed, rain_now, snow_now, city, description } = weatherData;
  const f = feels_like; // используем "ощущается как" для базы советов
  const wind = parseFloat(wind_speed);

  const advice = [
    `👕 *Что надеть в ${city} сейчас?*\n`,
    `🌡️ *На улице:* ${temp}°C`,
    `🤔 *Ощущается как:* ${f}°C`,
    `📝 ${description}\n`,
    `📋 *Мой совет:*`
  ];

  // Логика подбора одежды по ощущаемой температуре
  if (f >= 25) {
    advice.push('☀️ Жарко! Выбирайте легкие ткани: майки, шорты, сарафаны. Не забудьте кепку и солнцезащитные очки.');
  } else if (f >= 20) {
    advice.push('👕 Тепло и комфортно. Футболка или легкая рубашка, брюки или джинсы, кеды.');
  } else if (f >= 15) {
    advice.push('🧥 Прохладно. Подойдет лонгслив, легкий свитшот или тонкая ветровка поверх футболки.');
  } else if (f >= 10) {
    advice.push('🧥 Ощутимо холодает. Нужна демисезонная куртка или плотный бомбер, свитер и закрытая обувь.');
  } else if (f >= 5) {
    advice.push('🧣 Холодно. Надевайте осеннюю куртку или пальто. Можно добавить легкий шарф.');
  } else if (f >= 0) {
    advice.push('🧤 Около нуля. Пора доставать теплую куртку или легкий пуховик. Обязательно шапка и шарф.');
  } else if (f >= -10) {
    advice.push('❄️ Морозно. Зимний пуховик, теплые ботинки, перчатки и плотная шапка — обязательны.');
  } else if (f >= -20) {
    advice.push('🥶 Сильный мороз! Надевайте термобелье, шерстяной свитер, самый теплый пуховик и варежки.');
  } else {
    advice.push('🚨 Экстремальный холод! По возможности оставайтесь дома. Если нужно выйти — одевайтесь многослойно, закрывайте лицо шарфом.');
  }

  // Дополнительные советы по условиям
  if (wind > 7) {
    advice.push('💨 *Внимание:* Сильный ветер! Лучше надеть что-то непродуваемое (ветровку или парку).');
  }

  if (rain_now > 0) {
    advice.push('☔ *Осадки:* Идет дождь. Обязательно возьмите зонт или наденьте дождевик/куртку с капюшоном.');
  } else if (snow_now > 0) {
    advice.push('☃️ *Осадки:* Идет снег. Выбирайте непромокаемую обувь и одежду, к которой не липнет снег.');
  }

  return advice.join('\n');
}

// ===================== РАЗГОВОРНИК (ОСТАЛЬНОЙ КОД БЕЗ ИЗМЕНЕНИЙ) =====================
const dailyPhrases = [
  // ТРАНСПОРТ
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая автобусная остановка?", explanation: "Спрашиваем про общественный транспорт", category: "Транспорт", level: "Начальный" },
  { english: "I'd like a window seat, please.", russian: "Я хотел бы место у окна, пожалуйста.", explanation: "Заказываем место в самолете или поезде", category: "Транспорт", level: "Средний" },
  { english: "What time is the last train?", russian: "Во сколько последний поезд?", explanation: "Уточняем расписание", category: "Транспорт", level: "Начальный" },
  { english: "How often do the buses run?", russian: "Как часто ходят автобусы?", explanation: "Интервал движения", category: "Транспорт", level: "Средний" },
  { english: "Is this the right platform for Oxford?", russian: "Это правильная платформа на Оксфорд?", explanation: "Проверяем платформу", category: "Транспорт", level: "Средний" },
  { english: "Do I need to validate my ticket?", russian: "Мне нужно компостировать билет?", explanation: "Спрашиваем про валидацию", category: "Транспорт", level: "Средний" },
  { english: "Can I pay by card?", russian: "Можно оплатить картой?", explanation: "Способ оплаты", category: "Транспорт", level: "Начальный" },
  { english: "A return ticket to Brighton, please.", russian: "Билет туда-обратно в Брайтон, пожалуйста.", explanation: "Покупаем билет", category: "Транспорт", level: "Начальный" },
  { english: "Is there a direct flight?", russian: "Есть прямой рейс?", explanation: "Без пересадок", category: "Транспорт", level: "Средний" },
  { english: "What's the boarding time?", russian: "Во сколько посадка?", explanation: "Уточняем время посадки", category: "Транспорт", level: "Начальный" },
  { english: "Which gate do I need?", russian: "Какой выход мне нужен?", explanation: "В аэропорту", category: "Транспорт", level: "Начальный" },
  { english: "I missed my connection.", russian: "Я опоздал на стыковку.", explanation: "Проблема в аэропорту", category: "Транспорт", level: "Средний" },
  { english: "Can you call me a taxi?", russian: "Вы можете вызвать мне такси?", explanation: "В отеле или ресторане", category: "Транспорт", level: "Начальный" },
  { english: "How much to the city center?", russian: "Сколько стоит до центра города?", explanation: "Торгуемся с таксистом", category: "Транспорт", level: "Начальный" },
  { english: "Keep the change.", russian: "Сдачи не надо.", explanation: "Чаевые таксисту", category: "Транспорт", level: "Средний" },
  { english: "I need to rent a car.", russian: "Мне нужно арендовать машину.", explanation: "В прокате авто", category: "Транспорт", level: "Средний" },
  { english: "Is insurance included?", russian: "Страховка включена?", explanation: "При аренде авто", category: "Транспорт", level: "Средний" },
  { english: "I'd like automatic transmission.", russian: "Я хотел бы автоматическую коробку.", explanation: "Выбор авто", category: "Транспорт", level: "Продвинутый" },
  { english: "Where can I park?", russian: "Где можно припарковаться?", explanation: "Поиск парковки", category: "Транспорт", level: "Начальный" },
  { english: "My car broke down.", russian: "Моя машина сломалась.", explanation: "Экстренная ситуация", category: "Транспорт", level: "Средний" },

  // ЕДА И РЕСТОРАНЫ
  { english: "Could you recommend a good restaurant?", russian: "Не могли бы вы порекомендовать хороший ресторан?", explanation: "Просим рекомендацию", category: "Еда", level: "Средний" },
  { english: "A table for two, please.", russian: "Столик на двоих, пожалуйста.", explanation: "В ресторане", category: "Еда", level: "Начальный" },
  { english: "Do you have a vegetarian menu?", russian: "У вас есть вегетарианское меню?", explanation: "Особое питание", category: "Еда", level: "Средний" },
  { english: "I'm allergic to nuts.", russian: "У меня аллергия на орехи.", explanation: "Предупреждение об аллергии", category: "Еда", level: "Средний" },
  { english: "What's the dish of the day?", russian: "Какое блюдо дня?", explanation: "Спецпредложение", category: "Еда", level: "Средний" },
  { english: "I'd like it medium rare.", russian: "Я хотел бы с кровью.", explanation: "Степень прожарки стейка", category: "Еда", level: "Продвинутый" },
  { english: "Could we see the wine list?", russian: "Можно посмотреть винную карту?", explanation: "Заказ вина", category: "Еда", level: "Средний" },
  { english: "Is service included?", russian: "Обслуживание включено?", explanation: "Проверка счета", category: "Еда", level: "Средний" },
  { english: "Can we sit outside?", russian: "Можно сесть на улице?", explanation: "На террасе", category: "Еда", level: "Начальный" },
  { english: "I didn't order this.", russian: "Я это не заказывал.", explanation: "Ошибка в заказе", category: "Еда", level: "Средний" },
  { english: "Could we have some more bread?", russian: "Можно еще хлеба?", explanation: "Дополнительный заказ", category: "Еда", level: "Начальный" },
  { english: "Is this spicy?", russian: "Это острое?", explanation: "Уточняем остроту", category: "Еда", level: "Начальный" },
  { english: "I'd like the bill, please.", russian: "Счет, пожалуйста.", explanation: "Просим счет", category: "Еда", level: "Начальный" },
  { english: "We'd like to order.", russian: "Мы хотели бы сделать заказ.", explanation: "Готовы заказывать", category: "Еда", level: "Начальный" },
  { english: "What do you recommend?", russian: "Что вы порекомендуете?", explanation: "Совет официанта", category: "Еда", level: "Начальный" },
  { english: "Can I have this to go?", russian: "Можно это с собой?", explanation: "Еда на вынос", category: "Еда", level: "Средний" },
  { english: "Is there a kids' menu?", russian: "Есть детское меню?", explanation: "Для детей", category: "Еда", level: "Средний" },
  { english: "Could we change tables?", russian: "Можно пересесть?", explanation: "Смена столика", category: "Еда", level: "Средний" },
  { english: "The food is cold.", russian: "Еда холодная.", explanation: "Жалоба", category: "Еда", level: "Средний" },
  { english: "I'd like to make a reservation.", russian: "Я хотел бы забронировать столик.", explanation: "Бронь по телефону", category: "Еда", level: "Средний" },
  { english: "For 7:30 PM.", russian: "На 19:30.", explanation: "Время брони", category: "Еда", level: "Начальный" },
  { english: "Do you have gluten-free options?", russian: "У вас есть безглютеновые блюда?", explanation: "Диетическое питание", category: "Еда", level: "Продвинутый" },
  { english: "Could we have a high chair?", russian: "Можно детский стульчик?", explanation: "Для ребенка", category: "Еда", level: "Средний" },
  { english: "Is tap water free?", russian: "Вода из-под крана бесплатная?", explanation: "Экономим на воде", category: "Еда", level: "Средний" },
  { english: "Can I pay separately?", russian: "Можно оплатить отдельно?", explanation: "Раздельный счет", category: "Еда", level: "Средний" },

  // ПОКУПКИ
  { english: "How much does this cost?", russian: "Сколько это стоит?", explanation: "Спрашиваем цену", category: "Покупки", level: "Начальный" },
  { english: "I'm just looking, thanks.", russian: "Я просто смотрю, спасибо.", explanation: "Отказ от помощи", category: "Покупки", level: "Начальный" },
  { english: "Do you have this in a different color?", russian: "У вас есть это другого цвета?", explanation: "Выбор цвета", category: "Покупки", level: "Средний" },
  { english: "Can I try this on?", russian: "Можно это примерить?", explanation: "Примерка", category: "Покупки", level: "Начальный" },
  { english: "Where are the fitting rooms?", russian: "Где примерочные?", explanation: "Поиск примерочной", category: "Покупки", level: "Начальный" },
  { english: "It doesn't fit.", russian: "Не подходит по размеру.", explanation: "Неправильный размер", category: "Покупки", level: "Начальный" },
  { english: "Do you have a larger size?", russian: "У вас есть размер побольше?", explanation: "Нужен больше", category: "Покупки", level: "Средний" },
  { english: "Is this on sale?", russian: "Это по акции?", explanation: "Скидка", category: "Покупки", level: "Средний" },
  { english: "Can I get a tax refund?", russian: "Можно вернуть налог?", explanation: "Tax Free", category: "Покупки", level: "Продвинутый" },
  { english: "I'd like to return this.", russian: "Я хотел бы вернуть это.", explanation: "Возврат товара", category: "Покупки", level: "Средний" },
  { english: "Do you offer gift wrapping?", russian: "У вас есть подарочная упаковка?", explanation: "Упаковка подарка", category: "Покупки", level: "Средний" },
  { english: "Is there a warranty?", russian: "Есть гарантия?", explanation: "На электронику", category: "Покупки", level: "Средний" },
  { english: "Can you order it for me?", russian: "Можете заказать для меня?", explanation: "Нет в наличии", category: "Покупки", level: "Средний" },
  { english: "I'll take it.", russian: "Я беру это.", explanation: "Решение купить", category: "Покупки", level: "Начальный" },
  { english: "Where's the nearest supermarket?", russian: "Где ближайший супермаркет?", explanation: "Поиск продуктов", category: "Покупки", level: "Начальный" },
  { english: "Do you have a loyalty card?", russian: "У вас есть карта лояльности?", explanation: "Скидочная карта", category: "Покупки", level: "Средний" },
  { english: "Can I have a receipt, please?", russian: "Можно чек, пожалуйста?", explanation: "Просим чек", category: "Покупки", level: "Начальный" },
  { english: "Is this real leather?", russian: "Это настоящая кожа?", explanation: "Проверка материала", category: "Покупки", level: "Средний" },
  { english: "Where can I find cosmetics?", russian: "Где найти косметику?", explanation: "Отдел косметики", category: "Покупки", level: "Начальный" },
  { english: "Do you have this in stock?", russian: "Это есть в наличии?", explanation: "Наличие товара", category: "Покупки", level: "Средний" },

  // ЗДОРОВЬЕ
  { english: "I need to see a doctor.", russian: "Мне нужно к врачу.", explanation: "Вызов врача", category: "Здоровье", level: "Начальный" },
  { english: "Where's the nearest pharmacy?", russian: "Где ближайшая аптека?", explanation: "Поиск аптеки", category: "Здоровье", level: "Начальный" },
  { english: "I have a headache.", russian: "У меня болит голова.", explanation: "Симптомы", category: "Здоровье", level: "Начальный" },
  { english: "I feel dizzy.", russian: "У меня кружится голова.", explanation: "Плохое самочувствие", category: "Здоровье", level: "Средний" },
  { english: "I have a fever.", russian: "У меня температура.", explanation: "Жар", category: "Здоровье", level: "Начальный" },
  { english: "I need antibiotics.", russian: "Мне нужны антибиотики.", explanation: "По рецепту", category: "Здоровье", level: "Средний" },
  { english: "I'm allergic to penicillin.", russian: "У меня аллергия на пенициллин.", explanation: "Предупреждение", category: "Здоровье", level: "Продвинутый" },
  { english: "I have asthma.", russian: "У меня астма.", explanation: "Хроническое заболевание", category: "Здоровье", level: "Средний" },
  { english: "I need painkillers.", russian: "Мне нужны обезболивающие.", explanation: "От боли", category: "Здоровье", level: "Средний" },
  { english: "I think I broke my arm.", russian: "Кажется, я сломал руку.", explanation: "Травма", category: "Здоровье", level: "Средний" },
  { english: "Call an ambulance!", russian: "Вызовите скорую!", explanation: "Экстренный вызов", category: "Здоровье", level: "Начальный" },
  { english: "I have diabetes.", russian: "У меня диабет.", explanation: "Важная информация", category: "Здоровье", level: "Средний" },
  { english: "I need insulin.", russian: "Мне нужен инсулин.", explanation: "Лекарство", category: "Здоровье", level: "Продвинутый" },
  { english: "I can't sleep.", russian: "Я не могу спать.", explanation: "Бессонница", category: "Здоровье", level: "Начальный" },
  { english: "Do I need a prescription?", russian: "Нужен рецепт?", explanation: "Уточнение", category: "Здоровье", level: "Средний" },
  { english: "I have heart problems.", russian: "У меня проблемы с сердцем.", explanation: "Сердечное заболевание", category: "Здоровье", level: "Средний" },
  { english: "I'm pregnant.", russian: "Я беременна.", explanation: "Важная информация", category: "Здоровье", level: "Средний" },
  { english: "I need a dentist.", russian: "Мне нужен стоматолог.", explanation: "Зубная боль", category: "Здоровье", level: "Начальный" },
  { english: "I have a sore throat.", russian: "У меня болит горло.", explanation: "Простуда", category: "Здоровье", level: "Начальный" },
  { english: "Is it serious?", russian: "Это серьезно?", explanation: "Оценка состояния", category: "Здоровье", level: "Средний" },

  // ГОСТИНИЦА
  { english: "I have a reservation.", russian: "У меня забронировано.", explanation: "На ресепшн", category: "Гостиница", level: "Начальный" },
  { english: "Check-in, please.", russian: "Заселение, пожалуйста.", explanation: "Прибытие в отель", category: "Гостиница", level: "Начальный" },
  { english: "What time is check-out?", russian: "Во сколько выезд?", explanation: "Время выезда", category: "Гостиница", level: "Начальный" },
  { english: "Can I have a late check-out?", russian: "Можно поздний выезд?", explanation: "Дополнительное время", category: "Гостиница", level: "Средний" },
  { english: "Is breakfast included?", russian: "Завтрак включен?", explanation: "Уточнение", category: "Гостиница", level: "Начальный" },
  { english: "The air conditioner doesn't work.", russian: "Кондиционер не работает.", explanation: "Проблема в номере", category: "Гостиница", level: "Средний" },
  { english: "There's no hot water.", russian: "Нет горячей воды.", explanation: "Проблема в номере", category: "Гостиница", level: "Средний" },
  { english: "Could I have extra towels?", russian: "Можно дополнительные полотенца?", explanation: "В номер", category: "Гостиница", level: "Средний" },
  { english: "Is there WiFi in the room?", russian: "В номере есть WiFi?", explanation: "Интернет", category: "Гостиница", level: "Начальный" },
  { english: "What's the WiFi password?", russian: "Какой пароль от WiFi?", explanation: "Доступ в интернет", category: "Гостиница", level: "Начальный" },
  { english: "Can you store my luggage?", russian: "Можете оставить мой багаж?", explanation: "Камера хранения", category: "Гостиница", level: "Средний" },
  { english: "I need a wake-up call at 7 AM.", russian: "Мне нужен звонок-будильник в 7 утра.", explanation: "Будильник", category: "Гостиница", level: "Средний" },
  { english: "Can I change rooms?", russian: "Можно поменять номер?", explanation: "Смена номера", category: "Гостиница", level: "Средний" },
  { english: "Is there a gym?", russian: "У вас есть тренажерный зал?", explanation: "Услуги отеля", category: "Гостиница", level: "Средний" },
  { english: "Do you have a swimming pool?", russian: "У вас есть бассейн?", explanation: "Удобства", category: "Гостиница", level: "Начальный" },

  // ОРИЕНТАЦИЯ В ГОРОДЕ
  { english: "How do I get to the museum?", russian: "Как мне добраться до музея?", explanation: "Маршрут", category: "Город", level: "Начальный" },
  { english: "Is it far from here?", russian: "Это далеко отсюда?", explanation: "Расстояние", category: "Город", level: "Начальный" },
  { english: "Can I walk there?", russian: "Туда можно дойти пешком?", explanation: "Пешая доступность", category: "Город", level: "Средний" },
  { english: "Which bus goes to the beach?", russian: "Какой автобус идет на пляж?", explanation: "Общественный транспорт", category: "Город", level: "Средний" },
  { english: "Where's the city center?", russian: "Где центр города?", explanation: "Ориентация", category: "Город", level: "Начальный" },
  { english: "I'm lost.", russian: "Я заблудился.", explanation: "Потерялся", category: "Город", level: "Начальный" },
  { english: "Can you show me on the map?", russian: "Можете показать на карте?", explanation: "Просьба показать", category: "Город", level: "Средний" },
  { english: "What's the address?", russian: "Какой адрес?", explanation: "Уточнение", category: "Город", level: "Начальный" },
  { english: "Turn left at the traffic lights.", russian: "Поверните налево на светофоре.", explanation: "Маршрут", category: "Город", level: "Средний" },
  { english: "Is this the way to the station?", russian: "Это дорога к вокзалу?", explanation: "Проверка маршрута", category: "Город", level: "Средний" },
  { english: "Go straight ahead.", russian: "Идите прямо.", explanation: "Направление", category: "Город", level: "Начальный" },
  { english: "It's around the corner.", russian: "Это за углом.", explanation: "Близко", category: "Город", level: "Начальный" },
  { english: "I'm looking for this street.", russian: "Я ищу эту улицу.", explanation: "Поиск", category: "Город", level: "Средний" },
  { english: "What's the best route?", russian: "Какой лучший маршрут?", explanation: "Оптимальный путь", category: "Город", level: "Средний" },
  { english: "Is it safe to walk at night?", russian: "Здесь безопасно гулять ночью?", explanation: "Безопасность", category: "Город", level: "Средний" },

  // ЭКСТРЕННЫЕ СЛУЧАИ
  { english: "Help!", russian: "Помогите!", explanation: "Крик о помощи", category: "Экстренное", level: "Начальный" },
  { english: "Call the police!", russian: "Вызовите полицию!", explanation: "Экстренный вызов", category: "Экстренное", level: "Начальный" },
  { english: "There's a fire!", russian: "Пожар!", explanation: "Пожарная тревога", category: "Экстренное", level: "Начальный" },
  { english: "I've been robbed.", russian: "Меня ограбили.", explanation: "Кража", category: "Экстренное", level: "Средний" },
  { english: "I lost my passport.", russian: "Я потерял паспорт.", explanation: "Потеря документа", category: "Экстренное", level: "Средний" },
  { english: "My wallet was stolen.", russian: "У меня украли кошелек.", explanation: "Кража", category: "Экстренное", level: "Средний" },
  { english: "I need to contact the embassy.", russian: "Мне нужно связаться с посольством.", explanation: "ЧП за границей", category: "Экстренное", level: "Средний" },
  { english: "There's been an accident.", russian: "Произошла авария.", explanation: "Сообщение о ДТП", category: "Экстренное", level: "Средний" },
  { english: "I'm being followed.", russian: "За мной следят.", explanation: "Опасная ситуация", category: "Экстренное", level: "Продвинутый" },
  { english: "I need a lawyer.", russian: "Мне нужен адвокат.", explanation: "Юридическая помощь", category: "Экстренное", level: "Средний" },
  { english: "I've been assaulted.", russian: "На меня напали.", explanation: "Физическое насилие", category: "Экстренное", level: "Продвинутый" },
  { english: "Where is the police station?", russian: "Где полицейский участок?", explanation: "Поиск полиции", category: "Экстренное", level: "Начальный" },
  { english: "I want to report a crime.", russian: "Я хочу заявить о преступлении.", explanation: "В полиции", category: "Экстренное", level: "Продвинутый" },
  { english: "My child is missing.", russian: "Мой ребенок пропал.", explanation: "Пропал человек", category: "Экстренное", level: "Средний" },
  { english: "I need a translator.", russian: "Мне нужен переводчик.", explanation: "Языковой барьер", category: "Экстренное", level: "Средний" },

  // РАБОТА И БИЗНЕС
  { english: "I have a job interview.", russian: "У меня собеседование.", explanation: "Поиск работы", category: "Работа", level: "Средний" },
  { english: "What's the salary?", russian: "Какая зарплата?", explanation: "Обсуждение оплаты", category: "Работа", level: "Средний" },
  { english: "When can I start?", russian: "Когда я могу приступить?", explanation: "Готовность работать", category: "Работа", level: "Средний" },
  { english: "I need a work visa.", russian: "Мне нужна рабочая виза.", explanation: "Документы", category: "Работа", level: "Продвинутый" },
  { english: "I'm here for a conference.", russian: "Я здесь на конференции.", explanation: "Командировка", category: "Работа", level: "Средний" },
  { english: "Let's schedule a meeting.", russian: "Давайте назначим встречу.", explanation: "Деловая встреча", category: "Работа", level: "Средний" },
  { english: "I'll send you an email.", russian: "Я пришлю вам письмо.", explanation: "Деловая переписка", category: "Работа", level: "Средний" },
  { english: "Can you send me the contract?", russian: "Можете прислать мне контракт?", explanation: "Документы", category: "Работа", level: "Средний" },
  { english: "I need a day off.", russian: "Мне нужен выходной.", explanation: "Отгул", category: "Работа", level: "Средний" },
  { english: "I'm sick today.", russian: "Я заболел сегодня.", explanation: "Больничный", category: "Работа", level: "Начальный" },
  { english: "What are the working hours?", russian: "Какой график работы?", explanation: "Режим работы", category: "Работа", level: "Средний" },
  { english: "Is overtime paid?", russian: "Сверхурочные оплачиваются?", explanation: "Оплата труда", category: "Работа", level: "Продвинутый" },
  { english: "I'd like to resign.", russian: "Я хотел бы уволиться.", explanation: "Увольнение", category: "Работа", level: "Продвинутый" },
  { english: "Can you write a reference?", russian: "Можете написать рекомендацию?", explanation: "Рекомендательное письмо", category: "Работа", level: "Продвинутый" },
  { english: "I have experience in this field.", russian: "У меня есть опыт в этой сфере.", explanation: "Опыт работы", category: "Работа", level: "Средний" },

  // ОБЩЕНИЕ И ЗНАКОМСТВА
  { english: "Hi, my name is...", russian: "Привет, меня зовут...", explanation: "Знакомство", category: "Общение", level: "Начальный" },
  { english: "Nice to meet you.", russian: "Приятно познакомиться.", explanation: "Вежливость", category: "Общение", level: "Начальный" },
  { english: "Where are you from?", russian: "Откуда вы?", explanation: "Вопрос о происхождении", category: "Общение", level: "Начальный" },
  { english: "I'm from Russia.", russian: "Я из России.", explanation: "Ответ", category: "Общение", level: "Начальный" },
  { english: "Do you speak English?", russian: "Вы говорите по-английски?", explanation: "Язык общения", category: "Общение", level: "Начальный" },
  { english: "I don't understand.", russian: "Я не понимаю.", explanation: "Нет понимания", category: "Общение", level: "Начальный" },
  { english: "Could you speak slower?", russian: "Не могли бы вы говорить медленнее?", explanation: "Просьба", category: "Общение", level: "Средний" },
  { english: "Can you repeat that?", russian: "Можете повторить?", explanation: "Уточнение", category: "Общение", level: "Начальный" },
  { english: "What do you do?", russian: "Чем вы занимаетесь?", explanation: "Профессия", category: "Общение", level: "Средний" },
  { english: "Do you live here?", russian: "Вы здесь живете?", explanation: "Место жительства", category: "Общение", level: "Средний" },
  { english: "I'm just visiting.", russian: "Я просто в гостях.", explanation: "Турист", category: "Общение", level: "Средний" },
  { english: "What are your hobbies?", russian: "Какие у вас хобби?", explanation: "Интересы", category: "Общение", level: "Средний" },
  { english: "Can I have your number?", russian: "Можно ваш номер?", explanation: "Обмен контактами", category: "Общение", level: "Средний" },
  { english: "Let's keep in touch.", russian: "Давайте оставаться на связи.", explanation: "Поддержание контакта", category: "Общение", level: "Средний" },
  { english: "It was great talking to you.", russian: "Было приятно пообщаться.", explanation: "Завершение разговора", category: "Общение", level: "Средний" }
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
  
  const summary = getWeatherSummary(w);
  const message = `🌤️ *Погода в ${w.city} на текущий момент:*\n\n` +
    `🌡️ *Температура:* ${w.temp}°C (ощущается как ${w.feels_like}°C)\n` +
    `📝 *На улице:* ${w.description}\n` +
    `💨 *Ветер:* ${w.wind_speed} м/с, ${w.wind_dir}\n` +
    `📊 *Давление:* ${w.pressure} мм рт.ст.\n` +
    `💧 *Влажность:* ${w.humidity}%\n\n` +
    `ℹ️ *Кратко:* ${summary}`;

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const f = await getDetailedTodayWeather(res.city);
  if (!f.success) return ctx.reply('❌ Ошибка: ' + f.error);
  await ctx.reply(`📅 *Прогноз в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const res = await getUserCity(ctx.from.id);
  if (!res.found || res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
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
  await ctx.reply(`🕹️ *Тетрис 3D*\n\nТвое игровое имя: *${name}*\n\nЖми на кнопку, чтобы играть!`, {
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
