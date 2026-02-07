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

// ===================== ФУНКЦИИ ПОГОДЫ =====================
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
        
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
        console.log(`🌤️ Weather URL: ${weatherUrl}`);
        
        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();
        
        console.log('🌤️ Weather ответ:', JSON.stringify(weatherData.current).slice(0, 200));
        
        if (!weatherData.current) {
            console.error('🌤️ Нет данных о погоде');
            throw new Error('Нет данных о погоде');
        }
        
        const current = weatherData.current;
        return {
            temp: Math.round(current.temperature_2m),
            feels_like: Math.round(current.apparent_temperature),
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m.toFixed(1),
            precipitation: `${current.precipitation} мм`,
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
            precipitation: '0 мм',
            description: 'Ясно ☀️',
            city: cityName
        };
    }
}

async function getTomorrowWeather(cityName) {
    console.log(`📅 Запрашиваю прогноз на завтра для: "${cityName}"`);
    
    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        console.log('📍 Geo ответ для прогноза:', JSON.stringify(geoData).slice(0, 200));
        
        if (!geoData.results || geoData.results.length === 0) {
            throw new Error('Город не найден');
        }
        
        const { latitude, longitude, name } = geoData.results[0];
        
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=2`;
        console.log(`📅 Forecast URL: ${forecastUrl}`);
        
        const forecastResponse = await fetch(forecastUrl);
        const forecastData = await forecastResponse.json();
        
        console.log('📅 Forecast ответ:', JSON.stringify(forecastData.daily).slice(0, 300));
        
        if (!forecastData.daily || forecastData.daily.time.length < 2) {
            console.error('📅 Нет данных прогноза');
            throw new Error('Нет данных прогноза');
        }
        
        // ПРОВЕРКА: есть ли данные для завтра
        const tomorrowCode = forecastData.daily.weather_code?.[1];
        console.log('📅 Код погоды на завтра:', tomorrowCode);
        
        return {
            city: name,
            temp_max: Math.round(forecastData.daily.temperature_2m_max[1]),
            temp_min: Math.round(forecastData.daily.temperature_2m_min[1]),
            precipitation: forecastData.daily.precipitation_sum?.[1]?.toFixed(1) || '0.0',
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
            precipitation: '0.5',
            description: 'Переменная облачность ⛅',
            isFallback: true
        };
    }
}

function getWeatherDescription(code) {
    console.log('📝 Получен код для описания:', code, typeof code);
    
    // Если код undefined или null, возвращаем стандартное описание
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
    {
        english: "Where is the nearest metro station?",
        russian: "Где ближайшая станция метро?",
        explanation: "Спрашиваем дорогу к метро",
        category: "travel",
        difficulty: "beginner"
    },
    {
        english: "It's raining cats and dogs",
        russian: "Льёт как из ведра",
        explanation: "Идиома для описания сильного дождя",
        category: "weather",
        difficulty: "intermediate"
    },
    {
        english: "Break the ice",
        russian: "Растопить лёд",
        explanation: "Начать разговор в неловкой ситуации",
        category: "communication",
        difficulty: "intermediate"
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
    .text('🏙️ СМЕНИТЬ ГОРОД')
    .text('ℹ️ ПОМОЩЬ')
    .resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА')
    .row()
    .text('📍 САНКТ-ПЕТЕРБУРГ')
    .row()
    .text('📍 СИМФЕРОПОЛЬ')
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
    const userId = ctx.from.id;
    const city = ctx.message.text.replace('📍 ', '').trim();
    console.log(`📍 Выбран город: "${city}" для ${userId}`);
    
    try {
        userStorage.set(userId, { city });
        
        await ctx.reply(
            `✅ *Город "${city}" сохранён!*\nТеперь вы можете узнать погоду или получить совет.`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка при выборе города:', error);
        await ctx.reply('Не удалось сохранить город. Попробуйте еще раз.');
    }
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`🌤️ ПОГОДА от ${userId}`);
    
    try {
        const userData = userStorage.get(userId) || {};
        
        if (!userData.city) {
            await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
            return;
        }
        
        await ctx.reply(`⏳ Запрашиваю погоду для ${userData.city}...`, { parse_mode: 'Markdown' });
        
        const weather = await getWeatherData(userData.city);
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
    const userId = ctx.from.id;
    console.log(`📅 ПОГОДА ЗАВТРА от ${userId}`);
    
    try {
        const userData = userStorage.get(userId) || {};
        
        if (!userData.city) {
            await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
            return;
        }
        
        await ctx.reply(`📅 Получаю прогноз на завтра для ${userData.city}...`, { parse_mode: 'Markdown' });
        
        const forecast = await getTomorrowWeather(userData.city);
        console.log('📅 Получен прогноз:', forecast);
        
        if (!forecast) {
            await ctx.reply('Не удалось получить прогноз. Попробуйте позже.', { reply_markup: mainMenuKeyboard });
            return;
        }
        
        const message = `📅 *Прогноз на завтра в ${forecast.city}*\n\n` +
                       `🔺 Максимум: *${forecast.temp_max}°C*\n` +
                       `🔻 Минимум: *${forecast.temp_min}°C*\n` +
                       `📝 ${forecast.description}\n` +
                       `🌧️ Осадки: *${forecast.precipitation} мм*\n\n` +
                       `💡 *Совет:* ${getTomorrowAdvice(forecast)}`;
        
        await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
        
    } catch (error) {
        console.error('❌ Ошибка в ПОГОДА ЗАВТРА:', error);
        await ctx.reply('❌ Не удалось получить прогноз.', { reply_markup: mainMenuKeyboard });
    }
});

function getTomorrowAdvice(forecast) {
    const precip = parseFloat(forecast.precipitation) || 0;
    if (precip > 5) return "Запланируйте дела в помещении!";
    if (forecast.temp_max - forecast.temp_min > 10) return "Одевайтесь слоями!";
    if (forecast.temp_max > 25) return "Отличный день для пикника!";
    return "Хорошего дня!";
}

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`👕 ЧТО НАДЕТЬ? от ${userId}`);
    
    try {
        const userData = userStorage.get(userId) || {};
        
        if (!userData.city) {
            await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
            return;
        }
        
        await ctx.reply(`👗 Анализирую погоду для ${userData.city}...`, { parse_mode: 'Markdown' });
        
        const weather = await getWeatherData(userData.city);
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
        const userId = ctx.from.id;
        userStorage.set(userId, { awaitingCity: true });
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
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const userData = userStorage.get(userId) || {};
    
    console.log(`📝 Текст от ${userId}: "${text}"`);
    
    if (text.startsWith('/') || 
        ['🚀 НАЧАТЬ', '🌤️ ПОГОДА СЕЙЧАС', '📅 ПОГОДА ЗАВТРА', '👕 ЧТО НАДЕТЬ?', 
         '💬 ФРАЗА ДНЯ', '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
        text.startsWith('📍 ')) {
        return;
    }
    
    if (userData.awaitingCity) {
        try {
            const city = text.trim();
            console.log(`🏙️ Сохраняю город "${city}" для ${userId}`);
            
            userStorage.set(userId, { city, awaitingCity: false });
            
            await ctx.reply(
                `✅ *Город "${city}" сохранён!*`,
                { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
            );
        } catch (error) {
            console.error('❌ Ошибка при сохранении города:', error);
            await ctx.reply('Не удалось сохранить город. Попробуйте еще раз.');
        }
    } else if (!userData.city) {
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

console.log('⚡ Бот загружен с исправлениями!');
