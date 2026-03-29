import { saveScore, getStats } from './db.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { username, score, level = 1, lines = 0, gameType = 'tetris' } = req.body;
    
    // В новой системе мы работаем только по username (логину), а не по ID
    if (!username || score === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: username, score'
      });
    }

    console.log(`💾 Сохранение счета для игрока ${username}: ${score}`);
    
    // Сохраняем в БД
    await saveScore(username, parseInt(score), parseInt(level), parseInt(lines));
    
    // Получаем обновленную статистику
    const stats = await getStats(username);
    
    return res.status(200).json({
      success: true,
      username: username,
      score: parseInt(score),
      stats: {
        best_score: stats?.best_score || 0,
        games_played: stats?.games || 0
      }
    });

  } catch (error) {
    console.error('❌ Ошибка в save-score:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
