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
    
    // 🌟 ТОЛЬКО ДОБАВИЛИ precipitation, rain, snowfall
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation,rain,snowfall&daily=precipitation_sum&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    if (!weatherData.current) {
      throw new Error('Нет данных о погоде');
    }
    
    const current = weatherData.current;
    const todayPrecipitation = weatherData.daily?.precipitation_sum[0] || 0;
    
    // 🔥 ОПРЕДЕЛЯЕМ ТИП ОСАДКОВ
    let precipitationType = 'Без осадков';
    if (current.snowfall > 0) {
      precipitationType = 'Снег ❄️';
      if (current.snowfall < 1) precipitationType = 'Небольшой снег ❄️';
      if (current.snowfall > 3) precipitationType = 'Сильный снег ❄️❄️';
    } else if (current.rain > 0) {
      precipitationType = 'Дождь 🌧️';
      if (current.rain < 1) precipitationType = 'Небольшой дождь 🌦️';
      if (current.rain > 3) precipitationType = 'Сильный дождь 🌧️🌧️';
    }
    
    // ДОБАВЛЯЕМ ТИП ОСАДКОВ В ОПИСАНИЕ
    let description = getWeatherDescription(current.weather_code);
    if (current.precipitation > 0) {
      if (current.snowfall > 0) {
        description = `${description} (снег ${current.snowfall} мм/час)`;
      } else if (current.rain > 0) {
        description = `${description} (дождь ${current.rain} мм/час)`;
      }
    }
    
    const weatherResult = {
      success: true,
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m.toFixed(1),
      
      // 🔥 НОВЫЕ ПОЛЯ
      precipitation_now: current.precipitation || 0,  // осадки сейчас
      rain_now: current.rain || 0,                    // дождь сейчас
      snow_now: current.snowfall || 0,                 // снег сейчас
      precipitation_type: precipitationType,           // тип осадков
      
      precipitation: todayPrecipitation > 0 ? `${todayPrecipitation.toFixed(1)} мм` : 'Без осадков',
      precipitation_value: todayPrecipitation,
      description: description,
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

// Оставляем функцию описания погоды без изменений
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
// ============= ПОЛНЫЙ РАЗГОВОРНИК: 200+ ФРАЗ НА ВСЕ СЛУЧАИ ЖИЗНИ =============
const dailyPhrases = [
  // -------------------- ТРАНСПОРТ (20 фраз) --------------------
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

  // -------------------- ЕДА И РЕСТОРАНЫ (25 фраз) --------------------
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

  // -------------------- ПОКУПКИ (20 фраз) --------------------
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

  // -------------------- ЗДОРОВЬЕ (20 фраз) --------------------
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

  // -------------------- ГОСТИНИЦА (15 фраз) --------------------
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

  // -------------------- ОРИЕНТАЦИЯ В ГОРОДЕ (15 фраз) --------------------
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

  // -------------------- ЭКСТРЕННЫЕ СЛУЧАИ (15 фраз) --------------------
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

  // -------------------- РАБОТА И БИЗНЕС (15 фраз) --------------------
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

  // -------------------- ОБЩЕНИЕ И ЗНАКОМСТВА (15 фраз) --------------------
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
  },

  // -------------------- ДЕНЬГИ И БАНКИ (10 фраз) --------------------
  {
    english: "Where can I exchange currency?",
    russian: "Где можно обменять валюту?",
    explanation: "Обменник",
    category: "Деньги",
    level: "Начальный"
  },
  {
    english: "What's the exchange rate?",
    russian: "Какой курс обмена?",
    explanation: "Курс валют",
    category: "Деньги",
    level: "Средний"
  },
  {
    english: "I need to withdraw money.",
    russian: "Мне нужно снять деньги.",
    explanation: "Банкомат",
    category: "Деньги",
    level: "Средний"
  },
  {
    english: "My card doesn't work.",
    russian: "Моя карта не работает.",
    explanation: "Проблема с картой",
    category: "Деньги",
    level: "Средний"
  },
  {
    english: "I lost my credit card.",
    russian: "Я потерял кредитную карту.",
    explanation: "Блокировка",
    category: "Деньги",
    level: "Средний"
  },
  {
    english: "I need to send money.",
    russian: "Мне нужно отправить деньги.",
    explanation: "Перевод",
    category: "Деньги",
    level: "Средний"
  },
  {
    english: "What's the commission?",
    russian: "Какая комиссия?",
    explanation: "Плата за услугу",
    category: "Деньги",
    level: "Средний"
  },
  {
    english: "Is there an ATM nearby?",
    russian: "Здесь рядом есть банкомат?",
    explanation: "Поиск банкомата",
    category: "Деньги",
    level: "Начальный"
  },
  {
    english: "I'd like to open an account.",
    russian: "Я хотел бы открыть счет.",
    explanation: "В банке",
    category: "Деньги",
    level: "Продвинутый"
  },
  {
    english: "Can I use my foreign card?",
    russian: "Можно использовать иностранную карту?",
    explanation: "Принимают ли",
    category: "Деньги",
    level: "Средний"
  },

  // -------------------- ТЕХНИКА И ИНТЕРНЕТ (10 фраз) --------------------
  {
    english: "My phone is dead.",
    russian: "Мой телефон разрядился.",
    explanation: "Нет заряда",
    category: "Техника",
    level: "Начальный"
  },
  {
    english: "Do you have a charger?",
    russian: "У вас есть зарядка?",
    explanation: "Зарядное устройство",
    category: "Техника",
    level: "Начальный"
  },
  {
    english: "Is there free WiFi?",
    russian: "Здесь есть бесплатный WiFi?",
    explanation: "Бесплатный интернет",
    category: "Техника",
    level: "Начальный"
  },
  {
    english: "My laptop won't turn on.",
    russian: "Мой ноутбук не включается.",
    explanation: "Проблема",
    category: "Техника",
    level: "Средний"
  },
  {
    english: "I need to print something.",
    russian: "Мне нужно что-то распечатать.",
    explanation: "Печать",
    category: "Техника",
    level: "Средний"
  },
  {
    english: "Where can I buy a SIM card?",
    russian: "Где купить сим-карту?",
    explanation: "Мобильная связь",
    category: "Техника",
    level: "Начальный"
  },
  {
    english: "I need a data plan.",
    russian: "Мне нужен тариф с интернетом.",
    explanation: "Мобильный интернет",
    category: "Техника",
    level: "Средний"
  },
  {
    english: "The screen is broken.",
    russian: "Экран разбит.",
    explanation: "Ремонт",
    category: "Техника",
    level: "Средний"
  },
  {
    english: "Can you fix it?",
    russian: "Вы можете это починить?",
    explanation: "Ремонт техники",
    category: "Техника",
    level: "Средний"
  },
  {
    english: "How long will it take?",
    russian: "Сколько времени это займет?",
    explanation: "Сроки",
    category: "Техника",
    level: "Средний"
  },

  // -------------------- РОМАНТИЧЕСКИЕ ОТНОШЕНИЯ (10 фраз) --------------------
  {
    english: "You're very beautiful.",
    russian: "Вы очень красивая.",
    explanation: "Комплимент",
    category: "Романтика",
    level: "Средний"
  },
  {
    english: "Can I buy you a drink?",
    russian: "Могу я купить вам напиток?",
    explanation: "В баре",
    category: "Романтика",
    level: "Средний"
  },
  {
    english: "Would you like to have dinner with me?",
    russian: "Не хотите поужинать со мной?",
    explanation: "Приглашение",
    category: "Романтика",
    level: "Средний"
  },
  {
    english: "You have a great sense of humor.",
    russian: "У вас отличное чувство юмора.",
    explanation: "Комплимент",
    category: "Романтика",
    level: "Средний"
  },
  {
    english: "I miss you.",
    russian: "Я скучаю по тебе.",
    explanation: "Чувства",
    category: "Романтика",
    level: "Начальный"
  },
  {
    english: "I love you.",
    russian: "Я люблю тебя.",
    explanation: "Признание",
    category: "Романтика",
    level: "Начальный"
  },
  {
    english: "Are you single?",
    russian: "Вы свободны?",
    explanation: "Статус отношений",
    category: "Романтика",
    level: "Средний"
  },
  {
    english: "I had a wonderful time.",
    russian: "Я прекрасно провел время.",
    explanation: "После свидания",
    category: "Романтика",
    level: "Средний"
  },
  {
    english: "When can I see you again?",
    russian: "Когда я увижу тебя снова?",
    explanation: "Следующая встреча",
    category: "Романтика",
    level: "Средний"
  },
  {
    english: "I'm not ready for a relationship.",
    russian: "Я не готов к отношениям.",
    explanation: "Отказ",
    category: "Романтика",
    level: "Продвинутый"
  },

  // -------------------- УСЛУГИ И СЕРВИС (10 фраз) --------------------
  {
    english: "I need a haircut.",
    russian: "Мне нужно подстричься.",
    explanation: "Парикмахерская",
    category: "Услуги",
    level: "Начальный"
  },
  {
    english: "Just a trim, please.",
    russian: "Просто подравняйте, пожалуйста.",
    explanation: "Стрижка",
    category: "Услуги",
    level: "Средний"
  },
  {
    english: "I need my shoes repaired.",
    russian: "Мне нужно отремонтировать обувь.",
    explanation: "Ремонт обуви",
    category: "Услуги",
    level: "Средний"
  },
  {
    english: "Where can I do laundry?",
    russian: "Где можно постирать?",
    explanation: "Прачечная",
    category: "Услуги",
    level: "Средний"
  },
  {
    english: "I need dry cleaning.",
    russian: "Мне нужна химчистка.",
    explanation: "Чистка одежды",
    category: "Услуги",
    level: "Средний"
  },
  {
    english: "When will it be ready?",
    russian: "Когда будет готово?",
    explanation: "Сроки",
    category: "Услуги",
    level: "Начальный"
  },
  {
    english: "Can you deliver it to my hotel?",
    russian: "Можете доставить в отель?",
    explanation: "Доставка",
    category: "Услуги",
    level: "Средний"
  },
  {
    english: "I need a locksmith.",
    russian: "Мне нужен слесарь.",
    explanation: "Замочные работы",
    category: "Услуги",
    level: "Продвинутый"
  },
  {
    english: "The key is broken.",
    russian: "Ключ сломался.",
    explanation: "Проблема",
    category: "Услуги",
    level: "Средний"
  },
  {
    english: "How much does the service cost?",
    russian: "Сколько стоит услуга?",
    explanation: "Цена",
    category: "Услуги",
    level: "Начальный"
  },

  // -------------------- СПОРТ И АКТИВНЫЙ ОТДЫХ (10 фраз) --------------------
  {
    english: "Where can I rent a bike?",
    russian: "Где можно взять напрокат велосипед?",
    explanation: "Прокат",
    category: "Спорт",
    level: "Средний"
  },
  {
    english: "Is there a hiking trail?",
    russian: "Здесь есть пешеходная тропа?",
    explanation: "Поход",
    category: "Спорт",
    level: "Средний"
  },
  {
    english: "I want to go skiing.",
    russian: "Я хочу покататься на лыжах.",
    explanation: "Зимний спорт",
    category: "Спорт",
    level: "Средний"
  },
  {
    english: "Do I need equipment?",
    russian: "Мне нужно снаряжение?",
    explanation: "Экипировка",
    category: "Спорт",
    level: "Средний"
  },
  {
    english: "Is there a gym nearby?",
    russian: "Здесь рядом есть спортзал?",
    explanation: "Тренировки",
    category: "Спорт",
    level: "Начальный"
  },
  {
    english: "I'd like to play tennis.",
    russian: "Я хотел бы поиграть в теннис.",
    explanation: "Аренда корта",
    category: "Спорт",
    level: "Средний"
  },
  {
    english: "Can I join your game?",
    russian: "Можно присоединиться к вашей игре?",
    explanation: "Командный спорт",
    category: "Спорт",
    level: "Средний"
  },
  {
    english: "What time does the pool open?",
    russian: "Во сколько открывается бассейн?",
    explanation: "Бассейн",
    category: "Спорт",
    level: "Начальный"
  },
  {
    english: "I need a personal trainer.",
    russian: "Мне нужен личный тренер.",
    explanation: "Фитнес",
    category: "Спорт",
    level: "Продвинутый"
  },
  {
    english: "Is there a surfing school?",
    russian: "Здесь есть школа серфинга?",
    explanation: "Водные виды",
    category: "Спорт",
    level: "Продвинутый"
  },

  // -------------------- ОБРАЗОВАНИЕ (10 фраз) --------------------
  {
    english: "I want to learn English.",
    russian: "Я хочу выучить английский.",
    explanation: "Изучение языка",
    category: "Образование",
    level: "Начальный"
  },
  {
    english: "Are there any language courses?",
    russian: "Здесь есть курсы языка?",
    explanation: "Поиск курсов",
    category: "Образование",
    level: "Средний"
  },
  {
    english: "How much are the classes?",
    russian: "Сколько стоят занятия?",
    explanation: "Цена обучения",
    category: "Образование",
    level: "Средний"
  },
  {
    english: "I need a private tutor.",
    russian: "Мне нужен частный репетитор.",
    explanation: "Индивидуальные занятия",
    category: "Образование",
    level: "Средний"
  },
  {
    english: "Is the certificate accredited?",
    russian: "Сертификат аккредитован?",
    explanation: "Официальный документ",
    category: "Образование",
    level: "Продвинутый"
  },
  {
    english: "I'm studying for an exam.",
    russian: "Я готовлюсь к экзамену.",
    explanation: "Подготовка",
    category: "Образование",
    level: "Средний"
  },
  {
    english: "Can I borrow this book?",
    russian: "Можно взять эту книгу?",
    explanation: "Библиотека",
    category: "Образование",
    level: "Начальный"
  },
  {
    english: "Where is the library?",
    russian: "Где библиотека?",
    explanation: "Поиск",
    category: "Образование",
    level: "Начальный"
  },
  {
    english: "I need a student visa.",
    russian: "Мне нужна студенческая виза.",
    explanation: "Документы",
    category: "Образование",
    level: "Продвинутый"
  },
  {
    english: "What's the deadline?",
    russian: "Какой крайний срок?",
    explanation: "Дедлайн",
    category: "Образование",
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
      // Добавляем предупреждение если город не указан
if (city === 'Не указан') {
  message += `⚠️ *Ваш город не указан!*\n`;
  message += `➡️ Статистика не попадет в топ без города!\n`;
  message += `➡️ Укажите город: /city [название]\n\n`;
}
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
async function getTopPlayersMessage(limit = 10, ctx = null) {
  try {
    console.log(`🏆 Получение топа ${limit} игроков...`);
    
    const client = await pool.connect();
    
    try {
// 🔴 ТОЛЬКО РЕАЛЬНЫЕ ПОЛЬЗОВАТЕЛИ - БЕЗ ТЕСТОВЫХ!
      const topQuery = `
        SELECT DISTINCT ON (gs.user_id)
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
        HAVING MAX(gs.score) >= 1000
        ORDER BY gs.user_id, MAX(gs.score) DESC
        LIMIT $1
      `;
      
      const result = await client.query(topQuery, [limit]);
      console.log(`🏆 Найдено игроков в топе: ${result.rows.length}`);
      
      // ✅ СОРТИРУЕМ ПО ОЧКАМ (ОТ БОЛЬШЕГО К МЕНЬШЕМУ)
      const sortedRows = result.rows.sort((a, b) => b.best_score - a.best_score);
      
      if (sortedRows.length === 0) {
        return `🏆 *Топ игроков*\n\n` +
               `🎮 *Пока никто не завершил игру с хорошим результатом!*\n\n` +
               `📝 *Как попасть в топ:*\n` +
               `1. 🎮 Играйте в тетрис\n` +
               `2. 🎯 Наберите минимум *1000 очков*\n` +
               `3. ✅ Завершите игру\n` +
               `4. 📍 Укажите город: /city [город]\n\n` +
               `🎯 *Текущие рекорды появятся здесь!*`;
      }
      
      let message = `🏆 *Топ ${Math.min(sortedRows.length, limit)} игроков в тетрисе*\n\n`;
      
      sortedRows.forEach((player, index) => {
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
      
      if (ctx && ctx.from) {
        const currentUserId = ctx.from.id.toString();
        
        const userBestQuery = `
          SELECT MAX(score) as best_score, COUNT(*) as games_played
          FROM game_scores 
          WHERE user_id = $1 
            AND game_type = 'tetris'
            AND score > 0
        `;
        
        const userResult = await client.query(userBestQuery, [currentUserId]);
        const userBestScore = userResult.rows[0]?.best_score || 0;
        const userGamesPlayed = userResult.rows[0]?.games_played || 0;
        
        const isInTop = sortedRows.some(p => p.user_id === currentUserId);
        
        if (isInTop) {
          const userIndex = sortedRows.findIndex(p => p.user_id === currentUserId);
          message += `👤 *Ваше место:* ${userIndex + 1}\n`;
          message += `🎯 *Ваш лучший счёт:* ${sortedRows[userIndex].best_score}\n\n`;
        } else if (userBestScore > 0) {
          if (userBestScore < 1000) {
            message += `👤 *Вы пока не в топе*\n`;
            message += `🎯 Ваш лучший результат: ${userBestScore} очков\n`;
            message += `🎯 *Нужно минимум 1000 очков* для попадания в топ!\n\n`;
          } else {
            const lastScore = sortedRows[sortedRows.length - 1]?.best_score || 0;
            const needed = Math.max(0, lastScore - userBestScore + 1);
            message += `👤 *Вы пока не в топе*\n`;
            message += `🎯 Ваш лучший результат: ${userBestScore}\n`;
            message += `🎯 *Нужно ещё ${needed} очков* для попадания в топ!\n\n`;
          }
        } else {
          message += `👤 *Вы пока не играли*\n`;
          message += `🎯 Начните игру и наберите минимум 1000 очков!\n\n`;
        }
        
        const cityQuery = 'SELECT city FROM users WHERE user_id = $1';
        const cityResult = await client.query(cityQuery, [currentUserId]);
        const userCity = cityResult.rows[0]?.city || 'Не указан';
        
        if (userCity === 'Не указан') {
          message += `📍 *Ваш город не указан!*\n`;
          message += `Укажите город: /city [город] чтобы отображаться в топе!\n\n`;
        }
      }
      
      message += `📝 *Как попасть в топ:*\n`;
      message += `• 🎮 Играйте в тетрис\n`;
      message += `• 🎯 Наберите *минимум 1000 очков*\n`;
      message += `• ✅ Завершите игру\n`;
      message += `• 📍 Укажите город: /city [город]\n\n`;
      message += `🔄 Топ обновляется после каждой завершенной игры`;
      
      return message;
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Ошибка в getTopPlayersMessage:', error);
    return `❌ Ошибка загрузки топа игроков: ${error.message}`;
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
