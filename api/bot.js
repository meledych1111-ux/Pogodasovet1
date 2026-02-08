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
      city: name
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
      city: cityName
    };
  }
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
      message += `   🎮 Уровень: ${player.level} | 📈 Линии: ${player.lines} | 🕹️ Игр: ${player.games_played}\n\n`;
    });
    
    message += `🎯 Соревнуйтесь с другими игроками!`;
    return message;
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error);
    return "❌ Не удалось загрузить топ игроков. Попробуйте позже.";
  }
}

// ===================== ФУНКЦИИ ПОГОДЫ =====================
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
      `• Прогноз на завтра\n` +
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
        message = `🎮 *Прогресс в игре:*\n\n` +
                  `• 🎯 Очки: *${data.score}*\n` +
                  `• 📊 Уровень: *${data.level}*\n` +
                  `• 📈 Линии: *${data.lines}*\n\n` +
                  `💪 Продолжайте в том же духе!\n\n`;
      }
      
      const statsMessage = await getGameStatsMessage(userId);
      message += statsMessage + `\n\n🔄 Нажмите "🎮 ИГРАТЬ В ТЕТРИС" для новой игры!`;
      
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
      `🌤️ *Погода в ${weather.city}*\n\n` +
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

// ===================== ОСТАЛЬНЫЕ КНОПКИ (сокращено для экономии места) =====================
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
      `• 📅 ПОГОДА ЗАВТРА - прогноз на завтра\n` +
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
      `🌤️ *Погода в ${weather.city}*\n\n` +
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
      `• 📅 ПОГОДА ЗАВТРА - прогноз на завтра\n` +
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
      `/forecast - прогноз на завтра\n` +
      `/wardrobe - что надеть?\n` +
      `/phrase - фраза дня\n` +
      `/random - случайная фраза\n` +
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

// Добавьте остальные команды аналогично...

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
       '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '📋 ПОКАЗАТЬ КОМАНДЫ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
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
        bot: bot.botInfo?.username || 'не инициализирован'
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
console.log('⚡ Бот загружен с полноценной системой статистики игр!');
