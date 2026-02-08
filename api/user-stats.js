import { getGameStats } from './init-db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, gameType = 'tetris' } = req.query;
    
    if (!userId) {
      return res.status(400).json({ 
        error: 'Missing required parameter: userId' 
      });
    }

    const stats = await getGameStats(parseInt(userId), gameType);
    
    // Если статистики нет, возвращаем нулевые значения
    const defaultStats = {
      games_played: 0,
      best_score: 0,
      best_level: 1,
      best_lines: 0,
      avg_score: 0,
      last_played: null
    };
    
    return res.status(200).json(stats || defaultStats);
    
  } catch (error) {
    console.error('Error getting user stats:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
