import { getGameProgress } from './db.js';

export default async function handler(req, res) {
  console.log('📋 API: /api/get-progress - запрос прогресса игры');
  console.log('📋 Метод:', req.method);
  console.log('📋 Query параметры:', req.query);
  console.log('📋 Body параметры:', req.body);
  
  // Разрешаем GET и POST для удобства
  if (req.method !== 'GET' && req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use GET or POST.' 
    });
  }

  try {
    let userId, gameType;
    
    // Получаем параметры в зависимости от метода
    if (req.method === 'GET') {
      userId = req.query.userId || req.query.user_id;
      gameType = req.query.gameType || req.query.game_type || 'tetris';
    } else if (req.method === 'POST') {
      userId = req.body.userId || req.body.user_id;
      gameType = req.body.gameType || req.body.game_type || 'tetris';
    }
    
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
    
    // 🔴 УБРАТЬ ПРЕОБРАЗОВАНИЕ В ЧИСЛО!
    // getGameProgress ожидает ID как строку
    
    console.log(`📋 Получение прогресса пользователя ${userId}, игра: ${gameType}`);
    
    // ✅ ПРАВИЛЬНО: Передаем ID как есть
    const progress = await getGameProgress(userId, gameType);
    
    console.log('📋 Прогресс из БД:', progress);
    
    if (progress) {
      // Форматируем данные прогресса
      const formattedProgress = {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved,
        has_progress: true,
        timestamp: progress.last_saved || new Date().toISOString(),
        
        // 🔴 ДОБАВЛЕНО: Время в читаемом формате
        last_saved_formatted: progress.last_saved 
          ? new Date(progress.last_saved).toLocaleString('ru-RU') 
          : null
      };
      
      console.log('✅ Прогресс найден:', {
        userId: userId,
        score: formattedProgress.score,
        level: formattedProgress.level,
        has_progress: true
      });
      
      return res.status(200).json({ 
        success: true,
        userId: userId,
        gameType: gameType,
        isWebApp: userId.startsWith('web_'), // Добавляем тип пользователя
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
        last_saved_formatted: null,
        has_progress: false,
        timestamp: new Date().toISOString()
      };
      
      return res.status(200).json({ 
        success: true,
        userId: userId,
        gameType: gameType,
        isWebApp: userId.startsWith('web_'), // Добавляем тип пользователя
        progress: emptyProgress,
        message: 'Сохраненного прогресса не найдено',
        timestamp: new Date().toISOString(),
        
        // 🔴 ДОБАВЛЕНО: Возможность начать новую игру
        suggestions: [
          'Начните новую игру',
          'Ваш прогресс будет автоматически сохраняться'
        ]
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
export const testGetProgress = async (testUserId = '123456789') => {
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
  
  // Тестируем оба типа пользователей
  const testUsers = [
    { id: '123456789', type: 'telegram' },
    { id: 'web_1770548758686', type: 'web' }
  ];
  
  Promise.all(testUsers.map(user => 
    testGetProgress(user.id).then(progress => {
      console.log(`🧪 Результат для ${user.type} (${user.id}):`, 
        progress ? 'Прогресс найден' : 'Нет прогресса');
    })
  )).then(() => {
    console.log('🧪 Все тесты завершены');
    process.exit(0);
  });
}
