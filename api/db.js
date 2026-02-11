import pg from 'pg';
const { Pool } = pg;
import { URL } from 'url';

// 🔴 ОПТИМИЗИРОВАННОЕ ПОДКЛЮЧЕНИЕ ДЛЯ NEON + VERCEL
const parseDatabaseUrl = () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL не установлен');
    return null;
  }

  try {
    const url = new URL(dbUrl);
    
    const maskedUrl = `${url.protocol}//${url.username}:***@${url.host}${url.pathname}`;
    console.log(`🔗 Подключение к БД: ${maskedUrl}`);
    
    let sslConfig;
    if (url.hostname.includes('neon.tech')) {
      sslConfig = {
        rejectUnauthorized: true,
        sslmode: 'require'
      };
      
      if (!url.searchParams.has('sslmode')) {
        url.searchParams.set('sslmode', 'require');
        console.log('🔒 Добавлен sslmode=require для Neon');
      }
    } else {
      sslConfig = process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true
      } : {
        rejectUnauthorized: false
      };
    }
    
    return {
      connectionString: url.toString(),
      ssl: sslConfig,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 20,
      allowExitOnIdle: true
    };
  } catch (error) {
    console.error('❌ Ошибка парсинга DATABASE_URL:', error.message);
    return {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 20,
      allowExitOnIdle: true
    };
  }
};

const poolConfig = parseDatabaseUrl();
const pool = poolConfig ? new Pool(poolConfig) : null;

// 🔴 ИСПРАВЛЕНО: ТОЛЬКО ЧИСЛОВЫЕ ID, НИКАКИХ ПРЕФИКСОВ!
function convertUserIdForDb(userId) {
  console.log(`🔧 convertUserIdForDb вызвана с:`, {
    значение: userId,
    тип: typeof userId,
    длина: userId ? String(userId).length : 0
  });
  
  if (userId === undefined || userId === null) {
    console.error('❌ convertUserIdForDb: userId не определен');
    return null; // 🔴 НЕ СОЗДАЕМ FALLBACK ID!
  }
  
  const userIdStr = String(userId).trim();
  
  if (userIdStr === '') {
    console.error('❌ convertUserIdForDb: userId пустая строка');
    return null; // 🔴 НЕ СОЗДАЕМ FALLBACK ID!
  }
  
  // 🔴 УБИРАЕМ ВСЕ ПРЕФИКСЫ!
  let cleanUserId = userIdStr;
  
  // Убираем web_ префикс
  if (cleanUserId.startsWith('web_')) {
    cleanUserId = cleanUserId.replace('web_', '');
    console.log(`🧹 Убран префикс web_: ${cleanUserId}`);
  }
  
  // Убираем test_user_ префикс
  if (cleanUserId.startsWith('test_user_')) {
    cleanUserId = cleanUserId.replace('test_user_', '');
    console.log(`🧹 Убран префикс test_user_: ${cleanUserId}`);
  }
  
  // 🔴 ПРОВЕРЯЕМ ЧТО ID ТОЛЬКО ИЗ ЦИФР
  if (/^\d+$/.test(cleanUserId)) {
    console.log(`✅ Чистый числовой ID: ${cleanUserId}`);
    return cleanUserId;
  } else {
    console.error(`❌ ID содержит недопустимые символы: ${cleanUserId}`);
    return null; // 🔴 НЕ СОЗДАЕМ FALLBACK ID!
  }
}

