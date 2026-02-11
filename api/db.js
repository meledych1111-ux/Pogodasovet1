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

// 🔴 ФУНКЦИЯ ДЛЯ ТЕСТИРОВАНИЯ ПОДКЛЮЧЕНИЯ
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

// 🔴 ФУНКЦИЯ ДЛЯ ПРОВЕРКИ СОЕДИНЕНИЯ
async function checkDatabaseConnection() {
  return await testConnection();
}

// 🔴 ФУНКЦИЯ СОЗДАНИЯ ТАБЛИЦ
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
    city = 'Не указан'
  } = userData;

  const dbUserId = String(user_id).trim();
  
  console.log(`👤 Сохранение профиля: user_id="${dbUserId}", city="${city}"`);
  
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO users (
        user_id, chat_id, username, first_name, city, created_at, last_active
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
    return result.rows[0]?.id;
    
  } catch (error) {
    console.error('❌ Ошибка сохранения профиля:', error.message);
    return null;
  } finally {
    client.release();
  }
}

export async function getUserProfile(userId) {
  console.log(`👤📥 Получение профиля: ${userId}`);
  
  if (!pool) return null;
  
  const dbUserId = String(userId).trim();
  const client = await pool.connect();
  
  try {
    const query = 'SELECT * FROM users WHERE user_id = $1';
    const result = await client.query(query, [dbUserId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('❌ Ошибка получения профиля:', error.message);
    return null;
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ ГОРОДОВ ============
export async function saveUserCity(userId, city, username = null) {
  const dbUserId = String(userId).trim();
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
      city: city || 'Не указан'
    };
  } catch (error) {
    console.error('❌ Ошибка saveUserCity:', error.message);
    return { success: false, error: error.message, user_id: dbUserId };
  }
}

export async function getUserCity(userId) {
  const dbUserId = String(userId).trim();
  console.log(`📍 Запрос города для: "${dbUserId}"`);
  
  if (!pool) {
    return { success: false, city: 'Не указан', found: false };
  }
  
  const client = await pool.connect();
  try {
    const userQuery = 'SELECT city FROM users WHERE user_id = $1';
    const userResult = await client.query(userQuery, [dbUserId]);
    
    if (userResult.rows[0]?.city && userResult.rows[0].city !== 'Не указан') {
      return { success: true, city: userResult.rows[0].city, found: true, source: 'users' };
    }
    
    return { success: true, city: 'Не указан', found: false, source: 'none' };
    
  } catch (error) {
    console.error('❌ Ошибка получения города:', error.message);
    return { success: false, city: 'Не указан', found: false };
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ ИГР ============
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
  console.log('🎮🔄 ========== СОХРАНЕНИЕ ИГРЫ ==========');
  
  if (!pool) {
    return { success: false, error: 'Нет подключения к БД' };
  }
  
  const dbUserId = String(userId).trim();
  
  if (parseInt(score) === 0 && isWin) {
    console.log('⚠️ Игра с 0 очков, пропускаем сохранение');
    return { success: false, error: 'Игра с нулевым счетом' };
  }
  
  const finalUsername = username || `Игрок_${dbUserId.slice(-4)}`;
  const client = await pool.connect();
  
  try {
    let currentCity = 'Не указан';
    const cityResult = await getUserCity(dbUserId);
    if (cityResult.success && cityResult.city !== 'Не указан') {
      currentCity = cityResult.city;
    }
    
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
    
    await client.query(
      'DELETE FROM game_progress WHERE user_id = $1 AND game_type = $2',
      [dbUserId, gameType || 'tetris']
    );
    
    return { success: true, id: savedId, user_id: dbUserId, score: parseInt(score) || 0 };
    
  } catch (error) {
    console.error('❌ Ошибка сохранения игры:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

export async function saveGameProgress(userId, gameType, score, level, lines, username = null) {
  console.log('💾🔄 ========== СОХРАНЕНИЕ ПРОГРЕССА ==========');
  
  if (!pool) {
    return { success: false, error: 'Нет подключения к БД' };
  }
  
  const dbUserId = String(userId).trim();
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
    return { success: true, user_id: result.rows[0]?.user_id };
    
  } catch (error) {
    console.error('❌ Ошибка сохранения прогресса:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

export async function getGameProgress(userId, gameType = 'tetris') {
  if (!pool) return { success: false, found: false };
  
  const dbUserId = String(userId).trim();
  const client = await pool.connect();
  
  try {
    const query = `
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `;
    
    const result = await client.query(query, [dbUserId, gameType]);
    
    if (result.rows[0]) {
      const progress = result.rows[0];
      return { 
        success: true, 
        found: true, 
        progress: {
          score: parseInt(progress.score) || 0,
          level: parseInt(progress.level) || 1,
          lines: parseInt(progress.lines) || 0,
          last_saved: progress.last_saved
        }
      };
    }
    
    return { success: true, found: false, progress: null };
    
  } catch (error) {
    console.error('❌ Ошибка получения прогресса:', error.message);
    return { success: false, found: false };
  } finally {
    client.release();
  }
}

export async function deleteGameProgress(userId, gameType = 'tetris') {
  if (!pool) return { success: false };
  
  const dbUserId = String(userId).trim();
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

export async function getGameStats(userId, gameType = 'tetris') {
  console.log('📊🔄 ========== ПОЛУЧЕНИЕ СТАТИСТИКИ ==========');
  
  if (!pool) return { success: false, stats: null };
  
  const dbUserId = String(userId).trim();
  const client = await pool.connect();
  
  try {
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
      WHERE user_id = $1 AND game_type = $2 AND score > 0
    `;
    
    const statsResult = await client.query(statsQuery, [dbUserId, gameType]);
    const rawStats = statsResult.rows[0] || {};
    
    const progressQuery = `
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `;
    
    const progressResult = await client.query(progressQuery, [dbUserId, gameType]);
    
    let city = 'Не указан';
    const cityResult = await getUserCity(dbUserId);
    if (cityResult.success && cityResult.city !== 'Не указан') {
      city = cityResult.city;
    }
    
    const gamesPlayed = parseInt(rawStats.games_played) || 0;
    
    const stats = {
      games_played: gamesPlayed,
      wins: parseInt(rawStats.wins) || 0,
      losses: parseInt(rawStats.losses) || 0,
      win_rate: gamesPlayed > 0 ? Math.round((parseInt(rawStats.wins) || 0) / gamesPlayed * 100) : 0,
      best_score: parseInt(rawStats.best_score) || 0,
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

// ============ ФУНКЦИИ ДЛЯ ТОПА ИГРОКОВ ============
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  console.log(`🏆 getTopPlayers: gameType=${gameType}, limit=${limit}`);
  
  if (!pool) {
    console.error('❌ Нет подключения к БД');
    return { success: false, players: [] };
  }
  
  const client = await pool.connect();
  
  try {
    const query = `
      SELECT 
        gs.user_id,
        COALESCE(u.username, gs.username, CONCAT('Игрок ', RIGHT(gs.user_id, 4))) as display_name,
        COALESCE(u.city, gs.city, 'Не указан') as city,
        MAX(gs.score) as best_score,
        COUNT(*) as games_played,
        MAX(gs.level) as best_level,
        MAX(gs.lines) as best_lines
      FROM game_scores gs
      LEFT JOIN users u ON gs.user_id = u.user_id
      WHERE gs.game_type = $1 
        AND gs.score > 0
        AND gs.is_win = true
        AND gs.user_id NOT LIKE 'test_%'
        AND gs.user_id NOT LIKE 'web_%'
        AND gs.user_id ~ '^[0-9]+$'
      GROUP BY gs.user_id, u.username, gs.username, u.city, gs.city
      ORDER BY MAX(gs.score) DESC, COUNT(*) DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    
    const players = result.rows.map((row, index) => ({
      rank: index + 1,
      user_id: row.user_id,
      display_name: row.display_name,
      username: row.display_name,
      city: row.city || 'Не указан',
      best_score: parseInt(row.best_score) || 0,
      best_level: parseInt(row.best_level) || 1,
      best_lines: parseInt(row.best_lines) || 0,
      games_played: parseInt(row.games_played) || 1
    }));
    
    console.log(`🏆 Топ игроков: ${players.length} игроков`);
    return { success: true, players: players, count: players.length };
    
  } catch (error) {
    console.error('❌ Ошибка топа:', error.message);
    return { success: false, players: [] };
  } finally {
    client.release();
  }
}

export async function getTopPlayersWithCities(limit = 10) {
  const result = await getTopPlayers('tetris', limit);
  return result.success ? result.players : [];
}

// ============ ДИАГНОСТИКА ============
export async function debugDatabase() {
  try {
    const connection = await testConnection();
    if (!connection.success) {
      return { success: false, error: connection.error };
    }
    
    const client = await pool.connect();
    try {
      const tablesInfo = await client.query(`
        SELECT 
          table_name,
          (SELECT COUNT(*) FROM information_schema.columns 
           WHERE table_schema = 'public' AND table_name = t.table_name) as columns_count,
          (xpath('/row/cnt/text()', 
            query_to_xml(format('SELECT COUNT(*) as cnt FROM %I', table_name), 
            false, true, '')))[1]::text::int as rows_count
        FROM information_schema.tables t
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      
      return { success: true, connection, tables: tablesInfo.rows };
    } finally {
      client.release();
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 🔴 ИНИЦИАЛИЗАЦИЯ
if (process.env.DATABASE_URL) {
  console.log('📊 Инициализация базы данных...');
  setTimeout(() => {
    createTables().catch(console.error);
  }, 1500);
}

// 🔴 ЭКСПОРТ
export { 
  pool,
  testConnection,
  checkDatabaseConnection,
  createTables,
  convertUserIdForDb: (userId) => String(userId).trim()
};
