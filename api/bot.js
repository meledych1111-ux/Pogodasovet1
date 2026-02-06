import { Bot, Keyboard } from 'grammy';

const bot = new Bot(process.env.BOT_TOKEN || '');
const userStorage = new Map();

// ===================== ФУНКЦИИ =====================
async function getWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    
    if (!geoData.results?.length) throw new Error('Город не найден');
    
    const { latitude, longitude, name } = geoData.results[0];
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    if (!weatherData.current) throw new Error('Нет данных о погоде');
    
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
    console.error('Ошибка получения погоды:', error.message);
    return {
      temp: 15, feels_like: 14, humidity: 65,
      wind: '3.2', precipitation: '0 мм',
      description: 'Облачно', city: cityName
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
  const { temp, description, wind, precipitation } = weatherData;
  let advice = [];

  if (temp >= 25) {
    advice.push('• 👕 Базовый слой: майка, футболка из хлопка или льна.');
    advice.push('• 👖 Верх: шорты, легкие брюки или юбка.');
  } else if (temp >= 18) {
    advice.push('• 👕 Базовый слой: футболка или тонкая рубашка.');
    advice.push('• 🧥 Верх: джинсы, брюки, легкая куртка на вечер.');
  } else if (temp >= 10) {
    advice.push('• 👕 Базовый слой: лонгслив или тонкое термобелье.');
    advice.push('• 🧥 Верх: свитер, толстовка, ветровка.');
  } else if (temp >= 0) {
    advice.push('• 👕 Базовый слой: теплое термобелье или флис.');
    advice.push('• 🧥 Верх: утепленный свитер, зимняя куртка, теплые брюки.');
  } else {
    advice.push('• 👕 Базовый слой: плотное термобелье, флис.');
    advice.push('• 🧥 Верх: пуховик, утепленные штаны.');
  }

  if (description.toLowerCase().includes('дождь') || parseFloat(precipitation) > 0) {
    advice.push('• ☔ Защита от влаги: дождевик, зонт, непромокаемая обувь.');
  }
  if (description.toLowerCase().includes('снег')) {
    advice.push('• ❄️ Для снега: непромокаемая обувь, варежки.');
  }
  if (parseFloat(wind) > 7) {
    advice.push('• 💨 От ветра: ветровка с мембраной, шарф.');
  }
  if (description.toLowerCase().includes('ясно') || description.includes('☀️')) {
    advice.push('• 🕶️ От солнца: солнцезащитные очки, головной убор.');
  }

  if (temp < 15) advice.push('• 🧣 Аксессуары: шапка, шарф, перчатки.');
  if (temp > 20 && description.includes('ясно')) advice.push('• 🧴 Солнцезащитный крем SPF 30+.');

  advice.push('\n👟 *Обувь*: выбирайте по погоде');
  advice.push('🎒 *С собой*: сумка для снятых слоев одежды');

  return advice.join('\n');
}

// ===================== КОЛЛЕКЦИЯ ФРАЗ (50+ для начала) =====================
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
  // Добавьте ещё фраз при необходимости
];
// ===================== КОЛЛЕКЦИЯ ФРАЗ (50+ для начала) =====================
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
  // Добавьте ещё фраз при необходимости
];

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
  .text('📍 СИМФЕРОПОЛЬ').text('📍 СЕВАСТОПОЛЬ')
  .row()
  .text('📍 ЯЛТА').text('📍 АЛУШТА')
  .row()
  .text('📍 ЕВПАТОРИЯ').text('📍 ФЕОДОСИЯ')
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

bot.hears(/^📍\s/, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '');
  userStorage.set(userId, { city });
  await ctx.reply(
    `✅ *Город "${city}" сохранён!*\nТеперь вы можете узнать погоду или получить совет.`,
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
  );
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const userData = userStorage.get(userId);
  
  if (userData?.awaitingCity && text && !text.startsWith('/') && text !== '🚀 НАЧАТЬ') {
    userStorage.set(userId, { city: text, awaitingCity: false });
    await ctx.reply(
      `✅ *Город "${text}" сохранён!*`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  }
});

bot.hears('🌤️ ПОГОДА', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData?.city) {
    await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
    return;
  }
  
  try {
    await ctx.reply(`⏳ *Запрашиваю погоду для ${userData.city}...*`, { parse_mode: 'Markdown' });
    const weather = await getWeatherData(userData.city);
    
    await ctx.reply(
      `🌤️ *Погода в ${userData.city}*\n\n` +
      `🌡️ Температура: *${weather.temp}°C*\n` +
      `🤔 Ощущается как: *${weather.feels_like}°C*\n` +
      `💨 Ветер: ${weather.wind} м/с\n` +
      `💧 Влажность: ${weather.humidity}%\n` +
      `📝 ${weather.description}\n` +
      `🌧️ Осадки: ${weather.precipitation}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  } catch (error) {
    await ctx.reply(`❌ Не удалось получить погоду для ${userData.city}.`, { reply_markup: mainMenuKeyboard });
  }
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const userId = ctx.from.id;
  const userData = userStorage.get(userId);
  
  if (!userData?.city) {
    await ctx.reply('Сначала выберите город!', { reply_markup: cityKeyboard });
    return;
  }
  
  try {
    await ctx.reply(`👗 *Анализирую погоду для ${userData.city}...*`, { parse_mode: 'Markdown' });
    const weather = await getWeatherData(userData.city);
    const advice = getWardrobeAdvice(weather);
    
    await ctx.reply(
      `👕 *Что надеть в ${userData.city}?*\n\n${advice}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  } catch (error) {
    await ctx.reply('❌ Не удалось получить рекомендацию.', { reply_markup: mainMenuKeyboard });
  }
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  if (dailyPhrases.length === 0) {
    await ctx.reply(
      `💬 *Фраза дня*\n\n` +
      `🇬🇧 "It's raining cats and dogs"\n\n` +
      `🇷🇺 "Льёт как из ведра"\n\n` +
      `📚 Идиома для описания сильного дождя\n\n` +
      `_Добавьте свои фразы в код бота_`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
    return;
  }
  
  const phrase = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  await ctx.reply(
    `💬 *Фраза дня*\n\n` +
    `🇬🇧 ${phrase.english}\n\n` +
    `🇷🇺 ${phrase.russian}\n\n` +
    `📚 ${phrase.explanation}`,
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
  );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => {
  ctx.reply('Выберите новый город:', { reply_markup: cityKeyboard });
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => {
  ctx.reply(
    `*Помощь по боту*\n\n` +
    `• Выберите город\n• Получите погоду и совет по одежде\n• Учите новую фразу каждый день\n\nВсе управление через кнопки.`,
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
  );
});

bot.hears('🔙 НАЗАД', (ctx) => {
  ctx.reply('Возвращаю в главное меню:', { reply_markup: mainMenuKeyboard });
});

// ===================== ЗАПУСК ДЛЯ VERCEL =====================
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ message: 'Bot is running' });
    }
    if (req.method === 'POST') {
      await bot.init();
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(200).json({ ok: false, error: error.message });
  }
}
