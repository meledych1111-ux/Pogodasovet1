import pg from 'pg';
const { Pool } = pg;
import { URL } from 'url';
import crypto from 'crypto';

// ===================== ГЕНЕРАТОР АНОНИМНЫХ ИМЕН =====================
const cloudEmojis = ['☁️', '🌤️', '⛅', '🌥️', '🌦️', '🌧️', '⛈️', '🌩️', '❄️', '🌈'];
const cloudNames = [
    'Облачко', 'Тучка', 'Перистое', 'Кучевое', 'Слоистое', 'Дождевое', 'Грозовое',
    'Пушистое', 'Легкое', 'Воздушное', 'Мягкое', 'Белое', 'Серебристое', 'Жемчужное',
    'Нежное', 'Летнее', 'Весеннее', 'Осеннее', 'Зимнее', 'Утреннее', 'Вечернее',
    'Золотое', 'Розовое', 'Лазурное', 'Солнечное', 'Лунное', 'Звездное'
];

export function generateAnonymousName(userId) {
    const userIdStr = String(userId);
    const hash = crypto.createHash('md5').update(userIdStr).digest('hex');
    const emojiIndex = parseInt(hash.substring(0, 4), 16) % cloudEmojis.length;
    const nameIndex = parseInt(hash.substring(4, 8), 16) % cloudNames.length;
    const numberSuffix = parseInt(hash.substring(8, 12), 16) % 100;

    return `${cloudEmojis[emojiIndex]} ${cloudNames[nameIndex]} ${numberSuffix}`;
}

export function convertUserIdForDb(userId) {
    if (!userId) return null;
    return String(userId).trim();
}

// ===================== ПОДКЛЮЧЕНИЕ К БД (ТОЧЕЧНОЕ ИСПРАВЛЕНИЕ ДЛЯ NEON) =====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1, 
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
});

// ===================== ФУНКЦИИ ПОЛЬЗОВАТЕЛЕЙ =====================
export async function saveOrUpdateUser(userData) {
    const { user_id, telegram_id = null, city = 'Не указан', username = null } = userData;
    const dbUserId = convertUserIdForDb(user_id);
    const client = await pool.connect();
    try {
        const query = `
            INSERT INTO users (user_id, telegram_id, city, last_active)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                telegram_id = COALESCE(EXCLUDED.telegram_id, users.telegram_id),
                city = CASE WHEN EXCLUDED.city != 'Не указан' THEN EXCLUDED.city ELSE users.city END,
                last_active = NOW()
            RETURNING id`;
        const result = await client.query(query, [dbUserId, telegram_id, city]);
        return result.rows[0]?.id;
    } finally { client.release(); }
}

export async function getUserProfile(userId) {
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM users WHERE user_id = $1 OR telegram_id = $1', [dbUserId]);
        return result.rows[0] || null;
    } finally { client.release(); }
}

export async function saveUserCity(userId, city, username) {
    return await saveOrUpdateUser({ user_id: userId, city, username });
}

export async function getUserCity(userId) {
    const profile = await getUserProfile(userId);
    return { success: true, city: profile?.city || 'Не указан', found: !!profile };
}

// ===================== ФУНКЦИИ ИГРЫ =====================
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        const profile = await getUserProfile(dbUserId);
        const displayName = username || profile?.username || generateAnonymousName(dbUserId);
        const query = `
            INSERT INTO game_scores (user_id, username, game_type, score, level, lines, is_win, city, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`;
        await client.query(query, [dbUserId, displayName, gameType, score, level, lines, isWin, profile?.city || 'Не указан']);
        return { success: true };
    } finally { client.release(); }
}

export async function getGameStats(userId, gameType = 'tetris') {
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        const query = `SELECT COUNT(*) as games_played, MAX(score) as best_score, MAX(level) as best_level, MAX(lines) as best_lines FROM game_scores WHERE user_id = $1 AND game_type = $2`;
        const result = await client.query(query, [dbUserId, gameType]);
        const r = result.rows[0];
        return {
            games_played: parseInt(r.games_played || 0),
            best_score: parseInt(r.best_score || 0),
            best_level: parseInt(r.best_level || 0),
            best_lines: parseInt(r.best_lines || 0)
        };
    } finally { client.release(); }
}

export async function getTopPlayers(gameType = 'tetris', limit = 10) {
    const client = await pool.connect();
    try {
        const query = `SELECT username, city, MAX(score) as score FROM game_scores WHERE game_type = $1 GROUP BY user_id, username, city ORDER BY score DESC LIMIT $2`;
        const result = await client.query(query, [gameType, limit]);
        return { success: true, players: result.rows.map((r, i) => ({ rank: i+1, username: r.username, city: r.city, score: r.score })) };
    } finally { client.release(); }
}

// ФУНКЦИИ ПРОГРЕССА (которые ищет бот)
export async function saveGameProgress(userId, gameType, progressData) {
    const client = await pool.connect();
    try {
        await client.query('UPDATE users SET game_data = $1 WHERE user_id = $2', [progressData, convertUserIdForDb(userId)]);
        return { success: true };
    } finally { client.release(); }
}

export async function getGameProgress(userId, gameType) {
    const profile = await getUserProfile(userId);
    return profile?.game_data || null;
}

export async function deleteGameProgress(userId, gameType) {
    const client = await pool.connect();
    try {
        await client.query('UPDATE users SET game_data = \'{}\' WHERE user_id = $1', [convertUserIdForDb(userId)]);
        return { success: true };
    } finally { client.release(); }
}

// ===================== ИНИЦИАЛИЗАЦИЯ БД =====================
export const initDb = async () => {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(100) UNIQUE NOT NULL,
                telegram_id VARCHAR(100) UNIQUE,
                city VARCHAR(100) DEFAULT 'Не указан',
                game_data JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT NOW(),
                last_active TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS game_auth (
                login VARCHAR(100) PRIMARY KEY, pin_hash VARCHAR(255) NOT NULL, salt VARCHAR(100) NOT NULL, last_login TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS game_scores (
                id SERIAL PRIMARY KEY, user_id VARCHAR(100) NOT NULL, game_type VARCHAR(50) DEFAULT 'tetris', score INTEGER DEFAULT 0, level INTEGER DEFAULT 1, lines INTEGER DEFAULT 0, is_win BOOLEAN DEFAULT TRUE, username VARCHAR(100), city VARCHAR(100) DEFAULT 'Не указан', created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        return true;
    } finally { client.release(); }
};

export { pool };
