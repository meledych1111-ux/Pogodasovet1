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

// 🔴 УНИВЕРСАЛЬНАЯ ФУНКЦИЯ КОНВЕРТАЦИИ USER_ID
function convertUserIdForDb(userId) {
  if (userId === undefined || userId === null) {
    console.error('❌ convertUserIdForDb: userId не определен');
    return 'unknown';
  }
  
  const userIdStr = String(userId);
  
  if (userIdStr.startsWith('web_')) {
    return userIdStr;
  } else if (/^\d+$/.test(userIdStr)) {
    return userIdStr;
  }
  return userIdStr;
}

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

// 🔴 ФУНКЦИЯ СОЗДАНИЯ ВСЕХ НЕОБХОДИМЫХ ТАБЛИЦ (ИСПРАВЛЕННАЯ)
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
    
    // 🔴 1. Таблица users (ИСПРАВЛЕНА - chat_id может быть NULL)
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
    
    // 🔴 2. Проверяем и исправляем структуру таблицы users
    console.log('🔍 Проверяем структуру таблицы users...');
    
    // Проверяем наличие столбцов и их nullable статус
    const columnsCheck = await client.query(`
      SELECT column_name, is_nullable, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    
    console.log('📊 Структура таблицы users:');
    columnsCheck.rows.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    
    // Если chat_id имеет ограничение NOT NULL, меняем его
    const chatIdColumn = columnsCheck.rows.find(col => col.column_name === 'chat_id');
    if (chatIdColumn && chatIdColumn.is_nullable === 'NO') {
      console.log('⚠️ Столбец chat_id имеет ограничение NOT NULL, меняем на NULLABLE...');
      try {
        await client.query(`ALTER TABLE users ALTER COLUMN chat_id DROP NOT NULL`);
        console.log('✅ Столбец chat_id теперь может быть NULL');
      } catch (alterError) {
        console.error('❌ Не удалось изменить столбец chat_id:', alterError.message);
      }
    }
    
    // 🔴 3. Таблица user_sessions (для совместимости)
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
    
    // 🔴 4. Таблица game_scores (основная таблица результатов)
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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        CONSTRAINT valid_user_id CHECK (user_id IS NOT NULL AND user_id != '')
      )
    `);
    console.log('✅ Таблица game_scores создана/проверена');
    
    // 🔴 5. Таблица game_progress
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
    
    // 🔴 6. Создаем индексы
    console.log('📊 Создание индексов...');
    
    // Индексы для game_scores
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_user_id ON game_scores(user_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores(score DESC)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_game_type ON game_scores(game_type)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_user_game ON game_scores(user_id, game_type)
    `);
    
    // Индексы для users
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)
    `);
    
    // Индексы для user_sessions
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_city ON user_sessions(selected_city)
    `);
    
    console.log('✅ Все таблицы и индексы созданы или уже существуют');
    
  } catch (error) {
    console.error('❌ Ошибка при создании таблиц:', error.message);
    console.error('❌ Stack trace:', error.stack);
  } finally {
    client.release();
  }
}

// 🔴 АВТОМАТИЧЕСКАЯ ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
if (process.env.DATABASE_URL) {
  console.log('📊 Инициализация базы данных...');
  
  const initializeDatabase = async (retryCount = 3) => {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        console.log(`🔄 Попытка ${attempt} из ${retryCount}...`);
        await createTables();
        console.log('✅ База данных успешно инициализирована');
        return;
      } catch (error) {
        console.error(`❌ Попытка ${attempt} не удалась:`, error.message);
        
        if (attempt < retryCount) {
          const delay = attempt * 2000;
          console.log(`⏳ Повтор через ${delay / 1000} секунд...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error('❌ Все попытки инициализации БД провалились');
        }
      }
    }
  };
  
  setTimeout(() => {
    initializeDatabase().catch(error => {
      console.error('💥 Критическая ошибка инициализации БД:', error);
    });
  }, 1500);
} else {
  console.warn('⚠️ DATABASE_URL не установлен, база данных не будет инициализирована');
}

// ============ ФУНКЦИИ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ (ИСПРАВЛЕННЫЕ) ============

/**
 * Сохраняет или обновляет профиль пользователя в таблице users
 */
