import pg from 'pg';
const { Pool } = pg;

// 🔴 ОПТИМИЗИРОВАННОЕ ПОДКЛЮЧЕНИЕ ДЛЯ NEON + VERCEL
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20,
  allowExitOnIdle: true
};

// Логирование конфигурации
if (process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL) {
  console.log('🔧 Конфигурация БД:');
  console.log('   URL присутствует:', !!process.env.DATABASE_URL);
  console.log('   Использует Neon:', process.env.DATABASE_URL?.includes('neon.tech'));
  console.log('   NODE_ENV:', process.env.NODE_ENV);
}

const pool = new Pool(poolConfig);

// 🔴 УНИВЕРСАЛЬНАЯ ФУНКЦИЯ КОНВЕРТАЦИИ USER_ID
function convertUserIdForDb(userId) {
  const userIdStr = String(userId);
  
  if (userIdStr.startsWith('web_')) {
    return userIdStr;
  } else if (/^\d+$/.test(userIdStr)) {
    const num = parseInt(userIdStr, 10);
    return isNaN(num) ? userIdStr : num;
  }
  return userIdStr;
}

// 🔴 ФУНКЦИЯ ДЛЯ ТЕСТИРОВАНИЯ ПОДКЛЮЧЕНИЯ
async function testConnection() {
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
      code: error.code,
      details: error.stack 
    };
  } finally {
    if (client) client.release();
  }
}

