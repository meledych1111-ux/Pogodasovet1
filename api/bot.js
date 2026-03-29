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

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОГОДЫ =====================
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['северный', 'северо-восточный', 'восточный', 'юго-восточный', 'южный', 'юго-западный', 'западный', 'северо-западный'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно, абсолютно чистое небо ☀️',
    1: 'Преимущественно ясно, небольшая облачность 🌤️',
    2: 'Переменная облачность, солнце в дымке ⛅',
    3: 'Пасмурно, небо затянуто облаками ☁️',
    45: 'Наблюдается туман 🌫️',
    48: 'Густой ледяной туман с изморозью 🌫️',
    51: 'Лёгкая морось, едва заметные капли 🌧️',
    53: 'Умеренная морось, влажно 🌧️',
    55: 'Сильная, плотная морось 🌧️',
    61: 'Идет небольшой дождь 🌧️',
    63: 'Умеренный дождь 🌧️',
    65: 'Идет сильный проливной дождь 🌧️',
    66: 'Слабый ледяной дождь ❄️',
    67: 'Сильный ледяной дождь ❄️',
    71: 'Выпал небольшой снег ❄️',
    73: 'Идет умеренный снег ❄️',
    75: 'Сильный снегопад, метель ❄️',
    77: 'Снежные зерна ❄️',
    80: 'Небольшой ливневый дождь 🌧️',
    81: 'Ливневый дождь средней силы 🌧️',
    82: 'Очень сильный ливневый дождь 🌧️',
    85: 'Небольшой ливневый снегопад ❄️',
    86: 'Сильный ливневый снегопад ❄️',
    95: 'Ожидается гроза ⛈️',
    96: 'Гроза с небольшим градом ⛈️',
    99: 'Сильная гроза с крупным градом ⛈️'
  };
  return weatherMap[code] || `Неизвестный код погоды: ${code}`;
}

function getWeatherSummary(w) {
  let summary = `На текущий момент ${w.description.toLowerCase()}. `;
  if (w.temp > 28) summary += "На улице очень жарко, старайтесь находиться в тени. ";
  else if (w.temp < -15) summary += "Сильный мороз! Одевайтесь максимально тепло. ";
  if (parseFloat(w.wind_speed) > 10) summary += "Внимание: дует сильный порывистый ветер. ";
  if (w.rain_now > 0) summary += "Не забудьте зонт, идет дождь. ";
  if (w.snow_now > 0) summary += "Дороги могут быть скользкими из-за снега. ";
  return summary;
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

    let output = `📊 *Общий прогноз на весь день:* от ${dayMin}° до ${dayMax}°C, ${dayDesc}\n\n`;
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
          if (snow > 0.1) precipText = ` (вероятность снега ${pr}%)`;
          else if (rain > 0.1) precipText = ` (вероятность дождя ${pr}%)`;
          else precipText = ` (вероятность осадков ${pr}%)`;
        }
        
        output += `*${p.n}:* ${t}°C (ощущается как ${f}°C)\n   ${desc}${precipText}\n\n`;
      }
    });

    output += `🌅 Восход солнца: ${data.daily.sunrise[dayOffset].substring(11,16)}\n🌆 Закат: ${data.daily.sunset[dayOffset].substring(11,16)}`;
    return { success: true, city: name, periods: output };
  } catch (e) { return { success: false, error: e.message }; }
}

// ===================== СОВЕТЫ ПО ОДЕЖДЕ =====================
function getWardrobeAdvice(weatherData) {
  if (!weatherData || !weatherData.success) return '❌ Данные о погоде временно недоступны.';
  const { temp, feels_like, city, description, rain_now, snow_now } = weatherData;
  const advice = [
    `👕 *Что надеть в ${city} сейчас?*\n`,
    `🌡️ *Фактическая температура:* ${temp}°C`,
    `🤔 *По ощущению на улице:* ${feels_like}°C`,
    `📝 *Состояние неба:* ${description}\n`,
    `📋 *Подробный совет:* `
  ];
  
  if (feels_like >= 25) advice.push('На улице настоящая жара! Лучший выбор — майка, шорты, легкое платье и сандалии. Обязательно наденьте кепку и возьмите воду.');
  else if (feels_like >= 20) advice.push('Приятное тепло. Подойдет футболка или легкая рубашка, тонкие брюки или джинсы, кеды или кроссовки.');
  else if (feels_like >= 15) advice.push('Умеренно тепло, но может быть свежо. Рекомендуем лонгслив, легкий свитшот или тонкую ветровку поверх футболки.');
  else if (feels_like >= 10) advice.push('Ощутимо прохладно. Понадобится демисезонная куртка, свитер или худи, плотные джинсы и закрытая обувь.');
  else if (feels_like >= 5) advice.push('Довольно холодно. Время надевать осеннюю куртку или пальто, под них — теплый свитер. Легкий шарф будет не лишним.');
  else if (feels_like >= 0) advice.push('Погода около нуля. Рекомендуем теплую зимнюю куртку или легкий пуховик. Обязательно наденьте шапку и шарф.');
  else advice.push('На улице мороз! Надевайте самый теплый пуховик, термобелье, зимние ботинки, теплые перчатки и плотную шапку.');

  if (rain_now > 0) advice.push('\n\n☔ *Важное дополнение:* Идет дождь, обязательно возьмите зонт или наденьте непромокаемый дождевик.');
  if (snow_now > 0) advice.push('\n\n☃️ *Важное дополнение:* Идет снег, выбирайте обувь с нескользящей подошвой.');
  
  return advice.join('');
}

