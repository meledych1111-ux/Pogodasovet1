const { getGameStats } = require('./db.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, gameType = 'tetris' } = req.query;
    
    if (!userId) {
      return res.status(400).json({ 
        error: 'Missing userId' 
      });
    }

    const stats = await getGameStats(parseInt(userId), gameType);
    
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
    console.error('Error getting stats:', error);
    return res.status(500).json({ 
      error: 'Internal server error'
    });
  }
};
