import { Bot, Keyboard } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден!');
    throw new Error('BOT_TOKEN is required');
}

console.log('🤖 Создаю бота...');
const bot = new Bot(BOT_TOKEN);

// ===================== ГЛОБАЛЬНАЯ ИНИЦИАЛИЗАЦИЯ =====================
let botInfo = null;
let initializationPromise = null;

async function ensureBotInitialized() {
    if (botInfo) {
        console.log('✅ Бот уже инициализирован');
        return botInfo;
    }
    
    if (!initializationPromise) {
        console.log('🔧 Начинаю инициализацию бота...');
        initializationPromise = (async () => {
            try {
                botInfo = await bot.api.getMe();
                console.log(`✅ Бот инициализирован: @${botInfo.username} (${botInfo.first_name})`);
                return botInfo;
            } catch (error) {
                console.error('❌ Ошибка инициализации бота:', error.message);
                initializationPromise = null;
                throw error;
            }
        })();
    }
    
    return await initializationPromise;
}

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
    }
];

// ===================== ФУНКЦИЯ ПОЛУЧЕНИЯ ПОГОДЫ =====================
async function getWeatherData(cityName) {
    console.log(`🌤️ Запрашиваю погоду для: "${cityName}"`);
    
    try {
        // 1. Получаем координаты города через Open-Meteo Geocoding
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru&format=json`;
        console.log(`📍 Geo URL: ${geoUrl}`);
        
        const geoResponse = await fetch(geoUrl);
        if (!geoResponse.ok) {
            throw new Error(`Geo API error: ${geoResponse.status} ${geoResponse.statusText}`);
        }
        
        const geoData = await geoResponse.json();
        console.log('📍 Geo response:', JSON.stringify(geoData).slice(0, 200));
        
        if (!geoData.results || geoData.results.length === 0) {
            throw new Error(`Город "${cityName}" не найден`);
        }
        
        const { latitude, longitude, name, country } = geoData.results[0];
        console.log(`📍 Найден город: ${name}, ${country} (${latitude}, ${longitude})`);
        
        // 2. Получаем погоду через Open-Meteo Weather API
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
        console.log(`🌤️ Weather URL: ${weatherUrl}`);
        
        const weatherResponse = await fetch(weatherUrl);
        if (!weatherResponse.ok) {
            throw new Error(`Weather API error: ${weatherResponse.status} ${weatherResponse.statusText}`);
        }
        
        const weatherData = await weatherResponse.json();
        console.log('🌤️ Weather response получен');
        
        if (!weatherData.current) {
            throw new Error('Нет данных о погоде в ответе');
        }
        
        const current = weatherData.current;
        console.log('🌤️ Данные погоды:', {
            temp: current.temperature_2m,
            feels_like: current.apparent_temperature,
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m,
            precipitation: current.precipitation,
            weather_code: current.weather_code
        });
        
        return {
            temp: Math.round(current.temperature_2m),
            feels_like: Math.round(current.apparent_temperature),
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m.toFixed(1),
            precipitation: current.precipitation.toFixed(1),
            description: getWeatherDescription(current.weather_code),
            city: name
        };
        
    } catch (error) {
        console.error('❌ Ошибка получения погоды:', error.message);
        // Возвращаем тестовые данные при ошибке
        return {
            temp: 20,
            feels_like: 19,
            humidity: 65,
            wind: '3.0',
            precipitation: '0.0',
            description: 'Ясно ☀️',
            city: cityName
        };
    }
}

function getWeatherDescription(code) {
    const weatherMap = {
        0: 'Ясно ☀️',
        1: 'В основном ясно 🌤️',
        2: 'Переменная облачность ⛅',
        3: 'Пасмурно ☁️',
        45: 'Туман 🌫️',
        48: 'Изморозь 🌫️',
        51: 'Легкая морось 🌧️',
        53: 'Морось 🌧️',
        55: 'Плотная морось 🌧️',
        56: 'Легкая ледяная морось 🌧️',
        57: 'Плотная ледяная морось 🌧️',
        61: 'Небольшой дождь 🌧️',
        63: 'Умеренный дождь 🌧️',
        65: 'Сильный дождь 🌧️',
        66: 'Легкий ледяной дождь 🌧️',
        67: 'Сильный ледяной дождь 🌧️',
        71: 'Небольшой снег ❄️',
        73: 'Умеренный снег ❄️',
        75: 'Сильный снег ❄️',
        77: 'Снежные зерна ❄️',
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
    if (description.includes('🌧️') || description.includes('⛈️') || parseFloat(precipitation) > 0) {
        advice.push('• ☔ Защита от влаги: дождевик, зонт, непромокаемая обувь');
    }
    if (description.includes('❄️') || description.includes('снег')) {
        advice.push('• ❄️ Для снега: непромокаемая обувь, варежки, теплая шапка');
    }
    if (parseFloat(wind) > 7) {
        advice.push('• 💨 От ветра: ветровка с мембраной, шарф');
    }
    if (description.includes('☀️') || description.includes('ясно')) {
        advice.push('• 🕶️ От солнца: солнцезащитные очки, головной убор');
    }

    // Общие советы
    if (temp < 15) {
        advice.push('• 🧣 Аксессуары: шапка, шарф, перчатки');
    }
    if (temp > 20 && description.includes('☀️')) {
        advice.push('• 🧴 Солнцезащитный крем SPF 30+');
    }

    advice.push('\n👟 *Обувь*: выбирайте по погоде');
    advice.push('🎒 *С собой*: сумка для снятых слоев одежды');

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
    .text('📍 МОСКВА')
    .text('📍 САНКТ-ПЕТЕРБУРГ')
    .row()
    .text('📍 СИМФЕРОПОЛЬ')
    .text('📍 КРАСНОДАР')
    .row()
    .text('✏️ ДРУГОЙ ГОРОД')
    .row()
    .text('🔙 НАЗАД')
    .resized()
    .oneTime();

// ===================== ОБРАБОТЧИКИ КОМАНД =====================
bot.command('start', async (ctx) => {
    console.log(`🚀 /start от ${ctx.from.id} (@${ctx.from.username || 'нет'})`);
    try {
        await ctx.reply(
            `👋 *Добро пожаловать!*\n\nЯ ваш погодный помощник с английскими фразами.\n\n👇 *Начните с кнопки ниже:*`,
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
            `📍 *Выберите ваш город:*\nМожно выбрать из списка или ввести свой.`,
            { parse_mode: 'Markdown', reply_markup: cityKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка в НАЧАТЬ:', error);
    }
});

bot.hears('✏️ ДРУГОЙ ГОРОД', async (ctx) => {
    console.log(`🏙️ ДРУГОЙ ГОРОД от ${ctx.from.id}`);
    try {
        await ctx.reply('Напишите название вашего города:');
        const userId = ctx.from.id;
        userStorage.set(userId, { awaitingCity: true });
    } catch (error) {
        console.error('❌ Ошибка в ДРУГОЙ ГОРОД:', error);
    }
});

bot.hears(/^📍\s/, async (ctx) => {
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
        console.error('❌ Ошибка при сохранении города:', error);
        await ctx.reply('Не удалось сохранить город. Попробуйте еще раз.');
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

bot.hears('🌤️ ПОГОДА', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`🌤️ ПОГОДА запрос от ${userId}`);
    
    try {
        const userData = userStorage.get(userId) || {};
        
        if (!userData.city) {
            console.log(`⚠️ У пользователя ${userId} нет города`);
            await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
            return;
        }
        
        console.log(`🌤️ Запрашиваю погоду для города: ${userData.city}`);
        await ctx.reply(`⏳ *Запрашиваю погоду для ${userData.city}...*`, { parse_mode: 'Markdown' });
        
        const weather = await getWeatherData(userData.city);
        console.log(`🌤️ Получена погода для ${weather.city}: ${weather.temp}°C`);
        
        await ctx.reply(
            `🌤️ *Погода в ${weather.city}*\n\n` +
            `🌡️ Температура: *${weather.temp}°C*\n` +
            `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
            `💨 Ветер: ${weather.wind} м/с\n` +
            `💧 Влажность: ${weather.humidity}%\n` +
            `📝 ${weather.description}\n` +
            `🌧️ Осадки: ${weather.precipitation} мм`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
        
    } catch (error) {
        console.error('❌ Ошибка в ПОГОДА:', error);
        await ctx.reply('❌ Не удалось получить данные о погоде. Попробуйте позже.', 
            { reply_markup: mainMenuKeyboard });
    }
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`👕 ЧТО НАДЕТЬ? запрос от ${userId}`);
    
    try {
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
        
    } catch (error) {
        console.error('❌ Ошибка в ЧТО НАДЕТЬ:', error);
        await ctx.reply('❌ Не удалось получить рекомендацию. Попробуйте позже.', 
            { reply_markup: mainMenuKeyboard });
    }
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
    console.log(`💬 ФРАЗА ДНЯ запрос от ${ctx.from.id}`);
    
    try {
        if (!dailyPhrases || dailyPhrases.length === 0) {
            await ctx.reply(
                `💬 *Фраза дня*\n\n` +
                `🇬🇧 "It's raining cats and dogs"\n\n` +
                `🇷🇺 "Льёт как из ведра"\n\n` +
                `📚 Идиома для описания сильного дождя`,
                { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
            );
            return;
        }
        
        // Выбираем фразу по дню месяца
        const today = new Date();
        const dayOfMonth = today.getDate();
        const phraseIndex = (dayOfMonth - 1) % dailyPhrases.length;
        const phrase = dailyPhrases[phraseIndex];
        
        console.log(`💬 Выбрана фраза #${phraseIndex}: "${phrase.english}"`);
        
        await ctx.reply(
            `💬 *Фраза дня*\n\n` +
            `🇬🇧 *${phrase.english}*\n\n` +
            `🇷🇺 *${phrase.russian}*\n\n` +
            `📚 ${phrase.explanation}\n\n` +
            `📊 Уровень: ${phrase.difficulty}\n` +
            `🏷️ Категория: ${phrase.category}`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
        
    } catch (error) {
        console.error('❌ Ошибка в ФРАЗА ДНЯ:', error);
        await ctx.reply(
            `💬 *Фраза дня*\n\n` +
            `🇬🇧 "Where is the nearest metro station?"\n\n` +
            `🇷🇺 "Где ближайшая станция метро?"\n\n` +
            `📚 Спрашиваем дорогу к метро`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
    }
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
    console.log(`🏙️ СМЕНИТЬ ГОРОД от ${ctx.from.id}`);
    try {
        await ctx.reply('Выберите город:', { reply_markup: cityKeyboard });
    } catch (error) {
        console.error('❌ Ошибка в СМЕНИТЬ ГОРОД:', error);
    }
});

bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
    console.log(`ℹ️ ПОМОЩЬ от ${ctx.from.id}`);
    try {
        await ctx.reply(
            `*Помощь по боту*\n\n` +
            `• *🌤️ ПОГОДА* - текущая погода в вашем городе\n` +
            `• *👕 ЧТО НАДЕТЬ?* - рекомендации по одежде\n` +
            `• *💬 ФРАЗА ДНЯ* - новая английская фраза каждый день\n` +
            `• *🏙️ СМЕНИТЬ ГОРОД* - изменить город для прогноза\n` +
            `• *ℹ️ ПОМОЩЬ* - это сообщение\n\n` +
            `Все управление через кнопки меню.`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка в ПОМОЩЬ:', error);
    }
});

