import { getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('📊 API: /api/user-stats - запрос статистики пользователя');
  
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
    
    // Определяем тип пользователя (только для логирования)
    const isWebApp = userId.startsWith('web_');
    
    console.log(`📊 Получение статистики для пользователя ${userId} (isWebApp: ${isWebApp}), игра: ${gameType}`);
    
    // ✅ ИСПРАВЛЕНО: Обработка результата getGameStats
    const result = await getGameStats(userId, gameType);
    
    console.log('📈 Результат из БД:', { 
      success: result?.success,
      has_stats: result?.has_stats,
      has_progress: result?.has_progress,
      source: result?.stats?.source
    });
    
    // Проверяем успешность выполнения
    if (!result || !result.success) {
      console.error('❌ Ошибка getGameStats:', result?.error);
      
      // Возвращаем пустую статистику при ошибке
      const fallbackStats = {
        user_id: userId,
        username: `Игрок ${String(userId).slice(-4)}`,
        games_played: 0,
        wins: 0,
        losses: 0,
        win_rate: '0.0',
        best_score: 0,
        avg_score: 0,
        best_level: 1,
        best_lines: 0,
        total_score: 0,
        last_played: null,
        city: '🏙️ Не указан',
        has_unfinished_game: false,
        source: 'error',
        note: 'Ошибка получения статистики'
      };
      
      return res.status(200).json({ 
        success: true, // API успешно отработало
        userId: userId,
        gameType: gameType,
        isWebApp: isWebApp,
        stats: fallbackStats,
        current_progress: null,
        meta: {
          has_stats: false,
          has_progress: false,
          has_played: false,
          is_new_player: true,
          next_milestone: calculateNextMilestone(0),
          note: 'Используются данные по умолчанию'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Получаем статистику из результата
    const stats = result.stats || {};
    
    // Форматируем ответ
    const response = {
      success: true,
      userId: userId,
      gameType: gameType,
      timestamp: new Date().toISOString(),
      isWebApp: isWebApp,
      source: stats.source || 'unknown',
      
      stats: {
        user_id: stats.user_id || userId,
        username: stats.username || `Игрок ${String(userId).slice(-4)}`,
        games_played: stats.games_played || 0,
        best_score: stats.best_score || 0,
        best_level: stats.best_level || 1,
        best_lines: stats.best_lines || 0,
        avg_score: stats.avg_score ? parseFloat(stats.avg_score.toFixed(2)) : 0,
        last_played: stats.last_played || null,
        city: stats.city || '🏙️ Не указан',
        
        wins: stats.wins || 0,
        losses: stats.losses || 0,
        win_rate: stats.win_rate || '0.0',
        total_score: stats.total_score || 0,
        has_unfinished_game: stats.has_unfinished_game || false
      },
      
      current_progress: stats.current_progress ? {
        score: stats.current_progress.score || 0,
        level: stats.current_progress.level || 1,
        lines: stats.current_progress.lines || 0,
        last_saved: stats.current_progress.last_saved || null
      } : null,
      
      meta: {
        has_stats: result.has_stats || false,
        has_progress: result.has_progress || false,
        has_played: (stats.games_played || 0) > 0,
        is_new_player: (stats.games_played || 0) === 0,
        next_milestone: calculateNextMilestone(stats.best_score || 0),
        note: stats.note || 'Без заметок'
      }
    };
    
    console.log('✅ Форматированный ответ:', {
      username: response.stats.username,
      games_played: response.stats.games_played,
      best_score: response.stats.best_score,
      city: response.stats.city,
      has_unfinished_game: response.stats.has_unfinished_game
    });
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('🔥 Критическая ошибка получения статистики:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: 'DATABASE_ERROR',
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
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
        progress: ((currentScore / milestone) * 100).toFixed(1) + '%',
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