// 🔴 НОВАЯ ФУНКЦИЯ ДЛЯ АВТОМАТИЧЕСКОЙ ОЧИСТКИ ТЕСТОВЫХ ДАННЫХ
async function cleanupTestUsers() {
  if (!pool) return;
  
  const client = await pool.connect();
  try {
    console.log('🧹 Автоматическая очистка тестовых пользователей...');
    
    // Удаляем из game_scores
    const gameResult = await client.query(`
      DELETE FROM game_scores 
      WHERE user_id LIKE 'web_%' 
         OR user_id LIKE 'test_user_%'
         OR user_id LIKE 'unknown_%'
         OR user_id LIKE 'empty_%'
      RETURNING id
    `);
    
    if (gameResult.rowCount > 0) {
      console.log(`✅ Удалено ${gameResult.rowCount} тестовых записей из game_scores`);
    }
    
    // Удаляем из users
    const usersResult = await client.query(`
      DELETE FROM users 
      WHERE user_id LIKE 'web_%' 
         OR user_id LIKE 'test_user_%'
         OR user_id LIKE 'unknown_%'
         OR user_id LIKE 'empty_%'
      RETURNING id
    `);
    
    if (usersResult.rowCount > 0) {
      console.log(`✅ Удалено ${usersResult.rowCount} тестовых пользователей из users`);
    }
    
    // Удаляем из user_sessions
    const sessionsResult = await client.query(`
      DELETE FROM user_sessions 
      WHERE user_id LIKE 'web_%' 
         OR user_id LIKE 'test_user_%'
         OR user_id LIKE 'unknown_%'
         OR user_id LIKE 'empty_%'
      RETURNING user_id
    `);
    
    if (sessionsResult.rowCount > 0) {
      console.log(`✅ Удалено ${sessionsResult.rowCount} тестовых сессий из user_sessions`);
    }
    
    // Удаляем из game_progress
    const progressResult = await client.query(`
      DELETE FROM game_progress 
      WHERE user_id LIKE 'web_%' 
         OR user_id LIKE 'test_user_%'
         OR user_id LIKE 'unknown_%'
         OR user_id LIKE 'empty_%'
      RETURNING user_id
    `);
    
    if (progressResult.rowCount > 0) {
      console.log(`✅ Удалено ${progressResult.rowCount} тестовых прогрессов из game_progress`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка очистки тестовых данных:', error.message);
  } finally {
    client.release();
  }
}

// 🔴 ВЫЗЫВАЕМ ОЧИСТКУ ПРИ ЗАПУСКЕ
setTimeout(() => {
  cleanupTestUsers();
}, 2000);

// Функция для тестирования подключения
async function testConnection() {
  if (!pool) {
    return { 
      success: false, 
      error: 'Пул подключения не инициализирован',
      details: 'DATABASE_URL не установлен' 
    };
  }
  
  let client;
  try {
    console.log('🧪 Тестирование подключения к БД...');
    
    client = await pool.connect();
    const result = await client.query('SELECT version() as version, NOW() as now, current_database() as db');
    
    console.log('✅ Подключение успешно:');
    console.log('   База данных:', result.rows[0].db);
    console.log('   Версия PostgreSQL:', result.rows[0].version.split(',')[0]);
    console.log('   Время сервера:', result.rows[0].now);
    
    return { 
      success: true, 
      version: result.rows[0].version, 
      time: result.rows[0].now,
      database: result.rows[0].db 
    };
  } catch (error) {
    console.error('❌ Ошибка подключения к БД:', error.message);
    console.error('❌ Код ошибки:', error.code);
    
    return { 
      success: false, 
      error: error.message, 
      code: error.code
    };
  } finally {
    if (client) client.release();
  }
}

// 🔴 ИСПРАВЛЕННАЯ ФУНКЦИЯ СОЗДАНИЯ ТАБЛИЦ - УБРАНЫ ТЕСТОВЫЕ ДАННЫЕ
async function createTables() {
  if (!pool) {
    console.error('❌ Пул подключения не инициализирован');
    return;
  }
  
  const client = await pool.connect();
  try {
    console.log('📊 Создание/проверка таблиц...');
    
    const testResult = await testConnection();
    if (!testResult.success) {
      throw new Error(`Не удалось подключиться к БД: ${testResult.error}`);
    }
    
    // 1. Таблица users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) UNIQUE NOT NULL,
        chat_id BIGINT,
        username VARCHAR(255),
        first_name VARCHAR(255),
        city VARCHAR(100) DEFAULT 'Не указан',
        created_at TIMESTAMP DEFAULT NOW(),
        last_active TIMESTAMP DEFAULT NOW(),
        stickers_created INTEGER DEFAULT 0,
        premium_level INTEGER DEFAULT 0
      )
    `);
    console.log('✅ Таблица users создана/проверена');
    
    // 2. Таблица user_sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id VARCHAR(50) PRIMARY KEY,
        selected_city VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        username VARCHAR(100) DEFAULT 'Игрок',
        user_type VARCHAR(20) DEFAULT 'telegram'
      )
    `);
    console.log('✅ Таблица user_sessions создана/проверена');
    
    // 3. Таблица game_scores
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_scores (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
        score INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        lines INTEGER NOT NULL DEFAULT 0,
        is_win BOOLEAN DEFAULT TRUE,
        username VARCHAR(100),
        city VARCHAR(100) DEFAULT 'Не указан',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        CONSTRAINT valid_user_id CHECK (user_id IS NOT NULL AND user_id != '')
      )
    `);
    console.log('✅ Таблица game_scores создана/проверена');
    
    // 4. Таблица game_progress - ИСПРАВЛЕНО: last_saved вместо updated_at
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_progress (
        user_id VARCHAR(50) NOT NULL,
        game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
        score INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        lines INTEGER DEFAULT 0,
        last_saved TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, game_type)
      )
    `);
    console.log('✅ Таблица game_progress создана/проверена');
    
    // 5. 🔴 НОВАЯ ТАБЛИЦА ДЛЯ СВЯЗЕЙ ID
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_links (
        id SERIAL PRIMARY KEY,
        telegram_id VARCHAR(50) NOT NULL,
        web_game_id VARCHAR(50) NOT NULL,
        username VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(telegram_id, web_game_id)
      )
    `);
    console.log('✅ Таблица user_links создана/проверена');
    
    // Создаем индексы
    console.log('📊 Создание индексов...');
    
    await client.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_user_id ON game_scores(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores(score DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_game_type ON game_scores(game_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_user_game ON game_scores(user_id, game_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_city ON game_scores(city)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_city ON user_sessions(selected_city)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_game_progress_user ON game_progress(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_links_telegram ON user_links(telegram_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_links_web ON user_links(web_game_id)`);
    
    console.log('✅ Все таблицы и индексы созданы');
    
  } catch (error) {
    console.error('❌ Ошибка при создании таблиц:', error.message);
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ ============

/**
 * Сохраняет или обновляет профиль пользователя - ТОЛЬКО ЧИСЛОВЫЕ ID!
 */
export async function saveOrUpdateUser(userData) {
  console.log('👤🔄 ========== СОХРАНЕНИЕ ПОЛЬЗОВАТЕЛЯ ==========');
  
  if (!pool) {
    console.error('❌ saveOrUpdateUser: Пул подключения не инициализирован');
    return null;
  }
  
  const {
    user_id,
    chat_id = null,
    username = '',
    first_name = '',
    city = 'Не указан',
    source = 'telegram'
  } = userData;

  // 🔴 ОЧИЩАЕМ ID ОТ ПРЕФИКСОВ
  const dbUserId = convertUserIdForDb(user_id);
  
  if (!dbUserId) {
    console.error('❌ Некорректный user_id:', user_id);
    return null;
  }
  
  console.log(`👤 Сохранение профиля: user_id="${dbUserId}", city="${city}"`);
  
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO users (
        user_id, 
        chat_id, 
        username, 
        first_name, 
        city, 
        created_at, 
        last_active
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        username = COALESCE(EXCLUDED.username, users.username),
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        city = COALESCE(EXCLUDED.city, users.city),
        last_active = NOW()
      RETURNING id
    `;
    
    const values = [
      dbUserId, 
      chat_id,
      username || `Игрок_${dbUserId.slice(-4)}`, 
      first_name || 'Игрок', 
      city || 'Не указан'
    ];
    
    const result = await client.query(query, values);
    const userId = result.rows[0]?.id;
    
    console.log(`✅ Профиль сохранен: ID=${userId}`);
    
    return userId;
  } catch (error) {
    console.error('❌ Ошибка сохранения профиля:', error.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Сохраняет город пользователя - ТОЛЬКО ЧИСЛОВЫЕ ID!
 */
export async function saveUserCity(userId, city, username = null) {
  const dbUserId = convertUserIdForDb(userId);
  
  if (!dbUserId) {
    console.error('❌ Некорректный userId:', userId);
    return { success: false, error: 'Некорректный ID пользователя' };
  }
  
  console.log(`📍 Сохранение города: ${dbUserId} -> "${city}"`);
  
  try {
    const result = await saveOrUpdateUser({
      user_id: dbUserId,
      username: username || '',
      first_name: username || 'Игрок',
      city: city || 'Не указан',
      chat_id: null
    });
    
    return { 
      success: !!result,
      user_id: dbUserId,
      city: city || 'Не указан',
      db_id: result
    };
  } catch (error) {
    console.error('❌ Ошибка saveUserCity:', error.message);
    return { 
      success: false, 
      error: error.message,
      user_id: dbUserId 
    };
  }
}

/**
 * Получает город пользователя - ТОЛЬКО ЧИСЛОВЫЕ ID!
 */
export async function getUserCity(userId) {
  const dbUserId = convertUserIdForDb(userId);
  
  if (!dbUserId) {
    console.error('❌ Некорректный userId:', userId);
    return { success: false, city: 'Не указан', found: false };
  }
  
  console.log(`📍 Запрос города для: "${dbUserId}"`);
  
  if (!pool) {
    return { success: false, city: 'Не указан', found: false };
  }
  
  const client = await pool.connect();
  try {
    const userQuery = 'SELECT city FROM users WHERE user_id = $1';
    const userResult = await client.query(userQuery, [dbUserId]);
    
    if (userResult.rows[0] && userResult.rows[0].city !== 'Не указан') {
      const city = userResult.rows[0].city;
      console.log(`✅ Город найден в users: "${city}"`);
      return { 
        success: true, 
        city: city,
        found: true,
        source: 'users' 
      };
    }
    
    return { 
      success: true, 
      city: 'Не указан',
      found: false,
      source: 'none' 
    };
    
  } catch (error) {
    console.error('❌ Ошибка получения города:', error.message);
    return { 
      success: false, 
      city: 'Не указан',
      found: false 
    };
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ ИГР - ТОЛЬКО ЧИСЛОВЫЕ ID! ============

/**
 * Сохраняет финальный результат игры - ТОЛЬКО ЧИСЛОВЫЕ ID!
 */
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
  console.log('🎮🔄 ========== СОХРАНЕНИЕ ИГРЫ ==========');
  
  if (!pool) {
    console.error('❌ saveGameScore: Нет подключения к БД');
    return { success: false, error: 'Нет подключения к БД' };
  }
  
  // 🔴 ОЧИЩАЕМ ID ОТ ПРЕФИКСОВ
  const dbUserId = convertUserIdForDb(userId);
  
  if (!dbUserId) {
    console.error('❌ Некорректный userId:', userId);
    return { success: false, error: 'Некорректный ID пользователя' };
  }
  
  // Не сохраняем игру с нулевым счетом
  if (parseInt(score) === 0 && isWin) {
    console.log('⚠️ Игра с 0 очков, пропускаем сохранение');
    return { success: false, error: 'Игра с нулевым счетом' };
  }
  
  const finalUsername = username || `Игрок_${String(dbUserId).slice(-4)}`;
  
  const client = await pool.connect();
  
  try {
    // Получаем город пользователя
    let currentCity = 'Не указан';
    const cityResult = await getUserCity(dbUserId);
    if (cityResult.success && cityResult.city !== 'Не указан') {
      currentCity = cityResult.city;
    }
    
    // Сохраняем результат игры
    const gameQuery = `
      INSERT INTO game_scores (
        user_id, username, game_type, score, level, lines, is_win, city, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) 
      RETURNING id
    `;
    
    const result = await client.query(gameQuery, [
      dbUserId, 
      finalUsername, 
      gameType || 'tetris', 
      parseInt(score) || 0, 
      parseInt(level) || 1, 
      parseInt(lines) || 0,
      isWin,
      currentCity
    ]);
    
    const savedId = result.rows[0]?.id;
    console.log(`✅ Игра сохранена! ID: ${savedId}, очки: ${score}`);
    
    // Удаляем прогресс
    await client.query(
      'DELETE FROM game_progress WHERE user_id = $1 AND game_type = $2',
      [dbUserId, gameType || 'tetris']
    );
    
    return { 
      success: true, 
      id: savedId,
      user_id: dbUserId,
      score: parseInt(score) || 0
    };
    
  } catch (error) {
    console.error('❌ Ошибка сохранения игры:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Сохраняет прогресс игры - ТОЛЬКО ЧИСЛОВЫЕ ID!
 */
export async function saveGameProgress(userId, gameType, score, level, lines, username = null) {
  console.log('💾🔄 ========== СОХРАНЕНИЕ ПРОГРЕССА ==========');
  
  if (!pool) {
    console.error('❌ saveGameProgress: Нет подключения к БД');
    return { success: false, error: 'Нет подключения к БД' };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  
  if (!dbUserId) {
    console.error('❌ Некорректный userId:', userId);
    return { success: false, error: 'Некорректный ID пользователя' };
  }
  
  const client = await pool.connect();
  
  try {
    const query = `
      INSERT INTO game_progress (user_id, game_type, score, level, lines, last_saved) 
      VALUES ($1, $2, $3, $4, $5, NOW()) 
      ON CONFLICT (user_id, game_type) 
      DO UPDATE SET 
        score = EXCLUDED.score,
        level = EXCLUDED.level,
        lines = EXCLUDED.lines,
        last_saved = NOW()
      RETURNING user_id
    `;
    
    const result = await client.query(query, [
      dbUserId, 
      gameType || 'tetris', 
      parseInt(score) || 0, 
      parseInt(level) || 1, 
      parseInt(lines) || 0
    ]);
    
    console.log(`✅ Прогресс сохранен для пользователя ${dbUserId}`);
    
    return { 
      success: true, 
      user_id: result.rows[0]?.user_id
    };
    
  } catch (error) {
    console.error('❌ Ошибка сохранения прогресса:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Получает статистику игрока - ТОЛЬКО ЧИСЛОВЫЕ ID!
 */
export async function getGameStats(userId, gameType = 'tetris') {
  console.log('📊🔄 ========== ПОЛУЧЕНИЕ СТАТИСТИКИ ==========');
  
  if (!pool) {
    console.error('❌ getGameStats: Нет подключения к БД');
    return { success: false, stats: null };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  
  if (!dbUserId) {
    console.error('❌ Некорректный userId:', userId);
    return { success: false, stats: null };
  }
  
  const client = await pool.connect();
  
  try {
    // Получаем статистику из game_scores
    const statsQuery = `
      SELECT 
        COUNT(*) as games_played,
        COUNT(CASE WHEN is_win THEN 1 END) as wins,
        COUNT(CASE WHEN NOT is_win THEN 1 END) as losses,
        COALESCE(MAX(score), 0) as best_score,
        COALESCE(AVG(score), 0) as avg_score,
        COALESCE(MAX(level), 1) as best_level,
        COALESCE(MAX(lines), 0) as best_lines,
        COALESCE(SUM(score), 0) as total_score,
        MIN(created_at) as first_played,
        MAX(created_at) as last_played
      FROM game_scores 
      WHERE user_id = $1 
        AND game_type = $2
        AND score > 0
    `;
    
    const statsResult = await client.query(statsQuery, [dbUserId, gameType]);
    const rawStats = statsResult.rows[0] || {};
    
    // Получаем прогресс
    const progressQuery = `
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `;
    
    const progressResult = await client.query(progressQuery, [dbUserId, gameType]);
    
    // Получаем город
    let city = 'Не указан';
    const cityResult = await getUserCity(dbUserId);
    if (cityResult.success && cityResult.city !== 'Не указан') {
      city = cityResult.city;
    }
    
    const gamesPlayed = parseInt(rawStats.games_played) || 0;
    const bestScore = parseInt(rawStats.best_score) || 0;
    
    const stats = {
      games_played: gamesPlayed,
      wins: parseInt(rawStats.wins) || 0,
      losses: parseInt(rawStats.losses) || 0,
      win_rate: gamesPlayed > 0 ? Math.round((parseInt(rawStats.wins) || 0) / gamesPlayed * 100) : 0,
      best_score: bestScore,
      avg_score: Math.round(parseFloat(rawStats.avg_score) || 0),
      best_level: parseInt(rawStats.best_level) || 1,
      best_lines: parseInt(rawStats.best_lines) || 0,
      total_score: parseInt(rawStats.total_score) || 0,
      first_played: rawStats.first_played,
      last_played: rawStats.last_played,
      
      current_progress: progressResult.rows[0] ? {
        score: parseInt(progressResult.rows[0].score) || 0,
        level: parseInt(progressResult.rows[0].level) || 1,
        lines: parseInt(progressResult.rows[0].lines) || 0,
        last_saved: progressResult.rows[0].last_saved
      } : null,
      
      has_unfinished_game: progressResult.rows.length > 0,
      has_any_games: gamesPlayed > 0 || progressResult.rows.length > 0,
      has_completed_games: gamesPlayed > 0,
      
      city: city,
      user_id: dbUserId
    };
    
    return { success: true, stats: stats };
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error.message);
    return { success: false, stats: null };
  } finally {
    client.release();
  }
}

/**
 * Получает топ игроков - ТОЛЬКО ЧИСЛОВЫЕ ID!
 */
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  if (!pool) {
    return { success: false, players: [] };
  }
  
  const client = await pool.connect();
  
  try {
    // 🔴 ТОЛЬКО ЧИСЛОВЫЕ ID, БЕЗ ТЕСТОВЫХ!
    const query = `
      SELECT 
        gs.user_id,
        COALESCE(u.username, gs.username, CONCAT('Игрок ', RIGHT(gs.user_id, 4))) as display_name,
        COALESCE(u.city, gs.city, 'Не указан') as city,
        MAX(gs.score) as best_score,
        COUNT(*) as games_played,
        MAX(gs.level) as best_level,
        MAX(gs.lines) as best_lines,
        MAX(gs.created_at) as last_played
      FROM game_scores gs
      LEFT JOIN users u ON gs.user_id = u.user_id
      WHERE gs.game_type = $1 
        AND gs.score >= 1000
        AND gs.is_win = true
        AND gs.user_id NOT LIKE 'web_%'
        AND gs.user_id NOT LIKE 'test_user_%'
        AND gs.user_id NOT LIKE 'unknown_%'
        AND gs.user_id NOT LIKE 'empty_%'
        AND gs.user_id ~ '^[0-9]+$'
      GROUP BY gs.user_id, u.username, gs.username, u.city, gs.city
      ORDER BY MAX(gs.score) DESC, COUNT(*) DESC, MAX(gs.created_at) DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    
    const players = result.rows.map((row, index) => ({
      rank: index + 1,
      user_id: row.user_id,
      username: row.display_name || `Игрок ${row.user_id.slice(-4)}`,
      city: row.city || 'Не указан',
      score: parseInt(row.best_score) || 0,
      level: parseInt(row.best_level) || 1,
      lines: parseInt(row.best_lines) || 0,
      games_played: parseInt(row.games_played) || 1
    }));
    
    return { success: true, players: players };
    
  } catch (error) {
    console.error('❌ Ошибка топа:', error.message);
    return { success: false, players: [] };
  } finally {
    client.release();
  }
}

// ============ ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Удаляет прогресс игры - ТОЛЬКО ЧИСЛОВЫЕ ID!
 */
export async function deleteGameProgress(userId, gameType = 'tetris') {
  if (!pool) return { success: false };
  
  const dbUserId = convertUserIdForDb(userId);
  if (!dbUserId) return { success: false };
  
  const client = await pool.connect();
  
  try {
    await client.query(
      'DELETE FROM game_progress WHERE user_id = $1 AND game_type = $2',
      [dbUserId, gameType]
    );
    
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка удаления прогресса:', error.message);
    return { success: false };
  } finally {
    client.release();
  }
}

// Инициализация
if (process.env.DATABASE_URL) {
  console.log('📊 Инициализация базы данных...');
  
  setTimeout(() => {
    createTables().catch(error => {
      console.error('💥 Ошибка инициализации БД:', error);
    });
    
    // Периодическая очистка тестовых данных
    setInterval(() => {
      cleanupTestUsers();
    }, 3600000); // Каждый час
  }, 1500);
}

// Экспортируем функции
export { 
  pool,
  testConnection,
  getUserProfile,
  getTopPlayersWithCities,
  getGameProgress,
  checkDatabaseConnection,
  debugDatabase
};

// 🔴 НЕ ЭКСПОРТИРУЕМ ТЕСТОВЫЕ ФУНКЦИИ!