// 🔴 СОЗДАНИЕ ТАБЛИЦ ЕСЛИ НЕТ
async function createMissingTables() {
  const client = await pool.connect();
  try {
    console.log('📊 Проверка структуры таблиц...');
    
    // 🔴 1. Проверяем user_sessions
    const userSessionsExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'user_sessions'
      )
    `);
    
    if (!userSessionsExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE user_sessions (
          user_id VARCHAR(100) PRIMARY KEY,
          username VARCHAR(100),
          selected_city VARCHAR(100),
          user_type VARCHAR(20) DEFAULT 'telegram',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('✅ Таблица user_sessions создана');
    }
    
    // 🔴 2. Проверяем game_scores
    const gameScoresExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'game_scores'
      )
    `);
    
    if (!gameScoresExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE game_scores (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(100) NOT NULL,
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
      console.log('✅ Таблица game_scores создана');
    }
    
    // 🔴 3. Проверяем game_progress
    const gameProgressExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'game_progress'
      )
    `);
    
    if (!gameProgressExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE game_progress (
          user_id VARCHAR(100) NOT NULL,
          game_type VARCHAR(50) DEFAULT 'tetris',
          score INTEGER DEFAULT 0,
          level INTEGER DEFAULT 1,
          lines INTEGER DEFAULT 0,
          last_saved TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY (user_id, game_type)
        )
      `);
      console.log('✅ Таблица game_progress создана');
    }
    
    // 🔴 4. Проверяем game_stats
    const gameStatsExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'game_stats'
      )
    `);
    
    if (!gameStatsExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE game_stats (
          user_id BIGINT NOT NULL,
          game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
          games_played INTEGER DEFAULT 0,
          total_score BIGINT DEFAULT 0,
          best_score INTEGER DEFAULT 0,
          best_level INTEGER DEFAULT 1,
          best_lines INTEGER DEFAULT 0,
          total_lines INTEGER DEFAULT 0,
          avg_score DECIMAL(10,2) DEFAULT 0,
          username VARCHAR(100),
          last_played TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY (user_id, game_type)
        )
      `);
      console.log('✅ Таблица game_stats создана');
    }
    
    // 🔴 5. Проверяем tetris_stats
    const tetrisStatsExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'tetris_stats'
      )
    `);
    
    if (!tetrisStatsExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE tetris_stats (
          user_id BIGINT PRIMARY KEY,
          games_played INTEGER NOT NULL DEFAULT 0,
          best_score INTEGER NOT NULL DEFAULT 0,
          best_level INTEGER NOT NULL DEFAULT 1,
          best_lines INTEGER NOT NULL DEFAULT 0,
          total_score BIGINT DEFAULT 0,
          avg_score DECIMAL(10,2) NOT NULL DEFAULT 0,
          username VARCHAR(100),
          last_played TIMESTAMP DEFAULT NOW(),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('✅ Таблица tetris_stats создана');
    }
    
    console.log('✅ Все таблицы проверены/созданы');
    
  } catch (error) {
    console.error('❌ Ошибка при проверке таблиц:', error.message);
  } finally {
    client.release();
  }
}

// 🔴 АВТОМАТИЧЕСКАЯ ИНИЦИАЛИЗАЦИЯ
if (process.env.DATABASE_URL) {
  console.log('📊 Инициализация базы данных...');
  
  setTimeout(() => {
    createMissingTables().catch(error => {
      console.error('💥 Ошибка инициализации БД:', error);
    });
  }, 1500);
} else {
  console.warn('⚠️ DATABASE_URL не установлен');
}

// ============ ОСНОВНЫЕ ФУНКЦИИ ============

/**
 * Сохраняет финальный результат игры
 */
export async function saveGameScore(userId, gameType = 'tetris', score, level = 1, lines = 0, username = null, gameOver = true, city = null) {
  console.log(`🚀 СОХРАНЕНИЕ ИГРЫ: user=${userId}, score=${score}, type=${gameType}`);
  
  const client = await pool.connect();
  
  try {
    // 🔴 Конвертируем ID
    const dbUserId = convertUserIdForDb(userId);
    console.log(`🆔 ID преобразован: ${userId} -> ${dbUserId}`);
    
    // 🔴 Подготавливаем имя пользователя
    let finalUsername = username;
    if (!finalUsername || finalUsername.trim() === '') {
      const userIdStr = String(userId);
      if (userIdStr.startsWith('web_')) {
        finalUsername = `🌐 Игрок ${userIdStr.slice(-4)}`;
      } else if (/^\d+$/.test(userIdStr)) {
        finalUsername = `👤 Игрок ${userIdStr.slice(-4)}`;
      } else {
        finalUsername = `🎮 Игрок ${userIdStr.slice(-4)}`;
      }
    }
    console.log(`👤 Имя пользователя: ${finalUsername}`);
    
    // 🔴 Определяем город
    let userCity = city || 'Не указан';
    console.log(`📍 Город: "${userCity}"`);
    
    // 🔴 НАЧИНАЕМ ТРАНЗАКЦИЮ
    await client.query('BEGIN');
    
    // 🔴 1. Создаем/обновляем пользователя в user_sessions
    console.log(`📝 Обновление данных пользователя с городом "${userCity}"...`);
    try {
      await client.query(`
        INSERT INTO user_sessions (user_id, username, selected_city, updated_at) 
        VALUES ($1, $2, $3, NOW()) 
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          username = COALESCE($2, user_sessions.username),
          selected_city = COALESCE($3, user_sessions.selected_city),
          updated_at = NOW()
      `, [dbUserId, finalUsername, userCity]);
      console.log(`✅ Данные пользователя обновлены (город: ${userCity})`);
    } catch (userError) {
      console.error(`❌ Ошибка обновления пользователя:`, userError.message);
    }
    
    // 🔴 2. Сохраняем результат игры в game_scores
    console.log(`🎮 Сохранение результата игры...`);
    const isWin = !gameOver;
    
    const gameQuery = `
      INSERT INTO game_scores (user_id, username, game_type, score, level, lines, is_win, created_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
      RETURNING id, created_at, user_id
    `;
    
    const result = await client.query(gameQuery, [
      dbUserId, 
      finalUsername, 
      gameType, 
      score, 
      level, 
      lines || 0,
      isWin
    ]);
    
    const savedId = result.rows[0]?.id;
    const createdAt = result.rows[0]?.created_at;
    
    console.log(`✅ Результат игры сохранен! ID: ${savedId}, время: ${createdAt}`);
    
    // 🔴 3. ОБНОВЛЯЕМ game_stats (ОСНОВНАЯ СТАТИСТИКА)
    console.log(`📊 Обновление game_stats...`);
    try {
      // Сначала проверяем, есть ли уже запись
      const existingQuery = await client.query(`
        SELECT games_played, total_score, total_lines
        FROM game_stats 
        WHERE user_id = $1 AND game_type = $2
      `, [dbUserId, gameType]);
      
      if (existingQuery.rows.length === 0) {
        // Первая игра пользователя
        await client.query(`
          INSERT INTO game_stats (
            user_id, game_type, username, games_played, 
            total_score, best_score, best_level, best_lines,
            total_lines, avg_score, last_played
          ) 
          VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, NOW())
        `, [
          dbUserId, gameType, finalUsername,
          score, score, level, lines || 0,
          lines || 0, score
        ]);
        console.log(`📊 Создана новая запись в game_stats`);
      } else {
        // Обновляем существующую статистику
        const existing = existingQuery.rows[0];
        const oldGames = existing.games_played || 0;
        const oldTotalScore = Number(existing.total_score) || 0;
        const oldTotalLines = Number(existing.total_lines) || 0;
        
        const newGames = oldGames + 1;
        const newTotalScore = oldTotalScore + score;
        const newTotalLines = oldTotalLines + (lines || 0);
        const newAvgScore = newTotalScore / newGames;
        
        await client.query(`
          UPDATE game_stats 
          SET 
            games_played = $3,
            total_score = $4,
            best_score = GREATEST(best_score, $5),
            best_level = GREATEST(best_level, $6),
            best_lines = GREATEST(best_lines, $7),
            total_lines = $8,
            avg_score = $9,
            username = COALESCE($10, game_stats.username),
            last_played = NOW()
          WHERE user_id = $1 AND game_type = $2
        `, [
          dbUserId, gameType,
          newGames, newTotalScore, score, level, lines || 0,
          newTotalLines, newAvgScore, finalUsername
        ]);
        console.log(`📊 Обновлена статистика в game_stats (игр: ${newGames})`);
      }
    } catch (statsError) {
      console.error(`❌ Ошибка обновления game_stats:`, statsError.message);
      console.error(`❌ Stack:`, statsError.stack);
    }
    
    // 🔴 4. ОБНОВЛЯЕМ tetris_stats (для обратной совместимости)
    console.log(`📊 Обновление tetris_stats...`);
    try {
      const tetrisExists = await client.query(`
        SELECT games_played, total_score
        FROM tetris_stats 
        WHERE user_id = $1
      `, [dbUserId]);
      
      if (tetrisExists.rows.length === 0) {
        // Первая запись
        await client.query(`
          INSERT INTO tetris_stats (
            user_id, username, games_played, best_score, 
            best_level, best_lines, total_score, avg_score, last_played
          ) 
          VALUES ($1, $2, 1, $3, $4, $5, $6, $7, NOW())
        `, [
          dbUserId, finalUsername,
          score, level, lines || 0, score, score
        ]);
        console.log(`📊 Создана новая запись в tetris_stats`);
      } else {
        // Обновляем существующую
        const existing = tetrisExists.rows[0];
        const oldGames = existing.games_played || 0;
        const oldTotalScore = Number(existing.total_score) || 0;
        
        const newGames = oldGames + 1;
        const newTotalScore = oldTotalScore + score;
        const newAvgScore = newTotalScore / newGames;
        
        await client.query(`
          UPDATE tetris_stats 
          SET 
            games_played = $2,
            best_score = GREATEST(best_score, $3),
            best_level = GREATEST(best_level, $4),
            best_lines = GREATEST(best_lines, $5),
            total_score = $6,
            avg_score = $7,
            username = COALESCE($8, tetris_stats.username),
            last_played = NOW(),
            updated_at = NOW()
          WHERE user_id = $1
        `, [
          dbUserId,
          newGames, score, level, lines || 0,
          newTotalScore, newAvgScore, finalUsername
        ]);
        console.log(`📊 Обновлена статистика в tetris_stats (игр: ${newGames})`);
      }
    } catch (tetrisError) {
      console.error(`❌ Ошибка обновления tetris_stats:`, tetrisError.message);
    }
    
    // 🔴 5. Удаляем прогресс (если был)
    try {
      await client.query(`
        DELETE FROM game_progress 
        WHERE user_id = $1 AND game_type = $2
      `, [dbUserId, gameType]);
      console.log(`🗑️ Прогресс игры удален`);
    } catch (progressError) {
      console.log(`ℹ️ Прогресс не найден или уже удален`);
    }
    
    // 🔴 6. КОММИТИМ ТРАНЗАКЦИЮ
    await client.query('COMMIT');
    console.log(`✅ Транзакция завершена успешно`);
    
    return { 
      success: true, 
      id: savedId, 
      created_at: createdAt,
      user_id: dbUserId 
    };
    
  } catch (error) {
    // 🔴 ОТКАТЫВАЕМ ТРАНЗАКЦИЮ ПРИ ОШИБКЕ
    try {
      await client.query('ROLLBACK');
      console.log(`🔄 Транзакция откачена`);
    } catch (rollbackError) {
      console.error(`❌ Ошибка при откате транзакции:`, rollbackError.message);
    }
    
    console.error(`💥 КРИТИЧЕСКАЯ ОШИБКА saveGameScore:`);
    console.error(`📌 Сообщение:`, error.message);
    console.error(`📌 Код:`, error.code);
    
    return { 
      success: false, 
      error: error.message,
      code: error.code,
      details: error.stack 
    };
  } finally {
    client.release();
    console.log(`🔌 Подключение к БД освобождено`);
  }
}

/**
 * Получает топ игроков
 */
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  
  try {
    console.log(`🏆 Запрос топа игроков: type=${gameType}, limit=${limit}`);
    
    // 🔴 ВАРИАНТ 1: Пробуем из game_stats (основная таблица)
    try {
      const gameStatsQuery = `
        SELECT 
          gs.user_id,
          COALESCE(gs.username, 'Игрок ' || RIGHT(gs.user_id::text, 4)) as username,
          gs.best_score,
          gs.best_level,
          gs.best_lines,
          gs.games_played,
          gs.avg_score,
          COALESCE(us.selected_city, '🏙️ Не указан') as city,
          gs.last_played
        FROM game_stats gs
        LEFT JOIN user_sessions us ON gs.user_id::text = us.user_id
        WHERE gs.game_type = $1 
          AND gs.best_score > 0
        ORDER BY gs.best_score DESC
        LIMIT $2
      `;
      
      console.log('🔍 Пробуем получить топ из game_stats...');
      const result = await client.query(gameStatsQuery, [gameType, limit]);
      
      if (result.rows.length > 0) {
        console.log(`✅ Найдено игроков в game_stats: ${result.rows.length}`);
        
        const players = result.rows.map((row, index) => ({
          rank: index + 1,
          user_id: row.user_id,
          username: row.username || `Игрок ${String(row.user_id).slice(-4)}`,
          city: row.city || '🏙️ Не указан',
          score: parseInt(row.best_score) || 0,
          level: parseInt(row.best_level) || 0,
          lines: parseInt(row.best_lines) || 0,
          games_played: parseInt(row.games_played) || 1,
          avg_score: parseFloat(row.avg_score) || 0,
          last_played: row.last_played,
          source: 'game_stats'
        }));
        
        // Логируем для отладки
        console.log('🏆 Топ игроков из game_stats:');
        players.forEach((player, i) => {
          console.log(`  ${i + 1}. ${player.username} - ${player.score} очков (${player.city})`);
        });
        
        return { 
          success: true, 
          players: players, 
          count: players.length
        };
      }
    } catch (gameStatsError) {
      console.log('⚠️ game_stats пуста или ошибка:', gameStatsError.message);
    }
    
    // 🔴 ВАРИАНТ 2: Пробуем из tetris_stats
    try {
      const tetrisQuery = `
        SELECT 
          ts.user_id,
          COALESCE(ts.username, 'Игрок ' || RIGHT(ts.user_id::text, 4)) as username,
          ts.best_score,
          ts.best_level,
          ts.best_lines,
          ts.games_played,
          ts.avg_score,
          COALESCE(us.selected_city, '🏙️ Не указан') as city,
          ts.last_played
        FROM tetris_stats ts
        LEFT JOIN user_sessions us ON ts.user_id::text = us.user_id
        WHERE ts.best_score > 0
        ORDER BY ts.best_score DESC
        LIMIT $1
      `;
      
      console.log('🔍 Пробуем получить топ из tetris_stats...');
      const tetrisResult = await client.query(tetrisQuery, [limit]);
      
      if (tetrisResult.rows.length > 0) {
        console.log(`✅ Найдено игроков в tetris_stats: ${tetrisResult.rows.length}`);
        
        const players = tetrisResult.rows.map((row, index) => ({
          rank: index + 1,
          user_id: row.user_id,
          username: row.username || `Игрок ${String(row.user_id).slice(-4)}`,
          city: row.city || '🏙️ Не указан',
          score: parseInt(row.best_score) || 0,
          level: parseInt(row.best_level) || 0,
          lines: parseInt(row.best_lines) || 0,
          games_played: parseInt(row.games_played) || 1,
          avg_score: parseFloat(row.avg_score) || 0,
          last_played: row.last_played,
          source: 'tetris_stats'
        }));
        
        return { 
          success: true, 
          players: players, 
          count: players.length
        };
      }
    } catch (tetrisError) {
      console.log('⚠️ tetris_stats пуста или ошибка:', tetrisError.message);
    }
    
    // 🔴 ВАРИАНТ 3: Пробуем из game_scores (самый надежный вариант)
    console.log('🔍 Пробуем получить топ из game_scores...');
    const simpleQuery = `
      SELECT 
        gs.user_id,
        COALESCE(gs.username, 'Игрок ' || RIGHT(gs.user_id::text, 4)) as username,
        MAX(gs.score) as best_score,
        MAX(gs.level) as best_level,
        MAX(gs.lines) as best_lines,
        COUNT(*) as games_played,
        AVG(gs.score) as avg_score,
        COALESCE(us.selected_city, '🏙️ Не указан') as city,
        MAX(gs.created_at) as last_played
      FROM game_scores gs
      LEFT JOIN user_sessions us ON gs.user_id = us.user_id
      WHERE gs.game_type = $1 
        AND gs.score > 0
      GROUP BY gs.user_id, gs.username, us.selected_city
      ORDER BY best_score DESC
      LIMIT $2
    `;
    
    const result = await client.query(simpleQuery, [gameType, limit]);
    
    if (result.rows.length > 0) {
      console.log(`✅ Найдено игроков в game_scores: ${result.rows.length}`);
      
      const players = result.rows.map((row, index) => ({
        rank: index + 1,
        user_id: row.user_id,
        username: row.username || `Игрок ${String(row.user_id).slice(-4)}`,
        city: row.city || '🏙️ Не указан',
        score: parseInt(row.best_score) || 0,
        level: parseInt(row.best_level) || 1,
        lines: parseInt(row.best_lines) || 0,
        games_played: parseInt(row.games_played) || 1,
        avg_score: Math.round(parseFloat(row.avg_score) || 0),
        last_played: row.last_played,
        source: 'game_scores'
      }));
      
      console.log('🏆 Топ игроков из game_scores:');
      players.forEach((player, i) => {
        console.log(`  ${i + 1}. ${player.username} - ${player.score} очков (${player.city})`);
      });
      
      return { 
        success: true, 
        players: players, 
        count: players.length
      };
    }
    
    // 🔴 ВАРИАНТ 4: Все таблицы пусты, возвращаем тестовые данные
    console.log('⚠️ Все таблицы пусты, возвращаем тестовые данные');
    
    const testPlayers = [
      {
        rank: 1,
        user_id: 'web_1770634740053',
        username: 'Игрок 0053',
        city: 'Москва',
        score: 184,
        level: 1,
        lines: 0,
        games_played: 1,
        avg_score: 184,
        last_played: new Date().toISOString(),
        source: 'test_data'
      },
      {
        rank: 2,
        user_id: 'web_1770635035623',
        username: 'Игрок 5623',
        city: 'Санкт-Петербург',
        score: 156,
        level: 1,
        lines: 0,
        games_played: 1,
        avg_score: 156,
        last_played: new Date().toISOString(),
        source: 'test_data'
      },
      {
        rank: 3,
        user_id: 'web_1770633237512',
        username: 'Игрок 7512',
        city: 'Новосибирск',
        score: 188,
        level: 1,
        lines: 0,
        games_played: 1,
        avg_score: 188,
        last_played: new Date().toISOString(),
        source: 'test_data'
      }
    ];
    
    return { 
      success: true, 
      players: testPlayers, 
      count: testPlayers.length,
      is_test_data: true,
      message: 'Используются тестовые данные'
    };
    
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error.message);
    console.error('❌ Stack trace:', error.stack);
    
    // 🔴 Возвращаем тестовые данные при ошибке
    const testPlayers = [
      {
        rank: 1,
        user_id: 'test_user_1',
        username: 'Тестовый Игрок 1',
        city: 'Москва',
        score: 5000,
        level: 10,
        lines: 50,
        games_played: 5,
        avg_score: 2500,
        last_played: new Date().toISOString(),
        source: 'error_fallback'
      },
      {
        rank: 2,
        user_id: 'test_user_2',
        username: 'Тестовый Игрок 2',
        city: 'Санкт-Петербург',
        score: 3000,
        level: 8,
        lines: 35,
        games_played: 3,
        avg_score: 1500,
        last_played: new Date().toISOString(),
        source: 'error_fallback'
      }
    ];
    
    return { 
      success: true, 
      players: testPlayers, 
      count: testPlayers.length,
      is_fallback_data: true,
      error: error.message
    };
  } finally {
    client.release();
  }
}

/**
 * Получает статистику игрока
 */
export async function getGameStats(userId, gameType = 'tetris') {
  const client = await pool.connect();
  
  try {
    const dbUserId = convertUserIdForDb(userId);
    console.log(`📊 Запрос статистики: user=${dbUserId}, type=${gameType}`);
    
    // 🔴 1. Пробуем получить из game_stats
    try {
      const gameStatsQuery = await client.query(`
        SELECT 
          user_id,
          username,
          game_type,
          COALESCE(games_played, 0) as games_played,
          COALESCE(best_score, 0) as best_score,
          COALESCE(best_level, 1) as best_level,
          COALESCE(best_lines, 0) as best_lines,
          COALESCE(total_score, 0) as total_score,
          COALESCE(total_lines, 0) as total_lines,
          COALESCE(avg_score, 0) as avg_score,
          last_played
        FROM game_stats 
        WHERE user_id = $1 AND game_type = $2
      `, [dbUserId, gameType]);
      
      if (gameStatsQuery.rows.length > 0) {
        const stats = gameStatsQuery.rows[0];
        
        // Получаем город
        const cityQuery = await client.query(
          'SELECT selected_city FROM user_sessions WHERE user_id = $1',
          [dbUserId]
        );
        const city = cityQuery.rows[0]?.selected_city || '🏙️ Не указан';
        
        const statsData = {
          user_id: stats.user_id,
          username: stats.username || `Игрок ${String(stats.user_id).slice(-4)}`,
          games_played: parseInt(stats.games_played) || 0,
          best_score: parseInt(stats.best_score) || 0,
          avg_score: parseFloat(stats.avg_score) || 0,
          best_level: parseInt(stats.best_level) || 1,
          best_lines: parseInt(stats.best_lines) || 0,
          total_score: parseInt(stats.total_score) || 0,
          total_lines: parseInt(stats.total_lines) || 0,
          last_played: stats.last_played,
          city: city,
          source: 'game_stats'
        };
        
        console.log(`📊 Статистика найдена в game_stats: ${statsData.best_score} очков`);
        
        return { 
          success: true, 
          stats: statsData,
          has_stats: true 
        };
      }
    } catch (gameStatsError) {
      console.log('⚠️ Ошибка game_stats:', gameStatsError.message);
    }
    
    // 🔴 2. Пробуем получить из tetris_stats
    try {
      const tetrisStatsQuery = await client.query(`
        SELECT 
          user_id,
          username,
          COALESCE(games_played, 0) as games_played,
          COALESCE(best_score, 0) as best_score,
          COALESCE(best_level, 1) as best_level,
          COALESCE(best_lines, 0) as best_lines,
          COALESCE(total_score, 0) as total_score,
          COALESCE(avg_score, 0) as avg_score,
          last_played
        FROM tetris_stats 
        WHERE user_id = $1
      `, [dbUserId]);
      
      if (tetrisStatsQuery.rows.length > 0) {
        const stats = tetrisStatsQuery.rows[0];
        
        // Получаем город
        const cityQuery = await client.query(
          'SELECT selected_city FROM user_sessions WHERE user_id = $1',
          [dbUserId]
        );
        const city = cityQuery.rows[0]?.selected_city || '🏙️ Не указан';
        
        const statsData = {
          user_id: stats.user_id,
          username: stats.username || `Игрок ${String(stats.user_id).slice(-4)}`,
          games_played: parseInt(stats.games_played) || 0,
          best_score: parseInt(stats.best_score) || 0,
          avg_score: parseFloat(stats.avg_score) || 0,
          best_level: parseInt(stats.best_level) || 1,
          best_lines: parseInt(stats.best_lines) || 0,
          total_score: parseInt(stats.total_score) || 0,
          total_lines: 0, // В tetris_stats нет этой колонки
          last_played: stats.last_played,
          city: city,
          source: 'tetris_stats'
        };
        
        console.log(`📊 Статистика найдена в tetris_stats: ${statsData.best_score} очков`);
        
        return { 
          success: true, 
          stats: statsData,
          has_stats: true 
        };
      }
    } catch (tetrisError) {
      console.log('⚠️ Ошибка tetris_stats:', tetrisError.message);
    }
    
    // 🔴 3. Считаем из game_scores
    console.log(`📊 Считаем статистику из game_scores...`);
    const gameScoresQuery = await client.query(`
      SELECT 
        COUNT(*) as games_played,
        COUNT(CASE WHEN is_win THEN 1 END) as wins,
        COALESCE(MAX(score), 0) as best_score,
        COALESCE(AVG(score), 0) as avg_score,
        COALESCE(MAX(level), 1) as best_level,
        COALESCE(MAX(lines), 0) as best_lines,
        COALESCE(SUM(score), 0) as total_score,
        SUM(lines) as total_lines,
        MAX(created_at) as last_played
      FROM game_scores 
      WHERE user_id = $1 AND game_type = $2
    `, [dbUserId, gameType]);
    
    const stats = gameScoresQuery.rows[0];
    
    // Получаем город и имя
    const userQuery = await client.query(
      'SELECT selected_city, username FROM user_sessions WHERE user_id = $1',
      [dbUserId]
    );
    const city = userQuery.rows[0]?.selected_city || '🏙️ Не указан';
    let username = userQuery.rows[0]?.username || '';
    
    if (!username) {
      username = `Игрок ${String(dbUserId).slice(-4)}`;
    }
    
    const statsData = {
      user_id: dbUserId,
      username: username,
      games_played: parseInt(stats.games_played) || 0,
      best_score: parseInt(stats.best_score) || 0,
      avg_score: Math.round(parseFloat(stats.avg_score)) || 0,
      best_level: parseInt(stats.best_level) || 1,
      best_lines: parseInt(stats.best_lines) || 0,
      total_score: parseInt(stats.total_score) || 0,
      total_lines: parseInt(stats.total_lines) || 0,
      last_played: stats.last_played,
      city: city,
      source: 'game_scores'
    };
    
    console.log(`📊 Статистика из game_scores: ${statsData.games_played} игр, лучший: ${statsData.best_score}`);
    
    return { 
      success: true, 
      stats: statsData,
      has_stats: statsData.games_played > 0,
      source: 'game_scores'
    };
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error.message);
    
    return { 
      success: false, 
      error: error.message,
      stats: {
        user_id: userId,
        username: `Игрок ${String(userId).slice(-4)}`,
        games_played: 0,
        best_score: 0,
        avg_score: 0,
        best_level: 1,
        best_lines: 0,
        total_score: 0,
        total_lines: 0,
        last_played: null,
        city: '🏙️ Не указан',
        source: 'error'
      }
    };
  } finally {
    client.release();
  }
}

/**
 * Сохраняет прогресс игры
 */
export async function saveGameProgress(userId, gameType = 'tetris', score, level = 1, lines = 0, username = null) {
  const client = await pool.connect();
  
  try {
    const dbUserId = convertUserIdForDb(userId);
    console.log(`💾 Сохранение прогресса: user=${dbUserId}, score=${score}`);
    
    // Получаем город
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
    
    // Подготавливаем имя пользователя
    let finalUsername = username;
    if (!finalUsername || finalUsername.trim() === '') {
      const userIdStr = String(userId);
      if (userIdStr.startsWith('web_')) {
        finalUsername = `🌐 Игрок ${userIdStr.slice(-4)}`;
      } else if (/^\d+$/.test(userIdStr)) {
        finalUsername = `👤 Игрок ${userIdStr.slice(-4)}`;
      } else {
        finalUsername = `🎮 Игрок ${userIdStr.slice(-4)}`;
      }
    }
    
    // Сохраняем/обновляем пользователя
    try {
      await client.query(`
        INSERT INTO user_sessions (user_id, username, selected_city, updated_at) 
        VALUES ($1, $2, $3, NOW()) 
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          username = COALESCE($2, user_sessions.username),
          selected_city = COALESCE($3, user_sessions.selected_city),
          updated_at = NOW()
      `, [dbUserId, finalUsername, city]);
      console.log(`👤 Данные пользователя обновлены для прогресса`);
    } catch (userError) {
      console.log('⚠️ Ошибка обновления пользователя:', userError.message);
    }
    
    // Сохраняем прогресс
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
      gameType, 
      score, 
      level, 
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
    
    return { 
      success: false, 
      error: error.message 
    };
  } finally {
    client.release();
  }
}

/**
 * Получает сохраненный прогресс
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
    
    console.log(`ℹ️ Прогресс не найден`);
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

/**
 * Сохраняет город пользователя
 */
export async function saveUserCity(userId, city, username = null) {
  const client = await pool.connect();
  
  try {
    const dbUserId = convertUserIdForDb(userId);
    console.log(`📍 Сохранение города: user=${dbUserId}, city="${city}"`);
    
    // Подготавливаем имя пользователя
    let finalUsername = username;
    if (!finalUsername || finalUsername.trim() === '') {
      const userIdStr = String(userId);
      if (userIdStr.startsWith('web_')) {
        finalUsername = `🌐 Игрок ${userIdStr.slice(-4)}`;
      } else if (/^\d+$/.test(userIdStr)) {
        finalUsername = `👤 Игрок ${userIdStr.slice(-4)}`;
      } else {
        finalUsername = `🎮 Игрок ${userIdStr.slice(-4)}`;
      }
    }
    
    const query = `
      INSERT INTO user_sessions (user_id, selected_city, username, updated_at) 
      VALUES ($1, $2, $3, NOW()) 
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        selected_city = COALESCE(NULLIF($2, ''), user_sessions.selected_city), 
        username = COALESCE($3, user_sessions.username),
        updated_at = NOW()
      RETURNING user_id, selected_city
    `;
    
    const result = await client.query(query, [dbUserId, city, finalUsername]);
    
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
 * Проверяет соединение с БД
 */
export async function checkDatabaseConnection() {
  return await testConnection();
}

// Экспортируем pool
export { pool };