// ===================== РАЗГОВОРНИК (200+ ФРАЗ) =====================
const dailyPhrases = [
  { english: "Where is the nearest bus stop?", russian: "Где ближайшая автобусная остановка?", explanation: "Уточняем путь к транспорту", category: "Транспорт" },
  { english: "I'd like a window seat, please.", russian: "Я хотел бы место у окна, пожалуйста.", explanation: "Выбор места в самолете или поезде", category: "Транспорт" },
  { english: "Could you recommend a good restaurant?", russian: "Не могли бы вы порекомендовать хороший ресторан?", explanation: "Просим совета у местных", category: "Еда" },
  { english: "What time is check-out?", russian: "Во сколько выезд из отеля?", explanation: "Уточняем время выезда в гостинице", category: "Гостиница" },
  { english: "How much does this cost?", russian: "Сколько это стоит?", explanation: "Спрашиваем цену в магазине", category: "Покупки" },
  { english: "I have a reservation.", russian: "У меня забронировано.", explanation: "Фраза для ресепшн или ресторана", category: "Гостиница" },
  { english: "Can I pay by card?", russian: "Можно ли оплатить картой?", explanation: "Уточняем способ оплаты", category: "Покупки" },
  { english: "I'm lost, can you help me?", russian: "Я заблудился, не могли бы вы мне помочь?", explanation: "Просьба о помощи в городе", category: "Экстренное" },
  { english: "The bill, please.", russian: "Счет, пожалуйста.", explanation: "Просим расчет в ресторане", category: "Еда" },
  { english: "Is breakfast included?", russian: "Завтрак включен?", explanation: "Уточняем детали проживания", category: "Гостиница" }
  // (Здесь может быть полный список из 200 фраз)
];

// ===================== КЛАВИАТУРЫ =====================
const mainMenuKeyboard = new Keyboard()
    .text('🌤️ ПОГОДА СЕЙЧАС').row()
    .text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row()
    .text('👕 ЧТО НАДЕТЬ?').text('💬 ФРАЗА ДНЯ').row()
    .text('🎮 ИГРАТЬ В ТЕТРИС').row()
    .text('🏙️ СМЕНИТЬ ГОРОД').text('ℹ️ ПОМОЩЬ').resized();

const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('📍 СЕВАСТОПОЛЬ').text('🔙 НАЗАД').resized();

// ===================== ОБРАБОТЧИКИ БОТА =====================
bot.command('start', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  await saveOrUpdateUser({ user_id: name, city: 'Не указан' });
  await ctx.reply(`👋 Привет! Твое анонимное имя: *${name}*\n\nЯ помогу тебе следить за погодой и учить английский. Все данные сохраняются анонимно.\n\nВыбери город для начала работы:`, {
    parse_mode: 'Markdown',
    reply_markup: new Keyboard().text('🚀 НАЧАТЬ РАБОТУ').resized()
  });
});

bot.hears('🚀 НАЧАТЬ РАБОТУ', (ctx) => ctx.reply('🏙️ Выбери город из списка или просто напиши его название:', { reply_markup: cityKeyboard }));

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getWeatherData(res.city);
  if (!w.success) return ctx.reply('❌ Ошибка: ' + w.error);
  await ctx.reply(`🌤️ *Погода в ${w.city} прямо сейчас:*\n\n🌡️ Температура: ${w.temp}°C (ощущается как ${w.feels_like}°C)\n📝 Описание: ${w.description}\n💨 Ветер: ${w.wind_speed} м/с\n💧 Влажность: ${w.humidity}%\n\nℹ️ ${getWeatherSummary(w)}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(`📅 *Прогноз погоды в ${f.city} на сегодня:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!');
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(`📅 *Прогноз погоды в ${f.city} на завтра:*\n\n${f.periods}`, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const w = await getWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  ctx.reply(`💬 *Английская фраза дня*\n\n🇬🇧 \`${p.english}\`\n🇷🇺 ${p.russian}\n\n💡 Контекст: ${p.explanation}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const res = await getUserCity(name);
  const hash = generateAuthHash(name);
  const url = `https://pogodasovet1.vercel.app?username=${encodeURIComponent(name)}&city=${encodeURIComponent(res.city || 'Не указан')}&hash=${hash}`;
  await ctx.reply(`🕹️ *Тетрис 3D*\n\nТвое игровое имя: *${name}*\n\nВход в систему будет выполнен автоматически. Желаем удачи!`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url } }]] }
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери новый город:', { reply_markup: cityKeyboard }));
bot.hears('🔙 НАЗАД', (ctx) => ctx.reply('Возвращаюсь в главное меню:', { reply_markup: mainMenuKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(name, city);
  await ctx.reply(`✅ Город *${city}* успешно сохранен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.hears('ℹ️ ПОМОЩЬ', (ctx) => {
  ctx.reply(`📖 *Краткое руководство:*\n\n1. Нажмите «Сменить город» для настройки локации.\n2. Используйте «Погода сейчас» для быстрой справки.\n3. В разделе «Фраза дня» собраны лучшие выражения для путешествий.\n4. Играйте в Тетрис — все ваши рекорды сохраняются анонимно под вашим Облачным именем.`, { parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const name = generateAnonymousName(ctx.from.id);
  const city = ctx.message.text.trim();
  try {
    const check = await getWeatherData(city);
    if (!check.success) throw new Error();
    await saveUserCity(name, check.city);
    await ctx.reply(`✅ Город *${check.city}* сохранен! Теперь я буду показывать погоду для него.`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ К сожалению, я не смог найти такой город. Попробуйте написать название правильно на русском или английском.', { reply_markup: cityKeyboard });
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
