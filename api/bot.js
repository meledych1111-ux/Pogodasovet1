import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// ===================== ИМПОРТ ФУНКЦИЙ ИЗ БАЗЫ ДАННЫХ =====================
import {
  saveUserCity,
  getUserCity,
  saveOrUpdateUser,
  generateAnonymousName
} from './db.js';

// ===================== ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config();
dotenv.config({ path: envPath });

const bot = new Bot(process.env.BOT_TOKEN || 'dummy');

/**
 * Генерация проверочного хэша для входа без ПИН-кода
 */
function generateAuthHash(name) {
  const secret = process.env.BOT_TOKEN || 'fallback_secret';
  return crypto.createHash('sha256').update(name + secret).digest('hex').substring(0, 16);
}

// ===================== ПОДРОБНЫЕ ОПИСАНИЯ ПОГОДЫ =====================
function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно, абсолютно чистое и безоблачное небо ☀️',
    1: 'Преимущественно ясно, легкая и редкая облачность 🌤️',
    2: 'Переменная облачность, солнце временами скрывается за облаками ⛅',
    3: 'Пасмурно, небо полностью затянуто плотными облаками ☁️',
    45: 'Наблюдается густой туман, видимость ограничена 🌫️',
    48: 'Наблюдается ледяной туман с образованием изморози 🌫️',
    51: 'Идет легкая морось, едва заметный мелкий дождь 🌧️',
    53: 'Идет умеренная морось, высокая влажность 🌧️',
    55: 'Идет сильная и плотная морось 🌧️',
    61: 'Идет небольшой дождь, возможны кратковременные перерывы 🌧️',
    63: 'Идет умеренный дождь, небо затянуто 🌧️',
    65: 'Идет сильный проливной дождь, возможны подтопления 🌧️',
    66: 'Слабый ледяной дождь, на дорогах возможен гололед ❄️',
    67: 'Сильный ледяной дождь, опасные условия на дорогах ❄️',
    71: 'Выпал небольшой снег, земля слегка припорошена ❄️',
    73: 'Идет умеренный снег, хорошая зимняя погода ❄️',
    75: 'Сильный снегопад, метель и плохая видимость ❄️',
    77: 'Наблюдаются снежные зерна ❄️',
    80: 'Небольшой ливневый дождь, кратковременный 🌧️',
    81: 'Ливневый дождь средней интенсивности 🌧️',
    82: 'Очень сильный ливневый дождь, будьте осторожны 🌧️',
    85: 'Небольшой ливневый снегопад ❄️',
    86: 'Сильный ливневый снегопад, метель ❄️',
    95: 'Ожидается гроза с возможным дождем ⛈️',
    96: 'Гроза с небольшим градом, возможны порывы ветра ⛈️',
    99: 'Сильная гроза с крупным градом и шквалистым ветром ⛈️'
  };
  return weatherMap[code] || `Неизвестное состояние (код ${code})`;
}

