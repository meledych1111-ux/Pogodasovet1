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

// 🔴 УНИВЕРСАЛЬНАЯ ФУНКЦИЯ КОНВЕРТАЦИИ USER_ID (улучшенная)
function convertUserIdForDb(userId) {
  console.log(`🔧 convertUserIdForDb вызвана с:`, {
    значение: userId,
    тип: typeof userId,
    длина: userId ? String(userId).length : 0
  });
  
  if (userId === undefined || userId === null) {
    console.error('❌ convertUserIdForDb: userId не определен (undefined/null)');
    const fallbackId = 'unknown_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    console.log(`🔄 Возвращаем fallback ID: ${fallbackId}`);
    return fallbackId;
  }
  
  const userIdStr = String(userId).trim();
  
  if (userIdStr === '') {
    console.error('❌ convertUserIdForDb: userId пустая строка');
    const fallbackId = 'empty_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    console.log(`🔄 Возвращаем fallback ID: ${fallbackId}`);
    return fallbackId;
  }
  
  console.log(`🔧 Обработанный userId: "${userIdStr}"`);
  
  if (userIdStr.startsWith('web_')) {
    console.log(`🔧 Определен как web-пользователь`);
    return userIdStr;
  } else if (/^\d+$/.test(userIdStr)) {
    console.log(`🔧 Определен как Telegram ID (числовой)`);
    return userIdStr;
  } else {
    console.log(`🔧 Определен как другой тип ID`);
    return userIdStr;
  }
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

// 🔴 ФУНКЦИЯ СОЗДАНИЯ ВСЕХ НЕОБХОДИМЫХ ТАБЛИЦ
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
    
    // 🔴 1. Таблица users (исправленная)
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
    
    // 🔴 2. Таблица user_sessions (для совместимости)
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
    
    // 🔴 3. Таблица game_scores (основная таблица результатов)
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
    
    // 🔴 4. Таблица game_progress
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
    
    // 🔴 5. Создаем индексы
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
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_city ON game_scores(city)
    `);
    
    // Индексы для users
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)
    `);
    
    // Индексы для user_sessions
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_city ON user_sessions(selected_city)
    `);
    
    // Индексы для game_progress
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_progress_user ON game_progress(user_id)
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

// ============ ФУНКЦИИ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ ============

/**
 * Сохраняет или обновляет профиль пользователя в таблице users
 */
export async function saveOrUpdateUser(userData) {
  console.log('👤🔄 ========== СОХРАНЕНИЕ ПОЛЬЗОВАТЕЛЯ НАЧАЛО ==========');
  console.log('📥 Входные данные:', userData);
  
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

  const dbUserId = convertUserIdForDb(user_id);
  
  console.log(`👤 Сохранение профиля: user_id="${dbUserId}", city="${city}", chat_id=${chat_id || 'NULL'}`);
  
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
    
    console.log('📝 Параметры запроса:', values);
    
    const result = await client.query(query, values);
    const userId = result.rows[0]?.id;
    
    console.log(`✅ Профиль сохранен/обновлен: ID=${userId}`);
    
    // Также сохраняем в user_sessions для совместимости
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
    
    console.log('👤✅ ========== СОХРАНЕНИЕ ПОЛЬЗОВАТЕЛЯ УСПЕШНО ==========');
    
    return userId;
  } catch (error) {
    console.error('❌ Ошибка сохранения профиля:', error.message);
    console.error('❌ Код ошибки:', error.code);
    console.error('❌ Данные:', userData);
    
    // Пробуем упрощенный запрос
    if (error.code === '23505' || error.message.includes('unique')) {
      console.log('🔄 Пробую упрощенный запрос...');
      try {
        const simpleQuery = `
          INSERT INTO users (user_id, username, first_name, city)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id) DO NOTHING
          RETURNING id
        `;
        const simpleResult = await client.query(simpleQuery, [
          dbUserId, 
          username || `Игрок_${dbUserId.slice(-4)}`, 
          first_name || 'Игрок', 
          city || 'Не указан'
        ]);
        
        if (simpleResult.rows[0]) {
          console.log(`✅ Профиль сохранен через упрощенный запрос: ID=${simpleResult.rows[0].id}`);
          return simpleResult.rows[0].id;
        } else {
          // Пользователь уже существует, получаем его ID
          const existingUser = await client.query('SELECT id FROM users WHERE user_id = $1', [dbUserId]);
          if (existingUser.rows[0]) {
            console.log(`✅ Пользователь уже существует: ID=${existingUser.rows[0].id}`);
            return existingUser.rows[0].id;
          }
        }
      } catch (simpleError) {
        console.error('❌ Упрощенный запрос тоже не удался:', simpleError.message);
      }
    }
    
    return null;
  } finally {
    client.release();
    console.log('👤🔄 ========== СОХРАНЕНИЕ ПОЛЬЗОВАТЕЛЯ КОНЕЦ ==========\n');
  }
}

/**
 * Получает профиль пользователя
 */
export async function getUserProfile(userId) {
  console.log('👤📥 ========== ПОЛУЧЕНИЕ ПРОФИЛЯ НАЧАЛО ==========');
  
  if (!pool) {
    console.error('❌ getUserProfile: Пул подключения не инициализирован');
    return null;
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`👤 Запрос профиля: "${dbUserId}"`);
  
  const client = await pool.connect();
  try {
    const query = 'SELECT * FROM users WHERE user_id = $1';
    const result = await client.query(query, [dbUserId]);
    
    if (result.rows[0]) {
      console.log(`✅ Профиль найден: ${result.rows[0].username || 'без имени'}`);
      console.log('👤✅ ========== ПОЛУЧЕНИЕ ПРОФИЛЯ УСПЕШНО ==========');
      return result.rows[0];
    } else {
      console.log(`ℹ️ Профиль не найден для ${dbUserId}`);
      console.log('👤✅ ========== ПОЛУЧЕНИЕ ПРОФИЛЯ ЗАВЕРШЕНО ==========');
      return null;
    }
  } catch (error) {
    console.error('❌ Ошибка получения профиля:', error.message);
    return null;
  } finally {
    client.release();
    console.log('👤📥 ========== ПОЛУЧЕНИЕ ПРОФИЛЯ КОНЕЦ ==========\n');
  }
}

// ============ ФУНКЦИИ ДЛЯ ГОРОДОВ ============

/**
 * Сохраняет город пользователя
 */
export async function saveUserCity(userId, city, username = null) {
  const dbUserId = convertUserIdForDb(userId);
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
  console.log(`📍 Запрос города для: "${dbUserId}"`);
  
  if (!pool) {
    return { 
      success: false, 
      error: 'Нет подключения к БД',
      city: 'Не указан',
      found: false 
    };
  }
  
  const client = await pool.connect();
  try {
    // 1. Проверяем users
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
    
    // 2. Проверяем user_sessions
    const sessionQuery = 'SELECT selected_city FROM user_sessions WHERE user_id = $1';
    const sessionResult = await client.query(sessionQuery, [dbUserId]);
    
    if (sessionResult.rows[0] && sessionResult.rows[0].selected_city !== 'Не указан') {
      const city = sessionResult.rows[0].selected_city;
      console.log(`✅ Город найден в user_sessions: "${city}"`);
      return { 
        success: true, 
        city: city,
        found: true,
        source: 'user_sessions' 
      };
    }
    
    // 3. Проверяем последнюю игру пользователя
    const gameQuery = `
      SELECT city FROM game_scores 
      WHERE user_id = $1 AND city != 'Не указан' 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    const gameResult = await client.query(gameQuery, [dbUserId]);
    
    if (gameResult.rows[0]) {
      const city = gameResult.rows[0].city;
      console.log(`✅ Город найден в последней игре: "${city}"`);
      return { 
        success: true, 
        city: city,
        found: true,
        source: 'game_scores' 
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
 * Сохраняет финальный результат игры в game_scores (с расширенной отладкой)
 */
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
  console.log('🎮🔄 ========== СОХРАНЕНИЕ ИГРЫ НАЧАЛО ==========');
  console.log('📥 Входные параметры:', {
    userId,
    gameType,
    score,
    level,
    lines,
    username,
    isWin,
    timestamp: new Date().toISOString()
  });
  
  if (!pool) {
    console.error('❌ saveGameScore: Пул подключения не инициализирован');
    return { 
      success: false, 
      error: 'Нет подключения к БД',
      id: null 
    };
  }
  
  // 🔴 ВАЖНО: Не сохраняем игру с нулевым счетом
  if (parseInt(score) === 0 && isWin) {
    console.log('⚠️ Игра с 0 очками, пропускаем сохранение');
    return { 
      success: false, 
      error: 'Игра с нулевым счетом',
      id: null 
    };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`🔧 Преобразованный user_id: "${dbUserId}" (оригинал: "${userId}")`);
  
  const finalUsername = username || `Игрок_${String(dbUserId).slice(-4)}`;
  console.log(`👤 Имя для сохранения: "${finalUsername}"`);
  
  console.log(`🎮 Попытка сохранения: ${dbUserId} - ${score} очков (${gameType})`);
  
  const client = await pool.connect();
  console.log('🔗 Подключение к БД получено');
  
  try {
    // 1. Получаем актуальный город пользователя
    console.log('📍 Шаг 1: Получаем город пользователя...');
    let currentCity = 'Не указан';
    
    // Пробуем разные способы получить город
    try {
      // Сначала через getUserCity
      const cityResult = await getUserCity(userId);
      if (cityResult.success && cityResult.city !== 'Не указан') {
        currentCity = cityResult.city;
        console.log(`✅ Город получен через getUserCity: "${currentCity}"`);
      } else {
        // Пробуем через профиль
        const userProfile = await getUserProfile(dbUserId);
        if (userProfile?.city && userProfile.city !== 'Не указан') {
          currentCity = userProfile.city;
          console.log(`✅ Город получен из профиля: "${currentCity}"`);
        } else {
          // Пробуем через user_sessions
          const sessionResult = await client.query(
            'SELECT selected_city FROM user_sessions WHERE user_id = $1',
            [dbUserId]
          );
          if (sessionResult.rows[0]?.selected_city && 
              sessionResult.rows[0].selected_city !== 'Не указан') {
            currentCity = sessionResult.rows[0].selected_city;
            console.log(`✅ Город получен из user_sessions: "${currentCity}"`);
          }
        }
      }
    } catch (cityError) {
      console.error('❌ Ошибка получения города:', cityError.message);
    }
    
    console.log(`📍 Итоговый город для сохранения: "${currentCity}"`);
    
    // 2. Сохраняем/обновляем пользователя
    console.log('👤 Шаг 2: Сохраняем/обновляем пользователя...');
    const userSaveResult = await saveOrUpdateUser({
      user_id: dbUserId,
      username: finalUsername,
      first_name: finalUsername,
      city: currentCity, // Используем полученный город
      chat_id: null
    });
    
    if (userSaveResult) {
      console.log(`✅ Пользователь сохранен/обновлен. ID: ${userSaveResult}`);
    } else {
      console.log('⚠️ Не удалось сохранить пользователя, продолжаем...');
    }
    
    // 3. Сохраняем результат игры
    console.log('🎮 Шаг 3: Сохраняем результат игры в game_scores...');
    
    // 🔴 ВАЖНО: Если игра не завершена и мало очков - сохраняем как прогресс
    if (!isWin && parseInt(score) < 1000) {
      console.log('⚠️ Игра не завершена или мало очков, сохраняем как прогресс');
      const progressResult = await saveGameProgress(userId, gameType, score, level, lines, username);
      
      return {
        success: true,
        id: null,
        user_id: dbUserId,
        username: finalUsername,
        score: parseInt(score) || 0,
        city: currentCity,
        saved_as_progress: true,
        progress_id: progressResult.user_id
      };
    }
    
    const gameQuery = `
      INSERT INTO game_scores (
        user_id, 
        username, 
        game_type, 
        score, 
        level, 
        lines, 
        is_win,
        city
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING id, created_at
    `;
    
    const queryParams = [
      dbUserId, 
      finalUsername, 
      gameType || 'tetris', 
      parseInt(score) || 0, 
      parseInt(level) || 1, 
      parseInt(lines) || 0,
      isWin,
      currentCity  // 🔴 Город передается в запрос
    ];
    
    console.log('📝 Параметры SQL запроса:', queryParams);
    
    const result = await client.query(gameQuery, queryParams);
    
    const savedId = result.rows[0]?.id;
    const createdAt = result.rows[0]?.created_at;
    
    console.log(`✅ Результат игры сохранен! ID: ${savedId}, город: "${currentCity}"`);
    
    // 4. Удаляем прогресс (если был)
    if (isWin) {
      console.log('🗑️ Шаг 4: Удаляем сохраненный прогресс...');
      await client.query(
        'DELETE FROM game_progress WHERE user_id = $1 AND game_type = $2',
        [dbUserId, gameType || 'tetris']
      );
    }
    
    console.log('🎮✅ ========== СОХРАНЕНИЕ ИГРЫ УСПЕШНО ==========');
    
    return { 
      success: true, 
      id: savedId,
      user_id: dbUserId,
      username: finalUsername,
      score: parseInt(score) || 0,
      city: currentCity,
      created_at: createdAt
    };
    
  } catch (error) {
    console.error('💥❌ ОШИБКА СОХРАНЕНИЯ ИГРЫ:', error.message);
    // ... обработка ошибок
  } finally {
    client.release();
    console.log('🎮🔄 ========== СОХРАНЕНИЕ ИГРЫ КОНЕЦ ==========\n');
  }
}

/**
 * Сохраняет прогресс игры (автосохранение) с расширенной отладкой
 */
export async function saveGameProgress(userId, gameType, score, level, lines, username = null) {
  console.log('💾🔄 ========== СОХРАНЕНИЕ ПРОГРЕССА НАЧАЛО ==========');
  console.log('📥 Входные параметры:', {
    userId,
    gameType,
    score,
    level,
    lines,
    username,
    timestamp: new Date().toISOString()
  });
  
  if (!pool) {
    console.error('❌ saveGameProgress: Пул подключения не инициализирован');
    return { 
      success: false, 
      error: 'Нет подключения к БД' 
    };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`🔧 Преобразованный user_id: "${dbUserId}"`);
  
  console.log(`💾 Сохранение прогресса: user=${dbUserId}, score=${score}, game=${gameType}`);
  
  const client = await pool.connect();
  console.log('🔗 Подключение к БД получено');
  
  try {
    // Сохраняем/обновляем информацию о пользователе с chat_id = null
    if (username) {
      console.log('👤 Обновляем данные пользователя...');
      try {
        const userResult = await saveOrUpdateUser({
          user_id: dbUserId,
          username: username,
          first_name: username || 'Игрок',
          city: 'Не указан',
          chat_id: null
        });
        console.log(`✅ Данные пользователя обновлены. ID: ${userResult}`);
      } catch (userError) {
        console.log('⚠️ Ошибка обновления пользователя:', userError.message);
        console.log('Продолжаем без обновления пользователя...');
      }
    }
    
    // Сохраняем прогресс игры
    console.log('💾 Сохраняем прогресс в game_progress...');
    const query = `
      INSERT INTO game_progress (user_id, game_type, score, level, lines, last_saved) 
      VALUES ($1, $2, $3, $4, $5, NOW()) 
      ON CONFLICT (user_id, game_type) 
      DO UPDATE SET 
        score = EXCLUDED.score,
        level = EXCLUDED.level,
        lines = EXCLUDED.lines,
        last_saved = NOW()
      RETURNING user_id, last_saved, score, level
    `;
    
    const queryParams = [
      dbUserId, 
      gameType || 'tetris', 
      parseInt(score) || 0, 
      parseInt(level) || 1, 
      parseInt(lines) || 0
    ];
    
    console.log('📝 Параметры SQL запроса:', {
      query: 'INSERT INTO game_progress ... ON CONFLICT ...',
      params: queryParams
    });
    
    const result = await client.query(query, queryParams);
    
    const savedTime = result.rows[0]?.last_saved;
    const savedScore = result.rows[0]?.score;
    const savedLevel = result.rows[0]?.level;
    
    console.log(`✅ Прогресс сохранен:`, {
      score: savedScore,
      level: savedLevel,
      время: savedTime,
      конфликт_обработан: result.rowCount > 0 ? 'да' : 'нет',
      rows_affected: result.rowCount
    });
    
    // Проверяем сохраненный прогресс
    console.log('🔍 Проверяем сохраненный прогресс...');
    const verifyQuery = await client.query(
      'SELECT user_id, score, level, lines, last_saved FROM game_progress WHERE user_id = $1 AND game_type = $2',
      [dbUserId, gameType || 'tetris']
    );
    
    if (verifyQuery.rows[0]) {
      console.log('✅ Прогресс верифицирован:', verifyQuery.rows[0]);
    }
    
    console.log('💾✅ ========== СОХРАНЕНИЕ ПРОГРЕССА УСПЕШНО ==========');
    
    return { 
      success: true, 
      user_id: result.rows[0]?.user_id, 
      last_saved: savedTime,
      score: savedScore,
      level: savedLevel
    };
    
  } catch (error) {
    console.error('💥❌ ========== ОШИБКА СОХРАНЕНИЯ ПРОГРЕССА ==========');
    console.error('📛 Ошибка:', error.message);
    console.error('🔢 Код ошибки:', error.code);
    console.error('📌 Stack trace:');
    console.error(error.stack);
    
    console.error('📊 Параметры запроса:', { 
      userId: dbUserId, 
      gameType, 
      score,
      level,
      lines
    });
    
    if (error.code === '42P01') { // table does not exist
      console.error('⚠️ Таблица game_progress не существует!');
      try {
        const tables = await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        );
        console.error('📋 Существующие таблицы:', tables.rows.map(t => t.table_name));
      } catch (e) {
        console.error('Не удалось получить список таблиц:', e.message);
      }
    }
    
    console.error('💥❌ ========== КОНЕЦ ОШИБКИ ==========');
    
    return { 
      success: false, 
      error: error.message,
      code: error.code 
    };
  } finally {
    console.log('🔌 Освобождаем подключение к БД...');
    client.release();
    console.log('💾🔄 ========== СОХРАНЕНИЕ ПРОГРЕССА КОНЕЦ ==========\n');
  }
}

