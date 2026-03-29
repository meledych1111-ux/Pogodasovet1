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

// Генерируем ник. Мы используем его как единственный ключ.
export function generateAnonymousName(id) {
    if (!id) return '❓ Странник';
    const hash = crypto.createHash('md5').update(String(id)).digest('hex');
    const nameIndex = parseInt(hash.substring(0, 8), 16) % cloudNames.length;
    const numberSuffix = parseInt(hash.substring(8, 12), 16) % 100;
    const emojiIndex = parseInt(hash.substring(12, 16), 16) % cloudEmojis.length;
    return `${cloudEmojis[emojiIndex]} ${cloudNames[nameIndex]} ${numberSuffix}`;
}

async function query(text, params) {
    return await pool.query(text, params);
}

// ФУНКЦИИ ДЛЯ БОТА (Адаптированные под Облака)
export async function saveUserCity(cloudName, city) {
    const sql = `
        INSERT INTO users_cloud (cloud_name, city, last_active) 
        VALUES ($1, $2, NOW())
        ON CONFLICT (cloud_name) DO UPDATE SET 
            city = $2,
            last_active = NOW()`;
    return await query(sql, [cloudName, city]);
}

export async function getUserCity(cloudName) {
    const res = await query('SELECT city FROM users_cloud WHERE cloud_name = $1', [cloudName]);
    return { success: true, city: res.rows[0]?.city || 'Не указан' };
}

// Сохранение результата
export async function saveGameScore(cloudName, gameType, score, level, lines, city) {
    const sql = `
        INSERT INTO game_scores (cloud_name, game_type, score, level, lines, city, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())`;
    return await query(sql, [cloudName, gameType, score, level, lines, city || 'Не указан']);
}

// Статистика
export async function getGameStats(cloudName, gameType) {
    const sql = `
        SELECT COUNT(*) as games_played, MAX(score) as best_score, MAX(level) as best_level, MAX(lines) as best_lines, AVG(score) as avg_score
        FROM game_scores WHERE cloud_name = $1 AND game_type = $2`;
    const res = await query(sql, [cloudName, gameType]);
    return res.rows[0];
}

// ТОП игроков
export async function getTopPlayers(gameType, limit = 10) {
    const sql = `
        SELECT cloud_name as username, MAX(score) as score, MAX(city) as city
        FROM game_scores
        WHERE game_type = $1
        GROUP BY cloud_name
        ORDER BY score DESC
        LIMIT $2`;
    const res = await query(sql, [gameType, limit]);
    return {
        success: true,
        players: res.rows.map((row, index) => ({
            rank: index + 1,
            username: row.username,
            score: row.score,
            city: row.city || 'Не указан'
        }))
    };
}

export const initDb = async () => {
    await query(`
        CREATE TABLE IF NOT EXISTS users_cloud (
            cloud_name VARCHAR(100) PRIMARY KEY, 
            city VARCHAR(100) DEFAULT 'Не указан', 
            last_active TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS game_scores (
            id SERIAL PRIMARY KEY, 
            cloud_name VARCHAR(100), 
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
