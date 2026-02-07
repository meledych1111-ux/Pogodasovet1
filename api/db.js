import pg from 'pg';
const { Pool } = pg;

// Создаем пул соединений для Vercel Functions
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Требуется для Neon
  }
});

// ============ ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ============
// Функция для создания таблиц
async function createTables() {
  const client = await pool.connect();
  try {
    // Таблица для сессий пользователей (города)
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
    
    // Таблица для результатов игр
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
    
    // Создаем индексы для производительности
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

// Автоматическое создание таблиц при запуске
(async () => {
  if (process.env.DATABASE_URL) {
    try {
      await createTables();
      console.log('✅ База данных инициализирована');
    } catch (error) {
      console.error('❌ Ошибка инициализации БД:', error.message);
    }
  } else {
    console.warn('⚠️ DATABASE_URL не настроен. База данных не инициализирована.');
  }
})();

// ============ ФУНКЦИИ ДЛЯ РАБОТЫ С ГОРОДАМИ ============
export async function saveUserCity(userId, city) {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL не настроен. Город не сохранен.');
    return false;
  }
  
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO user_sessions (user_id, selected_city)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET selected_city = $2, updated_at = NOW()
    `;
    await client.query(query, [userId, city]);
    console.log(`✅ Город "${city}" сохранен для пользователя ${userId}`);
    return true;
  } catch (error) {
    console.error('❌ Ошибка при сохранении города:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getUserCity(userId) {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL не настроен. Город не получен.');
    return null;
  }
  
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT selected_city FROM user_sessions WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.selected_city || null;
  } catch (error) {
    console.error('❌ Ошибка при получении города:', error);
    return null;
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ РАБОТЫ С ИГРАМИ ============
export async function saveGameScore(userId, gameType, score, level, lines) {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL не настроен. Результат игры не сохранен.');
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
    console.log(`✅ Результат игры сохранен для пользователя ${userId}: ${score} очков`);
    return result.rows[0]?.id;
  } catch (error) {
    console.error('❌ Ошибка при сохранении результатов игры:', error);
    return null;
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ СТАТИСТИКИ ============
export async function getGameStats(userId, gameType = 'tetris') {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL не настроен. Статистика не получена.');
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

export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL не настроен. Топ игроков не получен.');
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
      ORDER BY MAX(score) DESC, MAX(level) DESC, MAX(lines) DESC
      LIMIT $2
    `;
    const result = await client.query(query, [gameType, limit]);
    return result.rows;
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error);
    return [];
  } finally {
    client.release();
  }
}

// ============ ТЕСТОВАЯ ФУНКЦИЯ ============
export async function checkDatabaseConnection() {
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

// Экспортируем pool для тестов
export { pool };