/**
 * Получает сохраненный прогресс игры с расширенной отладкой
 */
export async function getGameProgress(userId, gameType = 'tetris') {
  console.log('📥🔄 ========== ПОЛУЧЕНИЕ ПРОГРЕССА НАЧАЛО ==========');
  console.log('📥 Входные параметры:', {
    userId,
    gameType,
    timestamp: new Date().toISOString()
  });
  
  if (!pool) {
    console.error('❌ getGameProgress: Пул подключения не инициализирован');
    return { 
      success: false, 
      error: 'Нет подключения к БД',
      found: false 
    };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`🔧 Преобразованный user_id: "${dbUserId}"`);
  
  console.log(`📥 Запрос прогресса: user=${dbUserId}, type=${gameType}`);
  
  const client = await pool.connect();
  console.log('🔗 Подключение к БД получено');
  
  try {
    const query = `
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `;
    
    console.log('📝 SQL запрос:', query);
    console.log('📋 Параметры:', [dbUserId, gameType]);
    
    const startTime = Date.now();
    const result = await client.query(query, [dbUserId, gameType]);
    const queryTime = Date.now() - startTime;
    
    console.log(`⏱️ Время выполнения запроса: ${queryTime}ms`);
    console.log(`📊 Найдено записей: ${result.rows.length}`);
    
    if (result.rows[0]) {
      const progress = result.rows[0];
      const progressData = {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved
      };
      
      console.log(`✅ Прогресс найден:`, {
        score: progressData.score,
        level: progressData.level,
        lines: progressData.lines,
        last_saved: progressData.last_saved,
        сырые_данные: progress
      });
      
      console.log('📥✅ ========== ПОЛУЧЕНИЕ ПРОГРЕССА УСПЕШНО ==========');
      
      return { 
        success: true, 
        found: true, 
        progress: progressData,
        query_time_ms: queryTime
      };
    }
    
    console.log(`ℹ️ Прогресс не найден для пользователя ${dbUserId}`);
    
    // Проверяем, существует ли пользователь
    console.log('🔍 Проверяем существование пользователя...');
    const userCheck = await client.query(
      'SELECT user_id FROM users WHERE user_id = $1',
      [dbUserId]
    );
    
    if (userCheck.rows[0]) {
      console.log(`✅ Пользователь ${dbUserId} существует в таблице users`);
    } else {
      console.log(`ℹ️ Пользователь ${dbUserId} не найден в таблице users`);
    }
    
    console.log('📥✅ ========== ПОЛУЧЕНИЕ ПРОГРЕССА ЗАВЕРШЕНО ==========');
    
    return { 
      success: true, 
      found: false, 
      progress: null,
      user_exists: userCheck.rows.length > 0,
      query_time_ms: queryTime
    };
    
  } catch (error) {
    console.error('💥❌ ========== ОШИБКА ПОЛУЧЕНИЯ ПРОГРЕССА ==========');
    console.error('📛 Ошибка:', error.message);
    console.error('🔢 Код ошибки:', error.code);
    console.error('📌 Stack trace:');
    console.error(error.stack);
    
    if (error.code === '42P01') { // table does not exist
      console.error('⚠️ Таблица game_progress не существует!');
      console.error('🔄 Попробуем создать таблицу...');
      try {
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
        console.log('✅ Таблица game_progress создана');
      } catch (createError) {
        console.error('❌ Не удалось создать таблицу:', createError.message);
      }
    }
    
    console.error('💥❌ ========== КОНЕЦ ОШИБКИ ==========');
    
    return { 
      success: false, 
      error: error.message,
      code: error.code,
      found: false 
    };
  } finally {
    console.log('🔌 Освобождаем подключение к БД...');
    client.release();
    console.log('📥🔄 ========== ПОЛУЧЕНИЕ ПРОГРЕССА КОНЕЦ ==========\n');
  }
}

