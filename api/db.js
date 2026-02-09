import pg from 'pg';
const { Pool } = pg;

// 🔴 ИСПРАВЛЕННОЕ ПОДКЛЮЧЕНИЕ ДЛЯ NEON + VERCEL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 🔴 ВАЖНО: Neon требует правильного SSL
  ssl: {
    rejectUnauthorized: true, // Neon не принимает false
    // Опционально: добавьте CA сертификат для дополнительной надежности
    ca: process.env.NODE_ENV === 'production' ? 
      `-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF
ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6
b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJv
b3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXj
ca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM
9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qw
IFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6
VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L
93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQm
jgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUA
A4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDI
U5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUs
N+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vv
o/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU
5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpy
rqXRfboQnoZsG4q5WTP468SQvvG5
-----END CERTIFICATE-----` : undefined
  },
  // 🔴 Дополнительные параметры для стабильности
  connectionTimeoutMillis: 10000, // 10 секунд
  idleTimeoutMillis: 30000,
  max: 20 // максимальное количество клиентов в пуле
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

// 🔴 ФУНКЦИЯ ДЛЯ ТЕСТИРОВАНИЯ ПОДКЛЮЧЕНИЯ С ВЫВОДОМ ДЕТАЛЕЙ
async function testConnection() {
  let client;
  try {
    console.log('🧪 Тестирование подключения к БД...');
    console.log('🧪 DATABASE_URL (первые 50 символов):', process.env.DATABASE_URL?.substring(0, 50) + '...');
    console.log('🧪 NODE_ENV:', process.env.NODE_ENV);
    
    client = await pool.connect();
    const result = await client.query('SELECT version() as version, NOW() as now');
    
    console.log('✅ Подключение успешно:');
    console.log('   Версия PostgreSQL:', result.rows[0].version);
    console.log('   Время сервера:', result.rows[0].now);
    
    return { success: true, version: result.rows[0].version, time: result.rows[0].now };
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
    }
    
    return { success: false, error: error.message, code: error.code };
  } finally {
    if (client) client.release();
  }
}

async function createTables() {
  const client = await pool.connect();
  try {
    console.log('📊 Создание таблиц...');
    
    // Сначала тестируем подключение
    const testResult = await testConnection();
    if (!testResult.success) {
      throw new Error(`Не удалось подключиться к БД: ${testResult.error}`);
    }
    
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
    
    // 🔴 СПЕЦИАЛЬНЫЙ АНАЛИЗ ДЛЯ NEON SSL ПРОБЛЕМ
    if (error.message.includes('SSL') || error.code === 'ECONNRESET') {
      console.log('\n🔴 ВОЗМОЖНОЕ РЕШЕНИЕ ДЛЯ NEON:');
      console.log('1. Проверьте, что DATABASE_URL содержит sslmode=require');
      console.log('2. Убедитесь, что БД Neon активна в панели управления');
      console.log('3. Проверьте переменные окружения в Vercel');
      console.log('4. Для разработки добавьте ?sslmode=no-verify в конец DATABASE_URL');
    }
  } finally {
    client.release();
  }
}

