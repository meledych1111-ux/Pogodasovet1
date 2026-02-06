import { Bot, Keyboard } from 'grammy';

// Проверяем токен
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN не установлен');
}

console.log('🤖 Бот инициализируется...');

// Создаем бота
const bot = new Bot(BOT_TOKEN);

// Хранилище сессий в памяти
const sessions = {};

// Клавиатуры
const mainMenu = new Keyboard()
  .text('🌤️ ПОГОДА СЕЙЧАС').row()
  .text('👕 ЧТО НАДЕТЬ?').text('💬 ФРАЗА ДНЯ').row()
  .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ')
  .resized()
  .oneTime();

const cityMenu = new Keyboard()
  .text('📍 Москва').text('📍 Санкт-Петербург').row()
  .text('📍 Казань').text('📍 Сочи').row()
  .text('📍 Новосибирск').text('📍 Екатеринбург').row()
  .text('✏️ Ввести другой город').row()
  .text('🔙 Назад в меню')
  .resized()
  .oneTime();

// ===================== ОБРАБОТЧИКИ =====================

// Команда /start
bot.command('start', async (ctx) => {
  console.log('📝 Команда /start получена');
  
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Друг';
  
  // Инициализируем сессию
  sessions[userId] = {
    city: null,
    awaitingCityInput: false
  };
  
  console.log(`👤 Пользователь: ${userName} (ID: ${userId})`);
  
  try {
    await ctx.reply(
      `Привет, ${userName}! 👋\nЯ помогу узнать погоду и подскажу, что надеть.\n\n*Для начала выбери город:*`,
      { 
        parse_mode: 'Markdown', 
        reply_markup: cityMenu 
      }
    );
  } catch (error) {
    console.error('❌ Ошибка отправки сообщения:', error);
  }
});

// Обработчик выбора города
bot.hears(/^📍 /, async (ctx) => {
  console.log('📍 Пользователь выбрал город');
  
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '');
  
  if (sessions[userId]) {
    sessions[userId].city = city;
    sessions[userId].awaitingCityInput = false;
  }
  
  try {
    await ctx.reply(
      `✅ Отлично! Город *${city}* сохранён.\n\nТеперь выбери действие:`,
      { 
        parse_mode: 'Markdown', 
        reply_markup: mainMenu 
      }
    );
  } catch (error) {
    console.error('❌ Ошибка отправки сообщения:', error);
  }
});

// Обработчик для ввода другого города
bot.hears('✏️ Ввести другой город', async (ctx) => {
  const userId = ctx.from.id;
  
  if (sessions[userId]) {
    sessions[userId].awaitingCityInput = true;
  }
  
  await ctx.reply('📝 Напиши название своего города:', { 
    reply_markup: new Keyboard().text('🔙 Отмена').resized() 
  });
});

// Обработчик кнопки "Назад"
bot.hears('🔙 Назад в меню', async (ctx) => {
  const userId = ctx.from.id;
  
  if (sessions[userId]) {
    sessions[userId].awaitingCityInput = false;
  }
  
  await ctx.reply('🏠 Главное меню:', { reply_markup: mainMenu });
});

// Обработчик кнопки "Погода"
bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const userId = ctx.from.id;
  const session = sessions[userId];
  
  if (!session || !session.city) {
    await ctx.reply('⚠️ Сначала выбери город!', { reply_markup: cityMenu });
    return;
  }
  
  await ctx.reply(`🌤️ Погода в *${session.city}*:\n\n🌡️ Температура: 20°C\n💨 Ветер: 5 м/с\n💧 Влажность: 65%\n📝 Состояние: Солнечно ☀️`, 
    { parse_mode: 'Markdown', reply_markup: mainMenu }
  );
});

// Обработчик кнопки "Фраза дня"
bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  await ctx.reply(
    `💬 *Английская фраза дня*\n\n🇬🇧 **Where is the nearest metro station?**\n🇷🇺 **Где ближайшая станция метро?**\n\n📖 *Объяснение:* Спрашиваем дорогу к метро\n🏷️ *Категория:* Путешествия\n📊 *Уровень:* Начальный`,
    { parse_mode: 'Markdown', reply_markup: mainMenu }
  );
});

// Обработчик кнопки "Помощь"
bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
  await ctx.reply(
    `🆘 *Помощь по боту*\n\n• 🌤️ ПОГОДА СЕЙЧАС - текущая погода\n• 👕 ЧТО НАДЕТЬ? - совет по одежде\n• 💬 ФРАЗА ДНЯ - английская фраза\n• 🏙️ СМЕНИТЬ ГОРОД - изменить город\n\nИспользуйте кнопки для навигации.`,
    { parse_mode: 'Markdown', reply_markup: mainMenu }
  );
});

// Обработчик текстовых сообщений (для ввода города)
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const session = sessions[userId];
  
  console.log(`📨 Получено сообщение: "${text}" от ${userId}`);
  
  // Пропускаем команды
  if (text.startsWith('/')) return;
  
  // Проверяем, ожидается ли ввод города
  if (session && session.awaitingCityInput) {
    session.city = text;
    session.awaitingCityInput = false;
    
    await ctx.reply(
      `✅ Принято! Город *${text}* сохранён.\n\nТеперь выбери действие:`,
      { parse_mode: 'Markdown', reply_markup: mainMenu }
    );
    return;
  }
  
  // Если не знаем, что делать с сообщением
  if (!session || !session.city) {
    await ctx.reply('🤔 Сначала используйте /start', { reply_markup: cityMenu });
  }
});

// Обработчик ошибок
bot.catch((err) => {
  console.error('🔥 Ошибка в боте:', err);
});

// ===================== VERCEL WEBHOOK HANDLER =====================
let isBotInitialized = false;

export default async function handler(req, res) {
  console.log(`📨 ${req.method} запрос на ${req.url}`);
  
  // Для GET запросов - проверка работоспособности
  if (req.method === 'GET') {
    console.log('🔍 GET запрос - проверка работы бота');
    return res.status(200).json({ 
      ok: true, 
      message: 'Telegram Weather Bot is running',
      timestamp: new Date().toISOString(),
      sessionsCount: Object.keys(sessions).length
    });
  }
  
  // Для POST запросов - обработка от Telegram
  if (req.method === 'POST') {
    try {
      console.log('🤖 Обработка Telegram обновления...');
      
      const update = req.body;
      console.log('📦 Update:', JSON.stringify(update, null, 2));
      
      // Пытаемся обработать обновление
      await bot.handleUpdate(update);
      
      console.log('✅ Обновление обработано успешно');
      return res.status(200).json({ ok: true });
      
    } catch (error) {
      console.error('❌ Ошибка обработки обновления:', error);
      return res.status(200).json({ 
        ok: false, 
        error: error.message,
        stack: error.stack 
      });
    }
  }
  
  // Метод не поддерживается
  console.warn(`⚠️ Метод ${req.method} не поддерживается`);
  return res.status(405).json({ error: 'Method not allowed' });
}

// ===================== ПРОСТАЯ ФУНКЦИЯ ДЛЯ ПОГОДЫ =====================
async function getWeather(city) {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=55.7558&longitude=37.6176&current=temperature_2m,wind_speed_10m&timezone=Europe/Moscow`
    );
    const data = await response.json();
    return data.current;
  } catch (error) {
    console.error('Ошибка получения погоды:', error);
    return null;
  }
}
