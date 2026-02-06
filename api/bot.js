import { Bot, Keyboard } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');

const bot = new Bot(BOT_TOKEN);
const userStorage = new Map();

// ===================== КОЛЛЕКЦИЯ ФРАЗ =====================
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
    }
];

// ===================== ФУНКЦИЯ ПОЛУЧЕНИЯ ПОГОДЫ =====================
async function getWeatherData(cityName) {
    try {
        // Геокодинг
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        if (!geoData.results?.length) {
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
        
        const { latitude, longitude, name } = geoData.results[0];
        
        // Погода
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();
        
        if (!weatherData.current) {
            return {
                temp: 20,
                feels_like: 19,
                humidity: 65,
                wind: '3.0',
                precipitation: '0 мм',
                description: 'Ясно ☀️',
                city: name
            };
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
        console.error('Ошибка погоды:', error);
        return {
            temp: 20,
            feels_like: 19,
            humidity: 65,
            wind: '3.0',
            precipitation: '0 мм',
            description: 'Облачно ☁️',
            city: cityName
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

function getWardrobeAdvice(weatherData) {
    const { temp, description } = weatherData;
    let advice = [];

    if (temp >= 25) {
        advice.push('• 👕 Базовый слой: майка, футболка');
        advice.push('• 👖 Верх: шорты, легкие брюки');
    } else if (temp >= 18) {
        advice.push('• 👕 Базовый слой: футболка');
        advice.push('• 🧥 Верх: джинсы, легкая куртка');
    } else if (temp >= 10) {
        advice.push('• 👕 Базовый слой: лонгслив');
        advice.push('• 🧥 Верх: свитер, ветровка');
    } else if (temp >= 0) {
        advice.push('• 👕 Базовый слой: термобелье');
        advice.push('• 🧥 Верх: зимняя куртка');
    } else {
        advice.push('• 👕 Базовый слой: плотное термобелье');
        advice.push('• 🧥 Верх: пуховик');
    }

    if (description.includes('☀️')) {
        advice.push('• 🕶️ Солнцезащитные очки');
    }
    if (description.includes('🌧️') || description.includes('❄️')) {
        advice.push('• ☔ Защита от осадков');
    }

    return advice.join('\n');
}

// ===================== КЛАВИАТУРЫ =====================
const startKeyboard = new Keyboard()
    .text('🚀 НАЧАТЬ')
    .resized()
    .oneTime();

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА')
    .row()
    .text('👕 ЧТО НАДЕТЬ?')
    .text('💬 ФРАЗА ДНЯ')
    .row()
    .text('🏙️ СМЕНИТЬ ГОРОД')
    .text('ℹ️ ПОМОЩЬ')
    .resized()
    .oneTime();

const cityKeyboard = new Keyboard()
    .text('📍 СИМФЕРОПОЛЬ')
    .row()
    .text('✏️ ДРУГОЙ ГОРОД')
    .row()
    .text('🔙 НАЗАД')
    .resized()
    .oneTime();

// ===================== ОБРАБОТЧИКИ КОМАНД =====================
bot.command('start', async (ctx) => {
    await ctx.reply(
        `👋 *Добро пожаловать!*\n\nЯ ваш погодный помощник с английскими фразами.\n\n👇 *Начните с кнопки ниже:*`,
        { parse_mode: 'Markdown', reply_markup: startKeyboard }
    );
});

bot.hears('🚀 НАЧАТЬ', async (ctx) => {
    await ctx.reply(
        `📍 *Выберите ваш город:*\nМожно выбрать из списка или ввести свой.`,
        { parse_mode: 'Markdown', reply_markup: cityKeyboard }
    );
});

bot.hears('✏️ ДРУГОЙ ГОРОД', async (ctx) => {
    await ctx.reply('Напишите название вашего города:');
    const userId = ctx.from.id;
    userStorage.set(userId, { awaitingCity: true });
});

bot.hears('🔙 НАЗАД', async (ctx) => {
    await ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard });
});

bot.hears(/^📍\s/, async (ctx) => {
    const userId = ctx.from.id;
    const city = ctx.message.text.replace('📍 ', '').trim();
    userStorage.set(userId, { city });
    await ctx.reply(
        `✅ *Город "${city}" сохранён!*`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const userData = userStorage.get(userId) || {};
    
    // Пропускаем кнопки
    if (['🚀 НАЧАТЬ', '🌤️ ПОГОДА', '👕 ЧТО НАДЕТЬ?', '💬 ФРАЗА ДНЯ',
         '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
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
        await ctx.reply('Выберите город:', { reply_markup: cityKeyboard });
    }
});

bot.hears('🌤️ ПОГОДА', async (ctx) => {
    const userId = ctx.from.id;
    const userData = userStorage.get(userId) || {};
    
    if (!userData.city) {
        await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
        return;
    }
    
    await ctx.reply(`⏳ *Запрашиваю погоду для ${userData.city}...*`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(userData.city);
    
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
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
    const userId = ctx.from.id;
    const userData = userStorage.get(userId) || {};
    
    if (!userData.city) {
        await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
        return;
    }
    
    await ctx.reply(`👗 *Анализирую погоду для ${userData.city}...*`, { parse_mode: 'Markdown' });
    
    const weather = await getWeatherData(userData.city);
    const advice = getWardrobeAdvice(weather);
    
    await ctx.reply(
        `👕 *Что надеть в ${userData.city}?*\n\n${advice}`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
    const phrase = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
    
    await ctx.reply(
        `💬 *Фраза дня*\n\n` +
        `🇬🇧 *${phrase.english}*\n\n` +
        `🇷🇺 *${phrase.russian}*\n\n` +
        `📚 ${phrase.explanation}`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
    await ctx.reply('Выберите город:', { reply_markup: cityKeyboard });
});

bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
    await ctx.reply(
        `*Помощь по боту*\n\n` +
        `• *🌤️ ПОГОДА* - текущая погода\n` +
        `• *👕 ЧТО НАДЕТЬ?* - рекомендации\n` +
        `• *💬 ФРАЗА ДНЯ* - английская фраза\n` +
        `• *🏙️ СМЕНИТЬ ГОРОД* - изменить город\n` +
        `• *ℹ️ ПОМОЩЬ* - это сообщение`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
});

// ===================== ВАЖНО: ИНИЦИАЛИЗАЦИЯ БОТА =====================
let botInitialized = false;

async function initializeBot() {
    if (!botInitialized) {
        try {
            console.log('🔧 Инициализация бота...');
            await bot.init();
            botInitialized = true;
            console.log('✅ Бот инициализирован');
        } catch (error) {
            console.error('❌ Ошибка инициализации:', error);
            throw error;
        }
    }
}

// ===================== ОБРАБОТЧИК ДЛЯ VERCEL =====================
export default async function handler(req, res) {
    try {
        console.log(`📨 ${req.method} запрос`);
        
        if (req.method === 'GET') {
            return res.status(200).json({ 
                message: 'Бот работает',
                status: 'active'
            });
        }
        
        if (req.method === 'POST') {
            // ИНИЦИАЛИЗИРУЕМ БОТА ПЕРЕД ОБРАБОТКОЙ
            await initializeBot();
            
            console.log('📦 Получен update от Telegram');
            
            try {
                await bot.handleUpdate(req.body);
                console.log('✅ Update обработан');
                return res.status(200).json({ ok: true });
            } catch (error) {
                console.error('❌ Ошибка обработки:', error);
                return res.status(200).json({ ok: false, error: error.message });
            }
        }
        
        return res.status(405).json({ error: 'Method not allowed' });
        
    } catch (error) {
        console.error('🔥 Критическая ошибка:', error);
        return res.status(200).json({ 
            ok: false, 
            error: 'Internal error'
        });
    }
}
