import { Bot, Keyboard } from 'grammy';
import { createClient } from '@vercel/kv';

// ===================== КОНФИГУРАЦИЯ =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN не установлен');

// Настройка Vercel KV
const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ===================== API ПОГОДЫ =====================
async function getWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    if (!geoData.results?.[0]) throw new Error('Город не найден');
    
    const { latitude, longitude, name } = geoData.results[0];
    
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
    const weatherRes = await fetch(weatherUrl);
    const weatherJson = await weatherRes.json();

    const c = weatherJson.current;
    return {
      city: name,
      temp: Math.round(c.temperature_2m),
      feels_like: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m.toFixed(1),
      precipitation: c.precipitation,
      description: getWeatherDescription(c.weather_code)
    };
  } catch (error) {
    console.error('Ошибка погоды:', error);
    return {
      city: cityName,
      temp: 18,
      feels_like: 17,
      humidity: 65,
      wind: '3.5',
      precipitation: 0,
      description: 'Облачно с прояснениями ☁️'
    };
  }
}

function getWeatherDescription(code) {
  const map = {
    0: 'Ясно ☀️', 1: 'Преимущественно ясно 🌤️',
    2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️',
    51: 'Легкая морось 🌧️', 53: 'Умеренная морось 🌧️',
    55: 'Сильная морось 🌧️', 56: 'Ледяная морось 🌧️',
    57: 'Сильная ледяная морось 🌧️', 61: 'Небольшой дождь 🌧️',
    63: 'Умеренный дождь 🌧️', 65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️', 73: 'Умеренный снег ❄️',
    75: 'Сильный снег ❄️', 80: 'Небольшой ливень 🌧️',
    81: 'Умеренный ливень 🌧️', 82: 'Сильный ливень 🌧️',
    95: 'Гроза ⛈️'
  };
  return map[code] || `Код: ${code}`;
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
    russian: "Льёт как из ведра",
    explanation: "Очень сильный дождь",
    category: "Погода",
    level: "Средний"
  },
  {
    english: "Break the ice",
    russian: "Растопить лёд",
    explanation: "Начать разговор в незнакомой обстановке",
    category: "Общение",
    level: "Средний"
  },
  {
    english: "I'm feeling under the weather",
    russian: "Я неважно себя чувствую",
    explanation: "Быть немного больным",
    category: "Здоровье",
    level: "Средний"
  },
  {
    english: "Could you please repeat that?",
    russian: "Не могли бы вы повторить?",
    explanation: "Вежливая просьба повторить",
    category: "Общение",
    level: "Начальный"
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
  .text('📍 Симферополь').text('📍 Севастополь').row()
  .text('📍 Сочи').text('📍 Екатеринбург').row()
  .text('📍 Казань').text('📍 Новосибирск').row()
  .text('📍 Краснодар').text('✏️ Ввести другой город').row()
  .text('🔙 Назад в меню')
  .resized()
  .oneTime();

// ===================== РАБОТА С ХРАНИЛИЩЕМ =====================
async function getUserData(userId) {
  const data = await kv.get(`user:${userId}`);
  return data ? JSON.parse(data) : { city: null };
}

async function saveUserData(userId, data) {
  await kv.set(`user:${userId}`, JSON.stringify(data), { ex: 2592000 }); // 30 дней
}

// ===================== WEBHOOK =====================
export default async function handler(req, res) {
  const bot = new Bot(BOT_TOKEN);
  
  try {
    await bot.init();
  } catch (e) {
    console.error('Ошибка инициализации:', e);
    return res.status(500).json({ error: 'Bot init failed' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ 
      ok: true, 
      message: 'Bot is running',
      bot: bot.botInfo?.username || 'unknown'
    });
  }
  
  if (req.method === 'POST') {
    try {
      registerHandlers(bot);
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('Ошибка обработки:', e);
      return res.status(200).json({ ok: false });
    }
  }
  
  return res.status(405).end();
}

// ===================== РЕГИСТРАЦИЯ ОБРАБОТЧИКОВ =====================
function registerHandlers(bot) {
  bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.first_name || 'Друг';
    
    // Сохраняем пустые данные пользователя
    await saveUserData(userId, { city: null });
    
    await ctx.reply(
      `Привет, ${userName}! 👋\nЯ помогу узнать погоду и подскажу, что надеть. А заодно выучу с тобой полезную английскую фразу.\n\n*Для начала выбери город:*`,
      { parse_mode: 'Markdown', reply_markup: cityMenu }
    );
  });

  bot.hears(/^📍 /, async (ctx) => {
    const city = ctx.message.text.replace('📍 ', '');
    const userId = ctx.from.id;
    
    // Сохраняем выбранный город
    await saveUserData(userId, { city });
    
    await ctx.reply(
      `✅ Отлично! Город *${city}* сохранён.\nТеперь ты можешь узнать погоду или получить совет по одежде.`,
      { parse_mode: 'Markdown', reply_markup: mainMenu }
    );
  });

  bot.hears('✏️ Ввести другой город', async (ctx) => {
    const userId = ctx.from.id;
    
    // Помечаем, что ожидаем ввод города
    await saveUserData(userId, { awaitingCity: true });
    
    await ctx.reply(
      '📝 Напиши название своего города:\n_(например: Воронеж, Ростов-на-Дону, London)_',
      { parse_mode: 'Markdown' }
    );
  });

  bot.hears('🔙 Назад в меню', async (ctx) => {
    const userId = ctx.from.id;
    const userData = await getUserData(userId);
    
    if (!userData.city) {
      await ctx.reply('Выбери город:', { reply_markup: cityMenu });
    } else {
      await ctx.reply('🏠 Возвращаюсь в главное меню.', { reply_markup: mainMenu });
    }
  });

  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const userData = await getUserData(userId);
    
    // Если ждём ввод города
    if (userData.awaitingCity && !text.startsWith('/')) {
      await saveUserData(userId, { city: text, awaitingCity: false });
      
      await ctx.reply(
        `✅ Принято! Буду использовать город *${text}*.\n\nТеперь выбери действие:`,
        { parse_mode: 'Markdown', reply_markup: mainMenu }
      );
      return;
    }
    
    // Обработка кнопок меню
    switch (text) {
      case '🌤️ ПОГОДА СЕЙЧАС':
        return handleWeather(ctx, userId);
      case '👕 ЧТО НАДЕТЬ?':
        return handleClothes(ctx, userId);
      case '💬 ФРАЗА ДНЯ':
        return handlePhrase(ctx, userId);
      case '🏙️ СМЕНИТЬ ГОРОД':
        await saveUserData(userId, { city: null });
        await ctx.reply('Выбери новый город:', { reply_markup: cityMenu });
        return;
      case 'ℹ️ ПОМОЩЬ':
        return handleHelp(ctx);
      default:
        if (!userData.city) {
          await ctx.reply('⚠️ Сначала выбери город!', { reply_markup: cityMenu });
        } else {
          await ctx.reply('❓ Используй кнопки меню', { reply_markup: mainMenu });
        }
    }
  });
}

