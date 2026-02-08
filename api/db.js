import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // Увеличиваем таймауты
  connectionTimeoutMillis: 10000, // 10 секунд вместо 0
  idleTimeoutMillis: 30000,
  max: 20, // Максимальное количество клиентов в пуле
});

console.log('🔧 [DB] Настройки подключения:', {
  hasDatabaseUrl: !!process.env.DATABASE_URL,
  poolSettings: {
    connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
    idleTimeoutMillis: pool.options.idleTimeoutMillis,
    max: pool.options.max
  }
});

// ============ СОЗДАНИЕ ТАБЛИЦ ============
async function createTables() {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ [DB] DATABASE_URL не задан, пропускаем создание таблиц');
    return;
  }
  
  const client = await pool.connect();
  try {
    console.log('📊 [DB] Проверка и создание таблиц...');
    
    // Проверяем подключение
    await client.query('SELECT NOW() as time');
    console.log('✅ [DB] Подключение к БД успешно');
    
    // Таблица пользователей и городов
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        selected_city VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ [DB] Таблица users создана/проверена');
    
    // Таблица финальных результатов игр
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_scores (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
        score INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        lines INTEGER NOT NULL DEFAULT 0,
        game_date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ [DB] Таблица game_scores создана/проверена');
    
    // Таблица статистики игр
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_stats (
        user_id BIGINT NOT NULL,
        game_type VARCHAR(50) DEFAULT 'tetris',
        games_played INTEGER DEFAULT 0,
        total_score BIGINT DEFAULT 0,
        best_score INTEGER DEFAULT 0,
        best_level INTEGER DEFAULT 1,
        best_lines INTEGER DEFAULT 0,
        last_played TIMESTAMP,
        PRIMARY KEY (user_id, game_type)
      )
    `);
    console.log('✅ [DB] Таблица game_stats создана/проверена');
    
    // Создаем индексы для производительности
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_user_id ON game_scores(user_id);
      CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores(score DESC);
      CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
    `);
    console.log('✅ [DB] Индексы созданы/проверены');
    
    console.log('✅ [DB] Все таблицы успешно инициализированы');
    
  } catch (error) {
    console.error('❌ [DB] Ошибка при создании таблиц:', {
      message: error.message,
      code: error.code,
      detail: error.detail
    });
    // Не пробрасываем ошибку дальше, чтобы бот мог работать без БД
  } finally {
    client.release();
  }
}

// Отложенная инициализация БД
let dbInitialized = false;
async function initializeDatabase() {
  if (dbInitialized) return;
  
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ [DB] DATABASE_URL не задан, работа без базы данных');
    dbInitialized = true;
    return;
  }
  
  try {
    console.log('🔄 [DB] Начинаем инициализацию базы данных...');
    await createTables();
    dbInitialized = true;
    console.log('✅ [DB] База данных инициализирована');
  } catch (error) {
    console.error('❌ [DB] Критическая ошибка инициализации БД:', error.message);
    // Продолжаем без БД
    dbInitialized = true;
  }
}

// Инициализируем БД при первом запросе, а не при запуске
let initPromise = null;
async function ensureDatabaseInitialized() {
  if (!initPromise) {
    initPromise = initializeDatabase();
  }
  return initPromise;
}

