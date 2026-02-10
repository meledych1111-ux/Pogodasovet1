import pg from 'pg';
const { Pool } = pg;

// 🔴 ОПТИМИЗИРОВАННОЕ ПОДКЛЮЧЕНИЕ ДЛЯ NEON + VERCEL
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  // 🔴 УПРОЩЕННАЯ SSL КОНФИГУРАЦИЯ ДЛЯ NEON
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true
  } : {
    rejectUnauthorized: false // Для разработки и тестирования
  },
  // 🔴 Дополнительные параметры для стабильности
  connectionTimeoutMillis: 10000, // 10 секунд
  idleTimeoutMillis: 30000,
  max: 20, // максимальное количество клиентов в пуле
  allowExitOnIdle: true
};

// Логирование конфигурации (без пароля)
if (process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL) {
  console.log('🔧 Конфигурация БД:');
  console.log('   URL присутствует:', !!process.env.DATABASE_URL);
  console.log('   Использует Neon:', process.env.DATABASE_URL.includes('neon.tech'));
  console.log('   NODE_ENV:', process.env.NODE_ENV);
  console.log('   SSL:', poolConfig.ssl);
}

const pool = new Pool(poolConfig);

// 🔴 УНИВЕРСАЛЬНАЯ ФУНКЦИЯ КОНВЕРТАЦИИ USER_ID
function convertUserIdForDb(userId) {
  const userIdStr = String(userId);
  
  if (userIdStr.startsWith('web_')) {
    return userIdStr; // Web App пользователи - строка
  } else if (/^\d+$/.test(userIdStr)) {
    // Telegram ID - конвертируем в число
    const num = parseInt(userIdStr, 10);
    return isNaN(num) ? userIdStr : num;
  }
  return userIdStr;
}

// 🔴 ФУНКЦИЯ ДЛЯ ТЕСТИРОВАНИЯ ПОДКЛЮЧЕНИЯ С ВЫВОДОМ ДЕТАЛЕЙ
async function testConnection() {
  let client;
  try {
    console.log('🧪 Тестирование подключения к БД...');
    console.log('🧪 DATABASE_URL (первые 30 символов):', process.env.DATABASE_URL?.substring(0, 30) + '...');
    console.log('🧪 NODE_ENV:', process.env.NODE_ENV);
    
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
    console.error('❌ Детали SSL:', error.message.includes('SSL') ? 'Проблема с SSL' : 'Другая ошибка');
    
    // 🔴 ДОПОЛНИТЕЛЬНАЯ ДИАГНОСТИКА ДЛЯ NEON
    if (process.env.DATABASE_URL) {
      const url = process.env.DATABASE_URL;
      console.log('🔍 Анализ DATABASE_URL:');
      console.log('   Использует sslmode=require?', url.includes('sslmode=require'));
      console.log('   Использует neon.tech домен?', url.includes('neon.tech'));
      console.log('   Длина URL:', url.length);
    }
    
    return { 
      success: false, 
      error: error.message, 
      code: error.code,
      details: error.stack 
    };
  } finally {
    if (client) client.release();
  }
}

