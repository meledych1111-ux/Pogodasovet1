import pg from 'pg';
const { Pool } = pg;
import crypto from 'crypto';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000
});

const cloudEmojis = ['☁️', '🌤️', '⛅', '🌥️', '🌦️', '🌧️', '⛈️', '🌩️', '❄️', '🌈'];
const cloudNames = ['Облачко', 'Тучка', 'Перистое Облако', 'Кучевое Облако', 'Слоистое Облако', 'Дождевое Облако', 'Грозовое Облако', 'Снежное Облако', 'Серебристое Облако', 'Жемчужное Облако', 'Золотое Облако', 'Лунное Облако', 'Лунная Лаванда', 'Лунный Свет', 'Звёздное Облако', 'Звёздочка', 'Звёздный Дождь', 'Комета', 'Хвостатая Комета', 'Звездопад'];

// Генерирует абсолютно случайное имя (без привязки к ID)
export function generateRandomCloudName() {
    const nameIndex = Math.floor(Math.random() * cloudNames.length);
    const emojiIndex = Math.floor(Math.random() * cloudEmojis.length);
    const suffix = Math.floor(Math.random() * 900) + 100;
    return `${cloudEmojis[emojiIndex]} ${cloudNames[nameIndex]} ${suffix}`;
}

async function query(text, params) {
    return await pool.query(text, params);
}

// РАБОТА С ПИН-КОДАМИ И ПРОФИЛЯМИ
export async function getOrRegisterPin(pinInput) {
    let pin = pinInput;
    if (!pin) {
        pin = Math.floor(100000 + Math.random() * 900000).toString();
    }
    const res = await query('SELECT cloud_name FROM users_pins WHERE pin = $1', [pin]);
    if (res.rows[0]) {
        return { pin, cloudName: res.rows[0].cloud_name };
    } else {
        const newName = generateRandomCloudName();
        await query('INSERT INTO users_pins (pin, cloud_name) VALUES ($1, $2)', [pin, newName]);
        return { pin, cloudName: newName };
    }
}

export async function saveUserCity(cloudName, city) {
    const sql = `INSERT INTO users_cloud (cloud_name, city, last_active) VALUES ($1, $2, NOW()) 
                 ON CONFLICT (cloud_name) DO UPDATE SET city = $2, last_active = NOW()`;
    return await query(sql, [cloudName, city]);
}

export async function getUserCity(cloudName) {
    const res = await query('SELECT city FROM users_cloud WHERE cloud_name = $1', [cloudName]);
    return { success: true, city: res.rows[0]?.city || 'Не указан' };
}

// РАБОТА С ПРОГРЕССОМ (ТЕТРИС)
export async function saveGameProgress(cloudName, gameType, score, level, lines) {
    const sql = `INSERT INTO game_progress (cloud_name, game_type, score, level, lines, updated_at) 
                 VALUES ($1, $2, $3, $4, $5, NOW()) 
                 ON CONFLICT (cloud_name, game_type) DO UPDATE 
                 SET score = $3, level = $4, lines = $5, updated_at = NOW()`;
    return await query(sql, [cloudName, gameType, score, level, lines]);
}

export async function getGameProgress(cloudName, gameType) {
    const res = await query('SELECT * FROM game_progress WHERE cloud_name = $1 AND game_type = $2', [cloudName, gameType]);
    return res.rows[0];
}

export async function deleteGameProgress(cloudName, gameType) {
    return await query('DELETE FROM game_progress WHERE cloud_name = $1 AND game_type = $2', [cloudName, gameType]);
}

// РАБОТА СО СЧЕТОМ И СТАТИСТИКОЙ
export async function saveGameScore(cloudName, gameType, score, level, lines, city) {
    const sql = `INSERT INTO game_scores (cloud_name, game_type, score, level, lines, city, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`;
    return await query(sql, [cloudName, gameType, score, level, lines, city || 'Не указан']);
}

export async function getGameStats(cloudName, gameType) {
    const sql = `SELECT COUNT(*) as games_played, MAX(score) as best_score, MAX(level) as best_level, MAX(lines) as best_lines, AVG(score) as avg_score FROM game_scores WHERE cloud_name = $1 AND game_type = $2`;
    const res = await query(sql, [cloudName, gameType]);
    return res.rows[0];
}

export async function getTopPlayers(gameType, limit = 10) {
    const sql = `SELECT cloud_name as username, MAX(score) as score, MAX(city) as city, MAX(level) as level FROM game_scores WHERE game_type = $1 GROUP BY cloud_name ORDER BY score DESC LIMIT $2`;
    const res = await query(sql, [gameType, limit]);
    return {
        success: true,
        players: res.rows.map((row, index) => ({
            rank: index + 1,
            username: row.username,
            score: row.score,
            level: row.level,
            city: row.city || 'Не указан'
        }))
    };
}

export const initDb = async () => {
    await query(`
        CREATE TABLE IF NOT EXISTS users_pins (pin VARCHAR(10) PRIMARY KEY, cloud_name VARCHAR(100) NOT NULL, created_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE IF NOT EXISTS users_cloud (cloud_name VARCHAR(100) PRIMARY KEY, city VARCHAR(100) DEFAULT 'Не указан', last_active TIMESTAMP DEFAULT NOW());
        CREATE TABLE IF NOT EXISTS game_scores (id SERIAL PRIMARY KEY, cloud_name VARCHAR(100), game_type VARCHAR(50), score INTEGER, level INTEGER, lines INTEGER, city VARCHAR(100), created_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE IF NOT EXISTS game_progress (cloud_name VARCHAR(100), game_type VARCHAR(50), score INTEGER, level INTEGER, lines INTEGER, updated_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (cloud_name, game_type));
    `);
};

initDb().catch(console.error);
export { pool };
