import { saveGameScore, getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('🎮 API: /api/save-score - сохранение результата игры');
  
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка предварительного запроса OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
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
      username = null,
      gameOver = true
    } = req.body;
    
    console.log('🎮 Данные для сохранения:', { 
      userId, 
      gameType, 
      score, 
      level, 
      lines,
      username: username ? `${username.substring(0, 10)}...` : 'null',
      gameOver 
    });
    
    // Валидация данных
    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: userId',
        code: 'MISSING_USER_ID'
      });
    }
    
    if (!score && score !== 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: score',
        code: 'MISSING_SCORE'
      });
    }
    
    // Преобразуем типы
    const numericScore = parseInt(score) || 0;
    const numericLevel = parseInt(level) || 1;
    const numericLines = parseInt(lines) || 0;
    
    // Если счет 0, просто возвращаем успех без сохранения
    if (numericScore === 0) {
      console.log('🎮 Нулевой счет, пропускаем сохранение');
      return res.status(200).json({
        success: true,
        message: 'Нулевой счет не сохранен',
        saved: false,
        score: 0
      });
    }
    
    // Сохраняем результат игры
    console.log(`🎮 Сохраняем результат: ${numericScore} очков для пользователя ${userId}`);
    
    const saveResult = await saveGameScore(
      userId,
      gameType,
      numericScore,
      numericLevel,
      numericLines,
      username,
      gameOver
    );
    
    if (!saveResult || !saveResult.success) {
      console.error('❌ Ошибка сохранения результата:', saveResult?.error);
      return res.status(500).json({
        success: false,
        error: saveResult?.error || 'Ошибка сохранения результата',
        code: 'SAVE_ERROR'
      });
    }
    
    // Получаем обновленную статистику
    const statsResult = await getGameStats(userId, gameType);
    
    const response = {
      success: true,
      saved: true,
      message: 'Результат успешно сохранен!',
      save_details: {
        id: saveResult.id,
        created_at: saveResult.created_at,
        user_id: saveResult.user_id
      },
      score: numericScore,
      level: numericLevel,
      lines: numericLines,
      gameOver: gameOver,
      timestamp: new Date().toISOString()
    };
    
    // Добавляем статистику, если она есть
    if (statsResult && statsResult.success) {
      response.stats = {
        games_played: statsResult.stats?.games_played || 0,
        best_score: statsResult.stats?.best_score || 0,
        best_level: statsResult.stats?.best_level || 1,
        best_lines: statsResult.stats?.best_lines || 0,
        avg_score: statsResult.stats?.avg_score || 0
      };
      
      // Проверяем, является ли это новым рекордом
      const currentBest = statsResult.stats?.best_score || 0;
      if (numericScore > currentBest && currentBest > 0) {
        response.is_new_record = true;
        response.message = `🎉 НОВЫЙ РЕКОРД! ${numericScore} очков!`;
      }
    }
    
    console.log(`✅ Результат сохранен: ${numericScore} очков, ID: ${saveResult.id}`);
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('🔥 Критическая ошибка сохранения результата:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString()
      }
    });
  }
}
