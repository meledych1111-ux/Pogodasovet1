import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ============ СОЗДАНИЕ ТАБЛИЦ ============
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 🔴 ДОБАВИТЬ ЭТУ ФУНКЦИЮ СРАЗУ ПОСЛЕ ПУЛА
function convertUserIdForDb(userId) {
  const userIdStr = String(userId);
  
  if (userIdStr.startsWith('web_')) {
    return userIdStr; // Web App пользователи - строка
  } else if (/^\d+$/.test(userIdStr)) {
    // Telegram ID - конвертируем в число для bigint
    const num = parseInt(userIdStr);
    return isNaN(num) ? userIdStr : num;
  }
  return userIdStr;
}
async function createTables() {
  const client = await pool.connect();
  try {
    console.log('📊 Создание таблиц...');
    
    // Таблица пользователей и городов
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100),
        selected_city VARCHAR(100),
        user_type VARCHAR(20) DEFAULT 'telegram',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Таблица финальных результатов игр (ВСЕ игры)
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_scores (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        username VARCHAR(100),
        game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
        score INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        lines INTEGER NOT NULL DEFAULT 0,
        is_win BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Таблица прогресса игры (для автосохранения)
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_progress (
        user_id VARCHAR(50) NOT NULL,
        game_type VARCHAR(50) DEFAULT 'tetris',
        score INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        lines INTEGER DEFAULT 0,
        last_saved TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, game_type)
      )
    `);
    
    // Индексы
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_user_type 
      ON game_scores(user_id, game_type)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_score 
      ON game_scores(score DESC)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_game_type_score 
      ON game_scores(game_type, score DESC)
    `);
    
    // Индекс для фильтрации по победам
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_is_win 
      ON game_scores(is_win)
    `);
    
    console.log('✅ Все таблицы созданы или уже существуют');
  } catch (error) {
    console.error('❌ Ошибка при создании таблиц:', error);
    console.error('❌ Stack trace:', error.stack);
  } finally {
    client.release();
  }
}

// Автоматическое создание таблиц
if (process.env.DATABASE_URL) {
  console.log('📊 Инициализация базы данных...');
  createTables().catch(err => {
    console.error('❌ Ошибка при инициализации БД:', err);
  });
}

// ============ ФУНКЦИИ ДЛЯ ГОРОДОВ ============
export async function saveUserCity(userId, city, username = null) {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO user_sessions (user_id, selected_city, username) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        selected_city = $2, 
        username = COALESCE($3, user_sessions.username),
        updated_at = NOW()
      RETURNING user_id
    `;
    const result = await client.query(query, [userId, city, username]);
    console.log(`📍 Город сохранен: ${city} для пользователя ${userId}`);
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
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
  const client = await pool.connect();
  try {
    // 🔴 КОНВЕРТИРУЕМ ID
    const dbUserId = convertUserIdForDb(userId);
    
    console.log(`💾 Сохранение результата: ${score} очков для ${username || userId} (${isWin ? 'победа' : 'проигрыш'})`);
    console.log(`💾 Исходный ID: ${userId}, Конвертированный ID: ${dbUserId}`);
    
    // Сначала сохраняем/обновляем информацию о пользователе
    if (username) {
      await client.query(`
        INSERT INTO user_sessions (user_id, username) 
        VALUES ($1, $2) 
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          username = COALESCE($2, user_sessions.username),
          updated_at = NOW()
      `, [dbUserId, username]); // 🔴 ИСПОЛЬЗУЕМ dbUserId
    }
    
    // Сохраняем результат игры
    const query = `
      INSERT INTO game_scores (user_id, username, game_type, score, level, lines, is_win) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING id
    `;
    const result = await client.query(query, [dbUserId, username, gameType, score, level, lines, isWin]); // 🔴 ИСПОЛЬЗУЕМ dbUserId
    
    const savedId = result.rows[0]?.id;
    console.log(`✅ Результат сохранен (ID: ${savedId}): ${score} очков для ${dbUserId}`);
    
    return savedId;
  } catch (error) {
    console.error('❌ Ошибка сохранения результата:', error);
    console.error('❌ Параметры:', { userId, dbUserId: convertUserIdForDb(userId), gameType, score, username });
    return null;
  } finally {
    client.release();
  }
}

