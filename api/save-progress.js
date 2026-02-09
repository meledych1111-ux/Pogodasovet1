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
    
    // Определяем ID пользователя
    const finalUserId = userId || user_id;
    
    // Определяем имя пользователя
    let finalUsername = username || first_name || `Игрок`;
    if (last_name && first_name) {
      finalUsername = `${first_name} ${last_name}`;
    }
    
    console.log('💾 Данные для обработки:', { 
      action, 
      finalUserId, 
      finalUsername,
      gameType, 
      score, 
      level, 
      lines,
      gameOver 
    });
    
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
    
    // 🔴 УБРАТЬ ПРЕОБРАЗОВАНИЕ В ЧИСЛО!
    // ID передаем как есть: "123456" или "web_123456789"
    
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
      const currentProgress = await getGameProgress(finalUserId, gameType);
      const previousScore = currentProgress ? parseInt(currentProgress.score) : 0;
      
      // ✅ ИСПОЛЬЗУЕМ НОВУЮ ВЕРСИЮ saveGameProgress С USERNAME
      const result = await saveGameProgress(
        finalUserId,            // ID как строка
        gameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername           // Передаем имя пользователя
      );
      
      if (result) {
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
          timestamp: new Date().toISOString(),
          isWebApp: finalUserId.startsWith('web_')
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
      console.log(`🗑️ Удаление прогресса для пользователя ${finalUserId}, игра: ${gameType}`);
      
      // ✅ deleteGameProgress принимает ID как строку
      const result = await deleteGameProgress(finalUserId, gameType);
      
      if (result) {
        console.log('✅ Прогресс успешно удален');
        
        return res.status(200).json({ 
          success: true,
          action: 'delete',
          deleted: true,
          userId: finalUserId,
          gameType: gameType,
          isWebApp: finalUserId.startsWith('web_'),
          message: 'Прогресс игры удален'
        });
      } else {
        console.log('⚠️ Прогресс не найден или уже удален');
        
        return res.status(200).json({ 
          success: true,
          action: 'delete',
          deleted: false,
          userId: finalUserId,
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
export const simulateSaveProgress = async (userId, score, level = 1, lines = 0, username = null) => {
  try {
    console.log(`🧪 Тест сохранения прогресса для user ${userId}`);
    
    const mockData = {
      action: 'save',
      userId: userId,
      score: score,
      level: level,
      lines: lines,
      gameType: 'tetris',
      username: username
    };
    
    console.log('🧪 Тестовые данные:', mockData);
    
    // ✅ Обновляем вызов функции
    const result = await saveGameProgress(
      userId,          // ID как строка
      'tetris',
      parseInt(score),
      parseInt(level),
      parseInt(lines),
      username         // Передаем имя
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
  
  // Тестируем сохранение прогресса для разных типов пользователей
  const testUsers = [
    { id: '123456789', username: 'Telegram User', type: 'telegram' },
    { id: 'web_1770548758686', username: 'Web App User', type: 'web' }
  ];
  
  for (const user of testUsers) {
    const testScore = Math.floor(Math.random() * 10000);
    
    console.log(`🧪 Тест для ${user.type}: ${user.id}`);
    
    simulateSaveProgress(user.id, testScore, 3, 12, user.username).then((result) => {
      console.log(`🧪 Результат для ${user.type}: ${result ? 'Успешно' : 'Ошибка'}`);
    });
  }
}