// 🔴 ФУНКЦИЯ СОЗДАНИЯ ВСЕХ НЕОБХОДИМЫХ ТАБЛИЦ
async function createTables() {
  const client = await pool.connect();
  try {
    console.log('📊 Создание таблиц...');
    
    // Сначала тестируем подключение
    const testResult = await testConnection();
    if (!testResult.success) {
      throw new Error(`Не удалось подключиться к БД: ${testResult.error}`);
    }
    
    // 🔴 1. Таблица пользователей и городов
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
    console.log('✅ Таблица user_sessions создана/проверена');
    
    // 🔴 2. Таблица финальных результатов игр (ВСЕ игры)
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
    console.log('✅ Таблица game_scores создана/проверена');
    
    // 🔴 3. Таблица прогресса игры (для автосохранения)
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
    console.log('✅ Таблица game_progress создана/проверена');
    
    // 🔴 4. Таблица статистики (ДОБАВЛЯЕМ ОТСУТСТВУЮЩУЮ ТАБЛИЦУ)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tetris_stats (
        user_id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100),
        games_played INTEGER DEFAULT 0,
        best_score INTEGER DEFAULT 0,
        best_level INTEGER DEFAULT 1,
        best_lines INTEGER DEFAULT 0,
        total_score BIGINT DEFAULT 0,
        avg_score INTEGER DEFAULT 0,
        last_played TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица tetris_stats создана/проверена');
    
    // 🔴 5. Создаем индексы для производительности
    console.log('📊 Создание индексов...');
    
    // Индекс для game_scores
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
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_scores_is_win 
      ON game_scores(is_win)
    `);
    
    // Индекс для user_sessions
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_city 
      ON user_sessions(selected_city)
    `);
    
    // Индекс для tetris_stats
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tetris_stats_score 
      ON tetris_stats(best_score DESC)
    `);
    
    console.log('✅ Все таблицы и индексы созданы или уже существуют');
    
    // 🔴 ПРОВЕРЯЕМ СТРУКТУРУ ТАБЛИЦ
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('📊 Существующие таблицы:', tableCheck.rows.map(r => r.table_name).join(', '));
    
  } catch (error) {
    console.error('❌ Ошибка при создании таблиц:', error.message);
    console.error('❌ Stack trace:', error.stack);
    
    // 🔴 СПЕЦИАЛЬНЫЙ АНАЛИЗ ДЛЯ NEON SSL ПРОБЛЕМ
    if (error.message.includes('SSL') || error.code === 'ECONNRESET' || error.code === '23505') {
      console.log('\n🔴 ВОЗМОЖНОЕ РЕШЕНИЕ:');
      console.log('1. Проверьте DATABASE_URL в переменных окружения Vercel');
      console.log('2. Для Neon добавьте ?sslmode=require в конец строки подключения');
      console.log('3. Для разработки используйте ?sslmode=no-verify');
      console.log('4. Проверьте, что БД активна в панели управления Neon');
    }
  } finally {
    client.release();
  }
}

// 🔴 АВТОМАТИЧЕСКАЯ ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
if (process.env.DATABASE_URL) {
  console.log('📊 Инициализация базы данных...');
  
  // Функция инициализации с повторными попытками
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
          const delay = attempt * 2000; // Увеличиваем задержку с каждой попыткой
          console.log(`⏳ Повтор через ${delay / 1000} секунд...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error('❌ Все попытки инициализации БД провалились');
        }
      }
    }
  };
  
  // Запускаем с задержкой для Vercel среды
  setTimeout(() => {
    initializeDatabase().catch(error => {
      console.error('💥 Критическая ошибка инициализации БД:', error);
    });
  }, 1500);
} else {
  console.warn('⚠️ DATABASE_URL не установлен, база данных не будет инициализирована');
}

// ============ ФУНКЦИИ ДЛЯ ИГР ============

