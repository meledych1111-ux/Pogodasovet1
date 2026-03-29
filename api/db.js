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
    return String(userId).trim(); // Теперь логин может быть любым текстом
}

// ===================== ПОДКЛЮЧЕНИЕ К БД =====================
const parseDatabaseUrl = () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return null;
    try {
        const url = new URL(dbUrl);
        let sslConfig = { rejectUnauthorized: false };
        if (url.hostname.includes('neon.tech')) {
            sslConfig = { rejectUnauthorized: true, sslmode: 'require' };
        }
        return {
            connectionString: url.toString(),
            ssl: sslConfig,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 20
        };
    } catch (error) {
        return { connectionString: dbUrl, ssl: { rejectUnauthorized: false } };
    }
};

const poolConfig = parseDatabaseUrl();
const pool = poolConfig ? new Pool(poolConfig) : null;

// ===================== ФУНКЦИИ ПОЛЬЗОВАТЕЛЕЙ =====================
export async function saveOrUpdateUser(userData) {
    if (!pool) return null;
    const { user_id, chat_id = null, city = 'Не указан' } = userData;
    const dbUserId = convertUserIdForDb(user_id);
    if (!dbUserId) return null;

    const anonymousName = generateAnonymousName(dbUserId);
    const client = await pool.connect();
    try {
        const query = `
            INSERT INTO users (user_id, chat_id, username, first_name, city, last_active)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                city = CASE WHEN EXCLUDED.city != 'Не указан' THEN EXCLUDED.city ELSE users.city END,
                last_active = NOW()
            RETURNING id`;
        const result = await client.query(query, [dbUserId, chat_id, anonymousName, anonymousName, city]);
        return result.rows[0]?.id;
    } finally { client.release(); }
}

export async function getUserProfile(userId) {
    if (!pool) return null;
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM users WHERE user_id = $1', [dbUserId]);
        return result.rows[0] || null;
    } finally { client.release(); }
}

export async function saveUserCity(userId, city) {
    return await saveOrUpdateUser({ user_id: userId, city });
}

export async function getUserCity(userId) {
    const profile = await getUserProfile(userId);
    return { success: true, city: profile?.city || 'Не указан', found: !!profile };
}

// ===================== ФУНКЦИИ ИГРЫ =====================
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
    if (!pool) return { success: false };
    const dbUserId = convertUserIdForDb(userId);
    const anonymousName = username || generateAnonymousName(dbUserId);
    const client = await pool.connect();
    try {
        const cityRes = await getUserCity(dbUserId);
        const query = `
            INSERT INTO game_scores (user_id, username, game_type, score, level, lines, is_win, city, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id`;
        const result = await client.query(query, [dbUserId, anonymousName, gameType, score, level, lines, isWin, cityRes.city]);
        return { success: true, id: result.rows[0].id };
    } finally { client.release(); }
}

export async function getGameStats(userId, gameType = 'tetris') {
    if (!pool) return null;
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        const query = `
            SELECT 
                COUNT(*) as games_played, 
                MAX(score) as best_score, 
                AVG(score) as avg_score, 
                MAX(level) as best_level, 
                MAX(lines) as best_lines
            FROM game_scores 
            WHERE user_id = $1 AND game_type = $2 AND score > 0`;
        const result = await client.query(query, [dbUserId, gameType]);
        return result.rows[0];
    } finally { client.release(); }
}

export async function saveGameProgress(userId, gameType, score, level, lines) {
    if (!pool) return { success: false };
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        await client.query(`
            INSERT INTO game_progress (user_id, game_type, score, level, lines, last_saved)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (user_id, game_type) DO UPDATE SET
            score = EXCLUDED.score, level = EXCLUDED.level, lines = EXCLUDED.lines, last_saved = NOW()`,
            [dbUserId, gameType, score, level, lines]);
        return { success: true };
    } finally { client.release(); }
}

export async function getGameProgress(userId, gameType = 'tetris') {
    if (!pool) return { found: false };
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM game_progress WHERE user_id = $1 AND game_type = $2', [dbUserId, gameType]);
        return { success: true, found: result.rows.length > 0, progress: result.rows[0] };
    } finally { client.release(); }
}

export async function deleteGameProgress(userId, gameType = 'tetris') {
    if (!pool) return { success: false };
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        await client.query('DELETE FROM game_progress WHERE user_id = $1 AND game_type = $2', [dbUserId, gameType]);
        return { success: true };
    } finally { client.release(); }
}

export async function getTopPlayers(gameType = 'tetris', limit = 10) {
    if (!pool) return { success: false, players: [] };
    const client = await pool.connect();
    try {
        const query = `
            SELECT username as display_name, city, MAX(score) as best_score
            FROM game_scores WHERE game_type = $1 AND score >= 1000
            GROUP BY user_id, username, city ORDER BY best_score DESC LIMIT $2`;
        const result = await client.query(query, [gameType, limit]);
        return { success: true, players: result.rows };
    } finally { client.release(); }
}

export async function checkDatabaseConnection() {
    if (!pool) return { success: false };
    try {
        const client = await pool.connect();
        client.release();
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
}

// ===================== ИНИЦИАЛИЗАЦИЯ ТАБЛИЦ =====================
if (pool) {
    const initDb = async () => {
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(100) UNIQUE NOT NULL,
                    chat_id BIGINT,
                    username VARCHAR(255),
                    first_name VARCHAR(255),
                    city VARCHAR(100) DEFAULT 'Не указан',
                    created_at TIMESTAMP DEFAULT NOW(),
                    last_active TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS game_auth (
                    login VARCHAR(100) PRIMARY KEY,
                    pin_hash VARCHAR(255) NOT NULL,
                    salt VARCHAR(100) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    last_login TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS game_scores (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(100) NOT NULL,
                    game_type VARCHAR(50) DEFAULT 'tetris',
                    score INTEGER DEFAULT 0,
                    level INTEGER DEFAULT 1,
                    lines INTEGER DEFAULT 0,
                    is_win BOOLEAN DEFAULT TRUE,
                    username VARCHAR(100),
                    city VARCHAR(100) DEFAULT 'Не указан',
                    created_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS game_progress (
                    user_id VARCHAR(100) NOT NULL,
                    game_type VARCHAR(50) DEFAULT 'tetris',
                    score INTEGER DEFAULT 0,
                    level INTEGER DEFAULT 1,
                    lines INTEGER DEFAULT 0,
                    last_saved TIMESTAMP DEFAULT NOW(),
                    PRIMARY KEY (user_id, game_type)
                );
            `);
            console.log('✅ Таблицы базы данных готовы');
        } catch (e) {
            console.error('❌ Ошибка инициализации таблиц:', e.message);
        } finally {
            client.release();
        }
    };
    initDb();
}

export { pool };