export async function saveOrUpdateUser(userData) {
  if (!pool) {
    console.error('❌ saveOrUpdateUser: Пул подключения не инициализирован');
    return null;
  }
  
  const {
    user_id,
    chat_id = null, // 🔴 ПО УМОЛЧАНИЮ NULL
    username = '',
    first_name = '',
    city = 'Не указан',
    source = 'telegram'
  } = userData;

  const dbUserId = convertUserIdForDb(user_id);
  
  console.log(`👤 Сохранение профиля: user_id=${dbUserId}, city="${city}", chat_id=${chat_id || 'NULL'}`);
  
  const client = await pool.connect();
  try {
    // 🔴 ОБНОВЛЕННЫЙ ЗАПРОС С ПРАВИЛЬНОЙ ОБРАБОТКОЙ NULL
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
      chat_id, // 🔴 МОЖЕТ БЫТЬ NULL
      username || `Игрок_${dbUserId.slice(-4)}`, 
      first_name || 'Игрок', 
      city || 'Не указан'
    ];
    
    console.log(`📊 Параметры запроса:`, values);
    
    const result = await client.query(query, values);
    const userId = result.rows[0]?.id;
    
    console.log(`✅ Профиль сохранен/обновлен: ID=${userId}`);
    
    // 🔴 Также сохраняем в user_sessions для совместимости
    try {
      await client.query(`
        INSERT INTO user_sessions (user_id, username, selected_city, user_type)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          username = COALESCE($2, user_sessions.username),
          selected_city = COALESCE($3, user_sessions.selected_city),
          updated_at = NOW()
      `, [dbUserId, username || `Игрок_${dbUserId.slice(-4)}`, city || 'Не указан', source]);
      console.log(`✅ Данные также сохранены в user_sessions`);
    } catch (sessionError) {
      console.error('⚠️ Ошибка сохранения в user_sessions:', sessionError.message);
    }
    
    return userId;
  } catch (error) {
    console.error('❌ Ошибка сохранения профиля:', error.message);
    console.error('❌ Код ошибки:', error.code);
    console.error('❌ Данные:', userData);
    console.error('❌ Stack trace:', error.stack);
    
    // 🔴 ПЫТАЕМСЯ ИСПРАВИТЬ ПРОБЛЕМУ С CHAT_ID
    if (error.message.includes('chat_id') && error.message.includes('null value')) {
      console.log('🔄 Пробую исправить проблему с chat_id...');
      try {
        // Пробуем исправить структуру таблицы
        await client.query(`ALTER TABLE users ALTER COLUMN chat_id DROP NOT NULL`);
        console.log('✅ Структура таблицы исправлена');
        
        // Пробуем снова сохранить
        const retryQuery = `
          INSERT INTO users (user_id, username, first_name, city, created_at, last_active)
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (user_id) 
          DO UPDATE SET 
            username = COALESCE(EXCLUDED.username, users.username),
            first_name = COALESCE(EXCLUDED.first_name, users.first_name),
            city = COALESCE(EXCLUDED.city, users.city),
            last_active = NOW()
          RETURNING id
        `;
        
        const retryValues = [
          dbUserId, 
          username || `Игрок_${dbUserId.slice(-4)}`, 
          first_name || 'Игрок', 
          city || 'Не указан'
        ];
        
        const retryResult = await client.query(retryQuery, retryValues);
        const retryId = retryResult.rows[0]?.id;
        console.log(`✅ Профиль сохранен после исправления: ID=${retryId}`);
        return retryId;
      } catch (retryError) {
        console.error('❌ Не удалось исправить проблему:', retryError.message);
      }
    }
    
    return null;
  } finally {
    client.release();
  }
}

/**
 * Получает профиль пользователя
 */
