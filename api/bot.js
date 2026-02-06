import { Bot, Keyboard, session } from 'grammy';

// ===================== КОНФИГУРАЦИЯ =====================
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ FATAL: BOT_TOKEN не найден в переменных окружения');
}

// Создаем экземпляр бота
const bot = new Bot(BOT_TOKEN);

// ===================== СИСТЕМА СЕССИЙ =====================
// Используем встроенную систему сессий grammy
bot.use(
    session({
        initial: () => ({
            city: null,
            awaitingCityInput: false,
            processedUpdates: new Set()
        }),
    })
);

// ===================== РЕАЛЬНЫЙ API ПОГОДЫ (OPEN-METEO) =====================
async function getWeatherData(cityName) {
    console.log(`[Weather] Запрос для: "${cityName}"`);
    try {
        // 1. ГЕОКОДИНГ: Получаем координаты города
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        const geoRes = await fetch(geoUrl);
        const geoData = await geoRes.json();

        if (!geoData.results || geoData.results.length === 0) {
            throw new Error('Город не найден в базе Open-Meteo');
        }

        const { latitude, longitude, name, country } = geoData.results[0];
        console.log(`[Weather] Найден: ${name}, ${country} (${latitude}, ${longitude})`);

        // 2. ПОГОДА: Получаем прогноз по координатам
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
        const weatherRes = await fetch(weatherUrl);
        const weatherJson = await weatherRes.json();

        if (!weatherJson.current) {
            throw new Error('Нет текущих данных о погоде');
        }

        const c = weatherJson.current;
        return {
            city: name,
            temp: Math.round(c.temperature_2m),
            feels_like: Math.round(c.apparent_temperature),
            humidity: c.relative_humidity_2m,
            wind: c.wind_speed_10m.toFixed(1),
            precipitation: c.precipitation,
            description: getWeatherDescription(c.weather_code),
            rawCode: c.weather_code
        };

    } catch (error) {
        console.error(`[Weather] Ошибка для "${cityName}":`, error.message);
        // Возвращаем понятные тестовые данные в случае сбоя API
        return {
            city: cityName,
            temp: 18,
            feels_like: 17,
            humidity: 65,
            wind: '3.5',
            precipitation: 0,
            description: 'Облачно с прояснениями ☁️',
            rawCode: 3,
            isFallback: true
        };
    }
}

function getWeatherDescription(code) {
    const weatherMap = {
        0: 'Ясно ☀️', 1: 'Преимущественно ясно 🌤️',
        2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
        45: 'Туман 🌫️', 48: 'Изморозь 🌫️',
        51: 'Легкая морось 🌧️', 53: 'Умеренная морось 🌧️',
        55: 'Сильная морось 🌧️', 56: 'Легкая ледяная морось 🌧️',
        57: 'Сильная ледяная морось 🌧️', 61: 'Небольшой дождь 🌧️',
        63: 'Умеренный дождь 🌧️', 65: 'Сильный дождь 🌧️',
        71: 'Небольшой снег ❄️', 73: 'Умеренный снег ❄️',
        75: 'Сильный снег ❄️', 80: 'Небольшой ливень 🌧️',
        81: 'Умеренный ливень 🌧️', 82: 'Сильный ливень 🌧️',
        95: 'Гроза ⛈️'
    };
    return weatherMap[code] || `Код погоды: ${code}`;
}

