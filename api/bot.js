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

// Инициализируем при загрузке
initializeBot();

const userStorage = new Map();

// ===================== ФУНКЦИЯ ПОГОДЫ =====================
async function getWeatherData(cityName) {
    console.log(`🌤️ Запрашиваю погоду для: "${cityName}"`);
    
    try {
        // Для теста возвращаем фиктивные данные
        return {
            city: cityName,
            temp: 22,
            feels_like: 21,
            humidity: 65,
            wind: '3.5',
            precipitation: '0.0',
            description: 'Ясно ☀️'
        };
    } catch (error) {
        console.error('❌ Ошибка получения погоды:', error);
        return {
            city: cityName,
            temp: 20,
            feels_like: 19,
            humidity: 60,
            wind: '3.0',
            precipitation: '0.0',
            description: 'Облачно ☁️'
        };
    }
}

// ===================== ФРАЗЫ ДНЯ =====================
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
        russian: "Растопить лёд/начать общение",
        explanation: "Начать разговор в неловкой ситуации",
        category: "communication",
        difficulty: "intermediate"
    }
];

// ===================== КЛАВИАТУРЫ (БЕЗ .oneTime() !) =====================
// УБИРАЕМ .oneTime() - это основная причина!
const startKeyboard = new Keyboard()
    .text('🚀 НАЧАТЬ')
    .resized(); // УБРАЛИ .oneTime()

const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА')
    .row()
    .text('👕 ЧТО НАДЕТЬ?')
    .text('💬 ФРАЗА ДНЯ')
    .row()
    .text('🏙️ СМЕНИТЬ ГОРОД')
    .text('ℹ️ ПОМОЩЬ')
    .resized(); // УБРАЛИ .oneTime()

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА')
    .row()
    .text('📍 САНКТ-ПЕТЕРБУРГ')
    .row()
    .text('📍 СИМФЕРОПОЛЬ')
    .row()
    .text('📍 СЕВАСТОПОЛЬ')
    .row()
    .text('✏️ ДРУГОЙ ГОРОД')
    .row()
    .text('🔙 НАЗАД')
    .resized(); // УБРАЛИ .oneTime()

// ===================== ОБРАБОТЧИКИ =====================

// 1. Команда /start
bot.command('start', async (ctx) => {
    console.log(`🚀 /start от ${ctx.from.id}`);
    try {
        await ctx.reply(
            `👋 Привет, ${ctx.from.first_name}! Я бот погоды с английскими фразами.\n\n👇 *Нажмите НАЧАТЬ:*`,
            { parse_mode: 'Markdown', reply_markup: startKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка в /start:', error);
    }
});

// 2. Кнопка НАЧАТЬ
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

// 3. Выбор города из списка
bot.hears(/^📍 /, async (ctx) => {
    const userId = ctx.from.id;
    const city = ctx.message.text.replace('📍 ', '').trim();
    console.log(`📍 Выбран город: "${city}" для ${userId}`);
    
    try {
        // Сохраняем город
        userStorage.set(userId, { city });
        
        await ctx.reply(
            `✅ *Город "${city}" сохранён!*\nТеперь вы можете использовать все функции бота.`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка при выборе города:', error);
        await ctx.reply('Не удалось сохранить город. Попробуйте еще раз.');
    }
});

// 4. Кнопка ПОГОДА (ДОЛЖНА РАБОТАТЬ!)
bot.hears('🌤️ ПОГОДА', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`🌤️ ПОГОДА от ${userId}`);
    
    try {
        const userData = userStorage.get(userId) || {};
        
        if (!userData.city) {
            await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
            return;
        }
        
        await ctx.reply(`⏳ Запрашиваю погоду для *${userData.city}*...`, { parse_mode: 'Markdown' });
        
        const weather = await getWeatherData(userData.city);
        console.log('🌤️ Получена погода:', weather);
        
        await ctx.reply(
            `🌤️ *Погода в ${weather.city}*\n\n` +
            `🌡️ Температура: *${weather.temp}°C*\n` +
            `🤔 Ощущается: *${weather.feels_like}°C*\n` +
            `💨 Ветер: ${weather.wind} м/с\n` +
            `💧 Влажность: ${weather.humidity}%\n` +
            `📝 ${weather.description}`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
        
    } catch (error) {
        console.error('❌ Ошибка в ПОГОДА:', error);
        await ctx.reply('Не удалось получить погоду. Попробуйте позже.', { reply_markup: mainMenuKeyboard });
    }
});

// 5. Кнопка ФРАЗА ДНЯ (ДОЛЖНА РАБОТАТЬ!)
bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
    console.log(`💬 ФРАЗА ДНЯ от ${ctx.from.id}`);
    
    try {
        if (!dailyPhrases || dailyPhrases.length === 0) {
            await ctx.reply('Фразы не загружены.', { reply_markup: mainMenuKeyboard });
            return;
        }
        
        // Выбираем случайную фразу
        const phraseIndex = Math.floor(Math.random() * dailyPhrases.length);
        const phrase = dailyPhrases[phraseIndex];
        console.log(`💬 Выбрана фраза: "${phrase.english}"`);
        
        await ctx.reply(
            `💬 *Фраза дня*\n\n` +
            `🇬🇧 *${phrase.english}*\n\n` +
            `🇷🇺 *${phrase.russian}*\n\n` +
            `📚 ${phrase.explanation}\n\n` +
            `🏷️ Категория: ${phrase.category}\n` +
            `📊 Уровень: ${phrase.difficulty}`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
        
    } catch (error) {
        console.error('❌ Ошибка в ФРАЗА ДНЯ:', error);
        await ctx.reply('Не удалось получить фразу дня.', { reply_markup: mainMenuKeyboard });
    }
});

// 6. Кнопка ПОМОЩЬ (ДОЛЖНА РАБОТАТЬ!)
bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
    console.log(`ℹ️ ПОМОЩЬ от ${ctx.from.id}`);
    
    try {
        await ctx.reply(
            `*Помощь по боту*\n\n` +
            `• *🌤️ ПОГОДА* - текущая погода\n` +
            `• *👕 ЧТО НАДЕТЬ?* - рекомендации\n` +
            `• *💬 ФРАЗА ДНЯ* - английская фраза\n` +
            `• *🏙️ СМЕНИТЬ ГОРОД* - изменить город\n` +
            `• *ℹ️ ПОМОЩЬ* - это сообщение\n\n` +
            `*Использование:*\n` +
            `1. Нажмите НАЧАТЬ\n` +
            `2. Выберите город\n` +
            `3. Используйте кнопки меню`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка в ПОМОЩЬ:', error);
    }
});

