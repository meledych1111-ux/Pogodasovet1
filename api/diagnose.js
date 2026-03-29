import { pool } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // 1. Проверяем таблицу users_cloud
    const usersTable = await pool.query(`
      SELECT column_name, data_type, character_maximum_length 
      FROM information_schema.columns 
      WHERE table_name = 'users_cloud'
    `);

    // 2. Проверяем таблицу game_scores
    const scoresTable = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'game_scores'
    `);

    // 3. Проверяем наличие записей
    const userCount = await pool.query('SELECT COUNT(*) FROM users_cloud');
    const scoreCount = await pool.query('SELECT COUNT(*) FROM game_scores');

    return res.json({
      success: true,
      tables: {
        users_cloud: usersTable.rows,
        game_scores: scoresTable.rows
      },
      counts: {
        users: userCount.rows[0].count,
        scores: scoreCount.rows[0].count
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
