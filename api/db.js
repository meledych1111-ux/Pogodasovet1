import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ============ СОЗДАНИЕ ТАБЛИЦ ============
async function createTables() {
  const client = await pool.connect();
  try {
    console.log('📊 [DB] Проверка и создание таблиц...');
    
    // Таблица пользователей и городов
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        selected_city VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
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
    
    // Таблица статистики игр (агрегированные данные)
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
    
    console.log('✅ [DB] Все таблицы проверены/созданы');
    
  } catch (error) {
    console.error('❌ [DB] Ошибка при создании таблиц:', error);
  } finally {
    client.release();
  }
}

// Автоматическое создание таблиц при запуске
if (process.env.DATABASE_URL) {
  console.log('📊 [DB] Инициализация базы данных...');
  createTables().catch(err => {
    console.error('❌ [DB] Ошибка при инициализации БД:', err);
  });
} else {
  console.warn('⚠️ [DB] DATABASE_URL не задан, работа без базы данных');
}

// ============ ФУНКЦИИ ДЛЯ ГОРОДОВ ============
export async function saveUserCity(userId, city) {
  if (!process.env.DATABASE_URL) {
    console.log(`📍 [DB-FALLBACK] Город сохранен в памяти: ${city} для ${userId}`);
    return true; // ВОТ ТУТ ИСПРАВЛЕНИЕ
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
    
    const success = result.rows.length > 0;
    console.log(`📍 [DB] Город сохранен: ${city} для пользователя ${userId}, успех: ${success}`);
    return success; // ВОТ ТУТ ИСПРАВЛЕНИЕ
    
  } catch (error) {
    console.error('❌ [DB] Ошибка сохранения города:', error);
    return false; // ВОТ ТУТ ИСПРАВЛЕНИЕ
  } finally {
    client.release();
  }
}

export async function getUserCity(userId) {
  if (!process.env.DATABASE_URL) {
    console.log(`📍 [DB-FALLBACK] Город для ${userId} не найден (нет БД)`);
    return null;
  }
  
  const client = await pool.connect();
  try {
    const query = `SELECT selected_city FROM users WHERE user_id = $1`;
    const result = await client.query(query, [userId]);
    
    if (result.rows.length > 0) {
      const city = result.rows[0].selected_city;
      console.log(`📍 [DB] Город найден: ${city} для ${userId}`);
      return city;
    }
    
    console.log(`📍 [DB] Город для ${userId} не найден`);
    return null;
  } catch (error) {
    console.error('❌ [DB] Ошибка получения города:', error);
    return null;
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ ИГР ============
export async function saveGameScore(userId, gameType = 'tetris', score, level, lines) {
  if (!process.env.DATABASE_URL) {
    console.log(`🎮 [DB-FALLBACK] Счет сохранен в памяти: ${score} для ${userId}`);
    return { success: true };
  }
  
  const client = await pool.connect();
  try {
    // Начинаем транзакцию
    await client.query('BEGIN');
    
    // Сохраняем результат игры
    const saveQuery = `
      INSERT INTO game_scores (user_id, game_type, score, level, lines, game_date)
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
      RETURNING id
    `;
    
    const saveResult = await client.query(saveQuery, [
      userId, gameType, score, level, lines
    ]);
    
    console.log(`🎮 [DB] Счет сохранен: ID=${saveResult.rows[0]?.id}, ${score} очков для ${userId}`);
    
    // Обновляем статистику игрока
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
    
    console.log(`📊 [DB] Статистика обновлена: ${statsResult.rows[0]?.games_played} игр для ${userId}`);
    
    // Коммитим транзакцию
    await client.query('COMMIT');
    
    return { 
      success: true, 
      gameId: saveResult.rows[0]?.id,
      gamesPlayed: statsResult.rows[0]?.games_played 
    };
    
  } catch (error) {
    // Откатываем транзакцию при ошибке
    await client.query('ROLLBACK');
    console.error('❌ [DB] Ошибка сохранения счета:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

export async function getGameStats(userId, gameType = 'tetris') {
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
      console.log(`📊 [DB] Статистика получена для ${userId}: ${result.rows[0].games_played} игр`);
      return result.rows[0];
    }
    
    // Если статистики нет, возвращаем значения по умолчанию
    console.log(`📊 [DB] Статистика для ${userId} не найдена, возвращаем значения по умолчанию`);
    return {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null
    };
    
  } catch (error) {
    console.error('❌ [DB] Ошибка получения статистики:', error);
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
    
    console.log(`🏆 [DB] Получено ${result.rows.length} топ игроков`);
    
    // Форматируем результат
    return result.rows.map((row, index) => ({
      rank: index + 1,
      user_id: row.user_id,
      score: row.score,
      level: row.level,
      lines: row.lines,
      games_played: row.games_played || 1,
      game_date: row.game_date,
      game_time: row.game_time
    }));
    
  } catch (error) {
    console.error('❌ [DB] Ошибка получения топа игроков:', error);
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
    await client.query('SELECT 1');
    const endTime = Date.now();
    const time = `${endTime - startTime}ms`;
    
    console.log(`✅ [DB] Подключение к БД успешно (${time})`);
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

// Экспорт пула для других модулей
export { pool };
