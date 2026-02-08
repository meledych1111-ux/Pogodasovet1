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
    // Таблица пользователей и городов
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Таблица прогресса игры (для автосохранения)
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_progress (
        user_id BIGINT NOT NULL,
        game_type VARCHAR(50) DEFAULT 'tetris',
        score INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        lines INTEGER DEFAULT 0,
        last_saved TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, game_type)
      )
    `);
    
    // Создаем индексы для быстрого поиска
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_user_type 
      ON game_scores(user_id, game_type)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_score 
      ON game_scores(score DESC)
    `);
    
    console.log('✅ Все таблицы созданы или уже существуют');
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

// ============ ФУНКЦИИ ДЛЯ ГОРОДОВ ============
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

// ============ ФУНКЦИИ ДЛЯ ИГР ============
export async function saveGameScore(userId, gameType, score, level, lines) {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO game_scores (user_id, game_type, score, level, lines) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING id
    `;
    const result = await client.query(query, [userId, gameType, score, level, lines]);
    console.log(`🎮 Результат сохранен: ${score} очков для пользователя ${userId}`);
    return result.rows[0]?.id;
  } catch (error) {
    console.error('❌ Ошибка сохранения результата:', error);
    return null;
  } finally {
    client.release();
  }
}

// Функция для сохранения прогресса (автосохранение)
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
      RETURNING user_id
    `;
    const result = await client.query(query, [userId, gameType, score, level, lines]);
    console.log(`💾 Прогресс сохранен: ${score} очков`);
    return result.rows[0]?.user_id;
  } catch (error) {
    console.error('❌ Ошибка сохранения прогресса:', error);
    return null;
  } finally {
    client.release();
  }
}

// Получение сохраненного прогресса
export async function getGameProgress(userId, gameType = 'tetris') {
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
    console.error('❌ Ошибка получения прогресса:', error);
    return null;
  } finally {
    client.release();
  }
}

// Удаление прогресса после завершения игры
export async function deleteGameProgress(userId, gameType = 'tetris') {
  const client = await pool.connect();
  try {
    const query = `
      DELETE FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
      RETURNING user_id
    `;
    const result = await client.query(query, [userId, gameType]);
    console.log(`🗑️ Прогресс удален для пользователя ${userId}`);
    return result.rows[0]?.user_id;
  } catch (error) {
    console.error('❌ Ошибка удаления прогресса:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getGameStats(userId, gameType = 'tetris') {
  const client = await pool.connect();
  try {
    // Получаем статистику из сохраненных игр
    const statsQuery = `
      SELECT 
        COALESCE(COUNT(*), 0) as games_played,
        COALESCE(MAX(score), 0) as best_score,
        COALESCE(MAX(level), 1) as best_level,
        COALESCE(MAX(lines), 0) as best_lines,
        COALESCE(AVG(score), 0) as avg_score,
        MAX(created_at) as last_played
      FROM game_scores 
      WHERE user_id = $1 AND game_type = $2
    `;
    const statsResult = await client.query(statsQuery, [userId, gameType]);
    const stats = statsResult.rows[0];
    
    // Получаем текущий прогресс (если есть незавершенная игра)
    const progressQuery = `
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `;
    const progressResult = await client.query(progressQuery, [userId, gameType]);
    const progress = progressResult.rows[0];
    
    // Если есть прогресс, сравниваем с лучшими результатами
    let bestScore = parseInt(stats.best_score) || 0;
    let bestLevel = parseInt(stats.best_level) || 1;
    let bestLines = parseInt(stats.best_lines) || 0;
    
    if (progress) {
      const currentScore = parseInt(progress.score) || 0;
      const currentLevel = parseInt(progress.level) || 1;
      const currentLines = parseInt(progress.lines) || 0;
      
      // Если текущий прогресс лучше, используем его
      if (currentScore > bestScore) bestScore = currentScore;
      if (currentLevel > bestLevel) bestLevel = currentLevel;
      if (currentLines > bestLines) bestLines = currentLines;
    }
    
    return {
      games_played: parseInt(stats.games_played) || 0,
      best_score: bestScore,
      best_level: bestLevel,
      best_lines: bestLines,
      avg_score: parseFloat(stats.avg_score) || 0,
      last_played: stats.last_played,
      current_progress: progress ? {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved
      } : null,
      has_unfinished_game: !!progress
    };
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    return {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null,
      current_progress: null,
      has_unfinished_game: false
    };
  } finally {
    client.release();
  }
}

export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  try {
    console.log(`🏆 Запрос топа игроков для: ${gameType}, лимит: ${limit}`);
    
    // Обновленный запрос с JOIN для получения username (если есть таблица users)
    const query = `
      SELECT 
        gs.user_id,
        COALESCE(MAX(gs.score), 0) as score,
        COALESCE(MAX(gs.level), 1) as level,
        COALESCE(MAX(gs.lines), 0) as lines,
        COUNT(*) as games_played
      FROM game_scores gs
      WHERE gs.game_type = $1 
      GROUP BY gs.user_id
      HAVING COUNT(*) > 0
      ORDER BY MAX(gs.score) DESC, MAX(gs.level) DESC, MAX(gs.lines) DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    console.log(`🏆 Найдено игроков в топе: ${result.rows.length}`);
    
    // Форматируем результат
    return result.rows.map((player, index) => ({
      rank: index + 1,
      user_id: player.user_id,
      score: parseInt(player.score) || 0,
      level: parseInt(player.level) || 1,
      lines: parseInt(player.lines) || 0,
      games_played: parseInt(player.games_played) || 0,
      username: `Игрок #${player.user_id.toString().slice(-4)}` // Последние 4 цифры ID
    }));
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
// Добавьте в db.js после существующих функций:

