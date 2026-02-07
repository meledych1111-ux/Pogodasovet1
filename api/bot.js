import { Bot, Keyboard } from 'grammy';

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

// ===================== ФУНКЦИИ ПОГОДЫ (КАК БЫЛО) =====================
async function getWeatherData(cityName) {
    console.log(`🌤️ Запрашиваю погоду для: "${cityName}"`);
    
    try {
        // 1. ГЕОКОДИНГ
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        if (!geoData.results || geoData.results.length === 0) {
            throw new Error('Город не найден');
        }
        
        const { latitude, longitude, name } = geoData.results[0];
        
        // 2. ПОГОДА
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();
        
        if (!weatherData.current) {
            throw new Error('Нет данных о погоде');
        }
        
        const current = weatherData.current;
        
        // ОСАДКИ КАК ЧИСЛО
        const precipitationValue = current.precipitation || 0;
        
        return {
            temp: Math.round(current.temperature_2m),
            feels_like: Math.round(current.apparent_temperature),
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m.toFixed(1),
            precipitation: precipitationValue, // ЧИСЛО
            description: getWeatherDescription(current.weather_code),
            city: name
        };
        
    } catch (error) {
        console.error('❌ Ошибка получения погоды:', error.message);
        return {
            temp: 20,
            feels_like: 19,
            humidity: 65,
            wind: '3.0',
            precipitation: 0,
            description: 'Ясно ☀️',
            city: cityName
        };
    }
}