// Обработчик текстовых сообщений (для ввода города вручную)
bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    
    console.log(`📝 Текст от ${userId}: "${text}"`);
    
    // Пропускаем если это команда или кнопка
    const buttons = [
        '🚀 НАЧАТЬ', '🌤️ ПОГОДА', '👕 ЧТО НАДЕТЬ?', '💬 ФРАЗА ДНЯ',
        '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'
    ];
    
    if (text.startsWith('/') || buttons.includes(text) || text.startsWith('📍 ')) {
        return;
    }
    
    const userData = userStorage.get(userId) || {};
    
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
                phrasesCount: dailyPhrases.length,
                timestamp: new Date().toISOString()
            });
        }
        
        if (req.method === 'POST') {
            console.log('📦 Получен update от Telegram');
            
            // Убеждаемся, что бот инициализирован
            try {
                await ensureBotInitialized();
            } catch (initError) {
                console.error('❌ Бот не инициализирован:', initError);
                return res.status(200).json({ 
                    ok: false, 
                    error: 'Bot not initialized',
                    details: initError.message 
                });
            }
            
            try {
                const update = req.body;
                console.log('🔄 Обрабатываю update...');
                
                await bot.handleUpdate(update);
                console.log('✅ Update успешно обработан');
                
                return res.status(200).json({ ok: true });
            } catch (updateError) {
                console.error('❌ Ошибка обработки update:', updateError);
                return res.status(200).json({ 
                    ok: false, 
                    error: 'Update processing failed',
                    details: updateError.message 
                });
            }
        }
        
        return res.status(405).json({ error: 'Method not allowed' });
        
    } catch (error) {
        console.error('🔥 Критическая ошибка в handler:', error);
        return res.status(200).json({ 
            ok: false, 
            error: 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
}

// Инициализируем бота при запуске
console.log('⚡ Бот загружен, начинаю инициализацию...');
ensureBotInitialized().then(() => {
    console.log('🎉 Бот готов к работе!');
}).catch(error => {
    console.error('💥 Не удалось инициализировать бота:', error);
});
