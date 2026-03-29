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

// Сохранение или обновление пользователя (по анонимному нику)
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

// Сохранение счета игры
export async function saveGameScore(userId, gameType, score, level, lines) {
    const profile = await getUserProfile(userId);
    const sql = `
        INSERT INTO game_scores (user_id, game_type, score, level, lines, city, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())`;
    return await query(sql, [userId, gameType, score, level, lines, profile?.city || 'Не указан']);
}

// Получение статистики игрока
export async function getGameStats(userId, gameType = 'tetris') {
    const sql = `
        SELECT COUNT(*) as games_played, MAX(score) as best_score, 
        MAX(level) as best_level, MAX(lines) as best_lines, AVG(score) as avg_score
        FROM game_scores WHERE user_id = $1 AND game_type = $2`;
    const res = await query(sql, [userId, gameType]);
    const r = res.rows[0];
    return {
        games_played: parseInt(r?.games_played || 0),
        best_score: parseInt(r?.best_score || 0),
        best_level: parseInt(r?.best_level || 0),
        best_lines: parseInt(r?.best_lines || 0),
        avg_score: Math.round(parseFloat(r?.avg_score) || 0)
    };
}

// Топ игроков для Тетриса
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
    const sql = `
        SELECT user_id as username, city, MAX(score) as best_score
        FROM game_scores WHERE game_type = $1 AND score >= 100
        GROUP BY user_id, city ORDER BY best_score DESC LIMIT $2`;
    const res = await query(sql, [gameType, limit]);
    return { success: true, players: res.rows.map((r, i) => ({ 
        rank: i + 1, username: r.username, city: r.city, score: r.best_score 
    })) };
}

// Автоматическая инициализация (на всякий случай)
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
