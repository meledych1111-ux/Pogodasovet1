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
    console.log('📊 Создание таблиц...');
    
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
    
    // Индекс для топ игроков
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_game_type_score 
      ON game_scores(game_type, score DESC)
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
export async function saveGameScore(userId, gameType, score, level, lines) {
  const client = await pool.connect();
  try {
    console.log(`💾💾💾 ВЫЗОВ saveGameScore с параметрами:`, {
      userId, gameType, score, level, lines
    });
    
    // ПРОВЕРКА ПОДКЛЮЧЕНИЯ К БАЗЕ
    console.log(`🔍 Проверка подключения к БД...`);
    const connectionCheck = await client.query('SELECT 1 as test');
    console.log(`🔍 Подключение к БД:`, connectionCheck.rows[0]);
    
    const query = `
      INSERT INTO game_scores (user_id, game_type, score, level, lines) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING id
    `;
    
    console.log(`🔍 SQL запрос:`, query);
    console.log(`🔍 Параметры: [$1=${userId}, $2=${gameType}, $3=${score}, $4=${level}, $5=${lines}]`);
    
    const result = await client.query(query, [userId, gameType, score, level, lines]);
    
    console.log(`🔍 Результат от БД:`, {
      rowCount: result.rowCount,
      rows: result.rows,
      command: result.command
    });
    
    const savedId = result.rows[0]?.id;
    
    if (savedId) {
      console.log(`✅✅✅ УСПЕХ! Результат сохранен в game_scores с ID: ${savedId}`);
      
      // ПРОВЕРКА ЧТО ЗАПИСЬ ДЕЙСТВИТЕЛЬНО СОХРАНИЛАСЬ
      const verifyQuery = `
        SELECT id, user_id, score, created_at 
        FROM game_scores 
        WHERE id = $1
      `;
      const verifyResult = await client.query(verifyQuery, [savedId]);
      console.log(`🔍 Проверка сохраненной записи:`, verifyResult.rows[0]);
      
      // ПРОВЕРКА ОБЩЕГО КОЛИЧЕСТВА ЗАПИСЕЙ
      const countQuery = await client.query('SELECT COUNT(*) as total FROM game_scores');
      console.log(`🔍 Всего записей в game_scores:`, parseInt(countQuery.rows[0].total));
      
      // ПРОВЕРКА ЗАПИСЕЙ ДЛЯ ЭТОГО ПОЛЬЗОВАТЕЛЯ
      const userCountQuery = await client.query(
        'SELECT COUNT(*) as user_count FROM game_scores WHERE user_id = $1',
        [userId]
      );
      console.log(`🔍 Записей для пользователя ${userId}:`, parseInt(userCountQuery.rows[0].user_count));
      
    } else {
      console.log(`❌❌❌ ВНИМАНИЕ: saveGameScore вернул null/undefined!`);
      console.log(`❌ Проверка - возможно таблица game_scores не существует?`);
      
      // ПРОВЕРЯЕМ СУЩЕСТВОВАНИЕ ТАБЛИЦЫ
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'game_scores'
        )
      `);
      console.log(`🔍 Таблица game_scores существует?`, tableCheck.rows[0].exists);
    }
    
    return savedId;
    
  } catch (error) {
    console.error(`❌❌❌ КРИТИЧЕСКАЯ ОШИБКА в saveGameScore:`, error);
    console.error(`❌ Сообщение ошибки:`, error.message);
    console.error(`❌ Код ошибки:`, error.code);
    console.error(`❌ Детали ошибки:`, error.detail);
    console.error(`❌ Позиция ошибки:`, error.position);
    
    // ДОПОЛНИТЕЛЬНАЯ ДИАГНОСТИКА
    try {
      const tableInfo = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'game_scores' 
        ORDER BY ordinal_position
      `);
      console.log(`🔍 Структура таблицы game_scores:`, tableInfo.rows);
    } catch (e) {
      console.log(`🔍 Не удалось получить структуру таблицы:`, e.message);
    }
    
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
    console.log(`💾 Прогресс сохранен: ${score} очков для пользователя ${userId}`);
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