// Функция для сохранения прогресса (автосохранение)

export async function saveGameProgress(userId, gameType, score, level, lines, username = null) {
  const client = await pool.connect();
  try {
    // 🔴 КОНВЕРТИРУЕМ ID
    const dbUserId = convertUserIdForDb(userId);
    
    // Сохраняем информацию о пользователе
    if (username) {
      await client.query(`
        INSERT INTO user_sessions (user_id, username) 
        VALUES ($1, $2) 
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          username = COALESCE($2, user_sessions.username),
          updated_at = NOW()
      `, [dbUserId, username]); // 🔴 ИСПОЛЬЗУЕМ dbUserId
    }
    
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
    const result = await client.query(query, [dbUserId, gameType, score, level, lines]); // 🔴 ИСПОЛЬЗУЕМ dbUserId
    console.log(`💾 Прогресс сохранен: ${score} очков для ${dbUserId}`);
    return result.rows[0]?.user_id;
  } catch (error) {
    console.error('❌ Ошибка сохранения прогресса:', error);
    console.error('❌ Параметры:', { userId, dbUserId: convertUserIdForDb(userId), gameType, score });
    return null;
  } finally {
    client.release();
  }
}
export async function getGameStats(userId, gameType = 'tetris') {
  const client = await pool.connect();
  try {
    // 🔴 КОНВЕРТИРУЕМ ID
    const dbUserId = convertUserIdForDb(userId);
    
    console.log(`📊 Запрос статистики для user_id: ${dbUserId} (original: ${userId}), game_type: ${gameType}`);
    
    // Сначала проверяем, есть ли записи в game_scores
    const checkQuery = await client.query(
      'SELECT COUNT(*) as count FROM game_scores WHERE user_id = $1 AND game_type = $2',
      [dbUserId, gameType] // 🔴 ИСПОЛЬЗУЕМ dbUserId
    );
    
    const hasScores = parseInt(checkQuery.rows[0]?.count) > 0;
    
    if (!hasScores) {
      // Если нет записей в game_scores, проверяем game_progress
      console.log(`📊 Нет записей в game_scores, проверяем game_progress для ${dbUserId}`);
      
      const progressQuery = await client.query(`
        SELECT score, level, lines, last_saved 
        FROM game_progress 
        WHERE user_id = $1 AND game_type = $2
      `, [dbUserId, gameType]); // 🔴 ИСПОЛЬЗУЕМ dbUserId
      
      const progress = progressQuery.rows[0];
      
      if (progress) {
        console.log(`📊 Найден прогресс для ${dbUserId}: ${progress.score} очков`);
        return {
          games_played: 1,
          wins: 1,
          losses: 0,
          win_rate: '100.0',
          best_score: parseInt(progress.score) || 0,
          avg_score: parseInt(progress.score) || 0,
          best_level: parseInt(progress.level) || 1,
          best_lines: parseInt(progress.lines) || 0,
          last_played: progress.last_saved,
          current_progress: {
            score: parseInt(progress.score) || 0,
            level: parseInt(progress.level) || 1,
            lines: parseInt(progress.lines) || 0,
            last_saved: progress.last_saved
          },
          has_unfinished_game: true,
          note: 'Из незавершенной игры'
        };
      } else {
        console.log(`📊 Нет данных ни в game_scores, ни в game_progress для ${dbUserId}`);
        return {
          games_played: 0,
          wins: 0,
          losses: 0,
          win_rate: 0,
          best_score: 0,
          avg_score: 0,
          best_level: 1,
          best_lines: 0,
          last_played: null,
          current_progress: null,
          has_unfinished_game: false,
          note: 'Игрок еще не играл'
        };
      }
    }
    
    // Если есть записи в game_scores, используем их
    const statsQuery = `
      SELECT 
        COUNT(*) as games_played,
        COUNT(CASE WHEN is_win THEN 1 END) as wins,
        COALESCE(MAX(score), 0) as best_score,
        COALESCE(AVG(score), 0) as avg_score,
        COALESCE(MAX(level), 1) as best_level,
        COALESCE(MAX(lines), 0) as best_lines,
        MAX(created_at) as last_played
      FROM game_scores 
      WHERE user_id = $1 AND game_type = $2
    `;
    
    const statsResult = await client.query(statsQuery, [dbUserId, gameType]); // 🔴 ИСПОЛЬЗУЕМ dbUserId
    const stats = statsResult.rows[0] || {
      games_played: 0,
      wins: 0,
      best_score: 0,
      avg_score: 0,
      best_level: 1,
      best_lines: 0,
      last_played: null
    };
    
    // Проверяем, есть ли незавершенная игра в game_progress
    const progressQuery = await client.query(`
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `, [dbUserId, gameType]); // 🔴 ИСПОЛЬЗУЕМ dbUserId
    
    const progress = progressQuery.rows[0];
    
    const result = {
      games_played: parseInt(stats.games_played) || 0,
      wins: parseInt(stats.wins) || 0,
      losses: parseInt(stats.games_played) - parseInt(stats.wins) || 0,
      win_rate: stats.games_played > 0 ? 
        (parseInt(stats.wins) / parseInt(stats.games_played) * 100).toFixed(1) : 0,
      best_score: parseInt(stats.best_score) || 0,
      avg_score: parseFloat(stats.avg_score) || 0,
      best_level: parseInt(stats.best_level) || 1,
      best_lines: parseInt(stats.best_lines) || 0,
      last_played: stats.last_played,
      current_progress: progress ? {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved
      } : null,
      has_unfinished_game: !!progress
    };
    
    console.log(`📊 Статистика получена для ${dbUserId}:`, {
      games: result.games_played,
      wins: result.wins,
      best: result.best_score,
      has_unfinished: result.has_unfinished_game
    });
    
    return result;
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    console.error('❌ Stack trace:', error.stack);
    
    return {
      games_played: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      best_score: 0,
      avg_score: 0,
      best_level: 1,
      best_lines: 0,
      last_played: null,
      current_progress: null,
      has_unfinished_game: false
    };
  } finally {
    client.release();
  }
}