export async function getUserProfile(userId) {
  if (!pool) {
    console.error('❌ getUserProfile: Пул подключения не инициализирован');
    return null;
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`👤 Запрос профиля: ${dbUserId}`);
  
  const client = await pool.connect();
  try {
    const query = 'SELECT * FROM users WHERE user_id = $1';
    const result = await client.query(query, [dbUserId]);
    
    if (result.rows[0]) {
      console.log(`✅ Профиль найден: ${result.rows[0].username || 'без имени'}`);
      return result.rows[0];
    } else {
      console.log(`ℹ️ Профиль не найден для ${dbUserId}`);
      return null;
    }
  } catch (error) {
    console.error('❌ Ошибка получения профиля:', error.message);
    return null;
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ ГОРОДОВ (для совместимости) ============

/**
 * Сохраняет город пользователя (улучшенная версия)
 */
export async function saveUserCity(userId, city, username = null) {
  const dbUserId = convertUserIdForDb(userId);
  console.log(`📍 Сохранение города: ${dbUserId} -> "${city}"`);
  
  try {
    // Используем основную функцию с chat_id = null
    const result = await saveOrUpdateUser({
      user_id: dbUserId,
      username: username || '',
      first_name: username || 'Игрок',
      city: city || 'Не указан',
      chat_id: null // 🔴 ЯВНО УКАЗЫВАЕМ NULL
    });
    
    return { 
      success: !!result,
      user_id: dbUserId,
      city: city || 'Не указан',
      db_id: result
    };
  } catch (error) {
    console.error('❌ Ошибка saveUserCity:', error.message);
    
    // 🔴 РЕЗЕРВНЫЙ ВАРИАНТ: Пробуем напрямую
    if (pool) {
      const client = await pool.connect();
      try {
        const directQuery = `
          INSERT INTO user_sessions (user_id, username, selected_city)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id) 
          DO UPDATE SET 
            selected_city = EXCLUDED.selected_city,
            updated_at = NOW()
          RETURNING user_id
        `;
        
        const directResult = await client.query(directQuery, [
          dbUserId,
          username || `Игрок_${dbUserId.slice(-4)}`,
          city || 'Не указан'
        ]);
        
        if (directResult.rows[0]) {
          console.log(`✅ Город сохранен через резервный метод`);
          return { 
            success: true, 
            user_id: dbUserId,
            city: city || 'Не указан',
            source: 'fallback'
          };
        }
      } catch (directError) {
        console.error('❌ Ошибка резервного метода:', directError.message);
      } finally {
        client.release();
      }
    }
    
    return { 
      success: false, 
      error: error.message,
      user_id: dbUserId 
    };
  }
}

/**
 * Получает город пользователя
 */
export async function getUserCity(userId) {
  const dbUserId = convertUserIdForDb(userId);
  console.log(`📍 Запрос города: ${dbUserId}`);
  
  if (!pool) {
    console.error('❌ getUserCity: Пул подключения не инициализирован');
    return { 
      success: false, 
      error: 'Нет подключения к БД',
      city: 'Не указан',
      found: false 
    };
  }
  
  const client = await pool.connect();
  try {
    // Сначала пробуем из users
    const query = 'SELECT city FROM users WHERE user_id = $1';
    const result = await client.query(query, [dbUserId]);
    
    if (result.rows[0]) {
      const city = result.rows[0].city || 'Не указан';
      console.log(`✅ Город найден в users: "${city}"`);
      return { 
        success: true, 
        city: city,
        found: true,
        source: 'users' 
      };
    }
    
    // Если нет в users, пробуем user_sessions
    const sessionQuery = 'SELECT selected_city FROM user_sessions WHERE user_id = $1';
    const sessionResult = await client.query(sessionQuery, [dbUserId]);
    
    if (sessionResult.rows[0]) {
      const city = sessionResult.rows[0].selected_city || 'Не указан';
      console.log(`✅ Город найден в user_sessions: "${city}"`);
      return { 
        success: true, 
        city: city,
        found: true,
        source: 'user_sessions' 
      };
    }
    
    console.log(`ℹ️ Город не найден для ${dbUserId}`);
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
      error: error.message,
      city: 'Не указан',
      found: false 
    };
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ ИГР ============

/**
 * Сохраняет финальный результат игры в game_scores
 */
// Упрощенная версия без транзакции:
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
  if (!pool) {
    console.error('❌ saveGameScore: Пул подключения не инициализирован');
    return { 
      success: false, 
      error: 'Нет подключения к БД',
      id: null 
    };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  const finalUsername = username || `Игрок_${String(dbUserId).slice(-4)}`;
  
  console.log(`🎮 СОХРАНЕНИЕ: ${dbUserId} - ${score} очков (${gameType})`);
  
  const client = await pool.connect();
  
  try {
    // 1. Получаем или создаем пользователя с сохранением города
    const userProfile = await getUserProfile(dbUserId);
    const currentCity = userProfile?.city || 'Не указан';
    
    await saveOrUpdateUser({
      user_id: dbUserId,
      username: finalUsername,
      first_name: finalUsername,
      city: currentCity, // ← Сохраняем существующий город!
      chat_id: null
    });
    
    // 2. Сохраняем результат игры
    const gameQuery = `
      INSERT INTO game_scores (
        user_id, 
        username, 
        game_type, 
        score, 
        level, 
        lines, 
        is_win
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING id
    `;
    
    const result = await client.query(gameQuery, [
      dbUserId, 
      finalUsername, 
      gameType || 'tetris', 
      parseInt(score) || 0, 
      parseInt(level) || 1, 
      parseInt(lines) || 0,
      isWin
    ]);
    
    const savedId = result.rows[0]?.id;
    console.log(`✅ Результат сохранен! ID: ${savedId}`);
    
    // 3. Удаляем прогресс
    await client.query(
      'DELETE FROM game_progress WHERE user_id = $1 AND game_type = $2',
      [dbUserId, gameType || 'tetris']
    );
    
    return { 
      success: true, 
      id: savedId,
      user_id: dbUserId,
      username: finalUsername,
      score: parseInt(score) || 0
    };
    
  } catch (error) {
    console.error('💥 ОШИБКА СОХРАНЕНИЯ:', error.message);
    console.error('📌 Stack:', error.stack);
    
    return { 
      success: false, 
      error: error.message,
      code: error.code,
      id: null 
    };
  } finally {
    client.release();
  }
}

/**
 * Сохраняет прогресс игры (автосохранение)
 */
export async function saveGameProgress(userId, gameType, score, level, lines, username = null) {
  if (!pool) {
    console.error('❌ saveGameProgress: Пул подключения не инициализирован');
    return { 
      success: false, 
      error: 'Нет подключения к БД' 
    };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`💾 Сохранение прогресса: user=${dbUserId}, score=${score}`);
  
  const client = await pool.connect();
  
  try {
    // Сохраняем/обновляем информацию о пользователе с chat_id = null
    if (username) {
      try {
        await saveOrUpdateUser({
          user_id: dbUserId,
          username: username,
          first_name: username || 'Игрок',
          city: 'Не указан',
          chat_id: null // 🔴 ЯВНО УКАЗЫВАЕМ NULL
        });
        console.log(`👤 Данные пользователя обновлены для прогресса`);
      } catch (userError) {
        console.log('⚠️ Ошибка обновления пользователя:', userError.message);
      }
    }
    
    // Сохраняем прогресс игры
    const query = `
      INSERT INTO game_progress (user_id, game_type, score, level, lines, last_saved) 
      VALUES ($1, $2, $3, $4, $5, NOW()) 
      ON CONFLICT (user_id, game_type) 
      DO UPDATE SET 
        score = EXCLUDED.score,
        level = EXCLUDED.level,
        lines = EXCLUDED.lines,
        last_saved = NOW()
      RETURNING user_id, last_saved
    `;
    
    const result = await client.query(query, [
      dbUserId, 
      gameType || 'tetris', 
      parseInt(score) || 0, 
      parseInt(level) || 1, 
      parseInt(lines) || 0
    ]);
    
    const savedTime = result.rows[0]?.last_saved;
    console.log(`✅ Прогресс сохранен: ${score} очков (время: ${savedTime})`);
    
    return { 
      success: true, 
      user_id: result.rows[0]?.user_id, 
      last_saved: savedTime 
    };
    
  } catch (error) {
    console.error('❌ Ошибка сохранения прогресса:', error.message);
    console.error('❌ Параметры:', { 
      userId: dbUserId, 
      gameType, 
      score 
    });
    
    return { 
      success: false, 
      error: error.message 
    };
  } finally {
    client.release();
  }
}

/**
 * Получает сохраненный прогресс игры
 */
export async function getGameProgress(userId, gameType = 'tetris') {
  if (!pool) {
    console.error('❌ getGameProgress: Пул подключения не инициализирован');
    return { 
      success: false, 
      error: 'Нет подключения к БД',
      found: false 
    };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`📥 Запрос прогресса: user=${dbUserId}, type=${gameType}`);
  
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
      const progressData = {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved
      };
      
      console.log(`✅ Прогресс найден: ${progressData.score} очков`);
      return { 
        success: true, 
        found: true, 
        progress: progressData 
      };
    }
    
    console.log(`ℹ️ Прогресс не найден для пользователя ${dbUserId}`);
    return { 
      success: true, 
      found: false, 
      progress: null 
    };
    
  } catch (error) {
    console.error('❌ Ошибка получения прогресса:', error.message);
    
    return { 
      success: false, 
      error: error.message,
      found: false 
    };
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИЯ ПОЛУЧЕНИЯ СТАТИСТИКИ ИГРОКА ==========

/**
 * Получает полную статистику игрока
 */
export async function getGameStats(userId, gameType = 'tetris') {
  if (!pool) {
    return { success: false, stats: null };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`📊 Запрос РЕАЛЬНОЙ статистики для: ${dbUserId}`);
  
  const client = await pool.connect();
  
  try {
    // 🔴 1. Считаем ТОЛЬКО ЗАВЕРШЕННЫЕ ИГРЫ (game_scores)
    const statsQuery = `
      SELECT 
        COUNT(*) as games_played,
        COUNT(CASE WHEN is_win THEN 1 END) as wins,
        COALESCE(MAX(score), 0) as best_score,
        COALESCE(AVG(score), 0) as avg_score,
        COALESCE(MAX(level), 1) as best_level,
        COALESCE(MAX(lines), 0) as best_lines,
        COALESCE(SUM(score), 0) as total_score,
        MAX(created_at) as last_played
      FROM game_scores 
      WHERE user_id = $1 
        AND game_type = $2
        AND is_win = true  -- 🔴 ТОЛЬКО победы (завершенные игры)
    `;
    
    const statsResult = await client.query(statsQuery, [dbUserId, gameType]);
    const stats = statsResult.rows[0] || {
      games_played: 0,
      wins: 0,
      best_score: 0,
      avg_score: 0,
      best_level: 1,
      best_lines: 0,
      total_score: 0,
      last_played: null
    };
    
    console.log(`📊 Статистика из БД:`, {
      games: stats.games_played,
      best: stats.best_score,
      avg: stats.avg_score
    });
    
    // 🔴 2. Получаем город из users
    let city = 'Не указан';
    try {
      const cityResult = await client.query(
        'SELECT city FROM users WHERE user_id = $1',
        [dbUserId]
      );
      if (cityResult.rows[0] && cityResult.rows[0].city !== 'Не указан') {
        city = cityResult.rows[0].city;
      }
    } catch (cityError) {
      console.log('⚠️ Город не получен:', cityError.message);
    }
    
    // 🔴 3. Проверяем, есть ли НЕЗАВЕРШЕННАЯ игра (прогресс)
    const progressResult = await client.query(`
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `, [dbUserId, gameType]);
    
    const progress = progressResult.rows[0];
    const hasUnfinishedGame = !!progress;
    
    // 🔴 4. Формируем понятные данные
    const gamesPlayed = parseInt(stats.games_played) || 0;
    const hasAnyGames = gamesPlayed > 0 || hasUnfinishedGame;
    
    const statsData = {
      games_played: gamesPlayed,
      wins: parseInt(stats.wins) || 0,
      losses: gamesPlayed - (parseInt(stats.wins) || 0),
      best_score: parseInt(stats.best_score) || 0,
      avg_score: Math.round(parseFloat(stats.avg_score)) || 0,
      best_level: parseInt(stats.best_level) || 1,
      best_lines: parseInt(stats.best_lines) || 0,
      total_score: parseInt(stats.total_score) || 0,
      last_played: stats.last_played,
      current_progress: hasUnfinishedGame ? {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved
      } : null,
      has_unfinished_game: hasUnfinishedGame,
      has_any_games: hasAnyGames,  // 🔴 НОВОЕ ПОЛЕ
      city: city,
      user_id: dbUserId,
      isWebApp: dbUserId.startsWith('web_')
    };
    
    console.log(`✅ Статистика сформирована:`, {
      games: statsData.games_played,
      bestScore: statsData.best_score,
      hasGames: statsData.has_any_games,
      hasUnfinished: statsData.has_unfinished_game,
      city: statsData.city
    });
    
    return { 
      success: true, 
      stats: statsData,
      has_stats: gamesPlayed > 0,
      has_progress: hasUnfinishedGame
    };
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error.message);
    return { 
      success: false, 
      error: error.message,
      stats: null
    };
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИЯ ТОПА ИГРОКОВ С ГОРОДАМИ ==========

/**
 * Получает топ игроков с городами
 */
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  if (!pool) {
    return { success: false, players: [] };
  }
  
  const client = await pool.connect();
  
  try {
    // 🔴 ПРОСТОЙ И НАДЕЖНЫЙ ЗАПРОС: только ЛУЧШИЕ завершенные игры
    // ИСПРАВЛЕННЫЙ SQL ЗАПРОС:
const query = `
  SELECT 
    gs.user_id,
    COALESCE(
      u.username, 
      gs.username, 
      CASE 
        WHEN gs.user_id LIKE 'web_%' THEN CONCAT('🌐 Игрок ', SUBSTRING(gs.user_id FROM LENGTH(gs.user_id)-3))
        ELSE CONCAT('👤 Игрок ', SUBSTRING(gs.user_id FROM LENGTH(gs.user_id)-3))
      END
    ) as display_name,
    COALESCE(u.city, 'Не указан') as city,
    MAX(gs.score) as best_score,
    COUNT(*) as games_played,
    MAX(gs.level) as best_level,
    MAX(gs.lines) as best_lines,
    MAX(gs.created_at) as last_played,
    u.first_name
  FROM game_scores gs
  LEFT JOIN users u ON gs.user_id = u.user_id
  WHERE gs.game_type = $1 
    AND gs.score > 0
    AND gs.user_id IS NOT NULL
    AND gs.user_id != ''
  GROUP BY gs.user_id, u.username, gs.username, u.city, u.first_name
  HAVING MAX(gs.score) > 0
  ORDER BY MAX(gs.score) DESC, COUNT(*) DESC, MAX(gs.created_at) DESC
  LIMIT $2
`;
    
    console.log('🏆 SQL: Ищем только завершенные игры (мин. 1000 очков)');
    
    const result = await client.query(query, [gameType, limit]);
    console.log(`🏆 Найдено завершенных игр в топе: ${result.rows.length}`);
    
    // 🔴 ЕСЛИ НЕТ ЗАВЕРШЕННЫХ ИГР - ВОЗВРАЩАЕМ ПУСТОЙ ТОП
    if (result.rows.length === 0) {
      console.log('ℹ️ Нет завершенных игр с результатом > 1000 очков');
      return { 
        success: true, 
        players: [], 
        count: 0,
        message: 'Топ пуст - пока никто не завершил игру с хорошим результатом'
      };
    }
    
    // 🔴 УПРОЩЕННОЕ ФОРМИРОВАНИЕ ИМЕН
    const topPlayers = result.rows.map((row, index) => {
      // Простое имя: или first_name, или game_username, или Игрок + ID
      let displayName = 'Игрок';
      
      if (row.first_name && row.first_name.trim() && row.first_name !== 'Игрок') {
        displayName = row.first_name.trim();
      } else if (row.display_name && row.display_name.trim() && row.display_name !== 'Игрок') {
        displayName = row.display_name.trim();
      } else if (row.game_username && row.game_username.trim() && row.game_username !== 'Игрок') {
        displayName = row.game_username.trim();
      } else if (row.user_id) {
        const cleanId = String(row.user_id).slice(-4);
        displayName = `Игрок ${cleanId}`;
      }
      
      return {
        rank: index + 1,
        user_id: row.user_id,
        username: displayName,
        city: row.city || 'Не указан',
        score: parseInt(row.best_score) || 0,
        level: parseInt(row.level) || 1,
        lines: parseInt(row.lines) || 0,
        games_played: parseInt(row.games_played) || 1,
        last_played: row.last_played,
        is_completed_game: true // 🔴 ФЛАГ ЧТО ЭТО ЗАВЕРШЕННАЯ ИГРА
      };
    });
    
    // 🔴 ЛОГИРОВАНИЕ
    console.log('🏆 ТОП (только завершенные игры):');
    topPlayers.forEach((p, i) => {
      console.log(`${i+1}. ${p.username} - ${p.score} очков (${p.city})`);
    });
    
    return { 
      success: true, 
      players: topPlayers, 
      count: topPlayers.length
    };
    
  } catch (error) {
    console.error('❌ Ошибка топа:', error.message);
    return { 
      success: true, 
      players: [], 
      error: error.message 
    };
  } finally {
    client.release();
  }
}

/**
 * Альтернативная функция для топа с городами
 */
export async function getTopPlayersWithCities(limit = 10) {
  const result = await getTopPlayers('tetris', limit);
  return result.success ? result.players : [];
}

// ============ ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Удаляет прогресс игры
 */
export async function deleteGameProgress(userId, gameType = 'tetris') {
  if (!pool) {
    console.error('❌ deleteGameProgress: Пул подключения не инициализирован');
    return { 
      success: false, 
      error: 'Нет подключения к БД',
      deleted: false 
    };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`🗑️ Удаление прогресса: user=${dbUserId}, type=${gameType}`);
  
  const client = await pool.connect();
  
  try {
    const query = `
      DELETE FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
      RETURNING user_id
    `;
    
    const result = await client.query(query, [dbUserId, gameType]);
    
    if (result.rows[0]) {
      console.log(`✅ Прогресс удален для пользователя ${dbUserId}`);
      return { 
        success: true, 
        deleted: true,
        user_id: result.rows[0].user_id 
      };
    } else {
      console.log(`ℹ️ Прогресс не найден для удаления`);
      return { 
        success: true, 
        deleted: false 
      };
    }
    
  } catch (error) {
    console.error('❌ Ошибка удаления прогресса:', error.message);
    
    return { 
      success: false, 
      error: error.message,
      deleted: false 
    };
  } finally {
    client.release();
  }
}

/**
 * Проверяет соединение с базой данных
 */
export async function checkDatabaseConnection() {
  return await testConnection();
}

/**
 * Отладочная информация о базе данных
 */
export async function debugDatabase() {
  try {
    console.log('🔍 Отладка базы данных...');
    
    const connection = await checkDatabaseConnection();
    console.log('🔍 Соединение с БД:', connection.success ? '✅' : '❌');
    
    if (!connection.success) {
      return { success: false, error: connection.error };
    }
    
    const client = await pool.connect();
    
    try {
      // Сводная информация по всем таблицам
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
      
      console.log('📊 Структура базы данных:');
      for (const table of tablesInfo.rows) {
        console.log(`   ${table.table_name}: ${table.columns_count} колонок, ${table.rows_count} записей`);
      }
      
      // Проверяем основные таблицы
      const tables = ['users', 'game_scores', 'game_progress', 'user_sessions'];
      
      for (const table of tables) {
        try {
          const sample = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
          const count = sample.rows[0]?.count || 0;
          console.log(`📋 ${table}: ${count} записей`);
          
          if (count > 0) {
            const columns = await client.query(`
              SELECT column_name, data_type, is_nullable 
              FROM information_schema.columns 
              WHERE table_name = '${table}' 
              ORDER BY ordinal_position
            `);
            console.log(`   Колонки:`);
            columns.rows.forEach(c => {
              console.log(`     ${c.column_name}: ${c.data_type} ${c.is_nullable === 'YES' ? '(NULL)' : '(NOT NULL)'}`);
            });
          }
        } catch (e) {
          console.log(`⚠️ ${table}: ${e.message}`);
        }
      }
      
      return { 
        success: true, 
        connection: connection,
        tables: tablesInfo.rows 
      };
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('🔍 Ошибка отладки БД:', error.message);
    return { 
      success: false, 
      error: error.message 
    };
  }
}
/**
 * Функция для отладки сохранения данных
 */
export async function debugGameSave(userId, gameData) {
  console.log('🔍 ОТЛАДКА СОХРАНЕНИЯ ИГРЫ:');
  console.log('📋 Входные данные:');
  console.log('   User ID:', userId);
  console.log('   Данные игры:', gameData);
  
  const dbUserId = convertUserIdForDb(userId);
  console.log('   Преобразованный ID:', dbUserId);
  
  const client = await pool.connect();
  try {
    // Проверяем существование пользователя
    const userCheck = await client.query(
      'SELECT user_id, username, city FROM users WHERE user_id = $1',
      [dbUserId]
    );
    console.log('👤 Существующий пользователь:', userCheck.rows[0] || 'Не найден');
    
    // Проверяем существующие записи в game_scores
    const scoresCheck = await client.query(
      'SELECT COUNT(*) as count, MAX(score) as max_score FROM game_scores WHERE user_id = $1',
      [dbUserId]
    );
    console.log('🎮 Существующие записи:', scoresCheck.rows[0]);
    
    // Пробуем сохранить
    const saveResult = await saveGameScore(userId, 
      gameData.gameType || 'tetris',
      gameData.score || 0,
      gameData.level || 1,
      gameData.lines || 0,
      gameData.username
    );
    
    console.log('💾 Результат сохранения:', saveResult);
    
    // Проверяем сохраненное
    const verify = await client.query(
      'SELECT id, score, created_at FROM game_scores WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [dbUserId]
    );
    console.log('✅ Проверка сохраненного:', verify.rows[0] || 'Не найдено');
    
    return {
      user_exists: !!userCheck.rows[0],
      previous_scores: scoresCheck.rows[0],
      save_result: saveResult,
      verified: verify.rows[0]
    };
    
  } finally {
    client.release();
  }
}
/**
 * Проверяет целостность данных в базе
 */
export async function verifyDataIntegrity() {
  const client = await pool.connect();
  try {
    console.log('🔍 ПРОВЕРКА ЦЕЛОСТНОСТИ ДАННЫХ');
    
    // Проверяем пользователей без игр
    const usersWithoutGames = await client.query(`
      SELECT u.user_id, u.username, u.created_at
      FROM users u
      LEFT JOIN game_scores gs ON u.user_id = gs.user_id
      WHERE gs.id IS NULL
      LIMIT 10
    `);
    console.log('👤 Пользователи без игр:', usersWithoutGames.rows.length);
    
    // Проверяем игры без пользователей
    const gamesWithoutUsers = await client.query(`
      SELECT gs.id, gs.user_id, gs.score, gs.created_at
      FROM game_scores gs
      LEFT JOIN users u ON gs.user_id = u.user_id
      WHERE u.id IS NULL
      LIMIT 10
    `);
    console.log('🎮 Игры без пользователей:', gamesWithoutUsers.rows.length);
    
    // Самый высокий счет
    const topScore = await client.query(`
      SELECT gs.user_id, gs.username, gs.score, u.city, gs.created_at
      FROM game_scores gs
      LEFT JOIN users u ON gs.user_id = u.user_id
      ORDER BY gs.score DESC
      LIMIT 1
    `);
    console.log('🏆 Самый высокий счет:', topScore.rows[0]);
    
    // Статистика по таблицам
    const stats = {
      users: await client.query('SELECT COUNT(*) FROM users'),
      game_scores: await client.query('SELECT COUNT(*) FROM game_scores'),
      game_progress: await client.query('SELECT COUNT(*) FROM game_progress'),
      user_sessions: await client.query('SELECT COUNT(*) FROM user_sessions')
    };
    
    console.log('📊 Статистика таблиц:');
    console.log('   users:', stats.users.rows[0].count);
    console.log('   game_scores:', stats.game_scores.rows[0].count);
    console.log('   game_progress:', stats.game_progress.rows[0].count);
    console.log('   user_sessions:', stats.user_sessions.rows[0].count);
    
    return {
      users_count: parseInt(stats.users.rows[0].count),
      games_count: parseInt(stats.game_scores.rows[0].count),
      top_score: topScore.rows[0],
      orphaned_users: usersWithoutGames.rows,
      orphaned_games: gamesWithoutUsers.rows
    };
    
  } finally {
    client.release();
  }
}
/**
 * Диагностика подключения
 */
export async function diagnoseConnection() {
  const results = {
    timestamp: new Date().toISOString(),
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    databaseUrlType: process.env.DATABASE_URL?.includes('neon.tech') ? 'Neon' : 'Unknown',
    databaseUrlLength: process.env.DATABASE_URL?.length || 0,
    nodeEnv: process.env.NODE_ENV || 'development',
    connectionTest: await testConnection()
  };
  
  console.log('🔍 Диагностика подключения к БД:', results);
  return results;
}

// 🔴 АВТОМАТИЧЕСКАЯ ОТЛАДКА ПРИ ЗАПУСКЕ
if (process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL) {
  setTimeout(() => {
    console.log('🔧 Запуск автоотладки БД...');
    debugDatabase().then(result => {
      if (result.success) {
        console.log('✅ Отладка БД завершена успешно');
      } else {
        console.error('❌ Отладка БД завершена с ошибкой:', result.error);
      }
    }).catch(error => {
      console.error('💥 Ошибка при автоотладке:', error);
    });
  }, 3000);
}

// Экспортируем pool для использования в других частях приложения
export { pool };