// Получение статистики с исправлениями
export async function getGameStats(userId, gameType = 'tetris') {
  const client = await pool.connect();
  try {
    console.log(`📊 Запрос статистики для user_id: ${userId}, game_type: ${gameType}`);
    
    // Получаем статистику из сохраненных игр
    const statsQuery = `
      SELECT 
        COUNT(*) as games_played,
        COALESCE(MAX(score), 0) as best_score,
        COALESCE(MAX(level), 1) as best_level,
        COALESCE(MAX(lines), 0) as best_lines,
        COALESCE(AVG(score), 0) as avg_score,
        MAX(created_at) as last_played
      FROM game_scores 
      WHERE user_id = $1 AND game_type = $2
      GROUP BY user_id
    `;
    
    const statsResult = await client.query(statsQuery, [userId, gameType]);
    console.log(`📊 Результат запроса статистики:`, statsResult.rows);
    
    if (statsResult.rows.length === 0) {
      console.log(`📊 Нет данных для user_id: ${userId}`);
      return {
        games_played: 0,
        best_score: 0,
        best_level: 1,
        best_lines: 0,
        avg_score: 0,
        last_played: null
      };
    }
    
    const stats = statsResult.rows[0];
    
    // Получаем текущий прогресс (если есть незавершенная игра)
    const progressQuery = `
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `;
    const progressResult = await client.query(progressQuery, [userId, gameType]);
    const progress = progressResult.rows[0];
    
    console.log(`📊 Прогресс пользователя ${userId}:`, progress);
    
    return {
      games_played: parseInt(stats.games_played) || 0,
      best_score: parseInt(stats.best_score) || 0,
      best_level: parseInt(stats.best_level) || 1,
      best_lines: parseInt(stats.best_lines) || 0,
      avg_score: parseFloat(stats.avg_score) || 0,
      last_played: stats.last_played,
      has_progress: !!progress,
      progress_score: progress ? parseInt(progress.score) : 0,
      progress_level: progress ? parseInt(progress.level) : 1,
      progress_lines: progress ? parseInt(progress.lines) : 0
    };
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    return {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null,
      has_progress: false,
      progress_score: 0,
      progress_level: 1,
      progress_lines: 0
    };
  } finally {
    client.release();
  }
}

// Улучшенная функция получения топа игроков
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  try {
    console.log(`🏆 Запрос топа игроков для: ${gameType}, лимит: ${limit}`);
    
    const query = `
      SELECT 
        user_id,
        COALESCE(MAX(score), 0) as score,
        COALESCE(MAX(level), 1) as level,
        COALESCE(MAX(lines), 0) as lines,
        COUNT(*) as games_played
      FROM game_scores 
      WHERE game_type = $1 
      GROUP BY user_id
      HAVING COUNT(*) > 0
      ORDER BY MAX(score) DESC, MAX(level) DESC, MAX(lines) DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    console.log(`🏆 Найдено игроков в топе: ${result.rows.length}`);
    
    // Форматируем результат
    return result.rows.map((player, index) => ({
      rank: index + 1,
      user_id: player.user_id,
      score: parseInt(player.score) || 0,
      level: parseInt(player.level) || 1,
      lines: parseInt(player.lines) || 0,
      games_played: parseInt(player.games_played) || 0,
      username: `Игрок #${player.user_id}`
    }));
  } catch (error) {
    console.error('❌ Ошибка получения топа:', error);
    return [];
  } finally {
    client.release();
  }
}
