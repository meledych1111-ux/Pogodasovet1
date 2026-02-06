import { Bot, Keyboard } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN не установлен');
}

const bot = new Bot(BOT_TOKEN);

// ===================== ИНИЦИАЛИЗАЦИЯ БОТА =====================
let botInitialized = false;

async function initBot() {
  if (botInitialized) return;
  try {
    await bot.init();
    console.log(`✅ Бот инициализирован: @${bot.botInfo.username}`);
    botInitialized = true;
  } catch (e) {
    console.error('❌ Ошибка инициализации:', e);
    throw e;
  }
}

// ===================== API ПОГОДЫ =====================
async function getWeather(cityName) {
  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`
    );
    const geoData = await geo.json();
    
    if (!geoData.results?.[0]) throw new Error('Город не найден');
    
    const { latitude, longitude, name } = geoData.results[0];
    
    const weather = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&wind_speed_unit=ms&timezone=auto`
    );
    const w = await weather.json();
    
    const c = w.current;
    return {
      city: name,
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m.toFixed(1),
      desc: getDesc(c.weather_code)
    };
  } catch (e) {
    console.error('Ошибка погоды:', e);
    return null;
  }
}

function getDesc(code) {
  const map = {
    0: 'Ясно ☀️', 1: 'Ясно 🌤️', 2: 'Облачно ⛅', 3: 'Пасмурно ☁️',
    51: 'Морось 🌧️', 61: 'Дождь 🌧️', 63: 'Дождь 🌧️', 65: 'Ливень 🌧️',
    71: 'Снег ❄️', 73: 'Снег ❄️', 75: 'Снег ❄️', 95: 'Гроза ⛈️'
  };
  return map[code] || 'Погода';
}

// ===================== КЛАВИАТУРЫ =====================
const cityKb = new Keyboard()
  .text('Москва').text('СПб').row()
  .text('Сочи').text('Казань').row()
  .text('🔙 Назад')
  .resized();

const mainKb = new Keyboard()
  .text('🌤 Погода').text('👕 Одежда').row()
  .text('💬 Фраза').text('🏙 Город')
  .resized();

// ===================== КОМАНДЫ =====================
bot.command('start', (ctx) => {
  ctx.reply(
    `Привет! 👋\nВыбери город для прогноза:`,
    { reply_markup: cityKb }
  );
});

bot.hears(['Москва', 'СПб', 'Сочи', 'Казань'], async (ctx) => {
  const cityMap = { 'Москва': 'Москва', 'СПб': 'Санкт-Петербург', 'Сочи': 'Сочи', 'Казань': 'Казань' };
  const city = cityMap[ctx.msg.text];
  
  ctx.session ??= {};
  ctx.session.city = city;
  
  await ctx.reply(`✅ Выбран город: *${city}*\n\nВыбери действие:`, {
    parse_mode: 'Markdown',
    reply_markup: mainKb
  });
});

bot.hears('🔙 Назад', (ctx) => {
  ctx.session ??= {};
  ctx.session.city = null;
  ctx.reply('Выбери город:', { reply_markup: cityKb });
});

bot.hears('🌤 Погода', async (ctx) => {
  ctx.session ??= {};
  const city = ctx.session.city;
  
  if (!city) return ctx.reply('Сначала выбери город!', { reply_markup: cityKb });
  
  await ctx.reply(`Загружаю погоду для ${city}...`);
  
  const w = await getWeather(city);
  if (!w) return ctx.reply('❌ Не удалось получить погоду', { reply_markup: mainKb });
  
  ctx.reply(
    `🌤 *${w.city}*\n\n` +
    `🌡 ${w.temp}°C (ощущается как ${w.feels}°C)\n` +
    `💨 Ветер: ${w.wind} м/с\n` +
    `💧 Влажность: ${w.humidity}%\n` +
    `📝 ${w.desc}`,
    { parse_mode: 'Markdown', reply_markup: mainKb }
  );
});

bot.hears('👕 Одежда', async (ctx) => {
  ctx.session ??= {};
  const city = ctx.session.city;
  
  if (!city) return ctx.reply('Сначала выбери город!', { reply_markup: cityKb });
  
  const w = await getWeather(city);
  if (!w) return ctx.reply('❌ Не удалось получить погоду', { reply_markup: mainKb });
  
  let advice = '';
  if (w.temp >= 25) advice = '🩳 Футболка + шорты + панама';
  else if (w.temp >= 18) advice = '👕 Футболка + джинсы, лёгкая куртка';
  else if (w.temp >= 10) advice = '🧥 Свитер + ветровка, штаны';
  else if (w.temp >= 0) advice = '🧣 Термобельё + куртка, шапка/шарф';
  else advice = '🥶 Пуховик + шапка/шарф/варежки';
  
  if (w.desc.includes('🌧️')) advice += '\n☔ Возьми зонт!';
  if (w.desc.includes('❄️')) advice += '\n❄️ Обувь непромокаемая!';
  
  ctx.reply(
    `👕 *${city}*\n\nСовет: ${advice}`,
    { parse_mode: 'Markdown', reply_markup: mainKb }
  );
});

bot.hears('💬 Фраза', (ctx) => {
  const phrases = [
    'Break the ice — Растопить лёд (начать разговор)',
    'Piece of cake — Проще простого',
    'Under the weather — Неважно себя чувствовать',
    'Costs an arm and a leg — Очень дорого',
    'Once in a blue moon — Очень редко'
  ];
  const phrase = phrases[new Date().getDate() % phrases.length];
  
  ctx.reply(
    `💬 *Фраза дня*\n\n🇬🇧 ${phrase}`,
    { parse_mode: 'Markdown', reply_markup: mainKb }
  );
});

bot.hears('🏙 Город', (ctx) => {
  ctx.session ??= {};
  ctx.session.city = null;
  ctx.reply('Выбери новый город:', { reply_markup: cityKb });
});

// ===================== WEBHOOK =====================
export default async function handler(req, res) {
  // Инициализируем бота при первом запросе
  if (!botInitialized) {
    try {
      await initBot();
    } catch (e) {
      console.error('Не удалось инициализировать бота:', e);
      return res.status(500).json({ error: 'Bot initialization failed' });
    }
  }

  // GET — проверка работоспособности
  if (req.method === 'GET') {
    return res.status(200).json({ 
      ok: true, 
      message: 'Bot is running',
      bot: bot.botInfo?.username || 'unknown'
    });
  }
  
  // POST — обработка вебхука
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('Ошибка обработки:', e);
      return res.status(200).json({ ok: false });
    }
  }
  
  return res.status(405).end();
}
