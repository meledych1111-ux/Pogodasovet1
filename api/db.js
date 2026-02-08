import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Создание таблиц
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id BIGINT PRIMARY KEY,
        selected_city VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await client.query(`
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
    `);
    
    console.log('✅ Таблицы созданы или уже существуют');
  } catch (error) {
    console.error('❌ Ошибка при создании таблиц:', error);
  } finally {
    client.release();
  }
}

// Автоматическое создание таблиц
if (process.env.DATABASE_URL) {
  createTables();
}

// Экспортируемые функции
export async function saveUserCity(userId, city) {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO user_sessions (user_id, selected_city) 
      VALUES ($1, $2) 
      ON CONFLICT (user_id) 
      DO UPDATE SET selected_city = $2, updated_at = NOW()
      RETURNING user_id
    `;
    const result = await client.query(query, [userId, city]);
    return result.rows[0]?.user_id;
  } catch (error) {
    console.error('❌ Ошибка сохранения города:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getUserCity(userId) {
  const client = await pool.connect();
  try {
    const query = `
      SELECT selected_city FROM user_sessions 
      WHERE user_id = $1
    `;
    const result = await client.query(query, [userId]);
    return result.rows[0]?.selected_city || null;
  } catch (error) {
    console.error('❌ Ошибка получения города:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function saveGameScore(userId, gameType, score, level, lines) {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO game_scores (user_id, game_type, score, level, lines) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING id
    `;
    const result = await client.query(query, [userId, gameType, score, level, lines]);
    return result.rows[0]?.id;
  } catch (error) {
    console.error('❌ Ошибка сохранения:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getGameStats(userId, gameType = 'tetris') {
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

export async function getTopPlayers(gameType = 'tetris', limit = 10) {
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

export async function checkDatabaseConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() as current_time');
    return { 
      success: true, 
      time: result.rows[0].current_time 
    };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}