/**
 * Сохраняет финальный результат игры
 */
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
  console.log(`🚀 СОХРАНЕНИЕ ИГРЫ: user=${userId}, score=${score}, type=${gameType}`);
  
  const client = await pool.connect();
  
  try {
    // 🔴 1. Конвертируем ID
    const dbUserId = String(userId);
    console.log(`🆔 ID преобразован: ${userId} -> ${dbUserId}`);
    
    // 🔴 2. Подготавливаем имя пользователя
    const finalUsername = username || `Игрок_${String(userId).slice(-4)}`;
    console.log(`👤 Имя пользователя: ${finalUsername}`);
    
    // 🔴 3. НАЧИНАЕМ ТРАНЗАКЦИЮ
    await client.query('BEGIN');
    
    // 🔴 4. Создаем/обновляем пользователя
    console.log(`📝 Обновление данных пользователя...`);
    try {
      await client.query(`
        INSERT INTO user_sessions (user_id, username, selected_city) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          username = COALESCE($2, user_sessions.username),
          updated_at = NOW()
        RETURNING user_id
      `, [dbUserId, finalUsername, 'Не указан']);
      console.log(`✅ Данные пользователя обновлены`);
    } catch (userError) {
      console.error(`❌ Ошибка обновления пользователя:`, userError.message);
      // Продолжаем - пользователь может уже существовать
    }
    
    // 🔴 5. Сохраняем результат игры
    console.log(`🎮 Сохранение результата игры...`);
    const gameQuery = `
      INSERT INTO game_scores (user_id, username, game_type, score, level, lines, is_win) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING id, created_at
    `;
    
    const result = await client.query(gameQuery, [
      dbUserId, 
      finalUsername, 
      gameType || 'tetris', 
      score, 
      level || 1, 
      lines || 0,
      isWin
    ]);
    
    const savedId = result.rows[0]?.id;
    const createdAt = result.rows[0]?.created_at;
    
    console.log(`✅ Результат игры сохранен! ID: ${savedId}, время: ${createdAt}`);
    
    // 🔴 6. Обновляем статистику в tetris_stats
    console.log(`📊 Обновление статистики...`);
    try {
      // Сначала получаем текущую статистику
      const currentStats = await client.query(`
        SELECT games_played, total_score 
        FROM tetris_stats 
        WHERE user_id = $1
      `, [dbUserId]);
      
      if (currentStats.rows.length === 0) {
        // Первая игра пользователя
        await client.query(`
          INSERT INTO tetris_stats (user_id, username, games_played, best_score, best_level, best_lines, total_score, avg_score, last_played)
          VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)
        `, [
          dbUserId, 
          finalUsername, 
          score, 
          level || 1, 
          lines || 0, 
          score, 
          score,
          createdAt
        ]);
        console.log(`📊 Создана новая статистика`);
      } else {
        // Обновляем существующую статистику
        const currentGames = currentStats.rows[0].games_played || 0;
        const currentTotal = currentStats.rows[0].total_score || 0;
        const newTotal = currentTotal + score;
        const newAvg = Math.round(newTotal / (currentGames + 1));
        
        await client.query(`
          UPDATE tetris_stats 
          SET 
            games_played = games_played + 1,
            best_score = GREATEST(best_score, $2),
            best_level = GREATEST(best_level, $3),
            best_lines = GREATEST(best_lines, $4),
            total_score = total_score + $2,
            avg_score = $5,
            last_played = $6,
            updated_at = NOW()
          WHERE user_id = $1
        `, [
          dbUserId, 
          score, 
          level || 1, 
          lines || 0, 
          newAvg,
          createdAt
        ]);
        console.log(`📊 Статистика обновлена (игр: ${currentGames + 1})`);
      }
    } catch (statsError) {
      console.error(`⚠️ Ошибка обновления статистики:`, statsError.message);
      // Не прерываем выполнение, если статистика не обновилась
    }
    
    // 🔴 7. Удаляем прогресс (если был)
    try {
      await client.query(`
        DELETE FROM game_progress 
        WHERE user_id = $1 AND game_type = $2
      `, [dbUserId, gameType || 'tetris']);
      console.log(`🗑️ Прогресс игры удален`);
    } catch (progressError) {
      console.log(`ℹ️ Прогресс не найден или уже удален`);
    }
    
    // 🔴 8. КОММИТИМ ТРАНЗАКЦИЮ
    await client.query('COMMIT');
    console.log(`✅ Транзакция завершена успешно`);
    
    return { 
      success: true, 
      id: savedId, 
      created_at: createdAt,
      user_id: dbUserId 
    };
    
  } catch (error) {
    // 🔴 9. ОТКАТЫВАЕМ ТРАНЗАКЦИЮ ПРИ ОШИБКЕ
    try {
      await client.query('ROLLBACK');
      console.log(`🔄 Транзакция откачена`);
    } catch (rollbackError) {
      console.error(`❌ Ошибка при откате транзакции:`, rollbackError.message);
    }
    
    console.error(`💥 КРИТИЧЕСКАЯ ОШИБКА saveGameScore:`);
    console.error(`📌 Сообщение:`, error.message);
    console.error(`📌 Код:`, error.code);
    console.error(`📌 Stack:`, error.stack);
    
    return { 
      success: false, 
      error: error.message,
      code: error.code 
    };
  } finally {
    client.release();
    console.log(`🔌 Подключение к БД освобождено`);
  }
}

/**
 * Сохраняет прогресс игры (автосохранение)
 */
