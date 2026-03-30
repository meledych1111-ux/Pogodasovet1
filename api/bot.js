import { Bot, Keyboard, InlineKeyboard, session } from 'grammy';
import dotenv from 'dotenv';
import { pool, getOrRegisterPin, saveUserCity, getUserCity } from './db.js';

dotenv.config();
const bot = new Bot(process.env.BOT_TOKEN || '');

bot.use(session({ initial: () => ({ pin: null, cloudName: null }) }));

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОГОДЫ =====================
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return '—';
  const directions = ['С ⬆️', 'СВ ↗️', 'В ➡️', 'ЮВ ↘️', 'Ю ⬇️', 'ЮЗ ↙️', 'З ⬅️', 'СЗ ↖️'];
  return directions[Math.round(degrees / 45) % 8];
}

function getCloudDescription(cloudPercent) {
  if (cloudPercent < 10) return 'Ясно ☀️';
  if (cloudPercent < 30) return 'Малооблачно 🌤️';
  if (cloudPercent < 50) return 'Переменная облачность ⛅';
  if (cloudPercent < 85) return 'Облачно ☁️';
  return 'Пасмурно ☁️';
}

function calculateDayLength(sunrise, sunset) {
  if (!sunrise || !sunset) return '—';
  const [srh, srm] = sunrise.split(':').map(Number);
  const [ssh, ssm] = sunset.split(':').map(Number);
  let h = ssh - srh; let m = ssm - srm;
  if (m < 0) { h--; m += 60; }
  return `${h} ч ${m} мин`;
}

function getWeatherDescription(code) {
  const weatherMap = {
    0: 'Ясно ☀️', 1: 'В основном ясно 🌤️', 2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️', 51: 'Лёгкая морось 🌧️', 53: 'Морось 🌧️', 55: 'Сильная морось 🌧️',
    61: 'Небольшой дождь 🌧️', 63: 'Дождь 🌧️', 65: 'Сильный дождь 🌧️',
    71: 'Небольшой снег ❄️', 73: 'Снег ❄️', 75: 'Сильный снег ❄️',
    80: 'Ливень 🌧️', 81: 'Сильный ливень 🌧️', 95: 'Гроза ⛈️'
  };
  return weatherMap[code] || `Код: ${code}`;
}

async function getDetailedWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,weather_code,cloud_cover,visibility,rain,snowfall&daily=sunrise,sunset,uv_index_max&wind_speed_unit=ms&timezone=auto&forecast_days=1`;
    const wRes = await fetch(url);
    const wData = await wRes.json();
    const cur = wData.current;
    const daily = wData.daily;

    const sunrise = daily.sunrise[0].substring(11, 16);
    const sunset = daily.sunset[0].substring(11, 16);

    let msg = `📍 *${name}* — сейчас\n───────────────────\n`;
    msg += `🌡️ *Температура:* ${Math.round(cur.temperature_2m)}°C\n`;
    msg += `🤔 *Ощущается как:* ${Math.round(cur.apparent_temperature)}°C\n`;
    msg += `📝 *На улице:* ${getWeatherDescription(cur.weather_code)}\n───────────────────\n`;
    msg += `💨 *Ветер:* ${cur.wind_speed_10m.toFixed(1)} м/с (${getWindDirection(cur.wind_direction_10m)})\n`;
    if (cur.wind_gusts_10m > cur.wind_speed_10m + 2) msg += `🌪️ *Порывы:* ${cur.wind_gusts_10m.toFixed(1)} м/с\n`;
    msg += `📊 *Давление:* ${Math.round(cur.pressure_msl * 0.750062)} мм рт. ст.\n`;
    msg += `💧 *Влажность:* ${cur.relative_humidity_2m}%\n`;
    msg += `☁️ *Облачность:* ${getCloudDescription(cur.cloud_cover)} (${cur.cloud_cover}%)\n`;
    msg += `👁️ *Видимость:* ${(cur.visibility / 1000).toFixed(1)} км\n`;
    msg += `☀️ *УФ-индекс:* ${daily.uv_index_max[0]}\n───────────────────\n`;
    if (cur.rain > 0) msg += `🌧️ *Дождь:* ${cur.rain} мм\n`;
    if (cur.snowfall > 0) msg += `❄️ *Снег:* ${cur.snowfall} см\n`;
    msg += `🌅 Восход: ${sunrise} | 🌇 Закат: ${sunset}\n`;
    msg += `⏱ Длина дня: ${calculateDayLength(sunrise, sunset)}`;
    
    return { success: true, city: name, message: msg, temp: cur.temperature_2m, feels_like: cur.apparent_temperature, description: getWeatherDescription(cur.weather_code), has_rain: cur.rain > 0, has_snow: cur.snowfall > 0, wind_speed: cur.wind_speed_10m };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getDetailedForecast(cityName, dayOffset = 0) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error('Город не найден');
    const { latitude, longitude, name } = geoData.results[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max&wind_speed_unit=ms&timezone=auto&forecast_days=${dayOffset + 1}`;
    const res = await fetch(url);
    const data = await res.json();

    const start = dayOffset * 24;
    const periods = [
      { n: '🌙 Ночь', i: start + 3, e: '🌙' },
      { n: '🌅 Утро', i: start + 9, e: '🌅' },
      { n: '☀️ День', i: start + 15, e: '☀️' },
      { n: '🌆 Вечер', i: start + 21, e: '🌆' }
    ];

    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    let msg = `📅 *Прогноз: ${name}* (${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })})\n───────────────────\n`;
    msg += `📊 Обзор: от ${Math.round(data.daily.temperature_2m_min[dayOffset])}° до ${Math.round(data.daily.temperature_2m_max[dayOffset])}°C\n`;
    if (data.daily.precipitation_sum[dayOffset] > 0) msg += `🌧️ Осадки: ${data.daily.precipitation_sum[dayOffset]} мм\n`;
    if (data.daily.uv_index_max[dayOffset] > 0) msg += `☀️ Макс. УФ-индекс: ${data.daily.uv_index_max[dayOffset]}\n\n`;

    periods.forEach(p => {
      const t = Math.round(data.hourly.temperature_2m[p.i]);
      const f = Math.round(data.hourly.apparent_temperature[p.i]);
      const pr = data.hourly.precipitation_probability[p.i];
      const ws = data.hourly.wind_speed_10m[p.i].toFixed(1);
      msg += `${p.e} *${p.n}:*\n   🌡️ ${t}°C (ощ. ${f}°C)\n   📝 ${getWeatherDescription(data.hourly.weather_code[p.i])}\n   💨 Ветер: ${ws} м/с${pr > 5 ? ` | ☔️ ${pr}%` : ''}\n\n`;
    });

    msg += `───────────────────\n`;
    msg += `🌅 Восход: ${data.daily.sunrise[dayOffset].substring(11, 16)} | 🌇 Закат: ${data.daily.sunset[dayOffset].substring(11, 16)}`;
    return { success: true, message: msg };
  } catch (e) { return { success: false, message: "❌ Ошибка получения прогноза." }; }
}

