import { Bot, Keyboard } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN не установлен');
}

console.log('🤖 Инициализация бота...');

// Создаем бота с явной инициализацией
const bot = new Bot(BOT_TOKEN);

// Флаг инициализации
let botInitialized = false;

// Хранилище сессий
const sessions = {};

// Клавиатуры
const mainMenu = new Keyboard()
  .text('🌤️ ПОГОДА СЕЙЧАС').row()
  .text('💬 ФРАЗА ДНЯ').row()
  .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ')
  .resized()
  .oneTime();

const cityMenu = new Keyboard()
  .text('📍 Москва').text('📍 СПб').row()
  .text('📍 Казань').text('📍 Сочи').row()
  .text('✏️ Ввести другой город')
  .resized()
  .oneTime();

// ===================== ОБРАБОТЧИКИ =====================

bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Друг';
  
  console.log(`🚀 /start от ${userName} (${userId})`);
  
  // Инициализируем сессию
  sessions[userId] = {
    city: null,
    awaitingCityInput: false
  };
  
  await ctx.reply(
    `Привет, ${userName}! 👋\nЯ бот погоды.\n\nВыбери город:`,
    { reply_markup: cityMenu }
  );
});

bot.hears(/^📍 /, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '');
  
  console.log(`📍 Город выбран: ${city} для ${userId}`);
  
  if (!sessions[userId]) {
    sessions[userId] = {};
  }
  
  sessions[userId].city = city;
  sessions[userId].awaitingCityInput = false;
  
  await ctx.reply(
    `✅ Город "${city}" сохранён!\n\nЧто хотите сделать?`,
    { reply_markup: mainMenu }
  );
});

bot.hears('✏️ Ввести другой город', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!sessions[userId]) {
    sessions[userId] = {};
  }
  
  sessions[userId].awaitingCityInput = true;
  
  await ctx.reply('📝 Напишите название вашего города:');
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const userId = ctx.from.id;
  const session = sessions[userId];
  const city = session?.city || 'Москва';
  
  console.log(`🌤️ Запрос погоды для ${city} (${userId})`);
  
  await ctx.reply(
    `🌤️ Погода в ${city}:\n\n🌡️ Температура: +20°C\n💨 Ветер: 5 м/с\n💧 Влажность: 65%\n☀️ Состояние: Солнечно\n\nЧто дальше?`,
    { reply_markup: mainMenu }
  );
});

bot.hears('💬 ФРАЗА ДНЯ', async (ctx) => {
  console.log(`💬 Фраза дня запрошена`);
  
  await ctx.reply(
    `💬 *Английская фраза дня*\n\n🇬🇧 **"Where is the nearest metro station?"**\n🇷🇺 **"Где ближайшая станция метро?"**\n\n📖 *Объяснение:* Спрашиваем дорогу к метро\n🏷️ *Категория:* Путешествия\n📊 *Уровень:* Начальный`,
    { parse_mode: 'Markdown', reply_markup: mainMenu }
  );
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', async (ctx) => {
  await ctx.reply('Выберите город:', { reply_markup: cityMenu });
});

bot.hears('ℹ️ ПОМОЩЬ', async (ctx) => {
  await ctx.reply(
    `🆘 *Помощь по боту*\n\n• 🌤️ ПОГОДА СЕЙЧАС - текущая погода\n• 💬 ФРАЗА ДНЯ - английская фраза\n• 🏙️ СМЕНИТЬ ГОРОД - изменить город\n• ℹ️ ПОМОЩЬ - это сообщение\n\nИспользуйте кнопки для навигации!`,
    { parse_mode: 'Markdown', reply_markup: mainMenu }
  );
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  
  console.log(`📨 Сообщение от ${userId}: "${text}"`);
  
  // Пропускаем команды
  if (text.startsWith('/')) return;
  
  // Если ожидаем ввод города
  if (sessions[userId]?.awaitingCityInput) {
    sessions[userId].city = text;
    sessions[userId].awaitingCityInput = false;
    
    await ctx.reply(
      `✅ Город "${text}" сохранён!\n\nЧто хотите сделать?`,
      { reply_markup: mainMenu }
    );
    return;
  }
  
  // Если это не команда и не кнопка
  if (!text.startsWith('📍') && ![
    '🌤️ ПОГОДА СЕЙЧАС', '💬 ФРАЗА ДНЯ', '🏙️ СМЕНИТЬ ГОРОД', 'ℹ️ ПОМОЩЬ',
    '✏️ Ввести другой город'
  ].includes(text)) {
    await ctx.reply('🤔 Используйте кнопки или команду /start', { reply_markup: mainMenu });
  }
});

// Обработчик ошибок
bot.catch((err) => {
  console.error('🔥 Ошибка в обработчике:', err);
});

// ===================== VERCEL HANDLER =====================
export default async function handler(req, res) {
  console.log(`📨 ${req.method} запрос на ${req.url}`);
  
  // Для GET запросов
  if (req.method === 'GET') {
    try {
      // Инициализируем бота для GET запроса (чтобы проверить токен)
      if (!botInitialized) {
        console.log('🔄 Инициализация бота...');
        await bot.init();
        botInitialized = true;
        console.log('✅ Бот инициализирован:', bot.botInfo.username);
      }
      
      return res.status(200).json({
        ok: true,
        message: 'Telegram Weather Bot is running',
        bot: bot.botInfo?.username || 'unknown',
        timestamp: new Date().toISOString(),
        sessionsCount: Object.keys(sessions).length
      });
    } catch (error) {
      console.error('❌ Ошибка инициализации:', error);
      return res.status(500).json({
        ok: false,
        error: error.message,
        hint: 'Проверьте BOT_TOKEN в настройках Vercel'
      });
    }
  }
  
  // Для POST запросов от Telegram
  if (req.method === 'POST') {
    try {
      console.log('🤖 Получено обновление от Telegram');
      
      // Инициализируем бота при первом POST запросе
      if (!botInitialized) {
        console.log('🔄 Инициализация бота для обработки...');
        await bot.init();
        botInitialized = true;
        console.log('✅ Бот готов к работе:', bot.botInfo.username);
      }
      
      // Обрабатываем обновление
      const update = req.body;
      console.log('📦 Update type:', update?.message?.text || 'unknown');
      
      await bot.handleUpdate(update);
      
      console.log('✅ Обновление успешно обработано');
      return res.status(200).json({ ok: true });
      
    } catch (error) {
      console.error('❌ Ошибка обработки обновления:', error);
      return res.status(500).json({
        ok: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
  
  // Метод не поддерживается
  return res.status(405).json({ error: 'Method not allowed' });
}
