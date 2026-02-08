import { getGameProgress } from './db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, gameType = 'tetris' } = req.query;
    
    console.log('📋 Получение прогресса для:', userId);
    
    if (!userId) {
      return res.status(400).json({ 
        error: 'Missing userId' 
      });
    }

    const progress = await getGameProgress(parseInt(userId), gameType);
    
    return res.status(200).json({ 
      success: true,
      progress: progress || {
        score: 0,
        level: 1,
        lines: 0,
        last_saved: null
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting progress:', error);
    return res.status(500).json({ 
      error: 'Internal server error'
    });
  }
}