function getWardrobeAdvice(w) {
  if (!w || !w.success) return '❌ Данные о погоде недоступны.';
  const { temp, feels_like, city, description, has_rain, has_snow, wind_speed } = w;
  const t = feels_like;
  
  let advice = `👕 *Что надеть в ${city} сейчас?*\n`;
  advice += `🌡️ Сейчас: ${Math.round(temp)}°C (ощущается как ${Math.round(t)}°C)\n`;
  advice += `📝 ${description}\n\n📋 *Рекомендации по слоям:*\n`;
  
  if (t >= 25) {
    advice += "☀️ *Верх:* легкая футболка, майка из хлопка\n🩳 *Низ:* шорты, легкие брюки, юбка\n👟 *Обувь:* сандалии, открытые кеды\n🕶️ *Аксессуары:* кепка, солнцезащитные очки";
  } else if (t >= 18) {
    advice += "🌤️ *Верх:* футболка, рубашка с коротким рукавом\n👖 *Низ:* джинсы, легкие брюки\n👟 *Обувь:* кеды, кроссовки\n🧥 *Запас:* легкая кофта на вечер";
  } else if (t >= 12) {
    advice += "🌥️ *Верх:* лонгслив, рубашка + легкая ветровка\n👖 *Низ:* джинсы, чиносы\n👟 *Обувь:* кроссовки, закрытые туфли\n🧣 *Аксессуары:* тонкий шарф";
  } else if (t >= 5) {
    advice += "🧥 *Верх:* теплый свитер + демисезонная куртка\n👖 *Низ:* плотные джинсы или брюки\n🥾 *Обувь:* ботинки, утепленные кроссовки\n🧣 *Аксессуары:* шапка, шарф, перчатки";
  } else if (t >= -5) {
    advice += "🧣 *Верх:* термобелье + свитер + зимняя куртка\n👖 *Низ:* утепленные штаны\n🥾 *Обувь:* зимние ботинки\n🧤 *Аксессуары:* теплая шапка, шарф, варежки";
  } else {
    advice += "❄️ *Верх:* плотное термобелье + флис + теплый пуховик\n👖 *Низ:* термоштаны + утепленные брюки\n🥾 *Обувь:* зимние ботинки на меху\n🧤 *Аксессуары:* шапка-ушанка, плотный шарф, варежки";
  }

  if (has_rain) advice += "\n\n☔️ *Внимание:* Идет дождь, возьмите зонт!";
  if (has_snow) advice += "\n\n☃️ *Внимание:* На улице снег, выбирайте обувь с протектором.";
  if (wind_speed > 8) advice += "\n\n💨 *Ветрено:* Наденьте что-то непродуваемое.";

  return advice;
}

