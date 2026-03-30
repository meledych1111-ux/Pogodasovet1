import { saveGameScore, getGameStats, generateAnonymousName } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    // Принимаем session_id (UUID с фронта) вместо userId или чего-то еще
    const { session_id, score, level = 1, lines = 0, gameType = 'tetris', city = 'Не указан' } = req.body;
    
    if (!session_id || score === undefined) {
      return res.status(400).json({ success: false, error: 'Missing session_id or score' });
    }

    // Генерируем публичное "Облачное имя" из анонимного UUID.
    // Исходный session_id (UUID) НИКОГДА не сохраняется в базу данных.
    const cloudName = generateAnonymousName(session_id);

    // Сохраняем только анонимное имя и игровые данные
    await saveGameScore(cloudName, gameType, parseInt(score), parseInt(level), parseInt(lines), city);
    
    const stats = await getGameStats(cloudName, gameType);
    
    return res.status(200).json({
      success: true,
      stats: {
        best_score: stats?.best_score || 0,
        games_played: stats?.games_played || 0,
        cloudName: cloudName // Возвращаем имя, чтобы игрок знал, кто он в таблице
      }
    });

  } catch (error) {
    console.error('❌ Error in save-score:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
}