// 7. Кнопка ЧТО НАДЕТЬ?
bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`👕 ЧТО НАДЕТЬ? от ${userId}`);
    
    try {
        const userData = userStorage.get(userId) || {};
        
        if (!userData.city) {
            await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
            return;
        }
        
        await ctx.reply(`👗 Анализирую погоду для *${userData.city}*...`, { parse_mode: 'Markdown' });
        
        const weather = await getWeatherData(userData.city);
        
        let advice = '';
        if (weather.temp >= 20) {
            advice = '• 👕 Легкая одежда: футболка, шорты\n• 🕶️ Солнцезащитные очки';
        } else if (weather.temp >= 10) {
            advice = '• 🧥 Теплая одежда: свитер, куртка\n• 👖 Джинсы или брюки';
        } else {
            advice = '• 🧣 Зимняя одежда: теплая куртка, шапка\n• 🧤 Перчатки, шарф';
        }
        
        if (weather.description.includes('🌧️')) {
            advice += '\n• ☔ Возьмите зонт или дождевик';
        }
        
        await ctx.reply(
            `👕 *Что надеть в ${weather.city}?*\n\n${advice}`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
        
    } catch (error) {
        console.error('❌ Ошибка в ЧТО НАДЕТЬ:', error);
        await ctx.reply('Не удалось получить рекомендацию.', { reply_markup: mainMenuKeyboard });
    }
});

// 8. Кнопка СМЕНИТЬ ГОРОД
bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
    console.log(`🏙️ СМЕНИТЬ ГОРОД от ${ctx.from.id}`);
    try {
        await ctx.reply('Выберите новый город:', { reply_markup: cityKeyboard });
    } catch (error) {
        console.error('❌ Ошибка в СМЕНИТЬ ГОРОД:', error);
    }
});

// 9. Кнопка ДРУГОЙ ГОРОД
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

// 10. Кнопка НАЗАД
bot.hears('🔙 НАЗАД', async (ctx) => {
    console.log(`🔙 НАЗАД от ${ctx.from.id}`);
    try {
        await ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard });
    } catch (error) {
        console.error('❌ Ошибка в НАЗАД:', error);
    }
});

// 11. Обработчик текстовых сообщений (для ручного ввода города)
bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const userData = userStorage.get(userId) || {};
    
    console.log(`📝 Текст от ${userId}: "${text}"`);
    
    // Пропускаем команды и кнопки
    if (text.startsWith('/') || 
        ['🚀 НАЧАТЬ', '🌤️ ПОГОДА', '👕 ЧТО НАДЕТЬ?', '💬 ФРАЗА ДНЯ',
         '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
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
    } else {
        // Если есть город и это не команда, показываем главное меню
        await ctx.reply('Используйте кнопки меню:', { reply_markup: mainMenuKeyboard });
    }
});

// ===================== ОБРАБОТЧИК ДЛЯ VERCEL =====================
export default async function handler(req, res) {
    console.log(`🌐 ${req.method} запрос к /api/bot`);
    
    try {
        if (req.method === 'GET') {
            return res.status(200).json({ 
                message: 'Bot is running',
                status: 'active',
                timestamp: new Date().toISOString()
            });
        }
        
        if (req.method === 'POST') {
            // Убеждаемся, что бот инициализирован
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
