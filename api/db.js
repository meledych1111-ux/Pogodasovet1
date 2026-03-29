import pg from 'pg';
const { Pool } = pg;
import { URL } from 'url';
import crypto from 'crypto';

// ===================== ГЕНЕРАТОР АНОНИМНЫХ ИМЕН =====================
const cloudEmojis = ['☁️', '🌤️', '⛅', '🌥️', '🌦️', '🌧️', '⛈️', '🌩️', '❄️', '🌈'];
const cloudNames = [
    'Облачко', 'Тучка', 'Перистое Облако', 'Кучевое Облако', 'Слоистое Облако',
    'Дождевое Облако', 'Грозовое Облако', 'Снежное Облако', 'Серебристое Облако',
    'Жемчужное Облако', 'Золотое Облако', 'Лунное Облако', 'Лунная Лаванда', 'Лунный Свет',
    'Звёздное Облако', 'Звёздочка', 'Звёздный Дождь', 'Комета', 'Хвостатая Комета', 'Звездопад',
    'Розовое Облако', 'Лазурное Облако', 'Бирюзовое Облако', 'Солнечное Облако', 'Радужное Облако',
    'Нежное Облако', 'Пушистое Облако', 'Легкое Облако', 'Воздушное Облако', 'Мягкое Облако',
    'Белое Облако', 'Летнее Облако', 'Весеннее Облако', 'Осеннее Облако', 'Зимнее Облако',
    'Утреннее Облако', 'Вечернее Облако', 'Ночное Облако', 'Волшебное Облако', 'Сказочное Облако',
    'Медовое Облако', 'Ванильное Облако', 'Карамельное Облако', 'Мраморное Облако', 'Хрустальное Облако',
    'Алмазное Облако', 'Сияющее Облако', 'Светящееся Облако', 'Мерцающее Облако', 'Атласное Облако'
];

export function generateAnonymousName(userId) {
    const userIdStr = String(userId);
    const hash = crypto.createHash('md5').update(userIdStr).digest('hex');
    const nameIndex = parseInt(hash.substring(0, 8), 16) % cloudNames.length;
    const numberSuffix = parseInt(hash.substring(8, 12), 16) % 100;
    const emojiIndex = parseInt(hash.substring(12, 16), 16) % cloudEmojis.length;
    return `${cloudEmojis[emojiIndex]} ${cloudNames[nameIndex]} ${numberSuffix}`;
}

export function hashPin(pin, salt) {
    return crypto.createHash('sha256').update(pin + salt).digest('hex');
}

// ===================== ПОДКЛЮЧЕНИЕ К БД =====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20, // Увеличено для избежания дедлоков при вложенных запросах
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
});

export function convertUserIdForDb(userId) {
    if (!userId) return null;
    return String(userId).trim(); // СОХРАНЯЕМ ИМЯ ЦЕЛИКОМ!
}

// ===================== ФУНКЦИИ ПОЛЬЗОВАТЕЛЕЙ =====================
export async function saveOrUpdateUser(userData) {
    const { user_id, chat_id = null, city = 'Не указан' } = userData;
    const dbUserId = convertUserIdForDb(user_id);
    const client = await pool.connect();
    try {
        await initDb(client);
        const query = `
            INSERT INTO users (user_id, chat_id, city, last_active) 
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id) DO UPDATE SET 
                city = CASE WHEN EXCLUDED.city != 'Не указан' THEN EXCLUDED.city ELSE users.city END,
                last_active = NOW()
            RETURNING id`;
        const result = await client.query(query, [dbUserId, chat_id, city]);
        return result.rows[0]?.id;
    } finally { client.release(); }
}

export async function getUserProfile(userId) {
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

export async function getTakenLogins() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT login FROM game_auth');
        return result.rows.map(r => r.login);
    } finally { client.release(); }
}

// ===================== ФУНКЦИИ ИГРЫ =====================
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        // Чтобы избежать дедлока при max: 1, здесь лучше использовать тот же client, 
        // но getUserProfile создает свой. С max: 20 это не проблема.
        const profile = await getUserProfile(dbUserId); 
        const displayName = username || dbUserId;
        await client.query(`
            INSERT INTO game_scores (user_id, username, game_type, score, level, lines, is_win, city, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [dbUserId, displayName, gameType, score, level, lines, isWin, profile?.city || 'Не указан']
        );
        return { success: true };
    } finally { client.release(); }
}

export async function getGameStats(userId, gameType = 'tetris') {
    const dbUserId = convertUserIdForDb(userId);
    const client = await pool.connect();
    try {
        const query = `
            SELECT COUNT(*) as games_played, MAX(score) as best_score, 
            MAX(level) as best_level, MAX(lines) as best_lines, AVG(score) as avg_score
            FROM game_scores WHERE user_id = $1 AND game_type = $2`;
        const result = await client.query(query, [dbUserId, gameType]);
        const r = result.rows[0];
        return {
            games_played: parseInt(r?.games_played || 0),
            best_score: parseInt(r?.best_score || 0),
            best_level: parseInt(r?.best_level || 0),
            best_lines: parseInt(r?.best_lines || 0),
            avg_score: Math.round(parseFloat(r?.avg_score) || 0)
        };
    } finally { client.release(); }
}

export async function getTopPlayers(gameType = 'tetris', limit = 10) {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT username, city, MAX(score) as best_score
            FROM game_scores WHERE game_type = $1 AND score >= 100
            GROUP BY user_id, username, city ORDER BY best_score DESC LIMIT $2`, [gameType, limit]);
        return { success: true, players: result.rows.map((r, i) => ({ 
            rank: i + 1, username: r.username, city: r.city, score: r.best_score 
        })) };
    } finally { client.release(); }
}

// ===================== ИНИЦИАЛИЗАЦИЯ =====================
export const initDb = async (passClient = null) => {
    const client = passClient || await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, user_id VARCHAR(100) UNIQUE, chat_id BIGINT, city VARCHAR(100) DEFAULT 'Не указан', last_active TIMESTAMP DEFAULT NOW());
            CREATE TABLE IF NOT EXISTS game_auth (login VARCHAR(100) PRIMARY KEY, pin_hash VARCHAR(255) NOT NULL, salt VARCHAR(100) NOT NULL, last_login TIMESTAMP DEFAULT NOW());
            CREATE TABLE IF NOT EXISTS game_scores (id SERIAL PRIMARY KEY, user_id VARCHAR(100), username VARCHAR(100), game_type VARCHAR(50), score INTEGER, level INTEGER, lines INTEGER, is_win BOOLEAN, city VARCHAR(100), created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE IF NOT EXISTS game_progress (user_id VARCHAR(100), game_type VARCHAR(50), score INTEGER, level INTEGER, lines INTEGER, last_saved TIMESTAMP, PRIMARY KEY(user_id, game_type));
        `);
    } finally { if(!passClient) client.release(); }
};

initDb().catch(e => console.error('SQL Error:', e.message));

export { pool };