// ============ ФУНКЦИЯ ПОЛУЧЕНИЯ СТАТИСТИКИ ИГРОКА ==========

/**
 * Получает полную статистику игрока
 */
/**
 * Получает полную статистику игрока с расширенной отладкой
 */
export async function getGameStats(userId, gameType = 'tetris') {
  console.log('📊🔄 ========== ПОЛУЧЕНИЕ СТАТИСТИКИ НАЧАЛО ==========');
  console.log('📥 Входные параметры:', {
    userId,
    gameType,
    timestamp: new Date().toISOString()
  });
  
  if (!pool) {
    console.error('❌ getGameStats: Пул подключения не инициализирован');
    return { 
      success: false, 
      stats: null,
      error: 'Нет подключения к БД' 
    };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`🔧 Преобразованный user_id: "${dbUserId}" (оригинал: "${userId}")`);
  
  const client = await pool.connect();
  console.log('🔗 Подключение к БД получено');
  
  try {
    // 🔴 ШАГ 1: Получаем базовую статистику из game_scores
    console.log('📊 Шаг 1: Получаем базовую статистику из game_scores...');
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
        COALESCE(MIN(created_at), NOW()) as first_played,
        COALESCE(MAX(created_at), NOW()) as last_played
      FROM game_scores 
      WHERE user_id = $1 
        AND game_type = $2
        AND score > 0  -- Исключаем игры с 0 очками
    `;
    
    console.log('📝 SQL запрос статистики:', statsQuery);
    console.log('📋 Параметры:', [dbUserId, gameType]);
    
    const startTime = Date.now();
    const statsResult = await client.query(statsQuery, [dbUserId, gameType]);
    const queryTime = Date.now() - startTime;
    
    console.log(`⏱️ Время выполнения запроса: ${queryTime}ms`);
    console.log('📊 Результат запроса:', statsResult.rows[0]);
    
    const rawStats = statsResult.rows[0] || {
      games_played: '0',
      wins: '0',
      losses: '0',
      best_score: null,
      avg_score: null,
      best_level: null,
      best_lines: null,
      total_score: '0',
      first_played: null,
      last_played: null
    };
    
    // Преобразуем строки в числа
    const gamesPlayed = parseInt(rawStats.games_played) || 0;
    const wins = parseInt(rawStats.wins) || 0;
    const losses = parseInt(rawStats.losses) || 0;
    const bestScore = parseInt(rawStats.best_score) || 0;
    const avgScore = Math.round(parseFloat(rawStats.avg_score) || 0);
    const bestLevel = parseInt(rawStats.best_level) || 1;
    const bestLines = parseInt(rawStats.best_lines) || 0;
    const totalScore = parseInt(rawStats.total_score) || 0;
    
    console.log('🔢 Обработанная статистика:', {
      games_played: gamesPlayed,
      wins: wins,
      losses: losses,
      best_score: bestScore,
      avg_score: avgScore,
      best_level: bestLevel,
      best_lines: bestLines,
      total_score: totalScore
    });
    
    // 🔴 ШАГ 2: Получаем город пользователя
    console.log('📍 Шаг 2: Получаем город пользователя...');
    let city = 'Не указан';
    let citySource = 'none';
    
    try {
      // Пробуем разные источники по приоритету:
      
      // 1. Из таблицы users
      const cityResult = await client.query(
        'SELECT city FROM users WHERE user_id = $1',
        [dbUserId]
      );
      
      if (cityResult.rows[0] && cityResult.rows[0].city && cityResult.rows[0].city !== 'Не указан') {
        city = cityResult.rows[0].city;
        citySource = 'users';
        console.log(`✅ Город найден в users: "${city}"`);
      } else {
        // 2. Из user_sessions (для веб-пользователей)
        const sessionResult = await client.query(
          'SELECT selected_city FROM user_sessions WHERE user_id = $1',
          [dbUserId]
        );
        
        if (sessionResult.rows[0] && sessionResult.rows[0].selected_city && 
            sessionResult.rows[0].selected_city !== 'Не указан') {
          city = sessionResult.rows[0].selected_city;
          citySource = 'user_sessions';
          console.log(`✅ Город найден в user_sessions: "${city}"`);
        } else {
          // 3. Из последней игры пользователя
          const gameCityResult = await client.query(`
            SELECT city FROM game_scores 
            WHERE user_id = $1 
              AND game_type = $2 
              AND city IS NOT NULL 
              AND city != 'Не указан'
            ORDER BY created_at DESC 
            LIMIT 1
          `, [dbUserId, gameType]);
          
          if (gameCityResult.rows[0]) {
            city = gameCityResult.rows[0].city;
            citySource = 'game_scores';
            console.log(`✅ Город найден в последней игре: "${city}"`);
          } else {
            console.log('ℹ️ Город не найден, используем "Не указан"');
          }
        }
      }
    } catch (cityError) {
      console.error('⚠️ Ошибка получения города:', cityError.message);
    }
    
    // 🔴 ШАГ 3: Проверяем наличие незавершенной игры (прогресс)
    console.log('🔄 Шаг 3: Проверяем наличие прогресса...');
    let currentProgress = null;
    let hasUnfinishedGame = false;
    
    try {
      const progressResult = await client.query(`
        SELECT score, level, lines, last_saved 
        FROM game_progress 
        WHERE user_id = $1 AND game_type = $2
      `, [dbUserId, gameType]);
      
      if (progressResult.rows[0]) {
        const progress = progressResult.rows[0];
        currentProgress = {
          score: parseInt(progress.score) || 0,
          level: parseInt(progress.level) || 1,
          lines: parseInt(progress.lines) || 0,
          last_saved: progress.last_saved
        };
        hasUnfinishedGame = true;
        console.log(`✅ Найден прогресс игры:`, currentProgress);
      } else {
        console.log('ℹ️ Прогресс не найден');
      }
    } catch (progressError) {
      console.error('⚠️ Ошибка проверки прогресса:', progressError.message);
    }
    
    // 🔴 ШАГ 4: Формируем полную статистику
    console.log('📈 Шаг 4: Формируем полную статистику...');
    
    const hasAnyCompletedGames = gamesPlayed > 0;
    const hasAnyGames = hasAnyCompletedGames || hasUnfinishedGame;
    
    // Рассчитываем процент побед
    const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
    
    // Определяем уровень игрока на основе статистики
    let playerLevel = 'Новичок';
    if (bestScore >= 5000) playerLevel = 'Эксперт';
    else if (bestScore >= 2000) playerLevel = 'Продвинутый';
    else if (bestScore >= 1000) playerLevel = 'Средний';
    else if (gamesPlayed > 0) playerLevel = 'Начинающий';
    
    const statsData = {
      // Основная статистика
      games_played: gamesPlayed,
      wins: wins,
      losses: losses,
      win_rate: winRate,
      best_score: bestScore,
      avg_score: avgScore,
      best_level: bestLevel,
      best_lines: bestLines,
      total_score: totalScore,
      first_played: rawStats.first_played,
      last_played: rawStats.last_played,
      
      // Прогресс
      current_progress: currentProgress,
      has_unfinished_game: hasUnfinishedGame,
      has_any_games: hasAnyGames,
      has_completed_games: hasAnyCompletedGames,
      
      // Информация о пользователе
      city: city,
      city_source: citySource,
      user_id: dbUserId,
      is_web_user: dbUserId.startsWith('web_'),
      
      // Дополнительные метрики
      player_level: playerLevel,
      games_per_day: calculateGamesPerDay(gamesPlayed, rawStats.first_played),
      average_lines_per_game: gamesPlayed > 0 ? Math.round(bestLines / gamesPlayed) : 0,
      
      // Флаги для отображения
      show_city_warning: city === 'Не указан' && hasAnyGames,
      show_first_game_hint: gamesPlayed === 0,
      show_progress_continuation: hasUnfinishedGame && currentProgress?.score > 100
    };
    
    console.log('📊 Полная статистика сформирована:', {
      games: statsData.games_played,
      bestScore: statsData.best_score,
      hasGames: statsData.has_any_games,
      hasUnfinished: statsData.has_unfinished_game,
      city: statsData.city,
      playerLevel: statsData.player_level,
      winRate: `${statsData.win_rate}%`
    });
    
    // 🔴 ШАГ 5: Логируем итоговый результат
    console.log('🎯 Итоговая информация:');
    if (!hasAnyGames) {
      console.log('   🎮 Пользователь еще не играл');
    } else if (hasUnfinishedGame && !hasAnyCompletedGames) {
      console.log(`   💾 Только незавершенная игра: ${currentProgress?.score || 0} очков`);
    } else {
      console.log(`   🏆 Игр завершено: ${gamesPlayed}, лучший счет: ${bestScore}`);
      if (hasUnfinishedGame) {
        console.log(`   💪 Есть незавершенная игра: ${currentProgress?.score || 0} очков`);
      }
    }
    console.log(`   📍 Город: ${city} (источник: ${citySource})`);
    
    console.log('📊✅ ========== ПОЛУЧЕНИЕ СТАТИСТИКИ УСПЕШНО ==========');
    
    return { 
      success: true, 
      stats: statsData,
      has_stats: hasAnyCompletedGames,
      has_progress: hasUnfinishedGame,
      has_any_games: hasAnyGames,
      query_time_ms: queryTime,
      summary: {
        games: gamesPlayed,
        best_score: bestScore,
        city: city,
        player_level: playerLevel
      }
    };
    
  } catch (error) {
    console.error('💥❌ ========== ОШИБКА ПОЛУЧЕНИЯ СТАТИСТИКИ ==========');
    console.error('📛 Ошибка:', error.message);
    console.error('🔢 Код ошибки:', error.code);
    console.error('📌 Stack trace:');
    console.error(error.stack);
    
    // Дополнительная диагностика
    console.error('🔍 Диагностика проблемы:');
    console.error('   user_id:', dbUserId);
    console.error('   game_type:', gameType);
    
    // Проверяем существование таблиц
    try {
      const tablesCheck = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('game_scores', 'users', 'game_progress')
      `);
      console.error('   Существующие таблицы:', tablesCheck.rows.map(r => r.table_name));
    } catch (tableError) {
      console.error('   Не удалось проверить таблицы:', tableError.message);
    }
    
    console.error('💥❌ ========== КОНЕЦ ОШИБКИ ==========');
    
    return { 
      success: false, 
      error: error.message,
      code: error.code,
      stats: null
    };
  } finally {
    console.log('🔌 Освобождаем подключение к БД...');
    client.release();
    console.log('📊🔄 ========== ПОЛУЧЕНИЕ СТАТИСТИКИ КОНЕЦ ==========\n');
  }
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============

