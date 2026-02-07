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