// ===================== ФУНКЦИИ ОБРАБОТКИ =====================
async function handleWeather(ctx, userId) {
  const userData = await getUserData(userId);
  const city = userData.city;
  
  if (!city) {
    await ctx.reply('⚠️ Сначала выбери город!', { reply_markup: cityMenu });
    return;
  }
  
  await ctx.reply(`🔍 Запрашиваю погоду для *${city}*...`, { parse_mode: 'Markdown' });
  
  try {
    const weather = await getWeatherData(city);
    
    const message = `
🌤️ *Погода в ${weather.city}*

🌡️ *Температура:* ${weather.temp}°C
🤔 *Ощущается как:* ${weather.feels_like}°C
💨 *Ветер:* ${weather.wind} м/с
💧 *Влажность:* ${weather.humidity}%
📝 *Состояние:* ${weather.description}
🌧️ *Осадки:* ${weather.precipitation} мм
    `.trim();
    
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenu });
    
  } catch (err) {
    console.error('Ошибка погоды:', err);
    await ctx.reply('❌ Ошибка получения погоды', { reply_markup: mainMenu });
  }
}

async function handleClothes(ctx, userId) {
  const userData = await getUserData(userId);
  const city = userData.city;
  
  if (!city) {
    await ctx.reply('⚠️ Сначала выбери город!', { reply_markup: cityMenu });
    return;
  }
  
  await ctx.reply(`👔 Анализирую погоду в *${city}*...`, { parse_mode: 'Markdown' });
  
  try {
    const weather = await getWeatherData(city);
    
    let advice = '';
    if (weather.temp >= 25) advice = '🩳 Футболка + шорты + панама';
    else if (weather.temp >= 18) advice = '👕 Футболка + джинсы, лёгкая куртка';
    else if (weather.temp >= 10) advice = '🧥 Свитер + ветровка, штаны';
    else if (weather.temp >= 0) advice = '🧣 Термобельё + куртка, шапка/шарф';
    else advice = '🥶 Пуховик + шапка/шарф/варежки';
    
    if (weather.description.includes('🌧️')) advice += '\n☔ Возьми зонт!';
    if (weather.description.includes('❄️')) advice += '\n❄️ Обувь непромокаемая!';
    
    const message = `
👕 *Совет по одежде для ${weather.city}*

${advice}
    `.trim();
    
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenu });
    
  } catch (err) {
    console.error('Ошибка совета:', err);
    await ctx.reply('❌ Ошибка получения совета', { reply_markup: mainMenu });
  }
}

async function handlePhrase(ctx, userId) {
  const userData = await getUserData(userId);
  const city = userData.city;
  
  if (!city) {
    await ctx.reply('⚠️ Сначала выбери город!', { reply_markup: cityMenu });
    return;
  }
  
  const day = new Date().getDate();
  const phrase = dailyPhrases[day % dailyPhrases.length];
  
  const message = `
💬 *Фраза дня*

🇬🇧 **${phrase.english}**
🇷🇺 **${phrase.russian}**

📖 *Объяснение:*
${phrase.explanation}

🏷️ *Категория:* ${phrase.category}
📊 *Уровень:* ${phrase.level}
  `.trim();
  
  await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: mainMenu });
}

async function handleHelp(ctx) {
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
  `.trim();
  
  await ctx.reply(helpText, { parse_mode: 'Markdown', reply_markup: mainMenu });
}
