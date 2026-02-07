import { Bot, Keyboard } from 'grammy';
import { saveUserCity, getUserCity, saveGameScore } from './db.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден!');
    throw new Error('BOT_TOKEN is required');
}

console.log('🤖 Создаю бота...');
const bot = new Bot(BOT_TOKEN);

// ===================== ИНИЦИАЛИЗАЦИЯ =====================
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

initializeBot();

const userStorage = new Map();

// ===================== ФУНКЦИИ ПОГОДЫ =====================

// Функция для получения подробного описания погоды с учетом осадков
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

// Функция для получения текущей погоды
async function getWeatherData(cityName) {
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
        
        return {
            temp: Math.round(current.temperature_2m),
            feels_like: Math.round(current.apparent_temperature),
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m.toFixed(1),
            precipitation: todayPrecipitation > 0 ? `${todayPrecipitation.toFixed(1)} мм` : 'Без осадков',
            precipitation_value: todayPrecipitation,
            description: getDetailedWeatherDescription(current.weather_code, todayPrecipitation),
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
            description: 'Ясно ☀️',
            city: cityName
        };
    }
}

// Функция для получения ПОДРОБНОГО прогноза на ЗАВТРА (с разбивкой по времени)
async function getDetailedTomorrowWeather(cityName) {
    console.log(`📅 Запрашиваю подробный прогноз на завтра для: "${cityName}"`);
    
    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        if (!geoData.results || geoData.results.length === 0) {
            throw new Error('Город не найден');
        }
        
        const { latitude, longitude, name } = geoData.results[0];
        
        // ЗАПРАШИВАЕМ ПОЧАСОВОЙ ПРОГНОЗ на 48 часов
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=2`;
        
        const forecastResponse = await fetch(forecastUrl);
        const forecastData = await forecastResponse.json();
        
        if (!forecastData.hourly || !forecastData.daily) {
            throw new Error('Нет данных прогноза для завтра');
        }
        
        // Индексы для завтрашнего дня (с 24 по 47 часы)
        const tomorrowHourlyData = {
            times: forecastData.hourly.time.slice(24, 48),
            temperatures: forecastData.hourly.temperature_2m.slice(24, 48),
            precipitations: forecastData.hourly.precipitation.slice(24, 48),
            weatherCodes: forecastData.hourly.weather_code.slice(24, 48)
        };
        
        // Разбиваем на временные интервалы
        const timeIntervals = {
            '🌅 Утро (06:00-12:00)': { start: 6, end: 12 },
            '☀️ День (12:00-18:00)': { start: 12, end: 18 },
            '🌆 Вечер (18:00-00:00)': { start: 18, end: 24 },
            '🌙 Ночь (00:00-06:00)': { start: 0, end: 6 }
        };
        
        const periodForecasts = [];
        
        for (const [periodName, { start, end }] of Object.entries(timeIntervals)) {
            const periodHours = [];
            
            // Собираем данные для каждого часа в периоде
            for (let hour = start; hour < end; hour++) {
                periodHours.push({
                    temp: tomorrowHourlyData.temperatures[hour],
                    precipitation: tomorrowHourlyData.precipitations[hour],
                    weatherCode: tomorrowHourlyData.weatherCodes[hour]
                });
            }
            
            // Вычисляем средние/максимальные значения для периода
            const avgTemp = Math.round(periodHours.reduce((sum, h) => sum + h.temp, 0) / periodHours.length);
            const maxPrecipitation = Math.max(...periodHours.map(h => h.precipitation));
            const dominantWeatherCode = getDominantWeatherCode(periodHours.map(h => h.weatherCode));
            
            periodForecasts.push({
                period: periodName,
                temp: avgTemp,
                precipitation: maxPrecipitation,
                weatherCode: dominantWeatherCode,
                description: getDetailedWeatherDescription(dominantWeatherCode, maxPrecipitation)
            });
        }
        
        // Общие данные на день
        const tomorrowPrecipitation = forecastData.daily.precipitation_sum[1] || 0;
        const tomorrowCode = getDominantWeatherCode(tomorrowHourlyData.weatherCodes);
        
        return {
            city: name,
            temp_max: Math.round(forecastData.daily.temperature_2m_max[1]),
            temp_min: Math.round(forecastData.daily.temperature_2m_min[1]),
            precipitation: tomorrowPrecipitation > 0 ? `${tomorrowPrecipitation.toFixed(1)} мм` : 'Без осадков',
            precipitation_value: tomorrowPrecipitation,
            description: getDetailedWeatherDescription(tomorrowCode, tomorrowPrecipitation),
            periodForecasts: periodForecasts,
            rawCode: tomorrowCode
        };
        
    } catch (error) {
        console.error('❌ Ошибка прогноза:', error.message);
        return null;
    }
}

// Вспомогательная функция для определения доминирующего кода погоды
function getDominantWeatherCode(codes) {
    const frequency = {};
    codes.forEach(code => {
        frequency[code] = (frequency[code] || 0) + 1;
    });
    
    return Object.keys(frequency).reduce((a, b) => frequency[a] > frequency[b] ? a : b);
}

// Упрощенная версия для кнопки "ПОГОДА ЗАВТРА"
async function getTomorrowWeather(cityName) {
    try {
        const forecast = await getDetailedTomorrowWeather(cityName);
        if (!forecast) return null;
        
        return {
            city: forecast.city,
            temp_max: forecast.temp_max,
            temp_min: forecast.temp_min,
            precipitation: forecast.precipitation,
            precipitation_value: forecast.precipitation_value,
            description: forecast.description
        };
    } catch (error) {
        console.error('❌ Ошибка в getTomorrowWeather:', error);
        return null;
    }
}

// Совет для завтрашнего дня
function getTomorrowAdvice(forecast) {
    if (!forecast) return "Не удалось получить совет.";
    
    if (forecast.precipitation_value > 5) {
        return "Сильные осадки! Возьмите зонт и непромокаемую одежду!";
    }
    if (forecast.precipitation_value > 1) {
        return "Возможны осадки, лучше взять зонт.";
    }
    if (forecast.precipitation_value > 0) {
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
    .webApp('🎮 ИГРАТЬ В ТЕТРИС', 'https://pogodasovet1.vercel.app/')
    .row()
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
    try {
        // ОТПРАВЛЯЕМ КЛАВИАТУРУ СРАЗУ в первом сообщении
        await ctx.reply(
            `👋 *Добро пожаловать в бота погоды и английских фраз!*\n\n` +
            `🎮 *Да, здесь есть тетрис!* Но сначала давайте настроим бота.\n\n` +
            `👇 *ШАГ 1: Нажмите кнопку ниже*`,
            { 
                parse_mode: 'Markdown', 
                reply_markup: startKeyboard 
            }
        );
        
        // Второе сообщение с дополнительной информацией
        await ctx.reply(
            `📱 *Что умеет бот:*\n\n` +
            `🌤️ *Погода:*\n` +
            `• Текущая погода в вашем городе\n` +
            `• Прогноз на завтра\n` +
            `• Совет, что надеть\n\n` +
            `🇬🇧 *Английский:*\n` +
            `• Фраза дня\n` +
            `• Случайные полезные фразы\n\n` +
            `🎮 *Игры:*\n` +
            `• Тетрис в мини-приложении\n\n` +
            `👉 *Чтобы продолжить, нажмите "🚀 НАЧАТЬ РАБОТУ"*`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.error('❌ Ошибка в /start:', error);
    }
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', async (ctx) => {
    console.log(`📍 НАЧАТЬ РАБОТУ от ${ctx.from.id}`);
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

// ===================== КНОПКА "ПОКАЗАТЬ КОМАНДЫ" =====================
bot.hears('📋 ПОКАЗАТЬ КОМАНДЫ', async (ctx) => {
    console.log(`📋 ПОКАЗАТЬ КОМАНДЫ от ${ctx.from.id}`);
    
    try {
        // Убираем клавиатуру, чтобы появилось меню команд BotFather
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
            `/help - Помощь и список команд\n\n` +
            `Чтобы вернуть меню кнопок, нажмите /start`,
            { 
                parse_mode: 'Markdown',
                reply_markup: { remove_keyboard: true } // Убираем клавиатуру!
            }
        );
    } catch (error) {
        console.error('❌ Ошибка в ПОКАЗАТЬ КОМАНДЫ:', error);
    }
});

bot.hears(/^📍 /, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '').trim();
  console.log(`📍 Выбран город: "${city}" для ${userId}`);
  
  try {
    await saveUserCity(userId, city);
    userStorage.set(userId, { city, awaitingCity: false });
    
    await ctx.reply(
      `✅ *ШАГ 3: Готово! Город "${city}" сохранён!*\n\n` +
      `🎉 *Теперь доступны все функции бота:*\n\n` +
      `• Узнать погоду сейчас и на завтра 🌤️\n` +
      `• Получить совет по одежде 👕\n` +
      `• Изучать английские фразы 🇬🇧\n` +
      `• Играть в тетрис 🎮\n\n` +
      `👇 *Используйте кнопки ниже:*`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  } catch (error) {
    console.error('❌ Ошибка при выборе города:', error);
    await ctx.reply('Не удалось сохранить город в базу данных. Попробуйте еще раз.');
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
            console.log(`🎮 Счёт тетриса от