const dailyPhrases = [
  { e: "Where is the nearest bus stop?", r: "Где ближайшая остановка?", c: "Транспорт" },
  { e: "How much is the fare?", r: "Сколько стоит проезд?", c: "Транспорт" },
  { e: "Does this bus go to the city center?", r: "Этот автобус едет в центр города?", c: "Транспорт" },
  { e: "I'd like a window seat, please.", r: "Я хотел бы место у окна.", c: "Транспорт" },
  { e: "Keep the change.", r: "Сдачи не надо.", c: "Транспорт" },
  { e: "A table for two, please.", r: "Столик на двоих, пожалуйста.", c: "Еда" },
  { e: "What's the dish of the day?", r: "Какое сегодня блюдо дня?", c: "Еда" },
  { e: "Everything was delicious, thank you!", r: "Все было очень вкусно, спасибо!", c: "Еда" },
  { e: "Can I try this on?", r: "Можно это примерить?", c: "Покупки" },
  { e: "How much does this cost?", r: "Сколько это стоит?", c: "Покупки" },
  { e: "I'll take it.", r: "Я это возьму.", c: "Покупки" },
  { e: "Nice to meet you!", r: "Приятно познакомиться!", c: "Общение" },
  { e: "Could you repeat that, please?", r: "Не могли бы вы повторить?", c: "Общение" },
  { e: "I need a doctor.", r: "Мне нужен врач.", c: "Здоровье" },
  { e: "Call an ambulance!", r: "Вызовите скорую!", c: "Здоровье" },
  { e: "I'm lost, help me please.", r: "Я заблудился, помогите пожалуйста.", c: "Город" },
  { e: "Where is the restroom?", r: "Где туалет?", c: "Город" },
  { e: "How is it going?", r: "Как дела?", c: "Общение" },
  { e: "I don't understand.", r: "Я не понимаю.", c: "Общение" },
  { e: "Speak slower, please.", r: "Говорите медленнее, пожалуйста.", c: "Общение" },
  { e: "Could you help me?", r: "Вы не могли бы мне помочь?", c: "Общение" },
  { e: "Thank you for your help.", r: "Спасибо за помощь.", c: "Общение" },
  { e: "What time is it?", r: "Который час?", c: "Общение" },
  { e: "Where can I buy a ticket?", r: "Где я могу купить билет?", c: "Транспорт" },
  { e: "The check, please.", r: "Счет, пожалуйста.", c: "Еда" },
  { e: "Do you have any vegetarian dishes?", r: "У вас есть вегетарианские блюда?", c: "Еда" },
  { e: "Is there a pharmacy nearby?", r: "Поблизости есть аптека?", c: "Город" },
  { e: "Can I pay by card?", r: "Можно оплатить картой?", c: "Покупки" },
  { e: "I'm just looking, thanks.", r: "Я просто смотрю, спасибо.", c: "Покупки" },
  { e: "It's too expensive.", r: "Это слишком дорого.", c: "Покупки" }
];

const mainMenuKeyboard = new Keyboard().text('🌤️ ПОГОДА СЕЙЧАС').row().text('📅 СЕГОДНЯ').text('📅 ЗАВТРА').row().text('👕 ЧТО НАДЕТЬ?').row().text('💬 ФРАЗА ДНЯ').text('🎲 СЛУЧАЙНАЯ').row().text('🎮 ИГРАТЬ В ТЕТРИС').row().text('🏙️ СМЕНИТЬ ГОРОД').resized();
const cityKeyboard = new Keyboard().text('📍 МОСКВА').text('📍 САНКТ-ПЕТЕРБУРГ').row().text('📍 СЕВАСТОПОЛЬ').row().text('✏️ ДРУГОЙ ГОРОД').resized();

bot.command('start', async (ctx) => {
  const { pin, cloudName } = await getOrRegisterPin(ctx.session.pin);
  ctx.session.pin = pin;
  ctx.session.cloudName = cloudName;
  const gameUrl = `https://pogodasovet1.vercel.app/game?pin=${pin}`;
  const startInlineKeyboard = new InlineKeyboard().webApp('🎮 ИГРАТЬ В ТЕТРИС', gameUrl);
  let info = `👋 Привет! Твой анонимный ник: *${cloudName}*\n🔑 Твой ПИН-код: \`${pin}\` (сохрани его!)\n\n👇 Выбери город для точных советов:`;
  await ctx.reply(info, { parse_mode: 'Markdown', reply_markup: cityKeyboard });
  await ctx.reply('🕹️ *Тетрис готов!*', { reply_markup: startInlineKeyboard, parse_mode: 'Markdown' });
});

