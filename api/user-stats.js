import { getGameStats, generateAnonymousName } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const { session_id, gameType = 'tetris' } = req.query;
    
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'Missing session_id' });
    }

    const cloudName = generateAnonymousName(session_id);
    const stats = await getGameStats(cloudName, gameType);
    
    return res.status(200).json({
      success: true,
      cloudName: cloudName,
      gameType: gameType,
      games_played: parseInt(stats?.games_played) || 0,
      best_score: parseInt(stats?.best_score) || 0,
      best_level: parseInt(stats?.best_level) || 1,
      best_lines: parseInt(stats?.best_lines) || 0
    });

  } catch (error) {
    console.error('❌ Error in user-stats:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
}