function getWardrobeAdvice(weather) {
    const advice = [];
    const { temp, description, wind } = weather;

    // По температуре
    if (temp >= 25) {
        advice.push('• 🩳 Очень тепло: футболка, шорты, панама.');
        advice.push('• 👟 Легкая обувь: сандалии или кеды.');
    } else if (temp >= 18) {
        advice.push('• 👕 Тепло: футболка/рубашка, джинсы или брюки.');
        advice.push('• 🧥 Возьмите легкую куртку или ветровку на вечер.');
    } else if (temp >= 10) {
        advice.push('• 🧥 Прохладно: лонгслив, свитер/толстовка, ветровка.');
        advice.push('• 👖 Обязательно штаны. Шапка по желанию.');
    } else if (temp >= 0) {
        advice.push('• 🧣 Холодно: термобелье, теплый свитер, зимняя куртка.');
        advice.push('• 🧤 Не забудьте шапку, шарф и перчатки.');
    } else {
        advice.push('• 🥶 Мороз: плотное термобелье, пуховик, теплые штаны.');
        advice.push('• 🧣 Обязательно: шапка, шарф, варежки, теплая обувь.');
    }

    // По осадкам и явлениям
    if (description.includes('🌧️') || description.includes('⛈️') || weather.precipitation > 2) {
        advice.push('• ☔ **Дождь:** непромокаемая куртка/дождевик, зонт, устойчивая к воде обувь.');
    }
    if (description.includes('❄️') || description.includes('снег')) {
        advice.push('• ❄️ **Снег:** непромокаемая обувь с теплым носком, варежки лучше перчаток.');
    }
    if (parseFloat(wind) > 7) {
        advice.push('• 💨 **Ветер:** ветровка с капюшоном, закрытая одежда.');
    }
    if (description.includes('☀️')) {
        advice.push('• 🕶️ **Солнце:** солнцезащитные очки и крем SPF.');
    }

    advice.push('\n🎒 *Совет:* одевайтесь слоями (принцип "капусты"), чтобы регулировать температуру.');
    return advice.join('\n');
}

// ===================== БАЗА ФРАЗ =====================
const dailyPhrases = [
    {
        english: "Where is the nearest metro station?",
        russian: "Где ближайшая станция метро?",
        explanation: "Спрашиваем дорогу к метро",
        category: "Путешествия",
        level: "Начальный"
    },
    {
        english: "It's raining cats and dogs",
        russian: "Льёт как из ведра (досл. 'Дождь из кошек и собак')",
        explanation: "Очень сильный дождь. Классическая английская идиома.",
        category: "Погода",
        level: "Средний"
    },
    {
        english: "Break the ice",
        russian: "Растопить лёд",
        explanation: "Начать разговор в незнакомой или напряженной обстановке.",
        category: "Общение",
        level: "Средний"
    },
    {
        english: "I'm feeling under the weather",
        russian: "Я неважно себя чувствую (досл. 'Чувствую себя под погодой')",
        explanation: "Быть немного больным или не в настроении.",
        category: "Здоровье",
        level: "Средний"
    },
    {
        english: "Could you please repeat that?",
        russian: "Не могли бы вы повторить?",
        explanation: "Вежливая просьба повторить сказанное.",
        category: "Общение",
        level: "Начальный"
    },
    {
        english: "The ball is in your court",
        russian: "Мяч на твоей стороне площадки",
        explanation: "Теперь твоя очередь действовать или принимать решение.",
        category: "Деловое общение",
        level: "Средний"
    },
    {
        english: "Piece of cake",
        russian: "Проще простого (досл. 'Кусок пирога')",
        explanation: "Очень легкая задача.",
        category: "Повседневное",
        level: "Начальный"
    },
    {
        english: "Once in a blue moon",
        russian: "Очень редко (досл. 'Раз в голубую луну')",
        explanation: "Что-то происходит крайне редко.",
        category: "Время",
        level: "Средний"
    },
    {
        english: "Bite the bullet",
        russian: "Стиснуть зубы",
        explanation: "Принять трудное решение или пережить неприятную ситуацию.",
        category: "Принятие решений",
        level: "Средний"
    },
    {
        english: "Costs an arm and a leg",
        russian: "Стоит целое состояние (досл. 'Стоит руку и ногу')",
        explanation: "Очень дорого.",
        category: "Деньги",
        level: "Средний"
    }
];

// ===================== КЛАВИАТУРЫ =====================
const mainMenu = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('👕 ЧТО НАДЕТЬ?').text('💬 ФРАЗА ДНЯ').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ')
    .resized()
    .oneTime();

const cityMenu = new Keyboard()
    .text('📍 Москва').text('📍 Санкт-Петербург').row()
    .text('📍 Симферополь').text('📍 Сочи').row()
    .text('📍 Екатеринбург').text('📍 Казань').row()
    .text('📍 Новосибирск').text('📍 Краснодар').row()
    .text('✏️ Ввести другой город').row()
    .text('🔙 Назад в меню')
    .resized()
    .oneTime();

const backMenu = new Keyboard()
    .text('🔙 Назад в меню')
    .resized()
    .oneTime();

