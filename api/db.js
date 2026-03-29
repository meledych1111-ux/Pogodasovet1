import pg from 'pg';
const { Pool } = pg;
import crypto from 'crypto';

const cloudEmojis = ['☁️', '🌤️', '⛅', '🌥️', '🌦️', '🌧️', '⛈️', '🌩️', '❄️', '🌈'];
const cloudNames = ['Облачко', 'Тучка', 'Перистое Облако', 'Кучевое Облако', 'Слоистое Облако', 'Дождевое Облако', 'Грозовое Облако', 'Снежное Облако', 'Серебристое Облако', 'Жемчужное Облако', 'Золотое Облако', 'Лунное Облако', 'Лунная Лаванда', 'Лунный Свет', 'Звёздное Облако', 'Звёздочка', 'Звёздный Дождь', 'Комета', 'Хвостатая Комета', 'Звездопад'];

// Генерация анонимного ника на основе Telegram ID
export function generateAnonymousName(userId) {
    const hash = crypto.createHash('md5').update(String(userId)).digest('hex');
    const nameIndex = parseInt(hash.substring(0, 8), 16) % cloudNames.length;
    const numberSuffix = parseInt(hash.substring(8, 12), 16) % 100;
    const emojiIndex = parseInt(hash.substring(12, 16), 16) % cloudEmojis.length;
    return `${cloudEmojis[emojiIndex]} ${cloudNames[nameIndex]} ${numberSuffix}`;
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000
});

async function query(text, params) {
    return await pool.query(text, params);
}

// Сохранение пользователя (только анонимный ник)
export async function saveOrUpdateUser({ user_id, city }) {
    const sql = `
        INSERT INTO users (user_id, city, last_active) 
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id) DO UPDATE SET 
            city = CASE WHEN EXCLUDED.city != 'Не указан' THEN EXCLUDED.city ELSE users.city END,
            last_active = NOW()`;
    return await query(sql, [user_id, city || 'Не указан']);
}

export async function getUserProfile(userId) {
    const res = await query('SELECT * FROM users WHERE user_id = $1', [userId]);
    return res.rows[0] || null;
}

export async function saveUserCity(userId, city) {
    return await saveOrUpdateUser({ user_id: userId, city });
}

export async function getUserCity(userId) {
    const profile = await getUserProfile(userId);
    return { success: true, city: profile?.city || 'Не указан', found: !!profile };
}

// Сохранение счета игры (без возврата статистики)
export async function saveGameScore(userId, gameType, score, level, lines) {
    const profile = await getUserProfile(userId);
    const sql = `
        INSERT INTO game_scores (user_id, game_type, score, level, lines, city, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())`;
    return await query(sql, [userId, gameType, score, level, lines, profile?.city || 'Не указан']);
}

// Инициализация таблиц
export const initDb = async () => {
    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, 
            user_id VARCHAR(100) UNIQUE, 
            city VARCHAR(100) DEFAULT 'Не указан', 
            last_active TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS game_scores (
            id SERIAL PRIMARY KEY, 
            user_id VARCHAR(100), 
            game_type VARCHAR(50), 
            score INTEGER, 
            level INTEGER, 
            lines INTEGER, 
            city VARCHAR(100), 
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
};

initDb().catch(console.error);
export { pool };
