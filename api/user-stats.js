import { getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('📊 Запрос статистики:', req.method, req.query);
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, gameType = 'tetris' } = req.query;
    
    console.log('👤 Получение статистики для:', { userId, gameType });
    
    if (!userId) {
      console.log('❌ Отсутствует userId');
      return res.status(400).json({ 
        error: 'Missing userId' 
      });
    }

    const stats = await getGameStats(parseInt(userId), gameType);
    console.log('📈 Получена статистика:', stats);
    
    const defaultStats = {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null,
      current_progress: null,
      has_unfinished_game: false
    };
    
    // Объединяем полученные данные с дефолтными значениями
    const result = {
      games_played: stats?.games_played || 0,
      best_score: stats?.best_score || 0,
      best_level: stats?.best_level || 1,
      best_lines: stats?.best_lines || 0,
      avg_score: stats?.avg_score || 0,
      last_played: stats?.last_played || null,
      current_progress: stats?.current_progress || null,
      has_unfinished_game: stats?.has_unfinished_game || false
    };
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    return res.status(500).json({ 
      error: 'Internal server error'
    });
  }
}
