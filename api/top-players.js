import { getTopPlayers } from './db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { gameType = 'tetris', limit = 10 } = req.query;
    
    const topPlayers = await getTopPlayers(gameType, parseInt(limit));
    
    return res.status(200).json(topPlayers || []);
    
  } catch (error) {
    console.error('Error getting top players:', error);
    return res.status(500).json({ 
      error: 'Internal server error'
    });
  }
}
