import { Bot, Keyboard, session, SessionFlavor, Context } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден!');
    throw new Error('BOT_TOKEN is required');
}

// Определяем, какие данные будем хранить в сессии
interface SessionData {
  selectedCity?: string;     // Будем хранить здесь выбранный город
  awaitingCity?: boolean;    // Флаг ожидания ввода города (для "✏️ ДРУГОЙ ГОРОД")
}

// Расширяем тип контекста бота, чтобы в нем появилось ctx.session
type MyContext = Context & SessionFlavor<SessionData>;

console.log('🤖 Создаю бота...');
const bot = new Bot<MyContext>(BOT_TOKEN);

// ===================== НАСТРОЙКА СЕССИЙ =====================
// Функция, которая возвращает начальные (пустые) данные сессии для нового пользователя
function initialSessionData(): SessionData {
  return {}; // Пока у нового пользователя города нет
}

// Подключаем сессии к боту
bot.use(session({ initial: initialSessionData }));

// УДАЛИТЕ ВСЁ ОТСЮДА И ДО ФУНКЦИЙ ПОГОДЫ:
// let botInitialized = false;
// async function initializeBot() { ... }
// initializeBot();

// ===================== ФУНКЦИИ ПОГОДЫ =====================

// Вспомогательные функции для определения типа осадков
function getPrecipitationType(weatherCode, precipitationAmount) {
    // Если осадков нет или очень мало
    if (!precipitationAmount || precipitationAmount < 0.1) {
        return 'без осадков';
    }
    
    // Определяем тип по погодному коду
    const rainCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
    const snowCodes = [71, 73, 75, 77, 85, 86];
    const drizzleCodes = [51, 53, 55]; // Морось
    
    if (snowCodes.includes(weatherCode)) {
        return 'снег';
    } else if (rainCodes.includes(weatherCode)) {
        return 'дождь';
    } else if (drizzleCodes.includes(weatherCode)) {
        return 'морось';
    } else {
        return 'осадки';
    }
}

function getPrecipitationEmoji(type) {
    const emojiMap = {
        'снег': '❄️',
        'дождь': '🌧️',
        'морось': '🌦️',
        'осадки': '🌧️',
        'без осадков': ''
    };
    return emojiMap[type] || '';
}

