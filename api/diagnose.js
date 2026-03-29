// api/diagnose.js
import { pool } from './db.js';

export default async function handler(req, res) {
  const client = await pool.connect();
  
  try {
    console.log('🩺 Диагностика базы данных...');
    
    // 1. Проверяем соединение
    const timeCheck = await client.query('SELECT NOW() as db_time');
    
    // 2. Проверяем таблицы
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    // 3. Проверяем game_scores
    const scoresStats = await client.query(`
      SELECT 
        COUNT(*) as total_games,
        COUNT(DISTINCT user_id) as unique_players,
        COALESCE(MAX(score), 0) as max_score,
        COALESCE(AVG(score), 0) as avg_score,
        MAX(created_at) as latest_game
      FROM game_scores
    `);
    
    // 4. Проверяем последние 10 записей
    const recentScores = await client.query(`
      SELECT id, user_id, score, level, lines, created_at 
      FROM game_scores 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    // 5. Проверяем game_progress
    const progressStats = await client.query(`
      SELECT COUNT(*) as total_progress FROM game_progress
    `);
    
    // 6. Проверяем user_sessions
    const userStats = await client.query(`
      SELECT COUNT(*) as total_users FROM user_sessions
    `);
    
    return res.json({
      success: true,
      database: {
        connection: '✅ OK',
        current_time: timeCheck.rows[0].db_time,
        tables: tables.rows.map(t => t.table_name),
        has_game_scores: tables.rows.some(t => t.table_name === 'game_scores'),
        has_game_progress: tables.rows.some(t => t.table_name === 'game_progress'),
        has_user_sessions: tables.rows.some(t => t.table_name === 'user_sessions')
      },
      game_scores: {
        total_games: parseInt(scoresStats.rows[0].total_games),
        unique_players: parseInt(scoresStats.rows[0].unique_players),
        max_score: parseInt(scoresStats.rows[0].max_score),
        avg_score: parseFloat(scoresStats.rows[0].avg_score),
        latest_game: scoresStats.rows[0].latest_game,
        recent_games: recentScores.rows
      },
      game_progress: {
        total_progress: parseInt(progressStats.rows[0].total_progress)
      },
      user_sessions: {
        total_users: parseInt(userStats.rows[0].total_users)
      },
      environment: {
        node_env: process.env.NODE_ENV,
        database_url: process.env.DATABASE_URL ? '✅ Настроен' : '❌ Отсутствует',
        has_ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? '✅ Да' : '❌ Нет'
      }
    });
    
  } catch (error) {
    console.error('🩺 Ошибка диагностики:', error);
    return res.json({
      success: false,
      error: error.message,
      stack: error.stack,
      database_url: process.env.DATABASE_URL,
      node_env: process.env.NODE_ENV
    });
  } finally {
    client.release();
  }
}