/**
 * Рассчитывает среднее количество игр в день
 */
function calculateGamesPerDay(totalGames, firstPlayedDate) {
  if (!totalGames || !firstPlayedDate) return 0;
  
  try {
    const firstPlayed = new Date(firstPlayedDate);
    const now = new Date();
    const daysDiff = Math.max(1, Math.floor((now - firstPlayed) / (1000 * 60 * 60 * 24)));
    
    return parseFloat((totalGames / daysDiff).toFixed(2));
  } catch (error) {
    console.error('Ошибка расчета игр в день:', error);
    return 0;
  }
}

/**
 * Альтернативная упрощенная версия статистики (для API)
 */
export async function getSimpleGameStats(userId, gameType = 'tetris') {
  console.log('📊 [Упрощенная] Запрос статистики для:', userId);
  
  const fullStats = await getGameStats(userId, gameType);
  
  if (!fullStats.success) {
    return {
      success: false,
      error: fullStats.error,
      simple_stats: null
    };
  }
  
  const stats = fullStats.stats;
  
  // Формируем упрощенную версию
  const simpleStats = {
    games_played: stats.games_played,
    best_score: stats.best_score,
    avg_score: stats.avg_score,
    win_rate: stats.win_rate,
    city: stats.city,
    player_level: stats.player_level,
    has_unfinished_game: stats.has_unfinished_game,
    current_progress_score: stats.current_progress?.score || 0
  };
  
  return {
    success: true,
    simple_stats: simpleStats,
    full_stats_available: true
  };
}