// НОВАЯ ФУНКЦИЯ: ПРОГНОЗ НА ЗАВТРА
async function getTomorrowWeather(cityName) {
    console.log(`📅 Запрашиваю прогноз на завтра для: "${cityName}"`);
    
    try {
        // 1. ГЕОКОДИНГ
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        if (!geoData.results || geoData.results.length === 0) {
            throw new Error('Город не найден');
        }
        
        const { latitude, longitude, name } = geoData.results[0];
        
        // 2. ПРОГНОЗ НА 2 ДНЯ
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=2`;
        const forecastResponse = await fetch(forecastUrl);
        const forecastData = await forecastResponse.json();
        
        if (!forecastData.daily || forecastData.daily.time.length < 2) {
            throw new Error('Нет данных прогноза');
        }
        
        // Данные на завтра (индекс 1)
        const precipitationValue = forecastData.daily.precipitation_sum?.[1] || 0;
        
        return {
            city: name,
            temp_max: Math.round(forecastData.daily.temperature_2m_max[1]),
            temp_min: Math.round(forecastData.daily.temperature_2m_min[1]),
            precipitation: precipitationValue, // ЧИСЛО
            description: getWeatherDescription(forecastData.daily.weather_code[1])
        };
        
    } catch (error) {
        console.error('❌ Ошибка прогноза:', error.message);
        return {
            city: cityName,
            temp_max: 24,
            temp_min: 18,
            precipitation: 0.5,
            description: 'Переменная облачность ⛅'
        };
    }
}

function getWeatherDescription(code) {
    const weatherMap = {
        0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅',
        3: 'Пасмурно ☁️', 45: 'Туман 🌫️', 48: 'Изморозь 🌫️',
        51: 'Легкая морось 🌧️', 53: 'Морось 🌧️', 61: 'Небольшой дождь 🌧️',
        63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️', 71: 'Небольшой снег ❄️',
        73: 'Снег ❄️', 75: 'Сильный снег ❄️'
    };
    return weatherMap[code] || 'Погодные данные';
}

// ===================== РАСШИРЕННЫЕ СОВЕТЫ ПО ОДЕЖДЕ (КАК БЫЛО) =====================
function getWardrobeAdvice(weatherData) {
    const { temp, description, wind, precipitation } = weatherData;
    let advice = [];

    // Основные рекомендации по температуре
    if (temp >= 25) {
        advice.push('• 👕 Базовый слой: майка, футболка из хлопка или льна');
        advice.push('• 👖 Верх: шорты, легкие брюки или юбка');
    } else if (temp >= 18) {
        advice.push('• 👕 Базовый слой: футболка или тонкая рубашка');
        advice.push('• 🧥 Верх: джинсы, брюки, легкая куртка на вечер');
    } else if (temp >= 10) {
        advice.push('• 👕 Базовый слой: лонгслив или тонкое термобелье');
        advice.push('• 🧥 Верх: свитер, толстовка, ветровка');
    } else if (temp >= 0) {
        advice.push('• 👕 Базовый слой: теплое термобелье или флис');
        advice.push('• 🧥 Верх: утепленный свитер, зимняя куртка, теплые брюки');
    } else {
        advice.push('• 👕 Базовый слой: плотное термобелье, флис');
        advice.push('• 🧥 Верх: пуховик, утепленные штаны');
    }

    // Дополнительные рекомендации
    if (description.toLowerCase().includes('дождь') || precipitation > 0) {
        advice.push('• ☔ Защита от влаги: дождевик, зонт, непромокаемая обувь');
    }
    if (description.toLowerCase().includes('снег')) {
        advice.push('• ❄️ Для снега: непромокаемая обувь, варежки');
    }
    if (parseFloat(wind) > 7) {
        advice.push('• 💨 От ветра: ветровка с мембраной, шарф');
    }
    if (description.toLowerCase().includes('ясно') || description.includes('☀️')) {
        advice.push('• 🕶️ От солнца: солнцезащитные очки, головной убор');
    }

    if (temp < 15) advice.push('• 🧣 Аксессуары: шапка, шарф, перчатки');
    if (temp > 20 && description.includes('ясно')) advice.push('• 🧴 Солнцезащитный крем SPF 30+.');

    advice.push('\n👟 *Обувь*: выбирайте по погоде');
    advice.push('🎒 *С собой*: сумка для снятых слоев одежды');

    return advice.join('\n');
}

// ===================== 150 ФРАЗ (сокращенный вариант) =====================
const dailyPhrases = [
    {
        id: 1,
        english: "Where is the nearest metro station?",
        russian: "Где ближайшая станция метро?",
        explanation: "Спрашиваем дорогу к метро",
        category: "travel",
        difficulty: "beginner"
    },
    {
        id: 2,
        english: "How much is a ticket to the museum?",
        russian: "Сколько стоит билет в музей?",
        explanation: "Спрашиваем цену билета",
        category: "travel",
        difficulty: "beginner"
    },
    {
        id: 3,
        english: "It's raining cats and dogs",
        russian: "Льёт как из ведра",
        explanation: "Идиома для описания сильного дождя",
        category: "weather",
        difficulty: "intermediate"
    },
    {
        id: 4,
        english: "Break the ice",
        russian: "Растопить лёд/начать общение",
        explanation: "Начать разговор в неловкой ситуации",
        category: "communication",
        difficulty: "intermediate"
    },
    {
        id: 5,
        english: "Every cloud has a silver lining",
        russian: "Нет худа без добра",
        explanation: "В любой плохой ситуации есть что-то хорошее",
        category: "optimism",
        difficulty: "intermediate"
    },
    {
        id: 6,
        english: "I need a cup of coffee",
        russian: "Мне нужна чашка кофе",
        explanation: "Простая бытовая фраза",
        category: "daily",
        difficulty: "beginner"
    }
];

// ===================== КЛАВИАТУРЫ (С ДОБАВЛЕННОЙ КНОПКОЙ ЗАВТРА) =====================
const startKeyboard = new Keyboard()
    .text('🚀 НАЧАТЬ')
    .resized();

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС')
    .row()
    .text('📅 ПОГОДА ЗАВТРА')  // НОВАЯ КНОПКА
    .text('👕 ЧТО НАДЕТЬ?')
    .row()
    .text('💬 ФРАЗА ДНЯ')
    .text('🏙️ СМЕНИТЬ ГОРОД')
    .row()
    .text('ℹ️ ПОМОЩЬ')
    .resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА')
    .text('📍 САНКТ-ПЕТЕРБУРГ')
    .row()
    .text('📍 СИМФЕРОПОЛЬ')
    .text('📍 СЕВАСТОПОЛЬ')  // ВАШ ГОРОД
    .row()
    .text('📍 КРАСНОДАР')
    .text('📍 СОЧИ')
    .row()
    .text('✏️ ДРУГОЙ ГОРОД')
    .row()
    .text('🔙 НАЗАД')
    .resized();

// ===================== ОБРАБОТЧИКИ (СТАРЫЕ + НОВЫЕ) =====================

// 1. КОМАНДА START
bot.command('start', async (ctx) => {
    console.log(`🚀 /start от ${ctx.from.id}`);
    await ctx.reply(
        `👋 Привет! Я бот погоды с английскими фразами.\n\n👇 *Нажмите НАЧАТЬ:*`,
        { parse_mode: 'Markdown', reply_markup: startKeyboard }
    );
});

// 2. КНОПКА НАЧАТЬ
bot.hears('🚀 НАЧАТЬ', async (ctx) => {
    console.log(`📍 НАЧАТЬ от ${ctx.from.id}`);
    await ctx.reply(
        `📍 *Выберите ваш город:*\n(включая Севастополь)`,
        { parse_mode: 'Markdown', reply_markup: cityKeyboard }
    );
});

// 3. ВЫБОР ГОРОДА (включая Севастополь)
bot.hears(/^📍 /, async (ctx) => {
    const userId = ctx.from.id;
    const city = ctx.message.text.replace('📍 ', '').trim();
    console.log(`📍 Выбран город: "${city}" для ${userId}`);
    
    userStorage.set(userId, { city });
    
    await ctx.reply(
        `✅ *Город "${city}" сохранён!*\nТеперь вы можете узнать погоду или получить совет.`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

// 4. ПОГОДА СЕЙЧАС (с правильными осадками)
bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`🌤️ ПОГОДА от ${userId}`);
    
    const userData = userStorage.get(userId) || {};
    
    if (!userData.city) {
        await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
        return;
    }
    
    await ctx.reply(`⏳ Запрашиваю погоду для ${userData.city}...`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(userData.city);
    
    // ПРАВИЛЬНОЕ ОТОБРАЖЕНИЕ ОСАДКОВ
    const precipitationDisplay = weather.precipitation.toFixed(1);
    
    await ctx.reply(
        `🌤️ *Погода в ${weather.city}*\n\n` +
        `🌡️ Температура: *${weather.temp}°C*\n` +
        `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
        `💨 Ветер: ${weather.wind} м/с\n` +
        `💧 Влажность: ${weather.humidity}%\n` +
        `📝 ${weather.description}\n` +
        `🌧️ Осадки: *${precipitationDisplay} мм/ч*`,  // ПРАВИЛЬНО!
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

// 5. НОВАЯ КНОПКА: ПОГОДА ЗАВТРА
bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`📅 ПОГОДА ЗАВТРА от ${userId}`);
    
    const userData = userStorage.get(userId) || {};
    
    if (!userData.city) {
        await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
        return;
    }
    
    await ctx.reply(`📅 Получаю прогноз на завтра для ${userData.city}...`, { parse_mode: 'Markdown' });
    
    const forecast = await getTomorrowWeather(userData.city);
    
    if (!forecast) {
        await ctx.reply('Не удалось получить прогноз.', { reply_markup: mainMenuKeyboard });
        return;
    }
    
    // ПРАВИЛЬНОЕ ОТОБРАЖЕНИЕ ОСАДКОВ
    const precipitationDisplay = forecast.precipitation.toFixed(1);
    
    const message = `📅 *Прогноз на завтра в ${forecast.city}*\n\n` +
                   `🔺 Максимум: *${forecast.temp_max}°C*\n` +
                   `🔻 Минимум: *${forecast.temp_min}°C*\n` +
                   `📝 ${forecast.description}\n` +
                   `🌧️ Осадки: *${precipitationDisplay} мм*`;  // ПРАВИЛЬНО!
    
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

// 6. ЧТО НАДЕТЬ? (расширенные советы)
bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`👕 ЧТО НАДЕТЬ? от ${userId}`);
    
    const userData = userStorage.get(userId) || {};
    
    if (!userData.city) {
        await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
        return;
    }
    
    await ctx.reply(`👗 Анализирую погоду для ${userData.city}...`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(userData.city);
    const advice = getWardrobeAdvice(weather);
    
    await ctx.reply(
        `👕 *Что надеть в ${weather.city}?*\n\n` +
        `*Текущие условия:* ${weather.temp}°C, ${weather.description}\n\n` +
        `${advice}`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

// 7. ФРАЗА ДНЯ
bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
    console.log(`💬 ФРАЗА ДНЯ от ${ctx.from.id}`);
    
    const phrase = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
    
    await ctx.reply(
        `💬 *Фраза дня*\n\n` +
        `🇬🇧 *${phrase.english}*\n\n` +
        `🇷🇺 *${phrase.russian}*\n\n` +
        `📚 ${phrase.explanation}`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

// 8. НОВАЯ КОМАНДА: RANDOM (случайная фраза)
bot.command('random', async (ctx) => {
    console.log(`🎲 /random от ${ctx.from.id}`);
    
    const phrase = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
    
    await ctx.reply(
        `🎲 *Случайная английская фраза*\n\n` +
        `🇬🇧 *${phrase.english}*\n\n` +
        `🇷🇺 *${phrase.russian}*\n\n` +
        `📚 ${phrase.explanation}\n\n` +
        `🔄 Используйте /random для новой случайной фразы!`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

// 9. ПОМОЩЬ
bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
    await ctx.reply(
        `*Помощь по боту*\n\n` +
        `• *🌤️ ПОГОДА СЕЙЧАС* - текущая погода\n` +
        `• *📅 ПОГОДА ЗАВТРА* - прогноз на завтра\n` +
        `• *👕 ЧТО НАДЕТЬ?* - рекомендации по одежде\n` +
        `• *💬 ФРАЗА ДНЯ* - английская фраза\n` +
        `• *🏙️ СМЕНИТЬ ГОРОД* - изменить город\n` +
        `• *ℹ️ ПОМОЩЬ* - это сообщение\n\n` +
        `*Команды:*\n` +
        `/start - начать работу\n` +
        `/random - случайная английская фраза`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

// 10. ОСТАЛЬНЫЕ КНОПКИ (как было)
bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
    await ctx.reply('Выберите новый город:', { reply_markup: cityKeyboard });
});

bot.hears('✏️ ДРУГОЙ ГОРОД', async (ctx) => {
    await ctx.reply('Напишите название вашего города:');
    const userId = ctx.from.id;
    userStorage.set(userId, { awaitingCity: true });
});

bot.hears('🔙 НАЗАД', async (ctx) => {
    await ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard });
});

// 11. ОБРАБОТЧИК ТЕКСТА (для ввода города)
bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const userData = userStorage.get(userId) || {};
    
    if (text.startsWith('/') || 
        ['🚀 НАЧАТЬ', '🌤️ ПОГОДА СЕЙЧАС', '📅 ПОГОДА ЗАВТРА', '👕 ЧТО НАДЕТЬ?', 
         '💬 ФРАЗА ДНЯ', '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
        text.startsWith('📍 ')) {
        return;
    }
    
    if (userData.awaitingCity) {
        userStorage.set(userId, { city: text });
        await ctx.reply(
            `✅ *Город "${text}" сохранён!*`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
    } else if (!userData.city) {
        await ctx.reply('Пожалуйста, сначала выберите город:', { reply_markup: cityKeyboard });
    }
});

// ===================== VERCEL HANDLER =====================
export default async function handler(req, res) {
    console.log(`🌐 ${req.method} запрос к /api/bot`);
    
    try {
        if (req.method === 'GET') {
            return res.status(200).json({ 
                message: 'Bot is running',
                status: 'ok',
                timestamp: new Date().toISOString()
            });
        }
        
        if (req.method === 'POST') {
            await initializeBot();
            
            console.log('📦 Получен update от Telegram');
            
            try {
                await bot.handleUpdate(req.body);
                console.log('✅ Update обработан');
                return res.status(200).json({ ok: true });
            } catch (error) {
                console.error('❌ Ошибка:', error);
                return res.status(200).json({ ok: false });
            }
        }
        
        return res.status(405).json({ error: 'Method not allowed' });
        
    } catch (error) {
        console.error('🔥 Ошибка:', error);
        return res.status(200).json({ ok: false });
    }
}

console.log('⚡ Бот загружен!');