export async function saveGameProgress(userId, gameType, score, level, lines, username = null) {
  const client = await pool.connect();
  
  try {
    // 🔴 Конвертируем ID
    const dbUserId = convertUserIdForDb(userId);
    console.log(`💾 Сохранение прогресса: user=${dbUserId}, score=${score}`);
    
    // Получаем текущий город пользователя
    let city = 'Не указан';
    try {
      const cityResult = await client.query(
        'SELECT selected_city FROM user_sessions WHERE user_id = $1',
        [dbUserId]
      );
      if (cityResult.rows[0]) {
        city = cityResult.rows[0].selected_city || 'Не указан';
      }
    } catch (cityError) {
      console.log('⚠️ Не удалось получить город:', cityError.message);
    }
    
    // 🔴 Сохраняем/обновляем информацию о пользователе
    if (username) {
      try {
        await client.query(`
          INSERT INTO user_sessions (user_id, username, selected_city) 
          VALUES ($1, $2, $3) 
          ON CONFLICT (user_id) 
          DO UPDATE SET 
            username = COALESCE($2, user_sessions.username),
            selected_city = COALESCE($3, user_sessions.selected_city),
            updated_at = NOW()
        `, [dbUserId, username, city]);
        console.log(`👤 Данные пользователя обновлены для прогресса`);
      } catch (userError) {
        console.log('⚠️ Ошибка обновления пользователя:', userError.message);
      }
    }
    
    // 🔴 Сохраняем прогресс игры
    const query = `
      INSERT INTO game_progress (user_id, game_type, score, level, lines) 
      VALUES ($1, $2, $3, $4, $5) 
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
      score, 
      level || 1, 
      lines || 0
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
      userId, 
      dbUserId: convertUserIdForDb(userId), 
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
  const client = await pool.connect();
  
  try {
    const dbUserId = convertUserIdForDb(userId);
    console.log(`📥 Запрос прогресса: user=${dbUserId}, type=${gameType}`);
    
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

// ============ ФУНКЦИИ ДЛЯ ГОРОДОВ ============

/**
 * Сохраняет город пользователя
 */
export async function saveUserCity(userId, city, username = null) {
  const client = await pool.connect();
  
  try {
    const dbUserId = convertUserIdForDb(userId);
    console.log(`📍 Сохранение города: user=${dbUserId}, city="${city}"`);
    
    const query = `
      INSERT INTO user_sessions (user_id, selected_city, username) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        selected_city = COALESCE(NULLIF($2, ''), user_sessions.selected_city), 
        username = COALESCE($3, user_sessions.username),
        updated_at = NOW()
      RETURNING user_id, selected_city
    `;
    
    const result = await client.query(query, [dbUserId, city, username]);
    
    const savedCity = result.rows[0]?.selected_city;
    console.log(`✅ Город сохранен: "${savedCity}" для пользователя ${dbUserId}`);
    
    return { 
      success: true, 
      user_id: result.rows[0]?.user_id,
      city: savedCity 
    };
    
  } catch (error) {
    console.error('❌ Ошибка сохранения города:', error.message);
    
    return { 
      success: false, 
      error: error.message 
    };
  } finally {
    client.release();
  }
}

/**
 * Получает город пользователя
 */
export async function getUserCity(userId) {
  const client = await pool.connect();
  
  try {
    const dbUserId = convertUserIdForDb(userId);
    console.log(`📍 Запрос города: user=${dbUserId}`);
    
    const query = `
      SELECT selected_city FROM user_sessions 
      WHERE user_id = $1
    `;
    
    const result = await client.query(query, [dbUserId]);
    
    const city = result.rows[0]?.selected_city || 'Не указан';
    console.log(`✅ Город найден: "${city}"`);
    
    return { 
      success: true, 
      city: city,
      found: !!result.rows[0] 
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

// ============ ФУНКЦИЯ ТОПА ИГРОКОВ (ИСПРАВЛЕННЫЙ SQL) ==========

/**
 * Получает топ игроков для указанного типа игры
 */
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  
  try {
    console.log(`🏆 Запрос топа игроков: type=${gameType}, limit=${limit}`);
    
    // 🔴 ПЕРВЫЙ ВАРИАНТ: Используем tetris_stats (если есть данные)
    try {
      const tetrisTopQuery = `
        SELECT 
          ts.user_id,
          COALESCE(NULLIF(us.username, ''), ts.username, 'Игрок') as username,
          COALESCE(NULLIF(us.selected_city, ''), 'Не указан') as city,
          ts.best_score as score,
          ts.best_level as level,
          ts.best_lines as lines,
          ts.games_played,
          ts.last_played
        FROM tetris_stats ts
        LEFT JOIN user_sessions us ON ts.user_id = us.user_id
        WHERE ts.best_score > 0
        ORDER BY ts.best_score DESC, ts.games_played DESC
        LIMIT $1
      `;
      
      const tetrisResult = await client.query(tetrisTopQuery, [limit]);
      
      if (tetrisResult.rows.length > 0) {
        console.log(`🏆 Топ из tetris_stats: ${tetrisResult.rows.length} игроков`);
        
        const topPlayers = tetrisResult.rows.map((row, index) => {
          const gamesPlayed = parseInt(row.games_played) || 1;
          
          let username = row.username;
          if (!username || username === 'Игрок') {
            const userIdStr = String(row.user_id || '0000');
            if (userIdStr.startsWith('web_')) {
              username = `🌐 Игрок #${userIdStr.slice(-4)}`;
            } else {
              username = `👤 Игрок #${userIdStr.slice(-4)}`;
            }
          }
          
          return {
            rank: index + 1,
            user_id: row.user_id,
            username: username,
            city: row.city || 'Не указан',
            score: parseInt(row.score) || 0,
            level: parseInt(row.level) || 0,
            lines: parseInt(row.lines) || 0,
            games_played: gamesPlayed,
            wins: gamesPlayed, // Для tetris_stats предполагаем все игры - победы
            win_rate: '100.0',
            last_played: row.last_played,
            source: 'tetris_stats'
          };
        });
        
        return { 
          success: true, 
          players: topPlayers, 
          count: topPlayers.length,
          source: 'tetris_stats' 
        };
      }
    } catch (tetrisError) {
      console.log('⚠️ tetris_stats не доступна или пуста:', tetrisError.message);
    }
    
    // 🔴 ВТОРОЙ ВАРИАНТ: Используем game_scores (ИСПРАВЛЕННЫЙ SQL ЗАПРОС)
    console.log(`🏆 Используем game_scores для топа...`);
    
    // 🔴 ИСПРАВЛЕННЫЙ SQL ЗАПРОС (без ошибки GROUP BY)
    const query = `
      SELECT 
        gs.user_id,
        COALESCE(NULLIF(us.username, ''), gs.username, 'Игрок') as username,
        COALESCE(NULLIF(us.selected_city, ''), 'Не указан') as city,
        MAX(gs.score) as best_score,
        COUNT(*) as games_played,
        COUNT(CASE WHEN gs.is_win THEN 1 END) as wins,
        MAX(gs.created_at) as last_played
      FROM game_scores gs
      LEFT JOIN user_sessions us ON gs.user_id = us.user_id
      WHERE gs.game_type = $1 AND gs.score > 0
      GROUP BY gs.user_id, us.username, us.selected_city
      ORDER BY MAX(gs.score) DESC, COUNT(*) DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    console.log(`🏆 Найдено игроков в топе: ${result.rows.length}`);
    
    const topPlayers = result.rows.map((row, index) => {
      let username = row.username;
      const userIdStr = String(row.user_id || '0000');
      
      if (!username || username === 'Игрок') {
        if (userIdStr.startsWith('web_')) {
          username = `🌐 Игрок #${userIdStr.slice(-4)}`;
        } else if (/^\d+$/.test(userIdStr)) {
          username = `👤 Игрок #${userIdStr.slice(-4)}`;
        } else {
          username = `🎮 Игрок #${userIdStr.slice(-4)}`;
        }
      }
      
      const gamesPlayed = parseInt(row.games_played) || 1;
      const wins = parseInt(row.wins) || 0;
      const winRate = gamesPlayed > 0 ? ((wins / gamesPlayed) * 100).toFixed(1) : '0.0';
      
      return {
        rank: index + 1,
        user_id: row.user_id,
        username: username,
        city: row.city || 'Не указан',
        score: parseInt(row.best_score) || 0,
        level: 1, // Упрощаем, так как в этом запросе нет уровня
        lines: 0, // Упрощаем, так как в этом запросе нет линий
        games_played: gamesPlayed,
        wins: wins,
        win_rate: winRate,
        last_played: row.last_played,
        source: 'game_scores'
      };
    });
    
    return { 
      success: true, 
      players: topPlayers, 
      count: topPlayers.length,
      source: 'game_scores' 
    };
    
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error.message);
    console.error('❌ Stack trace:', error.stack);
    
    return { 
      success: false, 
      error: error.message,
      players: [], 
      count: 0 
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
  const client = await pool.connect();
  
  try {
    // 🔴 Конвертируем ID
    const dbUserId = convertUserIdForDb(userId);
    
    console.log(`📊 Запрос статистики: user=${dbUserId}, type=${gameType}`);
    
    // 🔴 1. Пробуем получить из tetris_stats
    try {
      const tetrisStatsQuery = await client.query(`
        SELECT 
          COALESCE(games_played, 0) as games_played,
          COALESCE(best_score, 0) as best_score,
          COALESCE(best_level, 0) as best_level,
          COALESCE(best_lines, 0) as best_lines,
          COALESCE(total_score, 0) as total_score,
          COALESCE(avg_score, 0) as avg_score,
          COALESCE(last_played, NOW()) as last_played
        FROM tetris_stats 
        WHERE user_id = $1
      `, [dbUserId]);
      
      if (tetrisStatsQuery.rows.length > 0) {
        const stats = tetrisStatsQuery.rows[0];
        console.log(`📊 Статистика из tetris_stats: ${stats.games_played} игр, лучший: ${stats.best_score}`);
        
        const gamesPlayed = parseInt(stats.games_played) || 0;
        
        // Получаем город
        const cityQuery = await client.query(
          'SELECT selected_city FROM user_sessions WHERE user_id = $1',
          [dbUserId]
        );
        const city = cityQuery.rows[0]?.selected_city || 'Не указан';
        
        const statsData = {
          games_played: gamesPlayed,
          wins: gamesPlayed, // В tetris_stats все игры считаем победами
          losses: 0,
          win_rate: gamesPlayed > 0 ? '100.0' : '0.0',
          best_score: parseInt(stats.best_score) || 0,
          avg_score: parseInt(stats.avg_score) || 0,
          best_level: parseInt(stats.best_level) || 0,
          best_lines: parseInt(stats.best_lines) || 0,
          total_score: parseInt(stats.total_score) || 0,
          last_played: stats.last_played,
          city: city,
          source: 'tetris_stats'
        };
        
        return { 
          success: true, 
          stats: statsData,
          has_stats: true 
        };
      }
    } catch (tetrisError) {
      console.log('ℹ️ tetris_stats не доступна:', tetrisError.message);
    }
    
    // 🔴 2. Считаем из game_scores
    console.log(`📊 Используем game_scores для статистики...`);
    
    // Проверяем, есть ли записи в game_scores
    const checkQuery = await client.query(
      'SELECT COUNT(*) as count FROM game_scores WHERE user_id = $1 AND game_type = $2',
      [dbUserId, gameType]
    );
    
    const hasScores = parseInt(checkQuery.rows[0]?.count) > 0;
    
    if (!hasScores) {
      // 🔴 3. Если нет записей в game_scores, проверяем game_progress
      console.log(`📊 Проверяем game_progress...`);
      
      const progressQuery = await client.query(`
        SELECT score, level, lines, last_saved 
        FROM game_progress 
        WHERE user_id = $1 AND game_type = $2
      `, [dbUserId, gameType]);
      
      if (progressQuery.rows[0]) {
        const progress = progressQuery.rows[0];
        console.log(`📊 Найден прогресс: ${progress.score} очков`);
        
        // Получаем город
        const cityQuery = await client.query(
          'SELECT selected_city FROM user_sessions WHERE user_id = $1',
          [dbUserId]
        );
        const city = cityQuery.rows[0]?.selected_city || 'Не указан';
        
        const statsData = {
          games_played: 0,
          wins: 0,
          losses: 0,
          win_rate: '0.0',
          best_score: parseInt(progress.score) || 0,
          avg_score: 0,
          best_level: parseInt(progress.level) || 1,
          best_lines: parseInt(progress.lines) || 0,
          total_score: 0,
          last_played: null,
          current_progress: {
            score: parseInt(progress.score) || 0,
            level: parseInt(progress.level) || 1,
            lines: parseInt(progress.lines) || 0,
            last_saved: progress.last_saved
          },
          has_unfinished_game: true,
          city: city,
          source: 'game_progress',
          note: 'Есть незавершенная игра'
        };
        
        return { 
          success: true, 
          stats: statsData,
          has_stats: false,
          has_progress: true 
        };
      } else {
        // 🔴 4. Нет данных вообще
        console.log(`📊 Нет данных для пользователя ${dbUserId}`);
        
        // Получаем город (если есть)
        const cityQuery = await client.query(
          'SELECT selected_city FROM user_sessions WHERE user_id = $1',
          [dbUserId]
        );
        const city = cityQuery.rows[0]?.selected_city || 'Не указан';
        
        const statsData = {
          games_played: 0,
          wins: 0,
          losses: 0,
          win_rate: '0.0',
          best_score: 0,
          avg_score: 0,
          best_level: 1,
          best_lines: 0,
          total_score: 0,
          last_played: null,
          current_progress: null,
          has_unfinished_game: false,
          city: city,
          source: 'none',
          note: 'Игрок еще не играл'
        };
        
        return { 
          success: true, 
          stats: statsData,
          has_stats: false,
          has_progress: false 
        };
      }
    }
    
    // 🔴 5. Есть записи в game_scores - считаем статистику
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
      WHERE user_id = $1 AND game_type = $2
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
    
    // Получаем город
    const cityQuery = await client.query(
      'SELECT selected_city FROM user_sessions WHERE user_id = $1',
      [dbUserId]
    );
    const city = cityQuery.rows[0]?.selected_city || 'Не указан';
    
    // Проверяем, есть ли незавершенная игра
    const progressQuery = await client.query(`
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `, [dbUserId, gameType]);
    
    const progress = progressQuery.rows[0];
    
    const gamesPlayed = parseInt(stats.games_played) || 0;
    const wins = parseInt(stats.wins) || 0;
    const winRate = gamesPlayed > 0 ? ((wins / gamesPlayed) * 100).toFixed(1) : '0.0';
    
    const statsData = {
      games_played: gamesPlayed,
      wins: wins,
      losses: gamesPlayed - wins,
      win_rate: winRate,
      best_score: parseInt(stats.best_score) || 0,
      avg_score: Math.round(parseFloat(stats.avg_score)) || 0,
      best_level: parseInt(stats.best_level) || 1,
      best_lines: parseInt(stats.best_lines) || 0,
      total_score: parseInt(stats.total_score) || 0,
      last_played: stats.last_played,
      current_progress: progress ? {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved
      } : null,
      has_unfinished_game: !!progress,
      city: city,
      source: 'game_scores'
    };
    
    console.log(`📊 Статистика получена:`, {
      games: statsData.games_played,
      wins: statsData.wins,
      best: statsData.best_score,
      city: statsData.city,
      has_unfinished: statsData.has_unfinished_game
    });
    
    return { 
      success: true, 
      stats: statsData,
      has_stats: true,
      has_progress: !!progress 
    };
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error.message);
    console.error('❌ Stack trace:', error.stack);
    
    return { 
      success: false, 
      error: error.message,
      stats: {
        games_played: 0,
        wins: 0,
        losses: 0,
        win_rate: '0.0',
        best_score: 0,
        avg_score: 0,
        best_level: 1,
        best_lines: 0,
        total_score: 0,
        last_played: null,
        current_progress: null,
        has_unfinished_game: false,
        city: 'Не указан',
        source: 'error',
        note: 'Ошибка получения статистики'
      }
    };
  } finally {
    client.release();
  }
}

// ============ ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Удаляет прогресс игры
 */
export async function deleteGameProgress(userId, gameType = 'tetris') {
  const client = await pool.connect();
  
  try {
    const dbUserId = convertUserIdForDb(userId);
    console.log(`🗑️ Удаление прогресса: user=${dbUserId}, type=${gameType}`);
    
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
      
      // Детальная информация о каждой таблице
      const tables = ['user_sessions', 'game_scores', 'game_progress', 'tetris_stats'];
      
      for (const table of tables) {
        try {
          const sample = await client.query(`SELECT * FROM ${table} LIMIT 2`);
          console.log(`📋 ${table}: ${sample.rows.length} записей`);
          if (sample.rows.length > 0) {
            console.log(`   Пример:`, Object.keys(sample.rows[0]).slice(0, 3).join(', '));
          }
        } catch (e) {
          console.log(`⚠️ ${table}: таблица не существует или ошибка доступа`);
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

// 🔴 АВТОМАТИЧЕСКАЯ ОТЛАДКА ПРИ ЗАПУСКЕ (только в development)
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
