import pg from 'pg';
const { Pool } = pg;

// Создаем "пул" соединений. Это эффективно для serverless-функций.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Vercel добавил эту переменную
  ssl: {
    rejectUnauthorized: false // Требуется для Neon
  }
});

// Функция для создания таблицы (вызывается один раз при инициализации)
export async function createUserSessionsTable() {
  const client = await pool.connect();
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id BIGINT PRIMARY KEY,
        selected_city VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client.query(query);
    console.log('✅ Таблица user_sessions создана или уже существует');
  } catch (error) {
    console.error('❌ Ошибка при создании таблицы:', error);
  } finally {
    client.release();
  }
}

// Вызываем создание таблицы при загрузке модуля
createUserSessionsTable();

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
    throw error; // Пробрасываем ошибку, чтобы обработать её в обработчике бота
  } finally {
    client.release(); // Важно: всегда отпускаем клиента обратно в пул
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
    // Если запись найдена, возвращаем город, иначе — null
    return result.rows[0]?.selected_city || null;
  } catch (error) {
    console.error('❌ Ошибка при получении города из БД:', error);
    return null; // В случае ошибки возвращаем null
  } finally {
    client.release();
  }
}

// ============ ФУНКЦИИ ДЛЯ РАБОТЫ С ИГРАМИ ============

// Функция для сохранения результатов игры
export async function saveGameScore(userId, gameType, score, level, lines) {
  const client = await pool.connect();
  try {
    // Сначала создаём таблицу, если она не существует
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS game_scores (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
        score INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        lines INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, game_type)
      )
    `;
    await client.query(createTableQuery);
    
    // Сохраняем или обновляем результат
    const insertQuery = `
      INSERT INTO game_scores (user_id, game_type, score, level, lines) 
      VALUES ($1, $2, $3, $4, $5) 
      ON CONFLICT (user_id, game_type) 
      DO UPDATE SET 
        score = GREATEST(game_scores.score, EXCLUDED.score),
        level = GREATEST(game_scores.level, EXCLUDED.level),
        lines = GREATEST(game_scores.lines, EXCLUDED.lines),
        updated_at = NOW()
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
      'SELECT score, level, lines FROM game_scores WHERE user_id = $1 AND game_type = $2',
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

// Функция для получения таблицы лидеров
export async function getLeaderboard(gameType = 'tetris', limit = 10) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT user_id, score, level, lines 
       FROM game_scores 
       WHERE game_type = $1 
       ORDER BY score DESC, level DESC, lines DESC 
       LIMIT $2`,
      [gameType, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('❌ Ошибка при получении таблицы лидеров:', error);
    return [];
  } finally {
    client.release();
  }
}
