import { Bot, Keyboard } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN || "ВАШ_ТОКЕН_ЗДЕСЬ";

// Создаем бота
const bot = new Bot(BOT_TOKEN);

// Простое хранилище сессий
const sessions = {};

// Клавиатуры
const mainMenu = new Keyboard()
  .text('🌤️ ПОГОДА').row()
  .text('💬 ФРАЗА').row()
  .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ')
  .resized()
  .oneTime();

const cityMenu = new Keyboard()
  .text('📍 Москва').text('📍 СПб').row()
  .text('📍 Казань').text('📍 Сочи').row()
  .text('✏️ Другой город')
  .resized()
  .oneTime();

// Команда /start
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Друг';
  
  // Инициализируем сессию
  sessions[userId] = { city: 'Москва' };
  
  await ctx.reply(
    `Привет, ${userName}! 👋\nЯ бот погоды.\n\nВыбери город:`,
    { reply_markup: cityMenu }
  );
});

// Выбор города
bot.hears(/^📍 /, async (ctx) => {
  const userId = ctx.from.id;
  const city = ctx.message.text.replace('📍 ', '');
  
  if (sessions[userId]) {
    sessions[userId].city = city;
  }
  
  await ctx.reply(
    `✅ Город ${city} сохранён!\nЧто хотите сделать?`,
    { reply_markup: mainMenu }
  );
});

// Кнопка "Погода"
bot.hears('🌤️ ПОГОДА', async (ctx) => {
  const userId = ctx.from.id;
  const city = sessions[userId]?.city || 'Москва';
  
  await ctx.reply(
    `🌤️ Погода в ${city}:\n\n🌡️ +20°C\n💨 5 м/с\n☀️ Солнечно\n\nЧто дальше?`,
    { reply_markup: mainMenu }
  );
});

// Кнопка "Фраза"
bot.hears('💬 ФРАЗА', async (ctx) => {
  await ctx.reply(
    `💬 Фраза дня:\n\n🇬🇧 "Hello world!"\n🇷🇺 "Привет, мир!"\n\nИспользуется при изучении программирования.`,
    { reply_markup: mainMenu }
  );
});

// Обработчик остальных сообщений
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  
  if (text === '✏️ Другой город') {
    await ctx.reply('Напишите название города:');
    return;
  }
  
  if (text === '🏙️ СМЕНИТЬ ГОРОД') {
    await ctx.reply('Выберите город:', { reply_markup: cityMenu });
    return;
  }
  
  if (text === 'ℹ️ ПОМОЩЬ') {
    await ctx.reply('Это бот погоды. Используйте кнопки!', { reply_markup: mainMenu });
    return;
  }
  
  // Если город написали текстом
  if (!text.startsWith('/') && !text.startsWith('📍')) {
    const userId = ctx.from.id;
    sessions[userId] = { city: text };
    
    await ctx.reply(
      `✅ Город ${text} сохранён! Теперь используйте кнопки.`,
      { reply_markup: mainMenu }
    );
  }
});

// Обработчик ошибок
bot.catch((err) => {
  console.error('Ошибка бота:', err);
});

// Vercel handler
export default async function handler(req, res) {
  console.log('Запрос получен:', req.method, req.url);
  
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'Telegram Bot Webhook',
      timestamp: new Date().toISOString()
    });
  }
  
  if (req.method === 'POST') {
    try {
      console.log('Получен POST от Telegram');
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Ошибка обработки:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}