// ===================== ОБРАБОТКА КОМАНД И СООБЩЕНИЙ =====================
bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.first_name || 'Друг';
    
    console.log(`[Bot] /start от пользователя ${userId} (${userName})`);
    
    // Сбрасываем состояние пользователя
    ctx.session.city = null;
    ctx.session.awaitingCityInput = false;
    
    await ctx.reply(
        `Привет, ${userName}! 👋\n\nЯ помогу узнать погоду и подскажу, что надеть. А заодно выучу с тобой полезную английскую фразу.\n\n*Для начала выбери город:*`,
        { parse_mode: 'Markdown', reply_markup: cityMenu }
    );
});

// Обработка выбора города из списка
bot.hears(/^📍 /, async (ctx) => {
    const city = ctx.message.text.replace('📍 ', '');
    const userId = ctx.from.id;
    
    ctx.session.city = city;
    ctx.session.awaitingCityInput = false;
    
    console.log(`[Bot] Пользователь ${userId} выбрал город: ${city}`);
    
    await ctx.reply(
        `✅ Отлично! Город *${city}* сохранён.\nТеперь ты можешь узнать погоду или получить совет по одежде.`,
        { parse_mode: 'Markdown', reply_markup: mainMenu }
    );
});

// Ручной ввод города
bot.hears('✏️ Ввести другой город', async (ctx) => {
    ctx.session.awaitingCityInput = true;
    
    await ctx.reply(
        '📝 Напиши название своего города:\n_(например: Воронеж, Ростов-на-Дону, London)_',
        { parse_mode: 'Markdown', reply_markup: backMenu }
    );
});

// Обработка кнопки "Назад в меню"
bot.hears('🔙 Назад в меню', async (ctx) => {
    ctx.session.awaitingCityInput = false;
    
    if (!ctx.session.city) {
        await ctx.reply('Сначала выбери город.', { reply_markup: cityMenu });
    } else {
        await ctx.reply('🏠 Возвращаюсь в главное меню.', { reply_markup: mainMenu });
    }
});

// Обработка текстовых сообщений (ввод города)
bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    
    // Игнорируем команды
    if (text.startsWith('/')) {
        return;
    }
    
    // Если пользователь вводит город
    if (ctx.session.awaitingCityInput) {
        ctx.session.city = text;
        ctx.session.awaitingCityInput = false;
        
        console.log(`[Bot] Пользователь ${userId} ввел город: ${text}`);
        
        await ctx.reply(
            `✅ Принято! Буду использовать город *${text}*.\n\nТеперь выбери действие:`,
            { parse_mode: 'Markdown', reply_markup: mainMenu }
        );
        return;
    }
    
    // Если город еще не выбран
    if (!ctx.session.city) {
        await ctx.reply('⚠️ Сначала выбери город из меню или нажми "✏️ Ввести другой город"', { reply_markup: cityMenu });
        return;
    }
    
    // Если город выбран, но сообщение не распознано
    await ctx.reply(
        '❓ Не понял команду. Используй кнопки меню для навигации.',
        { reply_markup: mainMenu }
    );
});

// Кнопка "ПОГОДА СЕЙЧАС"
bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!ctx.session.city) {
        await ctx.reply('⚠️ Сначала выбери город.', { reply_markup: cityMenu });
        return;
    }
    
    const city = ctx.session.city;
    console.log(`[Bot] Запрос погоды от ${userId} для города: ${city}`);
    
    try {
        await ctx.reply(`🔍 Запрашиваю актуальную погоду для *${city}*...`, { parse_mode: 'Markdown' });
        
        const weather = await getWeatherData(city);
        
        const message = `
🌤️ *Погода в ${weather.city}*
${weather.isFallback ? '_(используются примерные данные)_\n' : ''}

🌡️ *Температура:* ${weather.temp}°C
🤔 *Ощущается как:* ${weather.feels_like}°C
💨 *Ветер:* ${weather.wind} м/с
💧 *Влажность:* ${weather.humidity}%
📝 *Состояние:* ${weather.description}
🌧️ *Осадки:* ${weather.precipitation} мм
        `.trim();
        
        await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenu });
        
    } catch (err) {
        console.error(`[Bot] Ошибка при запросе погоды для ${userId}:`, err);
        await ctx.reply(
            '❌ К сожалению, не удалось получить погоду.\nПопробуй позже или выбери другой город.',
            { reply_markup: mainMenu }
        );
    }
});

