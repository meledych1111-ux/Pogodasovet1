import { saveGameProgress } from './db.js';

export default async function handler(req, res) {
  console.log('💾 API: /api/save-progress - автосохранение игры');
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use POST.' 
    });
  }
  
  try {
    const {
      userId,
      gameType = 'tetris',
      score,
      level = 1,
      lines = 0,
      username = null
    } = req.body;
    
    console.log('💾 Данные для автосохранения:', { 
      userId, gameType, score, level, lines 
    });
    
    if (!userId || !score) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: userId or score'
      });
    }
    
    const result = await saveGameProgress(
      userId,
      gameType,
      score,
      level,
      lines,
      username
    );
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('❌ Ошибка автосохранения:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