// Функция для получения текущей погоды (СЕЙЧАС)
async function getWeatherData(cityName) {
    console.log(`🌤️ Запрашиваю погоду для: "${cityName}"`);
    
    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        console.log(`📍 Geo URL: ${geoUrl}`);
        
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        console.log('📍 Geo ответ:', JSON.stringify(geoData).slice(0, 200));
        
        if (!geoData.results || geoData.results.length === 0) {
            console.error('📍 Город не найден');
            throw new Error('Город не найден');
        }
        
        const { latitude, longitude, name } = geoData.results[0];
        console.log(`📍 Координаты: ${latitude}, ${longitude} (${name})`);
        
        // ИСПРАВЛЕНИЕ: Запрашиваем и текущую погоду, и daily прогноз
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m&daily=precipitation_sum,weather_code&wind_speed_unit=ms&timezone=auto&forecast_days=2`;
        console.log(`🌤️ Weather URL: ${weatherUrl}`);
        
        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();
        
        console.log('🌤️ Weather ответ (current):', JSON.stringify(weatherData.current).slice(0, 200));
        console.log('🌤️ Weather ответ (daily):', JSON.stringify(weatherData.daily).slice(0, 200));
        
        if (!weatherData.current || !weatherData.daily) {
            console.error('🌤️ Нет данных о погоде');
            throw new Error('Нет данных о погоде');
        }
        
        const current = weatherData.current;
        // Берем данные осадков из daily[0] (сегодня), а не из current
        const todayPrecipitation = weatherData.daily.precipitation_sum[0] || 0;
        const todayWeatherCode = weatherData.daily.weather_code[0];
        
        // Определяем тип осадков
        const precipitationType = getPrecipitationType(todayWeatherCode, todayPrecipitation);
        const precipitationEmoji = getPrecipitationEmoji(precipitationType);
        
        // Форматируем текст осадков
        let precipitationText;
        if (precipitationType === 'без осадков') {
            precipitationText = 'Без осадков';
        } else {
            precipitationText = `${precipitationEmoji} ${todayPrecipitation.toFixed(1)} мм`;
        }
        
        return {
            temp: Math.round(current.temperature_2m),
            feels_like: Math.round(current.apparent_temperature),
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m.toFixed(1),
            precipitation: precipitationText,
            precipitation_value: todayPrecipitation,
            precipitation_type: precipitationType,
            description: getWeatherDescription(todayWeatherCode),
            city: name
        };
        
    } catch (error) {
        console.error('❌ Ошибка получения погоды:', error.message);
        return {
            temp: 20,
            feels_like: 19,
            humidity: 65,
            wind: '3.0',
            precipitation: 'Без осадков',
            precipitation_value: 0,
            precipitation_type: 'без осадков',
            description: 'Ясно ☀️',
            city: cityName
        };
    }
}

// Функция для получения прогноза на ЗАВТРА
async function getTomorrowWeather(cityName) {
    console.log(`📅 Запрашиваю прогноз на завтра для: "${cityName}"`);
    
    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        if (!geoData.results || geoData.results.length === 0) {
            throw new Error('Город не найден');
        }
        
        const { latitude, longitude, name } = geoData.results[0];
        
        // Запрашиваем прогноз на 3 дня
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=3`;
        console.log(`📅 Forecast URL: ${forecastUrl}`);
        
        const forecastResponse = await fetch(forecastUrl);
        const forecastData = await forecastResponse.json();
        
        console.log('📅 Forecast ответ:', JSON.stringify(forecastData.daily).slice(0, 300));
        
        if (!forecastData.daily || 
            forecastData.daily.time.length < 2 ||
            forecastData.daily.precipitation_sum[1] === undefined) {
            console.error('📅 Нет данных прогноза для завтрашнего дня');
            throw new Error('Нет данных прогноза для завтра');
        }
        
        const tomorrowPrecipitation = forecastData.daily.precipitation_sum[1];
        const tomorrowCode = forecastData.daily.weather_code[1];
        
        console.log('📅 Данные на завтра:', {
            precipitation: tomorrowPrecipitation,
            code: tomorrowCode
        });
        
        // Определяем тип осадков
        const precipitationType = getPrecipitationType(tomorrowCode, tomorrowPrecipitation);
        const precipitationEmoji = getPrecipitationEmoji(precipitationType);
        
        // Форматируем текст осадков
        let precipitationText;
        if (precipitationType === 'без осадков') {
            precipitationText = 'Без осадков';
        } else {
            precipitationText = `${precipitationEmoji} ${tomorrowPrecipitation.toFixed(1)} мм`;
        }
        
        return {
            city: name,
            temp_max: Math.round(forecastData.daily.temperature_2m_max[1]),
            temp_min: Math.round(forecastData.daily.temperature_2m_min[1]),
            precipitation: precipitationText,
            precipitation_value: tomorrowPrecipitation,
            precipitation_type: precipitationType,
            description: getWeatherDescription(tomorrowCode),
            rawCode: tomorrowCode
        };
        
    } catch (error) {
        console.error('❌ Ошибка прогноза:', error.message);
        console.error('❌ Stack:', error.stack);
        return {
            city: cityName,
            temp_max: 24,
            temp_min: 18,
            precipitation: 'Без осадков',
            precipitation_value: 0,
            precipitation_type: 'без осадков',
            description: 'Переменная облачность ⛅',
            isFallback: true
        };
    }
}

function getWeatherDescription(code) {
    console.log('📝 Получен код для описания:', code, typeof code);
    
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
    
    return weatherMap[code] || `Код погоды: ${code}`;
}

// ===================== РАСШИРЕННЫЕ СОВЕТЫ ПО ОДЕЖДЕ =====================
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

// ===================== ФРАЗЫ (сокращенный набор) =====================
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
    .text('🚀 НАЧАТЬ')
    .resized();

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС')
    .text('📅 ПОГОДА ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?')
    .text('💬 ФРАЗА ДНЯ').row()
    .text('🎲 СЛУЧАЙНАЯ ФРАЗА')  
    .text('🏙️ СМЕНИТЬ ГОРОД').row()  // ← ДОБАВЬТЕ .row() здесь
    .text('ℹ️ ПОМОЩЬ')
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

