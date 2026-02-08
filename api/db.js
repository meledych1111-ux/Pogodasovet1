const pg = require('pg');
const { Pool } = pg;

// Создаем пул соединений для Vercel Functions
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ============ ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ============
async function createTables() {
  const client = await pool.connect();
  try {
    const userSessionsQuery = `
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id BIGINT PRIMARY KEY,
        selected_city VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client.query(userSessionsQuery);
    console.log('✅ Таблица user_sessions создана или уже существует');
    
    const gameScoresQuery = `
      CREATE TABLE IF NOT EXISTS game_scores (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
        score INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        lines INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client.query(gameScoresQuery);
    console.log('✅ Таблица game_scores создана или уже существует');
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_user_type 
      ON game_scores(user_id, game_type);
    `);
    console.log('✅ Индекс idx_game_scores_user_type создан');
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_score_desc 
      ON game_scores(score DESC);
    `);
    console.log('✅ Индекс idx_game_scores_score_desc создан');
    
  } catch (error) {
    console.error('❌ Ошибка при создании таблиц:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Автоматическое создание таблиц
if (process.env.DATABASE_URL) {
  (async () => {
    try {
      await createTables();
      console.log('✅ База данных инициализирована');
    } catch (error) {
      console.error('❌ Ошибка инициализации БД:', error.message);
    }
  })();
} else {
  console.warn('⚠️ DATABASE_URL не настроен');
}

// ============ ФУНКЦИИ БАЗЫ ДАННЫХ ============
async function saveGameScore(userId, gameType, score, level, lines) {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL не настроен');
    return null;
  }
  
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO game_scores (user_id, game_type, score, level, lines) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING id
    `;
    const result = await client.query(query, [userId, gameType, score, level, lines]);
    console.log(`✅ Результат сохранен: ${score} очков`);
    return result.rows[0]?.id;
  } catch (error) {
    console.error('❌ Ошибка сохранения:', error);
    return null;
  } finally {
    client.release();
  }
}

async function getGameStats(userId, gameType = 'tetris') {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL не настроен');
    return null;
  }
  
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        COUNT(*) as games_played,
        MAX(score) as best_score,
        MAX(level) as best_level,
        MAX(lines) as best_lines,
        AVG(score) as avg_score,
        MAX(created_at) as last_played
      FROM game_scores 
      WHERE user_id = $1 AND game_type = $2
    `;
    const result = await client.query(query, [userId, gameType]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    return null;
  } finally {
    client.release();
  }
}

async function getTopPlayers(gameType = 'tetris', limit = 10) {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL не настроен');
    return [];
  }
  
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        user_id,
        MAX(score) as score,
        MAX(level) as level,
        MAX(lines) as lines,
        COUNT(*) as games_played
      FROM game_scores 
      WHERE game_type = $1 
      GROUP BY user_id
      ORDER BY MAX(score) DESC
      LIMIT $2
    `;
    const result = await client.query(query, [gameType, limit]);
    return result.rows;
  } catch (error) {
    console.error('❌ Ошибка получения топа:', error);
    return [];
  } finally {
    client.release();
  }
}

async function checkDatabaseConnection() {
  if (!process.env.DATABASE_URL) {
    return { success: false, error: 'DATABASE_URL не настроен' };
  }
  
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() as current_time');
    return { success: true, time: result.rows[0].current_time };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

// Экспорт
module.exports = {
  saveGameScore,
  getGameStats,
  getTopPlayers,
  checkDatabaseConnection,
  pool
};
