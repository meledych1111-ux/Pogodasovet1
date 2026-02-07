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

// ===================== РЕАЛЬНАЯ ФУНКЦИЯ ПОГОДЫ (OPEN-METEO) =====================
async function getWeatherData(cityName) {
    console.log(`🌤️ Запрашиваю РЕАЛЬНУЮ погоду для: "${cityName}"`);
    
    try {
        // 1. ГЕОКОДИНГ: Находим координаты города
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        console.log(`📍 Geo URL: ${geoUrl}`);
        
        const geoResponse = await fetch(geoUrl);
        if (!geoResponse.ok) {
            throw new Error(`Ошибка геокодинга: ${geoResponse.status}`);
        }
        
        const geoData = await geoResponse.json();
        console.log('📍 Geo ответ:', JSON.stringify(geoData).slice(0, 300));
        
        if (!geoData.results || geoData.results.length === 0) {
            throw new Error(`Город "${cityName}" не найден в базе Open-Meteo`);
        }
        
        const { latitude, longitude, name, country, admin1 } = geoData.results[0];
        const fullCityName = admin1 ? `${name}, ${admin1}` : `${name}, ${country}`;
        console.log(`📍 Найден: ${fullCityName} (${latitude}, ${longitude})`);
        
        // 2. ПОГОДА: Получаем текущую погоду по координатам
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
        console.log(`🌤️ Weather URL: ${weatherUrl}`);
        
        const weatherResponse = await fetch(weatherUrl);
        if (!weatherResponse.ok) {
            throw new Error(`Ошибка погодного API: ${weatherResponse.status}`);
        }
        
        const weatherData = await weatherResponse.json();
        console.log('🌤️ Weather данные:', weatherData.current);
        
        if (!weatherData.current) {
            throw new Error('Нет данных о текущей погоде');
        }
        
        const current = weatherData.current;
        
        // 3. Получаем описание погоды по коду
        const description = getWeatherDescription(current.weather_code);
        
        // 4. Форматируем данные
        return {
            city: fullCityName,
            temp: Math.round(current.temperature_2m),
            feels_like: Math.round(current.apparent_temperature),
            humidity: Math.round(current.relative_humidity_2m),
            wind: current.wind_speed_10m.toFixed(1),
            precipitation: current.precipitation.toFixed(1),
            description: description,
            weather_code: current.weather_code,
            isReal: true,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error(`🔥 Ошибка получения реальной погоды для "${cityName}":`, error.message);
        
        // Возвращаем тестовые данные только в случае ошибки
        return {
            city: cityName,
            temp: 22,
            feels_like: 21,
            humidity: 65,
            wind: '3.5',
            precipitation: '0.0',
            description: 'Ясно ☀️ (тестовые данные)',
            isReal: false,
            error: error.message
        };
    }
}

function getWeatherDescription(code) {
    const weatherMap = {
        0: 'Ясно ☀️',
        1: 'Преимущественно ясно 🌤️',
        2: 'Переменная облачность ⛅',
        3: 'Пасмурно ☁️',
        45: 'Туман 🌫️',
        48: 'Изморозь 🌫️',
        51: 'Легкая морось 🌧️',
        53: 'Умеренная морось 🌧️',
        55: 'Сильная морось 🌧️',
        56: 'Легкая ледяная морось 🌧️',
        57: 'Сильная ледяная морось 🌧️',
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
        advice.push('• 👟 Обувь: сандалии, легкие кроссовки');
    } else if (temp >= 18) {
        advice.push('• 👕 Базовый слой: футболка или тонкая рубашка');
        advice.push('• 🧥 Верх: джинсы, брюки, легкая куртка на вечер');
        advice.push('• 👟 Обувь: кроссовки, кеды');
    } else if (temp >= 10) {
        advice.push('• 👕 Базовый слой: лонгслив или тонкое термобелье');
        advice.push('• 🧥 Верх: свитер, толстовка, ветровка');
        advice.push('• 👖 Штаны: джинсы, утепленные брюки');
    } else if (temp >= 0) {
        advice.push('• 👕 Базовый слой: теплое термобелье или флис');
        advice.push('• 🧥 Верх: утепленный свитер, зимняя куртка');
        advice.push('• 👖 Штаны: теплые брюки, зимние штаны');
    } else {
        advice.push('• 👕 Базовый слой: плотное термобелье, флис');
        advice.push('• 🧥 Верх: пуховик, утепленные штаны');
        advice.push('• 🧤 Обязательно: теплая шапка, шарф, перчатки');
    }

    // Дополнительные рекомендации
    if (description.includes('🌧️') || description.includes('⛈️') || parseFloat(precipitation) > 2) {
        advice.push('• ☔ Защита от дождя: дождевик, зонт, непромокаемая обувь');
    }
    if (description.includes('❄️') || description.includes('снег')) {
        advice.push('• ❄️ Для снега: непромокаемая обувь с теплым носком, варежки');
    }
    if (parseFloat(wind) > 7) {
        advice.push('• 💨 От ветра: ветровка с капюшоном, шарф');
    }
    if (description.includes('☀️') || description.includes('ясно')) {
        advice.push('• 🕶️ От солнца: солнцезащитные очки, головной убор, крем SPF 30+');
    }

    // Общие советы
    if (temp < 15) {
        advice.push('• 🧣 Аксессуары: шапка, шарф, перчатки');
    }

    advice.push('\n👟 *Обувь*: выбирайте по погоде');
    advice.push('🎒 *С собой*: сумка для снятых слоев одежды');

    return advice.join('\n');
}

// ===================== ФРАЗЫ ДНЯ =====================
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
    .text('🌤️ ПОГОДА')
    .row()
    .text('👕 ЧТО НАДЕТЬ?')
    .text('💬 ФРАЗА ДНЯ')
    .row()
    .text('🏙️ СМЕНИТЬ ГОРОД')
    .text('ℹ️ ПОМОЩЬ')
    .resized();

const cityKeyboard = new Keyboard()
    .text('📍 МОСКВА')
    .text('📍 САНКТ-ПЕТЕРБУРГ')
    .row()
    .text('📍 СИМФЕРОПОЛЬ')
    .text('📍 СЕВАСТОПОЛЬ')
    .row()
    .text('📍 КРАСНОДАР')
    .text('📍 СОЧИ')
    .row()
    .text('✏️ ДРУГОЙ ГОРОД')
    .row()
    .text('🔙 НАЗАД')
    .resized();

// ===================== ОБРАБОТЧИКИ КОМАНД =====================

// 1. Команда /start
bot.command('start', async (ctx) => {
    console.log(`🚀 /start от ${ctx.from.id} (@${ctx.from.username || 'нет'})`);
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

// 4. Кнопка ПОГОДА (РЕАЛЬНЫЕ ДАННЫЕ)
bot.hears('🌤️ ПОГОДА', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`🌤️ ПОГОДА от ${userId}`);
    
    try {
        const userData = userStorage.get(userId) || {};
        
        if (!userData.city) {
            await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
            return;
        }
        
        await ctx.reply(`⏳ Запрашиваю *реальную погоду* для ${userData.city}...`, { parse_mode: 'Markdown' });
        
        const weather = await getWeatherData(userData.city);
        console.log('🌤️ Получена погода:', weather);
        
        // Формируем сообщение
        let message = `🌤️ *Погода в ${weather.city}*\n\n`;
        
        if (!weather.isReal) {
            message += `⚠️ *Используются тестовые данные*\n`;
            message += `❌ Ошибка API: ${weather.error}\n\n`;
        } else {
            message += `✅ *Актуальные данные с Open-Meteo*\n\n`;
        }
        
        message += `🌡️ Температура: *${weather.temp}°C*\n`;
        message += `🤔 Ощущается: *${weather.feels_like}°C*\n`;
        message += `💨 Ветер: *${weather.wind} м/с*\n`;
        message += `💧 Влажность: *${weather.humidity}%*\n`;
        message += `📝 ${weather.description}\n`;
        message += `🌧️ Осадки: *${weather.precipitation} мм/ч*\n`;
        
        if (weather.isReal) {
            message += `\n🕐 Данные актуальны на текущий момент`;
        } else {
            message += `\n🔧 API временно недоступен, используем тестовые данные`;
        }
        
        await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
        
    } catch (error) {
        console.error('❌ Ошибка в ПОГОДА:', error);
        await ctx.reply(
            '❌ Не удалось получить погоду. Возможно, проблема с API или город указан некорректно.\n\nПопробуйте:\n1. Проверить название города\n2. Попробовать позже\n3. Использовать другой город',
            { reply_markup: mainMenuKeyboard }
        );
    }
});

// 5. Кнопка ЧТО НАДЕТЬ?
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
        const advice = getWardrobeAdvice(weather);
        
        let message = `👕 *Что надеть в ${weather.city}?*\n\n`;
        
        if (!weather.isReal) {
            message += `⚠️ *На основе тестовых данных*\n\n`;
        }
        
        message += `${advice}`;
        
        if (weather.isReal) {
            message += `\n\n📊 *Текущая погода:* ${weather.temp}°C, ${weather.description}`;
        }
        
        await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
        
    } catch (error) {
        console.error('❌ Ошибка в ЧТО НАДЕТЬ:', error);
        await ctx.reply('Не удалось получить рекомендацию.', { reply_markup: mainMenuKeyboard });
    }
});

