import { saveGameScore, saveGameProgress, deleteGameProgress, getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('📨 POST /api/save-score - начат');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }

  try {
    console.log('📊 Тело запроса:', req.body);
    
    // Извлекаем данные
    const rawUserId = req.body.userId || req.body.user_id;
    const score = req.body.score;
    const level = req.body.level || 1;
    const lines = req.body.lines || 0;
    const gameType = req.body.gameType || 'tetris';
    const gameOver = req.body.gameOver === true || req.body.gameOver === 'true';
    
    console.log('📊 Извлеченные данные:', {
      rawUserId, score, level, lines, gameType, gameOver
    });
    
    // ВАЖНО: Для отладки - всегда считаем gameOver = true
    const forceGameOver = true; // Временно для теста
    
    // ВАЛИДАЦИЯ
    if (!rawUserId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing userId' 
      });
    }
    
    if (score === undefined || score === null) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing score' 
      });
    }
    
    // Обработка userId
    let userId = rawUserId.toString().trim();
    let isWebApp = false;
    
    if (userId.startsWith('web_')) {
      const numericPart = userId.replace('web_', '');
      if (numericPart && !isNaN(parseInt(numericPart))) {
        userId = numericPart;
        isWebApp = true;
      }
    }
    
    // Преобразуем в числа
    const numericUserId = parseInt(userId);
    const numericScore = parseInt(score);
    const numericLevel = parseInt(level);
    const numericLines = parseInt(lines);
    
    if (isNaN(numericUserId) || isNaN(numericScore)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid number format' 
      });
    }
    
    // Для Web App добавляем смещение
    const dbUserId = isWebApp ? numericUserId + 1000000000 : numericUserId;
    
    console.log('🎯 Параметры сохранения:', {
      dbUserId, numericScore, gameType, gameOver, forceGameOver
    });
    
    // ВАЖНОЕ ИЗМЕНЕНИЕ: Всегда сохраняем в game_scores для теста
    console.log('💾 Сохраняем в game_scores...');
    const resultId = await saveGameScore(dbUserId, gameType, numericScore, numericLevel, numericLines);
    
    if (resultId) {
      console.log(`✅ Результат сохранен в game_scores! ID: ${resultId}`);
      
      // Также сохраняем/обновляем прогресс
      await saveGameProgress(dbUserId, gameType, numericScore, numericLevel, numericLines);
      console.log('💾 Прогресс также сохранен');
      
      // Получаем статистику
      const stats = await getGameStats(dbUserId, gameType);
      const bestScore = stats?.best_score || 0;
      const newRecord = numericScore > bestScore;
      
      const response = {
        success: true,
        saved: true,
        id: resultId,
        userId: isWebApp ? `web_${userId}` : numericUserId,
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameType: gameType,
        savedTo: 'game_scores',
        stats: {
          bestScore: bestScore,
          totalGames: stats?.games_played || 1,
          newRecord: newRecord
        },
        message: newRecord ? '🏆 Новый рекорд!' : 'Результат сохранен!',
        timestamp: new Date().toISOString()
      };
      
      console.log('📤 Ответ:', response);
      return res.status(200).json(response);
      
    } else {
      console.log('❌ Ошибка сохранения в game_scores');
      return res.status(500).json({ 
        success: false,
        error: 'SAVE_FAILED',
        message: 'Не удалось сохранить результат'
      });
    }
    
  } catch (error) {
    console.error('🔥 Ошибка:', error);
    return res.status(500).json({ 
      success: false,
      error: 'SERVER_ERROR',
      message: error.message
    });
  }
}
