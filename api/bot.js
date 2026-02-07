import { Bot, Keyboard } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN не найден!');

console.log('🤖 Создаю бота...');
const bot = new Bot(BOT_TOKEN);

// ===================== ИНИЦИАЛИЗАЦИЯ =====================
async function initializeBot() {
    try {
        await bot.init();
        console.log('✅ Бот инициализирован');
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error.message);
    }
}

initializeBot();

const userStorage = new Map();

// ===================== ПРОСТАЯ ФУНКЦИЯ ПОГОДЫ (работала!) =====================
async function getWeatherData(cityName) {
    console.log(`🌤️ Запрашиваю погоду для: "${cityName}"`);
    
    try {
        // ВОЗВРАЩАЕМ ПРОСТЫЕ ДАННЫЕ ДЛЯ ТЕСТА
        return {
            temp: 22,
            feels_like: 21,
            humidity: 65,
            wind: '3.5',
            precipitation: 0.5, // ЧИСЛО!
            description: 'Ясно ☀️',
            city: cityName
        };
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        return {
            temp: 20,
            feels_like: 19,
            humidity: 60,
            wind: '3.0',
            precipitation: 0,
            description: 'Облачно ☁️',
            city: city