// ============ СТАТИСТИКА И ЛИДЕРБОРД ============
export async function getGameStats(userId, gameType = 'tetris') {
  const client = await pool.connect();
  try {
    console.log(`📊 ВЫЗОВ getGameStats: user_id=${userId}, game_type=${gameType}`);
    
    // СНАЧАЛА ПРОВЕРИМ ЕСТЬ ЛИ ВООБЩЕ ДАННЫЕ
    const checkQuery = `
      SELECT COUNT(*) as total_count 
      FROM game_scores 
      WHERE user_id = $1 AND game_type = $2
    `;
    const checkResult = await client.query(checkQuery, [userId, gameType]);
    const totalCount = parseInt(checkResult.rows[0].total_count);
    
    console.log(`🔍 Всего записей для пользователя ${userId}:`, totalCount);
    
    if (totalCount === 0) {
      console.log(`⚠️ ВНИМАНИЕ: Нет записей в game_scores для пользователя ${userId}`);
      
      // Проверим все записи в таблице
      const allRecords = await client.query('SELECT COUNT(*) as all FROM game_scores');
      console.log(`🔍 Всего записей во всей таблице game_scores:`, parseInt(allRecords.rows[0].all));
    }
    
    // ОСНОВНОЙ ЗАПРОС
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
    `;
    
    const statsResult = await client.query(statsQuery, [userId, gameType]);
    const stats = statsResult.rows[0];
    
    console.log(`📊 СТАТИСТИКА ИЗ БД (сырые данные):`, stats);
    
    // Получаем прогресс
    const progressQuery = `
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `;
    const progressResult = await client.query(progressQuery, [userId, gameType]);
    const progress = progressResult.rows[0];
    
    const result = {
      games_played: parseInt(stats.games_played) || 0,
      best_score: parseInt(stats.best_score) || 0,
      best_level: parseInt(stats.best_level) || 1,
      best_lines: parseInt(stats.best_lines) || 0,
      avg_score: parseFloat(stats.avg_score) || 0,
      last_played: stats.last_played,
      current_progress: progress ? {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved
      } : null,
      has_unfinished_game: !!progress,
      debug: {
        total_records_found: totalCount,
        query_executed: true
      }
    };
    
    console.log(`✅ getGameStats результат:`, result);
    return result;
    
  } catch (error) {
    console.error(`❌ Ошибка getGameStats:`, error);
    return {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null,
      current_progress: null,
      has_unfinished_game: false,
      debug: { error: error.message }
    };
  } finally {
    client.release();
  }
}

export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  try {
    console.log(`🏆 Запрос топа игроков для: ${gameType}, лимит: ${limit}`);
    
    // Улучшенный запрос для лидерборда
    const query = `
      SELECT 
        user_id,
        MAX(score) as best_score,
        MAX(level) as best_level,
        MAX(lines) as best_lines,
        COUNT(*) as games_played,
        MAX(created_at) as last_played
      FROM game_scores 
      WHERE game_type = $1 
        AND score > 0  -- Исключаем нулевые результаты
      GROUP BY user_id
      HAVING COUNT(*) > 0
      ORDER BY MAX(score) DESC, MAX(level) DESC, MAX(lines) DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    console.log(`🏆 Найдено игроков в топе: ${result.rows.length}`);
    
    // Форматируем результат
    const topPlayers = result.rows.map((player, index) => {
      const userId = player.user_id;
      const lastDigits = userId ? String(userId).slice(-4) : '0000';
      
      return {
        rank: index + 1,
        user_id: userId,
        score: parseInt(player.best_score) || 0,
        level: parseInt(player.best_level) || 1,
        lines: parseInt(player.best_lines) || 0,
        games_played: parseInt(player.games_played) || 0,
        last_played: player.last_played,
        username: `Игрок #${lastDigits}`
      };
    });
    
    return topPlayers;
    
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error);
    console.error('❌ Stack trace:', error.stack);
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

// Функция для отладки базы данных
export async function debugDatabase() {
  try {
    console.log('🔍 Отладка базы данных...');
    
    // Проверяем соединение
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
          COALESCE(AVG(score), 0) as avg_score
        FROM game_scores 
        WHERE game_type = 'tetris'
      `);
      
      console.log('🔍 Статистика game_scores:', scoresStats.rows[0]);
      
      // Проверяем последние 5 игр
      const recentGames = await client.query(`
        SELECT user_id, score, level, lines, created_at
        FROM game_scores 
        WHERE game_type = 'tetris'
        ORDER BY created_at DESC 
        LIMIT 5
      `);
      
      console.log('🔍 Последние 5 игр:', recentGames.rows);
      
      // Проверяем топ 5 игроков (прямой запрос)
      const top5Direct = await client.query(`
        SELECT 
          user_id,
          MAX(score) as best_score
        FROM game_scores 
        WHERE game_type = 'tetris'
        GROUP BY user_id
        ORDER BY MAX(score) DESC 
        LIMIT 5
      `);
      
      console.log('🔍 Топ 5 игроков (прямой запрос):', top5Direct.rows);
      
      // Проверяем таблицу user_sessions
      const userSessions = await client.query(`
        SELECT COUNT(*) as total_users FROM user_sessions
      `);
      
      console.log('🔍 Всего пользователей:', userSessions.rows[0].total_users);
      
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

// Экспортируем pool для отладки
export { pool };
