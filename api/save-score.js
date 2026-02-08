import { saveGameScore } from './db.js';

export default async function handler(req, res) {
  console.log('📨 Запрос на сохранение очков:', req.method, req.body);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, gameType = 'tetris', score, level, lines } = req.body;
    
    console.log('📊 Данные для сохранения:', { userId, score, level, lines });
    
    if (!userId || score === undefined) {
      console.log('❌ Отсутствуют обязательные поля');
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }

    const resultId = await saveGameScore(
      parseInt(userId), 
      gameType, 
      parseInt(score), 
      level ? parseInt(level) : 1, 
      lines ? parseInt(lines) : 0
    );
    
    console.log('✅ Результат сохранения:', resultId);
    
    if (resultId) {
      return res.status(200).json({ 
        success: true, 
        id: resultId,
        message: 'Score saved successfully'
      });
    } else {
      console.log('❌ Не удалось сохранить в БД');
      return res.status(500).json({ 
        success: false,
        error: 'Failed to save score to database'
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка сохранения:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error'
    });
  }
}