// Удаление прогресса после завершения игры
export async function deleteGameProgress(userId, gameType = 'tetris') {
  const client = await pool.connect();
  try {
    // 🔴 КОНВЕРТИРУЕМ ID
    const dbUserId = convertUserIdForDb(userId);
    
    const query = `
      DELETE FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
      RETURNING user_id
    `;
    const result = await client.query(query, [dbUserId, gameType]); // 🔴 ИСПОЛЬЗУЕМ dbUserId
    console.log(`🗑️ Прогресс удален для пользователя ${dbUserId} (original: ${userId})`);
    return result.rows[0]?.user_id;
  } catch (error) {
    console.error('❌ Ошибка удаления прогресса:', error);
    return null;
  } finally {
    client.release();
  }
}
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  try {
    console.log(`🏆 Запрос топа игроков для: ${gameType}, лимит: ${limit}`);
    
    // УЛУЧШЕННЫЙ ЗАПРОС С ГОРОДОМ
    const query = `
      SELECT 
        gs.user_id,
        -- Имя пользователя
        COALESCE(
          NULLIF(gs.username, ''),  -- Игнорируем пустые строки
          us.username, 
          'Игрок #' || SUBSTRING(gs.user_id from '.{4}$')
        ) as username,
        -- 🔴 ГОРОД ПОЛЬЗОВАТЕЛЯ
        us.selected_city as city,
        -- Статистика игры
        MAX(gs.score) as score,
        MAX(gs.level) as level,
        MAX(gs.lines) as lines,
        COUNT(*) as games_played,
        COUNT(CASE WHEN gs.is_win THEN 1 END) as wins,
        MAX(gs.created_at) as last_played
      FROM game_scores gs
      LEFT JOIN user_sessions us ON gs.user_id = us.user_id
      WHERE gs.game_type = $1 
        AND gs.score > 0  -- Только игры с положительным счетом
      GROUP BY gs.user_id, gs.username, us.username, us.selected_city
      HAVING MAX(gs.score) > 0  -- Игнорируем нулевые результаты
      ORDER BY MAX(gs.score) DESC, wins DESC, games_played DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    console.log(`🏆 Найдено игроков в топе: ${result.rows.length}`);
    
    // Форматируем результат
    return result.rows.map((row, index) => {
      let username = row.username;
      const userIdStr = String(row.user_id || '0000');
      
      // Улучшаем формат username
      if (!username || username === `Игрок #${userIdStr.slice(-4)}`) {
        if (userIdStr.startsWith('web_')) {
          username = `🌐 Web #${userIdStr.slice(-4)}`;
        } else if (userIdStr.startsWith('tg_') || /^\d+$/.test(userIdStr)) {
          username = `👤 Telegram #${userIdStr.slice(-4)}`;
        } else {
          username = `🎮 Игрок #${userIdStr.slice(-4)}`;
        }
      }
      
      return {
        rank: index + 1,
        user_id: row.user_id,
        username: username,
        city: row.city || 'Город не указан', // 🔴 ДОБАВЛЕНО: ГОРОД
        score: parseInt(row.score) || 0,
        level: parseInt(row.level) || 1,
        lines: parseInt(row.lines) || 0,
        games_played: parseInt(row.games_played) || 0,
        wins: parseInt(row.wins) || 0,
        win_rate: row.games_played > 0 ? 
          ((parseInt(row.wins) / parseInt(row.games_played)) * 100).toFixed(1) : '0.0',
        last_played: row.last_played,
        _source: 'game_scores'
      };
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error);
    
    return [];
  } finally {
    client.release();
  }
}
// ============ ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ ============
export async function checkDatabaseConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() as current_time');
    console.log(`✅ Подключение к БД: OK (${result.rows[0].current_time})`);
    return { 
      success: true, 
      time: result.rows[0].current_time,
      message: 'База данных подключена'
    };
  } catch (error) {
    console.error('❌ Ошибка подключения к БД:', error);
    return { 
      success: false, 
      error: error.message,
      message: 'Ошибка подключения к базе данных'
    };
  } finally {
    client.release();
  }
}

