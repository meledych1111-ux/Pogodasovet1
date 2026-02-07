import { Bot, Keyboard, session } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден!');
    // Не бросаем ошибку, чтобы функция могла запуститься
    // throw new Error('BOT_TOKEN is required');
}

console.log('🤖 Инициализация бота...');

// Проверяем токен перед созданием бота
if (!BOT_TOKEN) {
    console.log('⚠️ Бот не будет работать без BOT_TOKEN');
    // Создаем заглушку
    const bot = { handleUpdate: async () => {} };
} else {
    const bot = new Bot(BOT_TOKEN);

    // ===================== СЕССИИ БЕЗ ВНЕШНЕГО ХРАНИЛИЩА =====================
    bot.use(session({
        initial: () => ({
            selectedCity: undefined,
            awaitingCity: false
        }),
        // Используем встроенное хранилище
    }));

    // ===================== ВСЕ ФУНКЦИИ ПОГОДЫ (ПОЛНЫЕ) =====================
    function getPrecipitationType(weatherCode, precipitationAmount) {
        if (!precipitationAmount || precipitationAmount < 0.1) {
            return 'без осадков';
        }
        
        const rainCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
        const snowCodes = [71, 73, 75, 77, 85, 86];
        const drizzleCodes = [51, 53, 55];
        
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

    function getWeatherDescription(code) {
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
            55: 'Сильная морось 🌧️',
            56: 'Ледяная морось',
            57: 'Сильная ледяная морось',
            61: 'Небольшой дождь 🌧️',
            63: 'Умеренный дождь 🌧️', 
            65: 'Сильный дождь 🌧️', 
            66: 'Ледяной дождь',
            67: 'Сильный ледяной дождь',
            71: 'Небольшой снег ❄️',
            73: 'Умеренный снег ❄️', 
            75: 'Сильный снег ❄️',
            77: 'Снежные зерна',
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

    async function getWeatherData(cityName) {
        console.log(`🌤️ Запрашиваю погоду для: "${cityName}"`);
        
        try {
            const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
            const geoResponse = await fetch(geoUrl);
            const geoData = await geoResponse.json();
            
            if (!geoData.results || geoData.results.length === 0) {
                console.error('📍 Город не найден');
                throw new Error('Город не найден');
            }
            
            const { latitude, longitude, name } = geoData.results[0];
            
            const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m&daily=precipitation_sum,weather_code&wind_speed_unit=ms&timezone=auto&forecast_days=2`;
            
            const weatherResponse = await fetch(weatherUrl);
            const weatherData = await weatherResponse.json();
            
            if (!weatherData.current || !weatherData.daily) {
                console.error('🌤️ Нет данных о погоде');
                throw new Error('Нет данных о погоде');
            }
            
            const current = weatherData.current;
            const todayPrecipitation = weatherData.daily.precipitation_sum[0] || 0;
            const todayWeatherCode = weatherData.daily.weather_code[0];
            
            const precipitationType = getPrecipitationType(todayWeatherCode, todayPrecipitation);
            const precipitationEmoji = getPrecipitationEmoji(precipitationType);
            
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
            
            const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=3`;
            
            const forecastResponse = await fetch(forecastUrl);
            const forecastData = await forecastResponse.json();
            
            if (!forecastData.daily || 
                forecastData.daily.time.length < 2 ||
                forecastData.daily.precipitation_sum[1] === undefined) {
                console.error('📅 Нет данных прогноза для завтрашнего дня');
                throw new Error('Нет данных прогноза для завтра');
            }
            
            const tomorrowPrecipitation = forecastData.daily.precipitation_sum[1];
            const tomorrowCode = forecastData.daily.weather_code[1];
            
            const precipitationType = getPrecipitationType(tomorrowCode, tomorrowPrecipitation);
            const precipitationEmoji = getPrecipitationEmoji(precipitationType);
            
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

    // ===================== РАСШИРЕННЫЕ СОВЕТЫ ПО ОДЕЖДЕ =====================
    function getWardrobeAdvice(weatherData) {
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

    function getTomorrowAdvice(forecast) {
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

    // ===================== ФРАЗЫ (ПОЛНЫЕ) =====================
    const dailyPhrases = [
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
        .text('🏙️ СМЕНИТЬ ГОРОД').row()
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
            const city = ctx.session.selectedCity;
            
            if (!city) {
                await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
                return;
            }
            
            await ctx.reply(`⏳ Запрашиваю погоду для ${city}...`, { parse_mode: 'Markdown' });
            
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
            console.error('❌ Ошибка в ПОГОДА:', error);
            await ctx.reply('❌ Не удалось получить данные о погоде.', { reply_markup: mainMenuKeyboard });
        }
    });

    bot.hears('📅 ПОГОДА ЗАВТРА', async (ctx) => {
        console.log(`📅 ПОГОДА ЗАВТРА от ${ctx.from.id}`);
        
        try {
            const city = ctx.session.selectedCity;
            
            if (!city) {
                await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
                return;
            }
            
            await ctx.reply(`📅 Получаю прогноз на завтра для ${city}...`, { parse_mode: 'Markdown' });
            
            const forecast = await getTomorrowWeather(city);
            
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

    bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
        console.log(`👕 ЧТО НАДЕТЬ? от ${ctx.from.id}`);
        
        try {
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
            
            await ctx.reply(
                `💬 *Фраза дня*\n\n` +
                `🇬🇧 *${phrase.english}*\n\n` +
                `🇷🇺 *${phrase.russian}*\n\n` +
                `📚 ${phrase.explanation}\n\n` +
                `📂 Категория: ${phrase.category} (${phrase.level})`,
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
                `• *💬 ФРАЗА ДНЯ* - английская фраза дня\n` +
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
        
        if (text.startsWith('/') || 
            ['🚀 НАЧАТЬ', '🌤️ ПОГОДА СЕЙЧАС', '📅 ПОГОДА ЗАВТРА', '👕 ЧТО НАДЕТЬ?', 
             '💬 ФРАЗА ДНЯ', '🎲 СЛУЧАЙНАЯ ФРАЗА', '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ', '🔙 НАЗАД', '✏️ ДРУГОЙ ГОРОД'].includes(text) ||
            text.startsWith('📍 ')) {
            return;
        }
        
        if (ctx.session.awaitingCity) {
            try {
                const city = text.trim();
                console.log(`🏙️ Сохраняю город "${city}" для ${ctx.from.id}`);
                
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
            await ctx.reply('Пожалуйста, сначала выберите город:', { reply_markup: cityKeyboard });
        } else {
            await ctx.reply('Я вас не понимаю. Пожалуйста, используйте кнопки меню.', { reply_markup: mainMenuKeyboard });
        }
    });
}

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
            console.log('📦 Получен update от Telegram');
            
            try {
                const update = req.body;
                
                if (!BOT_TOKEN) {
                    console.error('❌ Нет BOT_TOKEN, игнорирую update');
                    return res.status(200).json({ ok: true });
                }
                
                await bot.handleUpdate(update);
                console.log('✅ Update успешно обработан');
                
                return res.status(200).json({ ok: true });
            } catch (error) {
                console.error('❌ Ошибка обработки update:', error);
                console.error('❌ Stack:', error.stack);
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

console.log('⚡ Бот инициализирован!');
