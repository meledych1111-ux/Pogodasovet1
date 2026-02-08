// api/db.js
import pg from 'pg';
const { Pool } = pg;

// Создаем пул подключений
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// ===================== СОЗДАНИЕ ТАБЛИЦ =====================
async function createTables() {
  const client = await pool.connect();
  try {
    console.log('📊 Проверяю и создаю таблицы...');
    
    // 1. Таблица пользователей и их городов
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id BIGINT PRIMARY KEY,
        selected_city VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // 2. Таблица счета в играх (основная)
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
    
    // 3. Таблица прогресса игры (для сохранения промежуточных результатов)
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_progress (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
        score INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        lines INTEGER NOT NULL DEFAULT 0,
        last_saved TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, game_type)
      )
    `);
    
    // 4. Создаем индексы для быстрого поиска
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_user_id ON game_scores(user_id);
      CREATE INDEX IF NOT EXISTS idx_game_scores_game_type ON game_scores(game_type);
      CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores(score DESC);
      CREATE INDEX IF NOT EXISTS idx_game_progress_user_game ON game_progress(user_id, game_type);
    `);
    
    console.log('✅ Таблицы созданы или уже существуют');
    
  } catch (error) {
    console.error('❌ Ошибка при создании таблиц:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Автоматическое создание таблиц при наличии DATABASE_URL
if (process.env.DATABASE_URL) {
  createTables().catch(err => {
    console.error('❌ Не удалось создать таблицы:', err.message);
  });
}

// ===================== ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ =====================

// 1. Работа с городами пользователей
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
    console.error('❌ Ошибка сохранения города:', error.message);
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
    console.error('❌ Ошибка получения города:', error.message);
    return null;
  } finally {
    client.release();
  }
}

// 2. Работа с игровыми счетами (финальные результаты)
export async function saveGameScore(userId, gameType, score, level, lines) {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO game_scores (user_id, game_type, score, level, lines) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING id
    `;
    const result = await client.query(query, [userId, gameType, score, level, lines]);
    console.log(`✅ Счет сохранен: user=${userId}, score=${score}, level=${level}`);
    return result.rows[0]?.id;
  } catch (error) {
    console.error('❌ Ошибка сохранения счета:', error.message);
    return null;
  } finally {
    client.release();
  }
}

// 3. Работа с прогрессом игры (сохранение промежуточных результатов)
export async function saveGameProgress(userId, gameType, score, level, lines) {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO game_progress (user_id, game_type, score, level, lines) 
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, game_type) 
      DO UPDATE SET 
        score = EXCLUDED.score,
        level = EXCLUDED.level,
        lines = EXCLUDED.lines,
        last_saved = NOW()
      RETURNING id
    `;
    const result = await client.query(query, [userId, gameType, score, level, lines]);
    console.log(`💾 Прогресс сохранен: user=${userId}, score=${score}`);
    return result.rows[0]?.id;
  } catch (error) {
    console.error('❌ Ошибка сохранения прогресса:', error.message);
    return null;
  } finally {
    client.release();
  }
}

export async function getGameProgress(userId, gameType) {
  const client = await pool.connect();
  try {
    const query = `
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `;
    const result = await client.query(query, [userId, gameType]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('❌ Ошибка получения прогресса:', error.message);
    return null;
  } finally {
    client.release();
  }
}

export async function deleteGameProgress(userId, gameType) {
  const client = await pool.connect();
  try {
    const query = `
      DELETE FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
      RETURNING id
    `;
    const result = await client.query(query, [userId, gameType]);
    console.log(`🗑️ Прогресс удален: user=${userId}, game=${gameType}`);
    return result.rowCount > 0;
  } catch (error) {
    console.error('❌ Ошибка удаления прогресса:', error.message);
    return false;
  } finally {
    client.release();
  }
}

// 4. Статистика игрока
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
        MAX(created_at) as last_played,
        SUM(score) as total_score
      FROM game_scores 
      WHERE user_id = $1 AND game_type = $2
      GROUP BY user_id
    `;
    const result = await client.query(query, [userId, gameType]);
    return result.rows[0] || {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null,
      total_score: 0
    };
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error.message);
    return null;
  } finally {
    client.release();
  }
}

// 5. Топ игроков
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        user_id,
        MAX(score) as score,
        MAX(level) as level,
        MAX(lines) as lines,
        COUNT(*) as games_played,
        MAX(created_at) as last_game
      FROM game_scores 
      WHERE game_type = $1 
      GROUP BY user_id
      ORDER BY MAX(score) DESC
      LIMIT $2
    `;
    const result = await client.query(query, [gameType, limit]);
    return result.rows.map(row => ({
      user_id: row.user_id,
      score: parseInt(row.score) || 0,
      level: parseInt(row.level) || 1,
      lines: parseInt(row.lines) || 0,
      games_played: parseInt(row.games_played) || 1,
      last_game: row.last_game
    }));
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error.message);
    return [];
  } finally {
    client.release();
  }
}

// 6. Проверка подключения к базе данных
export async function checkDatabaseConnection() {
  const client = await pool.connect();
  try {
    const startTime = Date.now();
    const result = await client.query('SELECT NOW() as current_time, version() as db_version');
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    return { 
      success: true, 
      time: result.rows[0].current_time,
      version: result.rows[0].db_version,
      response_time_ms: responseTime,
      message: `База данных подключена (${responseTime}ms)`
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      message: 'Ошибка подключения к базе данных'
    };
  } finally {
    client.release();
  }
}

// 7. Дополнительные функции для диагностики
export async function getDatabaseInfo() {
  const client = await pool.connect();
  try {
    // Получаем информацию о всех таблицах
    const tables = await client.query(`
      SELECT 
        table_name,
        table_type
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    // Получаем количество записей в каждой таблице
    const tablesInfo = [];
    for (const table of tables.rows) {
      try {
        const countResult = await client.query(`SELECT COUNT(*) FROM "${table.table_name}"`);
        tablesInfo.push({
          name: table.table_name,
          type: table.table_type,
          row_count: parseInt(countResult.rows[0]?.count) || 0
        });
      } catch (err) {
        tablesInfo.push({
          name: table.table_name,
          type: table.table_type,
          error: err.message,
          row_count: 0
        });
      }
    }
    
    return {
      success: true,
      tables: tablesInfo,
      total_tables: tablesInfo.length,
      connection_string: process.env.DATABASE_URL ? 'Настроен' : 'Отсутствует'
    };
  } catch (error) {
    console.error('❌ Ошибка получения информации о БД:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

// Экспортируем пул для использования в других файлах
export { pool };