// 6. Кнопка ФРАЗА ДНЯ
bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
    console.log(`💬 ФРАЗА ДНЯ от ${ctx.from.id}`);
    
    try {
        if (!dailyPhrases || dailyPhrases.length === 0) {
            await ctx.reply('Фразы не загружены.', { reply_markup: mainMenuKeyboard });
            return;
        }
        
        // Выбираем фразу по дню месяца для разнообразия
        const dayOfMonth = new Date().getDate();
        const phraseIndex = (dayOfMonth - 1) % dailyPhrases.length;
        const phrase = dailyPhrases[phraseIndex];
        console.log(`💬 Выбрана фраза #${phraseIndex}: "${phrase.english}"`);
        
        await ctx.reply(
            `💬 *Фраза дня*\n\n` +
            `🇬🇧 *${phrase.english}*\n\n` +
            `🇷🇺 *${phrase.russian}*\n\n` +
            `📚 ${phrase.explanation}\n\n` +
            `🏷️ Категория: ${phrase.category}\n` +
            `📊 Уровень: ${phrase.level}`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
        
    } catch (error) {
        console.error('❌ Ошибка в ФРАЗА ДНЯ:', error);
        await ctx.reply('Не удалось получить фразу дня.', { reply_markup: mainMenuKeyboard });
    }
});

