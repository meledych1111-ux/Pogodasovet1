import pg from 'pg';
const { Pool } = pg;
import crypto from 'crypto';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { 
        // На Vercel/Render/Supabase обычно требуется false для самоподписанных сертификатов,
        // но SSL всё равно будет шифровать данные.
        rejectUnauthorized: false 
    },
    max: 10,
    idleTimeoutMillis: 30000
});

const cloudEmojis = ['☁️', '🌤️', '⛅', '🌥️', '🌦️', '🌧️', '⛈️', '🌩️', '❄️', '🌈'];
const cloudNames = ['Облачко', 'Тучка', 'Перистое Облако', 'Кучевое Облако', 'Слоистое Облако', 'Дождевое Облако', 'Грозовое Облако', 'Снежное Облако', 'Серебристое Облако', 'Жемчужное Облако', 'Золотое Облако', 'Лунное Облако', 'Лунная Лаванда', 'Лунный Свет', 'Звёздное Облако', 'Звёздочка', 'Звёздный Дождь', 'Комета', 'Хвостатая Комета', 'Звездопад'];

export function generateRandomCloudName() {
    const nameIndex = Math.floor(Math.random() * cloudNames.length);
    const emojiIndex = Math.floor(Math.random() * cloudEmojis.length);
    const suffix = Math.floor(Math.random() * 900) + 100;
    return `${cloudEmojis[emojiIndex]} ${cloudNames[nameIndex]} ${suffix}`;
}

async function query(text, params) {
    return await pool.query(text, params);
}

// ОЧИСТКА СТАРЫХ АККАУНТОВ (старше 1 года)
async function cleanupOldAccounts() {
    try {
        await query("DELETE FROM users_pins WHERE last_active < NOW() - INTERVAL '1 year'");
        await query("DELETE FROM users_cloud WHERE last_active < NOW() - INTERVAL '1 year'");
        await query("DELETE FROM game_progress WHERE updated_at < NOW() - INTERVAL '1 year'");
        console.log('🧹 База данных очищена от аккаунтов старше 1 year');
    } catch (e) {
        console.error('❌ Ошибка при очистке базы:', e);
    }
}

// РАБОТА С ПИН-КОДАМИ
export async function getOrRegisterPin(pinInput) {
    let pin = pinInput;
    if (!pin) {
        pin = Math.floor(100000 + Math.random() * 900000).toString();
    }
    
    const res = await query(
        'UPDATE users_pins SET last_active = NOW() WHERE pin = $1 RETURNING cloud_name', 
        [pin]
    );
    
    if (res.rows[0]) {
        return { pin, cloudName: res.rows[0].cloud_name };
    } else {
        const newName = generateRandomCloudName();
        await query(
            'INSERT INTO users_pins (pin, cloud_name, last_active) VALUES ($1, $2, NOW()) ON CONFLICT (pin) DO NOTHING', 
            [pin, newName]
        );
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
        CREATE TABLE IF NOT EXISTS users_pins (pin VARCHAR(10) PRIMARY KEY, cloud_name VARCHAR(100) NOT NULL, last_active TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE IF NOT EXISTS users_cloud (cloud_name VARCHAR(100) PRIMARY KEY, city VARCHAR(100) DEFAULT 'Не указан', last_active TIMESTAMP DEFAULT NOW());
        CREATE TABLE IF NOT EXISTS game_scores (id SERIAL PRIMARY KEY, cloud_name VARCHAR(100), game_type VARCHAR(50), score INTEGER, level INTEGER, lines INTEGER, city VARCHAR(100), created_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE IF NOT EXISTS game_progress (cloud_name VARCHAR(100), game_type VARCHAR(50), score INTEGER, level INTEGER, lines INTEGER, updated_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (cloud_name, game_type));
    `);
    cleanupOldAccounts().catch(console.error);
};

initDb().catch(console.error);
export { pool };