// ============ ФУНКЦИИ ДЛЯ ГОРОДОВ ============
export async function saveUserCity(userId, city) {
  await ensureDatabaseInitialized();
  
  if (!process.env.DATABASE_URL) {
    console.log(`📍 [DB-FALLBACK] Город сохранен в памяти: ${city} для ${userId}`);
    return true;
  }
  
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO users (user_id, selected_city) 
      VALUES ($1, $2) 
      ON CONFLICT (user_id) 
      DO UPDATE SET selected_city = $2, updated_at = NOW()
      RETURNING user_id
    `;
    const result = await client.query(query, [userId, city]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('❌ [DB] Ошибка сохранения города:', error.message);
    return false;
  } finally {
    client.release();
  }
}

export async function getUserCity(userId) {
  await ensureDatabaseInitialized();
  
  if (!process.env.DATABASE_URL) {
    console.log(`📍 [DB-FALLBACK] Город для ${userId} не найден (нет БД)`);
    return null;
  }
  
  const client = await pool.connect();
  try {
    const query = `SELECT selected_city FROM users WHERE user_id = $1`;
    const result = await client.query(query, [userId]);
    return result.rows.length > 0 ? result.rows[0].selected_city : null;
  } catch (error) {
    console.error('❌ [DB] Ошибка получения города:', error.message);
    return null;
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ ИГР ============
export async function saveGameScore(userId, gameType = 'tetris', score, level, lines) {
  await ensureDatabaseInitialized();
  
  if (!process.env.DATABASE_URL) {
    console.log(`🎮 [DB-FALLBACK] Счет сохранен в памяти: ${score} для ${userId}`);
    return { success: true };
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const saveQuery = `
      INSERT INTO game_scores (user_id, game_type, score, level, lines, game_date)
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
      RETURNING id
    `;
    
    const saveResult = await client.query(saveQuery, [
      userId, gameType, score, level, lines
    ]);
    
    const statsQuery = `
      INSERT INTO game_stats (user_id, game_type, games_played, total_score, 
                              best_score, best_level, best_lines, last_played)
      VALUES ($1, $2, 1, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id, game_type)
      DO UPDATE SET 
        games_played = game_stats.games_played + 1,
        total_score = game_stats.total_score + EXCLUDED.total_score,
        best_score = GREATEST(game_stats.best_score, EXCLUDED.best_score),
        best_level = GREATEST(game_stats.best_level, EXCLUDED.best_level),
        best_lines = GREATEST(game_stats.best_lines, EXCLUDED.best_lines),
        last_played = EXCLUDED.last_played
      RETURNING games_played
    `;
    
    const statsResult = await client.query(statsQuery, [
      userId, gameType, score, score, level, lines
    ]);
    
    await client.query('COMMIT');
    
    return { 
      success: true, 
      gameId: saveResult.rows[0]?.id,
      gamesPlayed: statsResult.rows[0]?.games_played 
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ [DB] Ошибка сохранения счета:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

export async function getGameStats(userId, gameType = 'tetris') {
  await ensureDatabaseInitialized();
  
  if (!process.env.DATABASE_URL) {
    console.log(`📊 [DB-FALLBACK] Статистика для ${userId} не доступна (нет БД)`);
    return {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null
    };
  }
  
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        games_played,
        best_score,
        best_level,
        best_lines,
        CASE 
          WHEN games_played > 0 THEN total_score / games_played 
          ELSE 0 
        END as avg_score,
        last_played
      FROM game_stats 
      WHERE user_id = $1 AND game_type = $2
    `;
    
    const result = await client.query(query, [userId, gameType]);
    
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    
    return {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null
    };
    
  } catch (error) {
    console.error('❌ [DB] Ошибка получения статистики:', error.message);
    return {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null
    };
  } finally {
    client.release();
  }
}

export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  await ensureDatabaseInitialized();
  
  if (!process.env.DATABASE_URL) {
    console.log(`🏆 [DB-FALLBACK] Топ игроков не доступен (нет БД)`);
    return [];
  }
  
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        gs.user_id,
        gs.score,
        gs.level,
        gs.lines,
        gs.created_at as game_time,
        gs.game_date,
        COALESCE(gst.games_played, 1) as games_played
      FROM game_scores gs
      LEFT JOIN game_stats gst ON gs.user_id = gst.user_id AND gs.game_type = gst.game_type
      WHERE gs.game_type = $1
      ORDER BY gs.score DESC, gs.created_at DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    return result.rows;
  } catch (error) {
    console.error('❌ [DB] Ошибка получения топа игроков:', error.message);
    return [];
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection() {
  if (!process.env.DATABASE_URL) {
    return { 
      success: false, 
      error: 'DATABASE_URL не задан',
      time: '0ms' 
    };
  }
  
  const client = await pool.connect();
  try {
    const startTime = Date.now();
    await client.query('SELECT NOW()');
    const endTime = Date.now();
    const time = `${endTime - startTime}ms`;
    
    return { success: true, time };
  } catch (error) {
    console.error('❌ [DB] Ошибка подключения к БД:', error.message);
    return { 
      success: false, 
      error: error.message,
      time: 'error' 
    };
  } finally {
    client.release();
  }
}

// Экспорт пула
export { pool };
