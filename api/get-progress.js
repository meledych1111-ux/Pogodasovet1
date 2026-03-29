import { saveGameProgress, deleteGameProgress, getGameProgress } from './db.js';

export default async function handler(req, res) {
  console.log('📋 API: /api/get-progress - запрос прогресса игры');
  console.log('📋 Метод:', req.method);
  console.log('📋 Query параметры:', req.query);
  console.log('📋 Body параметры:', req.body);
  
  if (req.method !== 'GET') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use GET.' 
    });
  }

  try {
    const { userId, gameType = 'tetris' } = req.query;
    
    console.log('📋 Получение прогресса для:', { userId, gameType });
    
    // Валидация параметров
    if (!userId) {
      console.log('❌ Отсутствует userId');
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: userId',
        code: 'MISSING_USER_ID'
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
    
    console.log(`📋 Получение прогресса пользователя ${numericUserId}, игра: ${gameType}`);
    
    // Получаем прогресс из базы данных
    const progress = await getGameProgress(numericUserId, gameType);
    
    console.log('📋 Прогресс из БД:', progress);
    
    if (progress) {
      // Форматируем данные прогресса
      const formattedProgress = {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved,
        has_progress: true,
        timestamp: progress.last_saved || new Date().toISOString()
      };
      
      console.log('✅ Прогресс найден:', formattedProgress);
      
      return res.status(200).json({ 
        success: true,
        userId: numericUserId,
        gameType: gameType,
        progress: formattedProgress,
        message: 'Прогресс игры найден',
        timestamp: new Date().toISOString()
      });
    } else {
      // Нет сохраненного прогресса
      console.log('📋 Прогресс не найден, возвращаем пустые данные');
      
      const emptyProgress = {
        score: 0,
        level: 1,
        lines: 0,
        last_saved: null,
        has_progress: false,
        timestamp: new Date().toISOString()
      };
      
      return res.status(200).json({ 
        success: true,
        userId: numericUserId,
        gameType: gameType,
        progress: emptyProgress,
        message: 'Сохраненного прогресса не найдено',
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка получения прогресса:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    // Более информативный ответ об ошибке
    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        code: 'PROGRESS_FETCH_ERROR',
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      fallback_progress: {
        score: 0,
        level: 1,
        lines: 0,
        last_saved: null,
        has_progress: false,
        message: 'Используются данные по умолчанию из-за ошибки БД'
      }
    };
    
    return res.status(500).json(errorResponse);
  }
}

// Вспомогательная функция для тестирования API
export const testGetProgress = async (testUserId = 123456789) => {
  try {
    console.log(`🧪 Тест получения прогресса для user ${testUserId}`);
    const progress = await getGameProgress(testUserId, 'tetris');
    console.log(`🧪 Прогресс:`, progress);
    return progress;
  } catch (error) {
    console.error('🧪 Ошибка теста:', error);
    return null;
  }
};

// Если файл запущен напрямую, выполнить тест
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🧪 Запуск теста get-progress.js');
  testGetProgress().then(() => {
    console.log('🧪 Тест завершен');
    process.exit(0);
  });
}