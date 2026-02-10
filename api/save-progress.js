import { saveGameProgress, deleteGameProgress, getGameProgress } from './db.js';

export default async function handler(req, res) {
  console.log('💾 API: /api/save-progress - обработка прогресса игры');
  console.log('💾 Метод:', req.method);
  
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
      action, 
      userId, 
      user_id,
      gameType = 'tetris', 
      score, 
      level, 
      lines,
      gameOver = false,
      username,
      first_name,
      last_name
    } = req.body;
    
    console.log('💾 Данные для обработки:', { 
      action, 
      userId: userId || user_id,
      gameType, 
      score, 
      level, 
      lines,
      gameOver 
    });
    
    // Определяем ID пользователя
    const finalUserId = userId || user_id;
    
    // Определяем имя пользователя
    let finalUsername = username || first_name || `Игрок`;
    if (last_name && first_name) {
      finalUsername = `${first_name} ${last_name}`;
    }
    
    // Валидация параметров
    if (!finalUserId) {
      console.log('❌ Отсутствует userId');
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: userId',
        code: 'MISSING_USER_ID'
      });
    }
    
    if (!action || (action !== 'save' && action !== 'delete')) {
      console.log('❌ Неверное действие:', action);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid action. Use "save" or "delete"',
        code: 'INVALID_ACTION'
      });
    }
    
    // Обработка действий
    if (action === 'save') {
      // Сохраняем прогресс
      const numericScore = parseInt(score || 0);
      const numericLevel = parseInt(level || 1);
      const numericLines = parseInt(lines || 0);
      
      console.log(`💾 Сохранение прогресса для пользователя ${finalUserId}:`, {
        username: finalUsername,
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameOver: gameOver
      });
      
      // Получаем текущий прогресс перед сохранением (для сравнения)
      const currentProgressResult = await getGameProgress(finalUserId, gameType);
      const previousScore = currentProgressResult.success && currentProgressResult.found 
        ? parseInt(currentProgressResult.progress?.score || 0) 
        : 0;
      
      // ✅ ИСПРАВЛЕНО: Обработка результата saveGameProgress
      const result = await saveGameProgress(
        finalUserId,            // ID как строка
        gameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername           // Передаем имя пользователя
      );
      
      // Проверяем успешность выполнения
      if (result && result.success) {
        const savedData = {
          userId: finalUserId,
          username: finalUsername,
          gameType: gameType,
          score: numericScore,
          level: numericLevel,
          lines: numericLines,
          previousScore: previousScore,
          isNewRecord: numericScore > previousScore,
          gameOver: gameOver,
          last_saved: result.last_saved || new Date().toISOString(),
          timestamp: new Date().toISOString(),
          isWebApp: finalUserId.startsWith('web_')
        };
        
        console.log('✅ Прогресс успешно сохранен:', savedData);
        
        return res.status(200).json({ 
          success: true,
          action: 'save',
          saved: true,
          data: savedData,
          message: gameOver ? 'Финальный прогресс сохранен' : 'Прогресс игры сохранен',
          save_result: result
        });
      } else {
        console.log('❌ Не удалось сохранить прогресс:', result?.error);
        return res.status(500).json({ 
          success: false,
          action: 'save',
          saved: false,
          error: result?.error || 'Failed to save progress to database',
          code: 'SAVE_FAILED',
          details: result
        });
      }
      
    } else if (action === 'delete') {
      // Удаляем прогресс (после завершения игры)
      console.log(`🗑️ Удаление прогресса для пользователя ${finalUserId}, игра: ${gameType}`);
      
      // ✅ ИСПРАВЛЕНО: Обработка результата deleteGameProgress
      const result = await deleteGameProgress(finalUserId, gameType);
      
      // Проверяем успешность выполнения
      if (result && result.success) {
        console.log('✅ Прогресс успешно удален:', result.deleted);
        
        return res.status(200).json({ 
          success: true,
          action: 'delete',
          deleted: result.deleted,
          userId: finalUserId,
          gameType: gameType,
          isWebApp: finalUserId.startsWith('web_'),
          message: result.deleted ? 'Прогресс игры удален' : 'Прогресс не найден или уже удален',
          delete_result: result
        });
      } else {
        console.log('⚠️ Ошибка удаления прогресса:', result?.error);
        
        return res.status(500).json({ 
          success: false,
          action: 'delete',
          deleted: false,
          error: result?.error || 'Ошибка при удалении прогресса',
          code: 'DELETE_ERROR',
          details: result
        });
      }
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка обработки прогресса:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: 'PROGRESS_HANDLING_ERROR',
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
}

// Функция для симуляции сохранения прогресса (для тестов)
export const simulateSaveProgress = async (userId, score, level = 1, lines = 0, username = null) => {
  try {
    console.log(`🧪 Тест сохранения прогресса для user ${userId}`);
    
    const result = await saveGameProgress(
      userId,          // ID как строка
      'tetris',
      parseInt(score),
      parseInt(level),
      parseInt(lines),
      username         // Передаем имя
    );
    
    console.log('🧪 Результат сохранения:', result);
    
    return result;
  } catch (error) {
    console.error('🧪 Ошибка теста:', error);
    return { success: false, error: error.message };
  }
};