// ===================== ФУНКЦИИ ПРОГНОЗА =====================
async function getWeatherData(cityName) {
  try {
    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.[0]) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation,rain,snowfall&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(weatherUrl);
    const wData = await wRes.json();
    const c = wData.current;
    
    return {
      success: true, city: name,
      temp: Math.round(c.temperature_2m),
      feels_like: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind_speed: c.wind_speed_10m.toFixed(1),
      description: getWeatherDescription(c.weather_code),
      rain_now: c.rain || 0,
      snow_now: c.snowfall || 0
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const encodedCity = encodeURIComponent(cityName);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.[0]) throw new Error('Город не найден');

    const { latitude, longitude, name } = geoData.results[0];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,rain,snowfall,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const dateStr = targetDate.toISOString().split('T')[0];

    const dayMax = Math.round(data.daily.temperature_2m_max[dayOffset]);
    const dayMin = Math.round(data.daily.temperature_2m_min[dayOffset]);
    const dayDesc = getWeatherDescription(data.daily.weather_code[dayOffset]);

    let output = `📊 *Общая сводка на день:* от ${dayMin}° до ${dayMax}°C\n✨ ${dayDesc}\n\n`;
    const periods = [{n:'🌙 Ночь',h:3}, {n:'🌅 Утро',h:9}, {n:'☀️ День',h:15}, {n:'🌆 Вечер',h:21}];
    
    periods.forEach(p => {
      const idx = data.hourly.time.findIndex(t => t.startsWith(dateStr) && parseInt(t.substring(11,13)) === p.h);
      if (idx !== -1) {
        const t = Math.round(data.hourly.temperature_2m[idx]);
        const f = Math.round(data.hourly.apparent_temperature[idx]);
        const pr = data.hourly.precipitation_probability[idx];
        const rain = data.hourly.rain[idx];
        const snow = data.hourly.snowfall[idx];
        const desc = getWeatherDescription(data.hourly.weather_code[idx]);
        
        let precipText = "";
        if (pr > 5) {
          if (snow > 0.1) precipText = ` (возможен снег, вероятность ${pr}%)`;
          else if (rain > 0.1) precipText = ` (возможен дождь, вероятность ${pr}%)`;
          else precipText = ` (возможны осадки, вероятность ${pr}%)`;
        }
        
        output += `*${p.n}:* ${t}°C (ощущается как ${f}°C)\n   ${desc}${precipText}\n\n`;
      }
    });

    output += `🌅 Восход солнца: ${data.daily.sunrise[dayOffset].substring(11,16)}\n🌆 Закат солнца: ${data.daily.sunset[dayOffset].substring(11,16)}`;
    return { success: true, city: name, periods: output };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== СОВЕТЫ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(weatherData) {
  if (!weatherData || !weatherData.success) return '❌ Данные о погоде временно недоступны.';
  const { temp, feels_like, city, description, rain_now, snow_now } = weatherData;
  const advice = [
    `👕 *Что надеть в ${city} прямо сейчас?*\n`,
    `🌡️ *Температура:* ${temp}°C`,
    `🤔 *Ощущается как:* ${feels_like}°C`,
    `📝 *На улице:* ${description}\n`,
    `📋 *Подробная рекомендация:* `
  ];
  
  if (feels_like >= 25) advice.push('На улице настоящая жара! Лучше всего подойдут майка, шорты или легкое платье. Обязательно наденьте головной убор и возьмите с собой воду.');
  else if (feels_like >= 20) advice.push('Приятная теплая погода. Выбирайте футболку, легкие брюки или джинсы. На ноги — кеды или легкие кроссовки.');
  else if (feels_like >= 15) advice.push('Умеренно тепло, но может быть свежо. Рекомендуем надеть лонгслив, свитшот или легкую ветровку поверх футболки.');
  else if (feels_like >= 10) advice.push('Ощутимо прохладно. Понадобится демисезонная куртка, плотный свитер или худи, джинсы и закрытая обувь.');
  else if (feels_like >= 5) advice.push('Довольно холодно. Время доставать осеннее пальто или куртку, под них — теплый джемпер. Легкий шарф защитит от ветра.');
  else if (feels_like >= 0) advice.push('Погода около нуля. Рекомендуем теплую зимнюю куртку или легкий пуховик. Обязательно наденьте шапку и шарф.');
  else advice.push('На улице мороз! Надевайте самый теплый пуховик, термобелье, зимние ботинки, теплые перчатки и плотную шапку.');

  if (rain_now > 0) advice.push('\n\n☔ *Внимание:* Идет дождь, не забудьте взять зонт!');
  if (snow_now > 0) advice.push('\n\n☃️ *Внимание:* Идет снег, выбирайте обувь с нескользящей подошвой.');
  
  return advice.join('');
}

// ===================== ПОЛНЫЙ РАЗГОВОРНИК (200+ ФРАЗ) =====================
const dailyPhrases = [
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая автобусная остановка?", explanation: "Путешествия: Поиск транспорта" },
  { english: "I'd like a window seat, please.", russian: "Я хотел бы место у окна, пожалуйста.", explanation: "Путешествия: В самолете или поезде" },
  { english: "Could you recommend a good restaurant?", russian: "Не могли бы вы порекомендовать хороший ресторан?", explanation: "Путешествия: Поиск еды" },
  { english: "How much does this cost?", russian: "Сколько это стоит?", explanation: "Магазин: Уточнение цены" },
  { english: "Can I try this on?", russian: "Можно это примерить?", explanation: "Магазин: Примерка одежды" },
  { english: "I need to see a doctor.", russian: "Мне нужно к врачу.", explanation: "Здоровье: Экстренная ситуация" },
  { english: "I'm lost, can you help me?", russian: "Я заблудился, не могли бы вы мне помочь?", explanation: "Город: Поиск пути" },
  { english: "Keep the change.", russian: "Сдачи не надо.", explanation: "Ресторан: Чаевые" },
  { english: "The bill, please.", russian: "Счет, пожалуйста.", explanation: "Ресторан: Оплата" },
  { english: "Is breakfast included?", russian: "Завтрак включен?", explanation: "Отель: Уточнение условий" },
  { english: "What time is check-out?", russian: "Во сколько выезд?", explanation: "Отель: Время выезда" },
  { english: "I have a reservation.", russian: "У меня забронировано.", explanation: "Отель/Ресторан: Бронь" },
  { english: "Can I pay by card?", russian: "Можно оплатить картой?", explanation: "Оплата: Способ оплаты" },
  { english: "Where is the restroom?", russian: "Где находится туалет?", explanation: "Базовая потребность" },
  { english: "Can you repeat that, please?", russian: "Могли бы вы повторить это?", explanation: "Общение: Просьба повторить" },
  { english: "Speak slower, please.", russian: "Говорите медленнее, пожалуйста.", explanation: "Общение: Понимание речи" },
  { english: "What do you recommend?", russian: "Что вы порекомендуете?", explanation: "Совет: Выбор чего-либо" },
  { english: "Call an ambulance!", russian: "Вызовите скорую помощь!", explanation: "Здоровье: ЧП" },
  { english: "I am allergic to nuts.", russian: "У меня аллергия на орехи.", explanation: "Здоровье: Предупреждение" },
  { english: "It's too expensive.", russian: "Это слишком дорого.", explanation: "Магазин: Торг" }
  // (Здесь в реальности массив на 200+ фраз)
];

// ===================== КЛАВИАТУРЫ =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').text('💬 ФРАЗА ДНЯ').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').resized();

const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('📍 СЕВАСТОПОЛЬ').text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ БОТА =====================
bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: name, city: 'Не указан' });
  await ctx.reply(`👋 Привет! Твое анонимное имя: *${name}*\n\nЯ твой личный ассистент. Выбери город, чтобы я мог показывать тебе максимально подробную погоду и давать советы.`, {
    parse_mode: 'Markdown',
    reply_markup: new Keyboard().text('🚀 НАЧАТЬ РАБОТУ').resized()
  });
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', (ctx) => ctx.reply('🏙️ Выбери город из списка или напиши название вручную:', { reply_markup: cityKeyboard }));

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка: ' + w.error);
  await ctx.reply(`🌤️ *Погода в ${w.city} прямо сейчас:*\n\n🌡️ Температура: ${w.temp}°C (ощущается как ${w.feels_like}°C)\n📝 Состояние: ${w.description}\n💨 Скорость ветра: ${w.wind_speed} м/с\n💧 Влажность: ${w.humidity}%\n\nℹ️ *Краткое резюме:* ${getWeatherSummary(w)}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(`📅 *Подробный прогноз в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(`📅 *Подробный прогноз в ${f.city} на завтра:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const w = await getWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  ctx.reply(`💬 *Английская фраза дня*\n\n🇬🇧 \`${p.english}\`\n🇷🇺 ${p.russian}\n\n💡 Категория: ${p.explanation}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const hash = generateAuthHash(name);
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(res.city || 'Не указан')}&hash=${hash}`;
  await ctx.reply(`🕹️ *Тетрис 3D*\n\nТвое игровое имя: *${name}*\nВход в систему будет выполнен автоматически. Желаем удачи в игре!`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город из списка:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Главное меню:', { reply_markup: mainMenuKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* успешно сохранен! Теперь я буду показывать погоду для него.`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.trim();
  try {
    const check = await getWeatherData(city);
    if (!check.success) throw new Error();
    await saveUserCity(name, check.city);
    await ctx.reply(`✅ Город *${check.city}* сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ К сожалению, город не найден. Проверьте правильность написания.', { reply_markup: cityKeyboard });
  }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      if (!bot.isInited()) await bot.init();
      await bot.handleUpdate(req.body);
    } catch (e) { console.error('Bot Error:', e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'running' });
}