// Автоматическое создание таблиц
if (process.env.DATABASE_URL) {
  console.log('📊 Инициализация базы данных...');
  
  // 🔴 ДОБАВЛЯЕМ ЗАДЕРЖКУ ДЛЯ VERCEL СРЕДЫ
  setTimeout(() => {
    createTables().catch(err => {
      console.error('❌ Ошибка при инициализации БД:', err);
      
      // 🔴 ПОВТОРНАЯ ПОПЫТКА ЧЕРЕЗ 5 СЕКУНД
      setTimeout(() => {
        console.log('🔄 Повторная попытка подключения к БД...');
        createTables().catch(console.error);
      }, 5000);
    });
  }, 1000); // Задержка для инициализации Vercel среды
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

// Функция для получения прогресса игры
export async function getGameProgress(userId, gameType = 'tetris') {
  const client = await pool.connect();
  try {
    const dbUserId = convertUserIdForDb(userId);
    
    const query = `
      SELECT score, level, lines, last_saved 
      FROM game_progress 
      WHERE user_id = $1 AND game_type = $2
    `;
    
    const result = await client.query(query, [dbUserId, gameType]);
    
    if (result.rows[0]) {
      const progress = result.rows[0];
      return {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ Ошибка получения прогресса:', error);
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
    
    // 🔴 ИСПРАВЛЕННЫЙ ЗАПРОС - ПРАВИЛЬНО АГРЕГИРУЕМ ДАННЫЕ
    const query = `
      WITH player_stats AS (
        SELECT 
          user_id,
          -- 🔴 ЛУЧШИЙ РЕЗУЛЬТАТ игрока
          MAX(score) as best_score,
          -- 🔴 УРОВЕНЬ И ЛИНИИ ИЗ ЛУЧШЕЙ ИГРЫ
          (
            SELECT level 
            FROM game_scores gs2 
            WHERE gs2.user_id = gs1.user_id 
              AND gs2.game_type = gs1.game_type 
              AND gs2.score = MAX(gs1.score)
            ORDER BY created_at DESC 
            LIMIT 1
          ) as best_level,
          (
            SELECT lines 
            FROM game_scores gs2 
            WHERE gs2.user_id = gs1.user_id 
              AND gs2.game_type = gs1.game_type 
              AND gs2.score = MAX(gs1.score)
            ORDER BY created_at DESC 
            LIMIT 1
          ) as best_lines,
          -- 🔴 КОЛИЧЕСТВО ВСЕХ ИГР
          COUNT(*) as games_played,
          -- 🔴 КОЛИЧЕСТВО ПОБЕД
          COUNT(CASE WHEN is_win THEN 1 END) as wins,
          MAX(created_at) as last_played
        FROM game_scores gs1
        WHERE game_type = $1 AND score > 0
        GROUP BY user_id
      )
      SELECT 
        ps.user_id,
        -- 🔴 ИМЯ И ГОРОД ИЗ user_sessions
        COALESCE(
          NULLIF(us.username, ''),
          'Игрок #' || SUBSTRING(ps.user_id from '.{4}$')
        ) as username,
        us.selected_city as city,
        ps.best_score as score,
        ps.best_level as level,
        ps.best_lines as lines,
        ps.games_played,
        ps.wins,
        ps.last_played
      FROM player_stats ps
      LEFT JOIN user_sessions us ON ps.user_id = us.user_id
      WHERE ps.best_score > 0
      ORDER BY ps.best_score DESC, ps.wins DESC, ps.games_played DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    console.log(`🏆 Найдено игроков в топе: ${result.rows.length}`);
    
    // 🔴 ДЛЯ ОТЛАДКИ: ВЫВОДИМ СЫРЫЕ ДАННЫЕ
    if (result.rows.length > 0) {
      console.log('🔍 Первые 3 записи из БД:');
      result.rows.slice(0, 3).forEach((row, i) => {
        console.log(`${i+1}. ${row.username}: ${row.score} очков, ${row.games_played} игр, город: ${row.city || 'нет'}`);
      });
    }
    
    // Форматируем результат
    return result.rows.map((row, index) => {
      let username = row.username;
      const userIdStr = String(row.user_id || '0000');
      
      // 🔴 УЛУЧШАЕМ ФОРМАТ ИМЕНИ
      if (!username || username.startsWith('Игрок #')) {
        if (userIdStr.startsWith('web_')) {
          username = `🌐 Игрок #${userIdStr.slice(-4)}`;
        } else if (/^\d+$/.test(userIdStr)) {
          username = `👤 Игрок #${userIdStr.slice(-4)}`;
        }
      }
      
      const gamesPlayed = parseInt(row.games_played) || 1;
      
      return {
        rank: index + 1,
        user_id: row.user_id,
        username: username,
        city: row.city || 'Город не указан',
        score: parseInt(row.score) || 0,
        level: parseInt(row.level) || 1,
        lines: parseInt(row.lines) || 0,
        games_played: gamesPlayed,
        wins: parseInt(row.wins) || 0,
        win_rate: gamesPlayed > 0 ? 
          ((parseInt(row.wins) / gamesPlayed) * 100).toFixed(1) : '0.0',
        last_played: row.last_played
      };
    });
    
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
  return await testConnection();
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

// 🔴 ЭКСПОРТИРУЕМ ТЕСТОВЫЕ ФУНКЦИИ ДЛЯ DIAGNOSTICS
export async function diagnoseConnection() {
  const results = {
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    databaseUrlType: process.env.DATABASE_URL?.includes('neon.tech') ? 'Neon' : 'Unknown',
    connectionTest: await testConnection(),
    nodeEnv: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  };
  
  console.log('🔍 Диагностика подключения к БД:', results);
  return results;
}

// Экспортируем pool
export { pool };
