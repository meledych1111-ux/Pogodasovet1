import { saveGameProgress, deleteGameProgress } from './db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, userId, gameType = 'tetris', score, level, lines } = req.body;
    
    console.log('📝 Сохранение прогресса:', { action, userId, score });
    
    if (!userId) {
      return res.status(400).json({ 
        error: 'Missing userId' 
      });
    }
    
    if (action === 'save') {
      // Сохраняем прогресс
      const result = await saveGameProgress(
        parseInt(userId), 
        gameType, 
        parseInt(score || 0), 
        parseInt(level || 1), 
        parseInt(lines || 0)
      );
      
      return res.status(200).json({ 
        success: true,
        saved: !!result,
        message: 'Progress saved'
      });
      
    } else if (action === 'delete') {
      // Удаляем прогресс (после завершения игры)
      const result = await deleteGameProgress(parseInt(userId), gameType);
      
      return res.status(200).json({ 
        success: true,
        deleted: !!result,
        message: 'Progress deleted'
      });
    } else {
      return res.status(400).json({ 
        error: 'Invalid action. Use "save" or "delete"' 
      });
    }
    
  } catch (error) {
    console.error('❌ Error handling progress:', error);
    return res.status(500).json({ 
      error: 'Internal server error'
    });
  }
}