// ===================== ОБРАБОТЧИКИ =====================
bot.command('start', async (ctx) => {
    console.log(`🚀 /start от ${ctx.from.id}`);
    try {
        await ctx.reply(
            `👋 Привет! Я бот погоды с английскими фразами.\n\n👇 *Нажмите НАЧАТЬ:*`,
            { parse_mode: 'Markdown', reply_markup: startKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка в /start:', error);
    }
});

bot.hears('🚀 НАЧАТЬ', async (ctx) => {
    console.log(`📍 НАЧАТЬ от ${ctx.from.id}`);
    try {
        await ctx.reply(
            `📍 *Выберите ваш город:*`,
            { parse_mode: 'Markdown', reply_markup: cityKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка в НАЧАТЬ:', error);
    }
});

bot.hears(/^📍 /, async (ctx) => {
    const city = ctx.message.text.replace('📍 ', '').trim();
    console.log(`📍 Выбран город: "${city}" для ${ctx.from.id}`);
    
    try {
        // Сохраняем город в сессию вместо userStorage
        ctx.session.selectedCity = city;
        
        await ctx.reply(
            `✅ *Город "${city}" сохранён!*\nТеперь вы можете узнать погоду или получить совет.`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка при выборе города:', error);
        await ctx.reply('Не удалось сохранить город. Попробуйте еще раз.');
    }
});

bot.hears('🎲 СЛУЧАЙНАЯ ФРАЗА', async (ctx) => {
    console.log(`🎲 СЛУЧАЙНАЯ ФРАЗА от ${ctx.from.id}`);
    
    try {
        if (!dailyPhrases || dailyPhrases.length === 0) {
            await ctx.reply('Фразы не загружены.', { reply_markup: mainMenuKeyboard });
            return;
        }
        
        const randomIndex = Math.floor(Math.random() * dailyPhrases.length);
        const phrase = dailyPhrases[randomIndex];
        console.log(`🎲 Случайная фраза #${randomIndex}: "${phrase.english}"`);
        
        await ctx.reply(
            `🎲 *Случайная английская фраза*\n\n` +
            `🇬🇧 *${phrase.english}*\n\n` +
            `🇷🇺 *${phrase.russian}*\n\n` +
            `📚 ${phrase.explanation}\n\n` +
            `📂 Категория: ${phrase.category} (${phrase.level})`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
        
    } catch (error) {
        console.error('❌ Ошибка в СЛУЧАЙНАЯ ФРАЗА:', error);
        await ctx.reply('❌ Не удалось получить случайную фразу.', { reply_markup: mainMenuKeyboard });
    }
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
    console.log(`🌤️ ПОГОДА от ${ctx.from.id}`);
    
    try {
        // Получаем город из сессии вместо userStorage
        const city = ctx.session.selectedCity;
        
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
        await ctx.reply('❌ Не удалось получить данные о погоде.', { reply_markup: mainMenuKeyboard });
    }
});

bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
    console.log(`📅 ПОГОДА ЗАВТРА от ${ctx.from.id}`);
    
    try {
        // Получаем город из сессии вместо userStorage
        const city = ctx.session.selectedCity;
        
        if (!city) {
            await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
            return;
        }
        
        await ctx.reply(`📅 Получаю прогноз на завтра для ${city}...`, { parse_mode: 'Markdown' });
        
        const forecast = await getTomorrowWeather(city);
        console.log('📅 Получен прогноз:', forecast);
        
        if (!forecast) {
            await ctx.reply('Не удалось получить прогноз. Попробуйте позже.', { reply_markup: mainMenuKeyboard });
            return;
        }
        
        const message = `📅 *Прогноз на завтра в ${forecast.city}*\n\n` +
                       `🔺 Максимум: *${forecast.temp_max}°C*\n` +
                       `🔻 Минимум: *${forecast.temp_min}°C*\n` +
                       `📝 ${forecast.description}\n` +
                       `🌧️ Осадки: ${forecast.precipitation}\n\n` +
                       `💡 *Совет:* ${getTomorrowAdvice(forecast)}`;
        
        await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
        
    } catch (error) {
        console.error('❌ Ошибка в ПОГОДА ЗАВТРА:', error);
        await ctx.reply('❌ Не удалось получить прогноз.', { reply_markup: mainMenuKeyboard });
    }
});

function getTomorrowAdvice(forecast) {
    // Используем precipitation_type и precipitation_value
    if (forecast.precipitation_type !== 'без осадков' && forecast.precipitation_value > 5) {
        return "Сильные осадки! Возьмите зонт и непромокаемую одежду!";
    }
    if (forecast.precipitation_type !== 'без осадков' && forecast.precipitation_value > 1) {
        return "Возможны осадки, лучше взять зонт.";
    }
    if (forecast.precipitation_type !== 'без осадков') {
        return "Ожидаются осадки, оденьтесь соответствующе.";
    }
    if (forecast.temp_max - forecast.temp_min > 10) {
        return "Большой перепад температур, одевайтесь слоями!";
    }
    if (forecast.temp_max > 25) {
        return "Жарко! Отличный день для отдыха на природе.";
    }
    if (forecast.temp_min < 0) {
        return "Холодно! Тепло оденьтесь.";
    }
    
    return "Хорошего дня!";
}

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
    console.log(`👕 ЧТО НАДЕТЬ? от ${ctx.from.id}`);
    
    try {
        // Получаем город из сессии вместо userStorage
        const city = ctx.session.selectedCity;
        
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

bot.command('random', async (ctx) => {
    console.log(`🎲 /random от ${ctx.from.id}`);
    
    try {
        if (!dailyPhrases || dailyPhrases.length === 0) {
            await ctx.reply('Фразы не загружены.', { reply_markup: mainMenuKeyboard });
            return;
        }
        
        const randomIndex = Math.floor(Math.random() * dailyPhrases.length);
        const phrase = dailyPhrases[randomIndex];
        console.log(`🎲 Случайная фраза #${randomIndex}: "${phrase.english}"`);
        
        await ctx.reply(
            `🎲 *Случайная английская фраза*\n\n` +
            `🇬🇧 *${phrase.english}*\n\n` +
            `🇷🇺 *${phrase.russian}*\n\n` +
            `📚 ${phrase.explanation}\n\n` +
            `🔄 Используйте /random для новой случайной фразы!`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
        
    } catch (error) {
        console.error('❌ Ошибка в /random:', error);
        await ctx.reply('❌ Не удалось получить случайную фразу.', { reply_markup: mainMenuKeyboard });
    }
});

bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
    console.log(`ℹ️ ПОМОЩЬ от ${ctx.from.id}`);
    
    try {
        await ctx.reply(
            `*Помощь по боту*\n\n` +
            `• *🌤️ ПОГОДА СЕЙЧАС* - текущая погода\n` +
            `• *📅 ПОГОДА ЗАВТРА* - прогноз на завтра\n` +
            `• *👕 ЧТО НАДЕТЬ?* - рекомендации по одежде\n` +
            `• *💬 ФРАЗА ДНЯ* - английская фраза\n` +
            `• *🎲 СЛУЧАЙНАЯ ФРАЗА* - случайная английская фраза\n` +
            `• *🏙️ СМЕНИТЬ ГОРОД* - изменить город\n` +
            `• *ℹ️ ПОМОЩЬ* - это сообщение\n\n` +
            `*Команды:*\n` +
            `/start - начать работу\n` +
            `/random - случайная фраза`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка в ПОМОЩЬ:', error);
    }
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
    console.log(`🏙️ СМЕНИТЬ ГОРОД от ${ctx.from.id}`);
    try {
        await ctx.reply('Выберите новый город:', { reply_markup: cityKeyboard });
    } catch (error) {
        console.error('❌ Ошибка в СМЕНИТЬ ГОРОД:', error);
    }
});

bot.hears('✏️ ДРУГОЙ ГОРОД', async (ctx) => {
    console.log(`✏️ ДРУГОЙ ГОРОД от ${ctx.from.id}`);
    try {
        await ctx.reply('Напишите название вашего города:');
        // Устанавливаем флаг в сессии, что ожидаем ввод города
        ctx.session.awaitingCity = true;
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

bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    
    console.log(`📝 Текст от ${ctx.from.id}: "${text}"`);
    
    // Игнорируем команды и кнопки
    if (text.startsWith('/') || 
        ['🚀 НАЧАТЬ', '🌤️ ПОГОДА СЕЙЧАС', '📅 ПОГОДА ЗАВТРА', '👕 ЧТО НАДЕТЬ?', 
         '💬 ФРАЗА ДНЯ', '🎲 СЛУЧАЙНАЯ ФРАЗА', '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
        text.startsWith('📍 ')) {
        return;
    }
    
    // Обработка ввода города
    if (ctx.session.awaitingCity) {
        try {
            const city = text.trim();
            console.log(`🏙️ Сохраняю город "${city}" для ${ctx.from.id}`);
            
            // Сохраняем город в сессию и сбрасываем флаг
            ctx.session.selectedCity = city;
            ctx.session.awaitingCity = false;
            
            await ctx.reply(
                `✅ *Город "${city}" сохранён!*`,
                { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
            );
        } catch (error) {
            console.error('❌ Ошибка при сохранении города:', error);
            await ctx.reply('Не удалось сохранить город. Попробуйте еще раз.');
        }
    } else if (!ctx.session.selectedCity) {
        // Если города нет в сессии
        await ctx.reply('Пожалуйста, сначала выберите город:', { reply_markup: cityKeyboard });
    }
});

// ===================== ОБРАБОТЧИК ДЛЯ VERCEL =====================
export default async function handler(req, res) {
    console.log(`🌐 ${req.method} запрос к /api/bot`);
    
    try {
        if (req.method === 'GET') {
            return res.status(200).json({ 
                message: 'Weather & English Phrases Bot is running',
                status: 'active',
                timestamp: new Date().toISOString()
            });
        }
        
        if (req.method === 'POST') {
            // ⚠️ УДАЛИТЬ эту строку! Не вызывайте initializeBot() здесь!
            // await initializeBot(); // ← ЭТУ СТРОКУ НУЖНО УДАЛИТЬ
            
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

console.log('⚡ Бот загружен с исправлениями!');
