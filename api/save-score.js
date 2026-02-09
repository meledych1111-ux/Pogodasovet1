import { saveGameScore, saveGameProgress, deleteGameProgress, getGameStats } from './db.js';

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
    
    // Извлекаем все возможные поля
    const {
      userId,
      user_id,
      score,
      level = 1,
      lines = 0,
      gameType = 'tetris',
      game_type,
      gameOver = false,
      action,
      username,
      first_name,
      last_name
    } = req.body;
    
    // Определяем ID пользователя
    let finalUserId;
    let isWebApp = false;
    
    // Приоритет 1: userId из запроса
    if (userId) {
      if (userId.startsWith('web_')) {
        finalUserId = userId; // Оставляем как есть: "web_123456"
        isWebApp = true;
      } else {
        finalUserId = userId.toString(); // Telegram ID
        isWebApp = false;
      }
    }
    // Приоритет 2: user_id из запроса
    else if (user_id) {
      if (user_id.startsWith('web_')) {
        finalUserId = user_id;
        isWebApp = true;
      } else {
        finalUserId = user_id.toString();
        isWebApp = false;
      }
    }
    // Приоритет 3: action tetris_score
    else if (action === 'tetris_score') {
      const rawId = req.body.user_id || req.body.userId;
      if (rawId) {
        finalUserId = rawId.startsWith('web_') ? rawId : rawId.toString();
        isWebApp = rawId.startsWith('web_');
      }
    }
    
    // Определяем gameType
    const finalGameType = game_type || gameType || 'tetris';
    
    // Определяем имя пользователя
    let finalUsername = username || first_name || `Игрок ${finalUserId ? finalUserId.slice(-4) : '0000'}`;
    if (last_name && first_name) {
      finalUsername = `${first_name} ${last_name}`;
    }
    
    // Валидация
    if (!finalUserId) {
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
    
    // Преобразуем значения
    const numericScore = parseInt(score) || 0;
    const numericLevel = parseInt(level) || 1;
    const numericLines = parseInt(lines) || 0;
    const isWin = numericScore > 0; // Простая логика: если есть очки - победа
    
    console.log('📊 Обработанные данные:', {
      finalUserId,
      finalUsername,
      numericScore,
      numericLevel,
      numericLines,
      finalGameType,
      gameOver,
      isWebApp,
      isWin
    });
    
    let resultId;
    
    if (gameOver) {
      // Если игра завершена, сохраняем финальный результат (ВСЕГДА, даже 0 очков)
      resultId = await saveGameScore(
        finalUserId,        // Оригинальный ID: "web_123" или "123456"
        finalGameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername,      // Передаем имя пользователя
        isWin               // Победа или проигрыш
      );
      
      // Удаляем прогресс, так как игра завершена
      await deleteGameProgress(finalUserId, finalGameType);
      console.log('🎮 Игра завершена, прогресс удален');
    } else {
      // Если игра продолжается, сохраняем прогресс
      resultId = await saveGameProgress(
        finalUserId, 
        finalGameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername       // Передаем имя для user_sessions
      );
      console.log('💾 Прогресс игры сохранен');
    }
    
    if (resultId) {
      // Получаем обновленную статистику
      const stats = await getGameStats(finalUserId, finalGameType);
      const bestScore = stats?.best_score || 0;
      const gamesPlayed = stats?.games_played || 0;
      const wins = stats?.wins || 0;
      
      console.log('✅ Результат сохранен успешно!', {
        savedId: resultId,
        userId: finalUserId,
        username: finalUsername,
        score: numericScore,
        bestScore: bestScore,
        gamesPlayed: gamesPlayed,
        wins: wins,
        gameOver: gameOver,
        isWebApp: isWebApp,
        isWin: isWin
      });
      
      const response = {
        success: true,
        id: resultId,
        userId: finalUserId,           // Оригинальный ID
        username: finalUsername,       // Имя пользователя
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameType: finalGameType,
        gameOver: gameOver,
        isWin: isWin,
        isWebApp: isWebApp,
        bestScore: bestScore,
        gamesPlayed: gamesPlayed,
        wins: wins,
        newRecord: numericScore > bestScore,
        message: gameOver ? 
          `Final ${isWin ? 'win' : 'loss'} saved (${numericScore} points)` : 
          'Game progress saved'
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
