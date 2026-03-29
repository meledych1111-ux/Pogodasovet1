import { saveGameScore, getGameStats } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { userId, score, level = 1, lines = 0, gameType = 'tetris', city } = req.body;
    
    // userId здесь — это наше "Облачное имя", которое пришло от фронтенда
    if (!userId || score === undefined) {
      return res.status(400).json({ success: false, error: 'Missing data' });
    }

    // Сохраняем (в db.js мы переименовали параметры)
    await saveGameScore(userId, gameType, parseInt(score), parseInt(level), parseInt(lines), city);
    
    const stats = await getGameStats(userId, gameType);
    
    return res.status(200).json({
      success: true,
      stats: {
        best_score: stats?.best_score || 0,
        games_played: stats?.games_played || 0
      }
    });

  } catch (error) {
    console.error('❌ Error in save-score:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
