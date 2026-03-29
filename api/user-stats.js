import { getGameStats } from './db.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  console.log('📊 /api/user-stats - Request:', req.query);

  try {
    const { userId, gameType = 'tetris' } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId parameter'
      });
    }

    const stats = await getGameStats(userId, gameType);
    
    const response = {
      success: true,
      userId: userId,
      gameType: gameType,
      games_played: parseInt(stats?.games_played) || 0,
      best_score: parseInt(stats?.best_score) || 0,
      best_level: parseInt(stats?.best_level) || 1,
      best_lines: parseInt(stats?.best_lines) || 0,
      avg_score: stats?.avg_score ? parseFloat(parseFloat(stats.avg_score).toFixed(2)) : 0
    };

    console.log('📊 Response:', response);
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Error in user-stats:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
