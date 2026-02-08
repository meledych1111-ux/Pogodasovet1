import { saveGameProgress, deleteGameProgress, getGameProgress } from './db.js';

export default async function handler(req, res) {
  console.log('💾 API: /api/save-progress - обработка прогресса игры');
  console.log('💾 Метод:', req.method);
  console.log('💾 Body параметры:', req.body);
  
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
      gameType = 'tetris', 
      score, 
      level, 
      lines,
      gameOver = false
    } = req.body;
    
    console.log('💾 Данные для обработки:', { 
      action, 
      userId, 
      gameType, 
      score, 
      level, 
      lines,
      gameOver 
    });
    
    // Валидация параметров
    if (!userId) {
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
    
    const numericUserId = parseInt(userId);
    
    if (isNaN(numericUserId)) {
      console.log('❌ Неверный формат userId:', userId);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid userId format. Must be a number.',
        code: 'INVALID_USER_ID'
      });
    }
    
    // Обработка действий
    if (action === 'save') {
      // Сохраняем прогресс
      const numericScore = parseInt(score || 0);
      const numericLevel = parseInt(level || 1);
      const numericLines = parseInt(lines || 0);
      
      console.log(`💾 Сохранение прогресса для пользователя ${numericUserId}:`, {
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameOver: gameOver
      });
      
      // Получаем текущий прогресс перед сохранением (для сравнения)
      const currentProgress = await getGameProgress(numericUserId, gameType);
      const previousScore = currentProgress ? parseInt(currentProgress.score) : 0;
      
      const result = await saveGameProgress(
        numericUserId, 
        gameType, 
        numericScore, 
        numericLevel, 
        numericLines
      );
      
      if (result) {
        const savedData = {
          userId: numericUserId,
          gameType: gameType,
          score: numericScore,
          level: numericLevel,
          lines: numericLines,
          previousScore: previousScore,
          isNewRecord: numericScore > previousScore,
          gameOver: gameOver,
          timestamp: new Date().toISOString()
        };
        
        console.log('✅ Прогресс успешно сохранен:', savedData);
        
        return res.status(200).json({ 
          success: true,
          action: 'save',
          saved: true,
          data: savedData,
          message: gameOver ? 'Финальный прогресс сохранен' : 'Прогресс игры сохранен'
        });
      } else {
        console.log('❌ Не удалось сохранить прогресс');
        return res.status(500).json({ 
          success: false,
          action: 'save',
          saved: false,
          error: 'Failed to save progress to database',
          code: 'SAVE_FAILED'
        });
      }
      
    } else if (action === 'delete') {
      // Удаляем прогресс (после завершения игры)
      console.log(`🗑️ Удаление прогресса для пользователя ${numericUserId}, игра: ${gameType}`);
      
      const result = await deleteGameProgress(numericUserId, gameType);
      
      if (result) {
        console.log('✅ Прогресс успешно удален');
        
        return res.status(200).json({ 
          success: true,
          action: 'delete',
          deleted: true,
          userId: numericUserId,
          gameType: gameType,
          message: 'Прогресс игры удален'
        });
      } else {
        console.log('⚠️ Прогресс не найден или уже удален');
        
        return res.status(200).json({ 
          success: true,
          action: 'delete',
          deleted: false,
          userId: numericUserId,
          gameType: gameType,
          message: 'Прогресс не найден или уже удален'
        });
      }
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка обработки прогресса:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    // Более информативный ответ об ошибке
    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        code: 'PROGRESS_HANDLING_ERROR',
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      fallback_response: {
        saved: false,
        message: 'Ошибка при обработке прогресса. Данные не сохранены.'
      }
    };
    
    return res.status(500).json(errorResponse);
  }
}

// Функция для симуляции сохранения прогресса (для тестов)
export const simulateSaveProgress = async (userId, score, level = 1, lines = 0) => {
  try {
    console.log(`🧪 Тест сохранения прогресса для user ${userId}`);
    
    const mockData = {
      action: 'save',
      userId: userId,
      score: score,
      level: level,
      lines: lines,
      gameType: 'tetris'
    };
    
    console.log('🧪 Тестовые данные:', mockData);
    
    // Пытаемся сохранить прогресс
    const result = await saveGameProgress(
      parseInt(userId),
      'tetris',
      parseInt(score),
      parseInt(level),
      parseInt(lines)
    );
    
    console.log('🧪 Результат сохранения:', result ? 'Успешно' : 'Не удалось');
    
    return result;
  } catch (error) {
    console.error('🧪 Ошибка теста:', error);
    return null;
  }
};

// Если файл запущен напрямую, выполнить тест
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🧪 Запуск теста save-progress.js');
  
  // Тестируем сохранение прогресса
  const testUserId = 123456789;
  const testScore = Math.floor(Math.random() * 10000);
  
  simulateSaveProgress(testUserId, testScore).then((result) => {
    console.log(`🧪 Тест завершен. Результат: ${result ? 'Успешно' : 'Ошибка'}`);
    
    // Тестируем удаление прогресса
    if (result) {
      console.log('🧪 Тестируем удаление прогресса...');
      deleteGameProgress(testUserId, 'tetris')
        .then(() => {
          console.log('🧪 Удаление теста завершено');
          process.exit(0);
        })
        .catch(err => {
          console.error('🧪 Ошибка удаления:', err);
          process.exit(1);
        });
    } else {
      process.exit(0);
    }
  });
}