// Кнопка "ЧТО НАДЕТЬ?"
bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!ctx.session.city) {
        await ctx.reply('⚠️ Сначала выбери город.', { reply_markup: cityMenu });
        return;
    }
    
    const city = ctx.session.city;
    console.log(`[Bot] Запрос совета по одежде от ${userId} для города: ${city}`);
    
    try {
        await ctx.reply(`👔 Анализирую погоду в *${city}*...`, { parse_mode: 'Markdown' });
        
        const weather = await getWeatherData(city);
        const advice = getWardrobeAdvice(weather);
        
        const message = `
👕 *Совет по одежде для ${weather.city}*
${weather.isFallback ? '_(на основе примерных данных)_\n' : ''}

${advice}
        `.trim();
        
        await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenu });
        
    } catch (err) {
        console.error(`[Bot] Ошибка при составлении совета для ${userId}:`, err);
        await ctx.reply(
            '❌ Не могу дать совет по одежде.\nПопробуй запросить погоду позже.',
            { reply_markup: mainMenu }
        );
    }
});

// Кнопка "ФРАЗА ДНЯ"
bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`[Bot] Запрос фразы дня от ${userId}`);
    
    // Выбираем фразу на основе дня месяца
    const dayOfMonth = new Date().getDate();
    const phraseIndex = dayOfMonth % dailyPhrases.length;
    const phrase = dailyPhrases[phraseIndex];
    
    const message = `
💬 *Английская фраза дня*

🇬🇧 **${phrase.english}**
🇷🇺 **${phrase.russian}**

📖 *Объяснение:*
${phrase.explanation}

🏷️ *Категория:* ${phrase.category}
📊 *Уровень:* ${phrase.level}
    `.trim();
    
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenu });
});

// Кнопка "СМЕНИТЬ ГОРОД"
bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
    ctx.session.city = null;
    ctx.session.awaitingCityInput = false;
    
    await ctx.reply('🔄 Выбери новый город из списка или введи свой:', { reply_markup: cityMenu });
});

// Кнопка "ПОМОЩЬ"
bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
    const helpText = `
🆘 *Помощь по боту*

🌤️ *ПОГОДА СЕЙЧАС* — показывает текущую погоду в выбранном городе.

👕 *ЧТО НАДЕТЬ?* — даёт рекомендации по одежде на основе погоды.

💬 *ФРАЗА ДНЯ* — учит новую полезную английскую фразу или идиому.

🏙️ *СМЕНИТЬ ГОРОД* — позволяет изменить город для прогноза.

ℹ️ *ПОМОЩЬ* — показывает это сообщение.

---

*Как пользоваться:*
1️⃣ При старте (/start) выбери или введи свой город
2️⃣ Используй кнопки меню для навигации
3️⃣ Данные о погоде берутся с открытого сервиса Open-Meteo

*Разработано с ❤️ для изучения английского и прогноза погоды*
    `.trim();
    
    await ctx.reply(helpText, { parse_mode: 'Markdown', reply_markup: mainMenu });
});

// ===================== ОБРАБОТЧИК ДЛЯ VERCEL (WEBHOOK) =====================
export default async function handler(req, res) {
    // Логируем начало обработки
    console.log(`[Vercel] ${req.method} запрос на /api/bot`);
    
    // Обработка GET-запроса (проверка работоспособности)
    if (req.method === 'GET') {
        try {
            const botInfo = await bot.api.getMe();
            return res.status(200).json({
                status: 'Bot endpoint is live ✅',
                bot_name: botInfo.first_name,
                bot_username: botInfo.username,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Vercel] Ошибка инициализации бота:', error);
            return res.status(500).json({
                status: 'Bot endpoint error ❌',
                error: error.message
            });
        }
    }
    
    // Обработка POST-запроса (вебхук от Telegram)
    if (req.method === 'POST') {
        try {
            const update = req.body;
            
            // Логируем апдейт
            console.log(`[Vercel] Обработка update ID: ${update.update_id}`);
            
            // Обрабатываем апдейт
            await bot.handleUpdate(update);
            
            // Отвечаем Telegram, что всё обработано успешно
            return res.status(200).json({ ok: true });
            
        } catch (error) {
            console.error('[Vercel] Ошибка при обработке вебхука:', error);
            
            // Всегда отвечаем 200 OK, чтобы Telegram не отключал вебхук
            return res.status(200).json({ 
                ok: false, 
                error: 'Webhook processing error' 
            });
        }
    }
    
    // Если метод не GET и не POST
    return res.status(405).json({ error: 'Method Not Allowed' });
}