/**
 * Получает статистику для отображения в сообщении бота
 */
export async function getGameStatsForMessage(userId, gameType = 'tetris') {
  try {
    const statsResult = await getGameStats(userId, gameType);
    
    if (!statsResult.success) {
      return {
        success: false,
        message: '❌ Не удалось загрузить статистику',
        has_stats: false
      };
    }
    
    const stats = statsResult.stats;
    const hasStats = stats.has_any_games;
    
    // Формируем читабельное сообщение
    let message = '';
    
    if (!hasStats) {
      message = `📊 *Статистика игры*\n\n🎮 Вы ещё не играли в тетрис!\n\nНажмите 🎮 ИГРАТЬ В ТЕТРИС чтобы начать!`;
    } else if (stats.has_unfinished_game && !stats.has_completed_games) {
      // Только незавершенная игра
      message = `📊 *Статистика игры*\n\n🔄 *Незавершенная игра:*\n`;
      message += `• Текущие очки: ${stats.current_progress.score}\n`;
      message += `• Текущий уровень: ${stats.current_progress.level}\n`;
      message += `• Собрано линий: ${stats.current_progress.lines}\n`;
      message += `💾 *Прогресс сохранён*\n\n`;
      message += `📍 Город: *${stats.city}*\n\n`;
      message += `💡 *Совет:* Завершите игру, чтобы результат попал в статистику!`;
    } else {
      // Есть завершенные игры
      message = `📊 *Статистика в тетрисе*\n\n`;
      
      if (stats.games_played > 0) {
        message += `🎮 Игр сыграно: *${stats.games_played}*\n`;
        message += `🏆 Побед/Поражений: *${stats.wins}/${stats.losses}* (${stats.win_rate}% побед)\n`;
        message += `🎯 Лучший счёт: *${stats.best_score}*\n`;
        message += `📊 Средний счёт: *${stats.avg_score}*\n`;
        message += `📈 Лучший уровень: *${stats.best_level}*\n`;
        message += `📉 Лучшие линии: *${stats.best_lines}*\n`;
        message += `💰 Всего очков: *${stats.total_score}*\n`;
        
        if (stats.last_played) {
          try {
            const date = new Date(stats.last_played);
            message += `⏰ Последняя игра: ${date.toLocaleDateString('ru-RU')}\n`;
          } catch {}
        }
      }
      
      if (stats.has_unfinished_game) {
        message += `\n🔄 *Незавершенная игра:* ${stats.current_progress.score} очков\n`;
      }
      
      message += `\n📍 Город: *${stats.city}*\n`;
      message += `📊 Уровень игрока: *${stats.player_level}*\n\n`;
      
      if (stats.games_per_day > 0) {
        message += `📅 Игр в день: *${stats.games_per_day}*\n`;
      }
      
      if (stats.city === 'Не указан') {
        message += `\n📍 *Совет:* Укажите город командой /city [город] чтобы отображаться в топе!`;
      } else {
        message += `\n🎯 *Цель:* Улучшите свой лучший результат и поднимитесь в топе!`;
      }
    }
    
    return {
      success: true,
      message: message,
      has_stats: hasStats,
      stats: stats,
      raw_stats: statsResult
    };
    
  } catch (error) {
    console.error('❌ Ошибка формирования сообщения статистики:', error);
    return {
      success: false,
      message: '❌ Произошла ошибка при загрузке статистики',
      has_stats: false,
      error: error.message
    };
  }
}