bot.hears('🌤️ ПОГОДА СЕЙЧАС', async (ctx) => {
  if (!ctx.session.cloudName) {
    const { cloudName } = await getOrRegisterPin(ctx.session.pin);
    ctx.session.cloudName = cloudName;
  }
  const res = await getUserCity(ctx.session.cloudName);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(w.message, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
});

bot.hears('📅 СЕГОДНЯ', async (ctx) => {
  if (!ctx.session.cloudName) {
    const { cloudName } = await getOrRegisterPin(ctx.session.pin);
    ctx.session.cloudName = cloudName;
  }
  const res = await getUserCity(ctx.session.cloudName);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const f = await getDetailedForecast(res.city, 0);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('📅 ЗАВТРА', async (ctx) => {
  if (!ctx.session.cloudName) {
    const { cloudName } = await getOrRegisterPin(ctx.session.pin);
    ctx.session.cloudName = cloudName;
  }
  const res = await getUserCity(ctx.session.cloudName);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const f = await getDetailedForecast(res.city, 1);
  await ctx.reply(f.message, { parse_mode: 'Markdown' });
});

bot.hears('👕 ЧТО НАДЕТЬ?', async (ctx) => {
  if (!ctx.session.cloudName) {
    const { cloudName } = await getOrRegisterPin(ctx.session.pin);
    ctx.session.cloudName = cloudName;
  }
  const res = await getUserCity(ctx.session.cloudName);
  if (res.city === 'Не указан') return ctx.reply('Сначала выбери город!', { reply_markup: cityKeyboard });
  const w = await getDetailedWeatherData(res.city);
  await ctx.reply(getWardrobeAdvice(w), { parse_mode: 'Markdown' });
});

bot.hears('💬 ФРАЗА ДНЯ', (ctx) => {
  const p = dailyPhrases[new Date().getDate() % dailyPhrases.length];
  ctx.reply(`💬 *Фраза дня*\n\n🇬🇧 \`${p.e}\`\n🇷🇺 ${p.r}\n\n📂 Категория: ${p.c}`, { parse_mode: 'Markdown' });
});

bot.hears('🎲 СЛУЧАЙНАЯ', (ctx) => {
  const p = dailyPhrases[Math.floor(Math.random() * dailyPhrases.length)];
  ctx.reply(`🎲 \`${p.e}\` — ${p.r}`, { parse_mode: 'Markdown' });
});

bot.hears('🎮 ИГРАТЬ В ТЕТРИС', async (ctx) => {
  if (!ctx.session.pin) {
    const { pin, cloudName } = await getOrRegisterPin();
    ctx.session.pin = pin; ctx.session.cloudName = cloudName;
  }
  const gameUrl = `https://pogodasovet1.vercel.app/game?pin=${ctx.session.pin}`;
  await ctx.reply(`🕹️ *Тетрис*\nНик: *${ctx.session.cloudName}*`, { 
    parse_mode: 'Markdown', 
    reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть Игру', web_app: { url: gameUrl } }]] } 
  });
});

bot.hears('🏙️ СМЕНИТЬ ГОРОД', (ctx) => ctx.reply('Выбери город из списка:', { reply_markup: cityKeyboard }));

bot.hears(/^📍 /, async (ctx) => {
  if (!ctx.session.cloudName) {
    const { cloudName } = await getOrRegisterPin(ctx.session.pin);
    ctx.session.cloudName = cloudName;
  }
  const city = ctx.message.text.replace('📍 ', '').trim();
  await saveUserCity(ctx.session.cloudName, city);
  await ctx.reply(`✅ Город *${city}* успешно установлен!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
});

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  if (!ctx.session.cloudName) {
    const { cloudName } = await getOrRegisterPin(ctx.session.pin);
    ctx.session.cloudName = cloudName;
  }
  const check = await getDetailedWeatherData(ctx.message.text.trim());
  if (check.success) {
    await saveUserCity(ctx.session.cloudName, check.city);
    await ctx.reply(`✅ Город *${check.city}* выбран!`, { reply_markup: mainMenuKeyboard, parse_mode: 'Markdown' });
  } else { ctx.reply('❌ Город не найден. Напиши правильно.', { reply_markup: cityKeyboard }); }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try { if (!bot.isInited()) await bot.init(); await bot.handleUpdate(req.body); } catch (e) { console.error(e); }
    return res.status(200).json({ ok: true });
  }
  return res.status(200).json({ status: 'active' });
}
