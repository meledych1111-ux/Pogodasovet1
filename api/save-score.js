import { saveGameScore, saveGameProgress, deleteGameProgress, getGameStats } from '../db.js';

export default async function handler(req, res) {
  console.log('📨 POST /api/save-score');
  
  if (req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }

  try {
    console.log('📊 Тело запроса:', req.body);
    
    // Пробуем разные варианты получения данных
    let userId, score, level, lines, gameType, gameOver;
    
    // Вариант 1: Данные из игры тетриса
    if (req.body.userId) {
      userId = req.body.userId;
      score = req.body.score;
      level = req.body.level;
      lines = req.body.lines;
      gameType = req.body.gameType || 'tetris';
      gameOver = req.body.gameOver || false;
    }
    // Вариант 2: Данные из Telegram Web App
    else if (req.body.action === 'tetris_score') {
      userId = req.body.user_id || req.body.userId;
      score = req.body.score;
      level = req.body.level;
      lines = req.body.lines;
      gameType = 'tetris';
      gameOver = req.body.gameOver || false;
    }
    // Вариант 3: Прямые параметры
    else {
      userId = req.body.user_id || req.body.userId;
      score = req.body.score;
      level = req.body.level || 1;
      lines = req.body.lines || 0;
      gameType = req.body.game_type || req.body.gameType || 'tetris';
      gameOver = req.body.gameOver || false;
    }
    
    console.log('📊 Обработанные данные:', {
      userId,
      score,
      level,
      lines,
      gameType,
      gameOver
    });
    
    // Валидация данных
    if (!userId) {
      console.log('❌ Отсутствует userId');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing userId field' 
      });
    }
    
    if (score === undefined || score === null) {
      console.log('❌ Отсутствует score');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing score field' 
      });
    }
    
    // Преобразуем в числа
    const numericUserId = parseInt(userId);
    const numericScore = parseInt(score);
    const numericLevel = level ? parseInt(level) : 1;
    const numericLines = lines ? parseInt(lines) : 0;
    
    if (isNaN(numericUserId)) {
      console.log('❌ Неверный userId:', userId);
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid userId format' 
      });
    }
    
    if (isNaN(numericScore)) {
      console.log('❌ Неверный score:', score);
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid score format' 
      });
    }
    
    console.log('💾 Сохраняем результат в базу данных...');
    
    let resultId;
    
    if (gameOver) {
      // Если игра завершена, сохраняем финальный результат
      resultId = await saveGameScore(
        numericUserId, 
        gameType, 
        numericScore, 
        numericLevel, 
        numericLines
      );
      
      // Удаляем прогресс, так как игра завершена
      await deleteGameProgress(numericUserId, gameType);
      console.log('🎮 Игра завершена, прогресс удален');
    } else {
      // Если игра продолжается, сохраняем прогресс
      resultId = await saveGameProgress(
        numericUserId, 
        gameType, 
        numericScore, 
        numericLevel, 
        numericLines
      );
      console.log('💾 Прогресс игры сохранен');
    }
    
    if (resultId) {
      // Получаем обновленную статистику
      const stats = await getGameStats(numericUserId, gameType);
      const bestScore = stats?.best_score || 0;
      
      console.log('✅ Результат сохранен успешно!', {
        savedId: resultId,
        userId: numericUserId,
        score: numericScore,
        bestScore: bestScore,
        gameOver: gameOver
      });
      
      const response = {
        success: true,
        id: resultId,
        userId: numericUserId,
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameType: gameType,
        gameOver: gameOver,
        bestScore: bestScore,
        newRecord: numericScore > bestScore,
        message: gameOver ? 'Final score saved successfully' : 'Game progress saved'
      };
      
      console.log('📤 Отправляем ответ:', response);
      
      return res.status(200).json(response);
    } else {
      console.log('❌ Не удалось сохранить в БД');
      return res.status(500).json({ 
        success: false,
        error: 'Failed to save to database. Check database connection.'
      });
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка сохранения:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    return res.status(500).json({ 
      success: false,
      error: `Internal server error: ${error.message}`,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