// Экспорт вспомогательных функций
export { calculateGamesPerDay };

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
        COALESCE(u.city, gs.city, 'Не указан') as city,
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
      GROUP BY gs.user_id, u.username, gs.username, u.city, gs.city, u.first_name
      HAVING MAX(gs.score) > 0
      ORDER BY MAX(gs.score) DESC, COUNT(*) DESC, MAX(gs.created_at) DESC
      LIMIT $2
    `;
    
    console.log('🏆 SQL: Ищем только завершенные игры');
    
    const result = await client.query(query, [gameType, limit]);
    console.log(`🏆 Найдено завершенных игр в топе: ${result.rows.length}`);
    
    if (result.rows.length === 0) {
      console.log('ℹ️ Нет завершенных игр с результатом > 0 очков');
      return { 
        success: true, 
        players: [], 
        count: 0,
        message: 'Топ пуст - пока никто не завершил игру с хорошим результатом'
      };
    }
    
    const topPlayers = result.rows.map((row, index) => {
      let displayName = 'Игрок';
      
      if (row.first_name && row.first_name.trim() && row.first_name !== 'Игрок') {
        displayName = row.first_name.trim();
      } else if (row.display_name && row.display_name.trim() && row.display_name !== 'Игрок') {
        displayName = row.display_name.trim();
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
        is_completed_game: true
      };
    });
    
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
 * Тестовая функция для проверки сохранения игры
 */
export async function testGameSave(userId = 'test_user_' + Date.now()) {
  console.log('🧪 ========== ТЕСТ СОХРАНЕНИЯ ИГРЫ ==========');
  
  const testData = {
    userId: userId,
    gameType: 'tetris',
    score: Math.floor(Math.random() * 10000) + 1000,
    level: Math.floor(Math.random() * 10) + 1,
    lines: Math.floor(Math.random() * 100) + 10,
    username: 'Тестовый игрок',
    isWin: true
  };
  
  console.log('🧪 Тестовые данные:', testData);
  
  const result = await saveGameScore(
    testData.userId,
    testData.gameType,
    testData.score,
    testData.level,
    testData.lines,
    testData.username,
    testData.isWin
  );
  
  console.log('🧪 Результат теста:', {
    успех: result.success,
    id: result.id,
    ошибка: result.error,
    код_ошибки: result.code
  });
  
  if (result.success) {
    console.log('✅ ТЕСТ ПРОЙДЕН УСПЕШНО');
  } else {
    console.log('❌ ТЕСТ ПРОВАЛЕН');
  }
  
  console.log('🧪 ========== КОНЕЦ ТЕСТА ==========\n');
  
  return result;
}

// Экспортируем pool для использования в других частях приложения
export { pool };
