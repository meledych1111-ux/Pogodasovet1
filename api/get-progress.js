import { getGameProgress } from './db.js';

export default async function handler(req, res) {
  console.log('📋 API: /api/get-progress - запрос прогресса игры');
  console.log('📋 Метод:', req.method);
  
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка предварительного запроса OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
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
    
    console.log(`📋 Получение прогресса пользователя ${userId}, игра: ${gameType}`);
    
    // ✅ ИСПРАВЛЕНО: Обработка результата getGameProgress
    const result = await getGameProgress(userId, gameType);
    
    console.log('📋 Результат из БД:', { 
      success: result?.success, 
      found: result?.found,
      error: result?.error 
    });
    
    // Проверяем успешность выполнения
    if (!result || !result.success) {
      console.error('❌ Ошибка получения прогресса:', result?.error);
      
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
        success: true, // API успешно отработало, даже если прогресса нет
        userId: userId,
        gameType: gameType,
        isWebApp: userId.startsWith('web_'),
        progress: emptyProgress,
        message: 'Нет сохраненного прогресса или ошибка получения',
        db_error: result?.error,
        timestamp: new Date().toISOString()
      });
    }
    
    // Проверяем, найден ли прогресс
    if (result.found && result.progress) {
      const progress = result.progress;
      
      // Форматируем данные прогресса
      const formattedProgress = {
        score: parseInt(progress.score) || 0,
        level: parseInt(progress.level) || 1,
        lines: parseInt(progress.lines) || 0,
        last_saved: progress.last_saved,
        last_saved_formatted: progress.last_saved 
          ? new Date(progress.last_saved).toLocaleString('ru-RU') 
          : null,
        has_progress: true,
        timestamp: progress.last_saved || new Date().toISOString()
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
        isWebApp: userId.startsWith('web_'),
        progress: formattedProgress,
        message: 'Прогресс игры найден',
        timestamp: new Date().toISOString()
      });
    } else {
      // Нет сохраненного прогресса
      console.log('📋 Прогресс не найден');
      
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
        isWebApp: userId.startsWith('web_'),
        progress: emptyProgress,
        message: 'Сохраненного прогресса не найдено',
        timestamp: new Date().toISOString(),
        suggestions: [
          'Начните новую игру',
          'Ваш прогресс будет автоматически сохраняться'
        ]
      });
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка получения прогресса:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: 'PROGRESS_FETCH_ERROR',
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
}

// Вспомогательная функция для тестирования API
export const testGetProgress = async (testUserId = '123456789') => {
  try {
    console.log(`🧪 Тест получения прогресса для user ${testUserId}`);
    const result = await getGameProgress(testUserId, 'tetris');
    console.log(`🧪 Результат:`, result);
    return result;
  } catch (error) {
    console.error('🧪 Ошибка теста:', error);
    return { success: false, error: error.message };
  }
};