// 7. Кнопка ПОМОЩЬ
bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
    console.log(`ℹ️ ПОМОЩЬ от ${ctx.from.id}`);
    
    try {
        await ctx.reply(
            `*Помощь по боту*\n\n` +
            `• *🌤️ ПОГОДА* - текущая погода с реальными данными Open-Meteo\n` +
            `• *👕 ЧТО НАДЕТЬ?* - рекомендации по одежде на основе погоды\n` +
            `• *💬 ФРАЗА ДНЯ* - новая английская фраза каждый день\n` +
            `• *🏙️ СМЕНИТЬ ГОРОД* - изменить город для прогноза\n` +
            `• *ℹ️ ПОМОЩЬ* - это сообщение\n\n` +
            `*Как пользоваться:*\n` +
            `1. Нажмите НАЧАТЬ\n` +
            `2. Выберите город из списка или введите свой\n` +
            `3. Используйте кнопки меню для получения информации\n\n` +
            `*Техническая информация:*\n` +
            `• Погодные данные: Open-Meteo API\n` +
            `• Реальное время: актуальные данные`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
        );
    } catch (error) {
        console.error('❌ Ошибка в ПОМОЩЬ:', error);
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
        await ctx.reply('Напишите название вашего города (например, "Воронеж" или "Rostov-on-Don"):');
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
        await ctx.reply('Используйте кнопки меню:', { reply_markup: mainMenuKeyboard });
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

// Автоматическая инициализация при старте
console.log('⚡ Бот загружен и готов к работе!');