// Отладка базы данных
export async function debugDatabase() {
  try {
    console.log('🔍 Отладка базы данных...');
    
    const connection = await checkDatabaseConnection();
    console.log('🔍 Соединение с БД:', connection);
    
    const client = await pool.connect();
    try {
      // Проверяем таблицу game_scores
      const scoresStats = await client.query(`
        SELECT 
          COUNT(*) as total_games,
          COUNT(DISTINCT user_id) as unique_players,
          COALESCE(MAX(score), 0) as max_score,
          COALESCE(AVG(score), 0) as avg_score,
          COUNT(CASE WHEN is_win THEN 1 END) as total_wins
        FROM game_scores 
        WHERE game_type = 'tetris'
      `);
      
      console.log('🔍 Статистика game_scores:', scoresStats.rows[0]);
      
      // Проверяем имена в топе
      const topWithNames = await client.query(`
        SELECT 
          gs.user_id,
          us.username,
          gs.username as game_username,
          MAX(gs.score) as score
        FROM game_scores gs
        LEFT JOIN user_sessions us ON gs.user_id = us.user_id
        WHERE gs.game_type = 'tetris'
        GROUP BY gs.user_id, us.username, gs.username
        ORDER BY MAX(gs.score) DESC 
        LIMIT 5
      `);
      
      console.log('🔍 Топ с именами:', topWithNames.rows);
      
    } finally {
      client.release();
    }
    
    return { success: true };
  } catch (error) {
    console.error('🔍 Ошибка отладки БД:', error);
    return { success: false, error: error.message };
  }
}

// Проверяем таблицы при запуске
if (process.env.NODE_ENV !== 'production') {
  setTimeout(() => {
    debugDatabase().catch(console.error);
  }, 5000);
}

// Экспортируем pool
export { pool };
