import { getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('📊 API: /api/user-stats - запрос статистики пользователя');
  
  // Разрешаем оба метода для удобства
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
    
    console.log('👤 Извлеченные параметры:', { userId, gameType });
    
    // Валидация данных
    if (!userId) {
      console.log('❌ Отсутствует userId');
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: userId',
        code: 'MISSING_USER_ID'
      });
    }
    
    // Обработка Web App ID (web_1770548758686)
    let isWebApp = false;
    let numericUserId;
    
    if (userId.startsWith('web_')) {
      // Извлекаем числовую часть из web_1770548758686
      const webId = userId.replace('web_', '');
      numericUserId = parseInt(webId);
      if (!isNaN(numericUserId)) {
        // Добавляем смещение для Web App пользователей
        numericUserId = numericUserId + 1000000000;
        isWebApp = true;
        console.log('🌐 Web App ID обнаружен, преобразован:', { 
          original: userId, 
          webId: webId, 
          dbUserId: numericUserId 
        });
      }
    } else {
      numericUserId = parseInt(userId);
    }
    
    if (isNaN(numericUserId)) {
      console.log('❌ Неверный формат userId:', userId);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid userId format. Must be a number.',
        code: 'INVALID_USER_ID'
      });
    }
    
    console.log(`📊 Получение статистики для пользователя ${numericUserId} (isWebApp: ${isWebApp}), игра: ${gameType}`);
    
    // Получаем статистику из базы данных
    const stats = await getGameStats(numericUserId, gameType);
    
    console.log('📈 Статистика из БД:', stats);
    
    // Форматируем ответ
    const response = {
      success: true,
      userId: isWebApp ? `web_${userId.replace('web_', '')}` : numericUserId,
      dbUserId: numericUserId,
      gameType: gameType,
      timestamp: new Date().toISOString(),
      isWebApp: isWebApp,
      
      // Основная статистика
      stats: {
        games_played: stats?.games_played || 0,
        best_score: stats?.best_score || 0,
        best_level: stats?.best_level || 1,
        best_lines: stats?.best_lines || 0,
        avg_score: stats?.avg_score ? parseFloat(stats.avg_score.toFixed(2)) : 0,
        last_played: stats?.last_played || null,
        rank: stats?.rank || 'Не определен'
      },
      
      // Прогресс текущей игры
      current_progress: stats?.current_progress ? {
        score: stats.current_progress.score || 0,
        level: stats.current_progress.level || 1,
        lines: stats.current_progress.lines || 0,
        last_saved: stats.current_progress.last_saved || null,
        has_unfinished_game: true
      } : null,
      
      // Дополнительная информация
      meta: {
        has_played: (stats?.games_played || 0) > 0,
        has_unfinished_game: stats?.has_unfinished_game || false,
        is_top_player: false,
        next_milestone: calculateNextMilestone(stats?.best_score || 0)
      }
    };
    
    console.log('✅ Форматированный ответ:', {
      games_played: response.stats.games_played,
      best_score: response.stats.best_score,
      has_unfinished_game: response.meta.has_unfinished_game
    });
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('🔥 Критическая ошибка получения статистики:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        code: 'DATABASE_ERROR',
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? {
          stack: error.stack,
          fullError: error.toString()
        } : undefined
      },
      fallback_stats: {
        games_played: 0,
        best_score: 0,
        best_level: 1,
        best_lines: 0,
        avg_score: 0,
        message: 'Используются данные по умолчанию из-за ошибки БД'
      }
    };
    
    return res.status(500).json(errorResponse);
  }
}

// Вспомогательная функция для расчета следующего рубежа
function calculateNextMilestone(currentScore) {
  const milestones = [
    100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000
  ];
  
  for (const milestone of milestones) {
    if (currentScore < milestone) {
      return {
        target: milestone,
        needed: milestone - currentScore,
        progress: (currentScore / milestone * 100).toFixed(1) + '%',
        message: `Следующий рубеж: ${milestone} очков`
      };
    }
  }
  
  return {
    target: 100000,
    needed: 0,
    progress: '100%',
    message: 'Вы достигли максимального рубежа! 🏆'
  };
}
