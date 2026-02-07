import pg from 'pg';
const { Pool } = pg;

// Создаем "пул" соединений. Это эффективно для serverless-функций.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Vercel добавил эту переменную
  ssl: {
    rejectUnauthorized: false // Требуется для Neon
  }
});

// Функция для создания таблиц (вызывается один раз при инициализации)
export async function createTables() {
  const client = await pool.connect();
  try {
    // Таблица для сессий пользователей (города)
    const userSessionsQuery = `
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id BIGINT PRIMARY KEY,
        selected_city VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client.query(userSessionsQuery);
    console.log('✅ Таблица user_sessions создана или уже существует');
    
    // Таблица для результатов игр (исправленная)
    const gameScoresQuery = `
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
    `;
    await client.query(gameScoresQuery);
    console.log('✅ Таблица game_scores создана или уже существует');
    
  } catch (error) {
    console.error('❌ Ошибка при создании таблиц:', error);
  } finally {
    client.release();
  }
}

// Вызываем создание таблиц при загрузке модуля
createTables();

// ============ ФУНКЦИИ ДЛЯ РАБОТЫ С ГОРОДАМИ ============

// Функция для сохранения или обновления города пользователя
export async function saveUserCity(userId, city) {
  const client = await pool.connect();
  try {
    // Этот запрос вставляет новую запись или обновляет существующую
    const query = `
      INSERT INTO user_sessions (user_id, selected_city)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET selected_city = $2, updated_at = NOW()
    `;
    await client.query(query, [userId, city]);
    console.log(`✅ Город "${city}" сохранен для пользователя ${userId}`);
  } catch (error) {
    console.error('❌ Ошибка при сохранении города в БД:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Функция для получения города пользователя
export async function getUserCity(userId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT selected_city FROM user_sessions WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.selected_city || null;
  } catch (error) {
    console.error('❌ Ошибка при получении города из БД:', error);
    return null;
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ РАБОТЫ С ИГРАМИ ============

// Функция для сохранения результатов игры
export async function saveGameScore(userId, gameType, score, level, lines) {
  const client = await pool.connect();
  try {
    // Сохраняем результат (теперь каждый результат сохраняется отдельно)
    const insertQuery = `
      INSERT INTO game_scores (user_id, game_type, score, level, lines) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING id
    `;
    
    const result = await client.query(insertQuery, [userId, gameType, score, level, lines]);
    console.log(`✅ Результат игры сохранён для пользователя ${userId}, ID записи: ${result.rows[0]?.id}`);
    return result.rows[0]?.id;
    
  } catch (error) {
    console.error('❌ Ошибка при сохранении результатов игры:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Функция для получения лучшего счёта пользователя
export async function getUserBestScore(userId, gameType = 'tetris') {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT MAX(score) as best_score, MAX(level) as best_level, MAX(lines) as best_lines FROM game_scores WHERE user_id = $1 AND game_type = $2',
      [userId, gameType]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('❌ Ошибка при получении результатов игры:', error);
    return null;
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ СТАТИСТИКИ ============

// Функция для получения статистики игрока (ИСПРАВЛЕННАЯ)
export async function getGameStats(userId, gameType = 'tetris') {
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        COUNT(*) as games_played,
        MAX(score) as best_score,
        MAX(level) as best_level,
        MAX(lines) as best_lines,
        AVG(score) as avg_score,
        MAX(created_at) as last_played
      FROM game_scores 
      WHERE user_id = $1 AND game_type = $2
    `;
    
    const result = await client.query(query, [userId, gameType]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    return null;
  } finally {
    client.release();
  }
}

// Функция для получения топа игроков (для /top команды)
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        user_id,
        MAX(score) as score,
        MAX(level) as level,
        MAX(lines) as lines,
        COUNT(*) as games_played
      FROM game_scores 
      WHERE game_type = $1 
      GROUP BY user_id
      ORDER BY MAX(score) DESC, MAX(level) DESC, MAX(lines) DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    return result.rows;
  } catch (error) {
    console.error('❌ Ошибка получения топа игроков:', error);
    return [];
  } finally {
    client.release();
  }
}

// Функция для получения таблицы лидеров (расширенная версия с JOIN)
export async function getLeaderboard(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  try {
    // Этот запрос возвращает топ игроков с их лучшими результатами
    const query = `
      SELECT DISTINCT ON (gs.user_id)
        gs.user_id,
        gs.score,
        gs.level,
        gs.lines,
        gs.created_at
      FROM game_scores gs
      WHERE gs.game_type = $1
      ORDER BY gs.user_id, gs.score DESC, gs.level DESC, gs.lines DESC
      LIMIT $2
    `;
    
    const result = await client.query(query, [gameType, limit]);
    return result.rows;
  } catch (error) {
    console.error('❌ Ошибка при получении таблицы лидеров:', error);
    return [];
  } finally {
    client.release();
  }
}

// Дополнительная функция: получение истории игр пользователя
export async function getUserGameHistory(userId, gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        score,
        level,
        lines,
        created_at
      FROM game_scores 
      WHERE user_id = $1 AND game_type = $2
      ORDER BY created_at DESC
      LIMIT $3
    `;
    
    const result = await client.query(query, [userId, gameType, limit]);
    return result.rows;
  } catch (error) {
    console.error('❌ Ошибка получения истории игр:', error);
    return [];
  } finally {
    client.release();
  }
}

// Дополнительная функция: удаление всех данных пользователя (для тестирования)
export async function clearUserData(userId) {
  const client = await pool.connect();
  try {
    // Удаляем данные из обеих таблиц
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM game_scores WHERE user_id = $1', [userId]);
    console.log(`✅ Данные пользователя ${userId} очищены`);
    return true;
  } catch (error) {
    console.error('❌ Ошибка при очистке данных:', error);
    return false;
  } finally {
    client.release();
  }
}
