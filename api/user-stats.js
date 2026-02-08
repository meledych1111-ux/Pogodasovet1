import { getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('📊 API: /api/user-stats - запрос статистики пользователя');
  
  // Устанавливаем заголовки CORS для разрешения запросов от веб-приложений
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка предварительных OPTIONS запросов
  if (req.method === 'OPTIONS') {
    console.log('📦 Обработка OPTIONS запроса');
    return res.status(200).end();
  }
  
  // Разрешаем оба метода для удобства
  if (req.method !== 'GET' && req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use GET, POST or OPTIONS.',
      code: 'METHOD_NOT_ALLOWED',
      allowed_methods: ['GET', 'POST', 'OPTIONS']
    });
  }

  try {
    let userId, gameType;
    
    // Получаем параметры в зависимости от метода
    if (req.method === 'GET') {
      userId = req.query.userId || req.query.user_id;
      gameType = req.query.gameType || req.query.game_type || 'tetris';
      console.log('📥 GET параметры:', { userId, gameType, query: req.query });
    } else if (req.method === 'POST') {
      // Пытаемся парсить JSON тело
      let body = req.body;
      if (typeof req.body === 'string') {
        try {
          body = JSON.parse(req.body);
        } catch (e) {
          console.log('⚠️ Тело запроса не JSON, используем как есть');
        }
      }
      userId = body?.userId || body?.user_id;
      gameType = body?.gameType || body?.game_type || 'tetris';
      console.log('📥 POST параметры:', { userId, gameType, body: req.body });
    }
    
    console.log('👤 Извлеченные параметры:', { userId, gameType });
    
    // Валидация данных
    if (!userId) {
      console.log('❌ Отсутствует userId');
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: userId',
        code: 'MISSING_USER_ID',
        help: 'Provide userId as query parameter or in request body',
        example: '/api/user-stats?userId=12345 or {"userId": "12345"}'
      });
    }
    
    // Проблема была здесь: обработка Web App ID
    let numericUserId;
    let isWebApp = false;
    
    if (typeof userId === 'string' && userId.startsWith('web_')) {
      // Это ID из веб-приложения, например: "web_1770548758686"
      isWebApp = true;
      
      // Извлекаем числовую часть
      const webIdStr = userId.replace('web_', '');
      numericUserId = parseInt(webIdStr);
      
      if (isNaN(numericUserId)) {
        // Если не удалось преобразовать в число, используем хэш
        console.log('⚠️ Web App ID не числовой, использую хэш:', userId);
        numericUserId = Math.abs(hashString(userId) % 1000000000);
      }
      
      console.log('🌐 Web App ID преобразован:', { 
        original: userId, 
        webId: webIdStr, 
        dbUserId: numericUserId 
      });
    } else {
      // Это обычный Telegram ID
      numericUserId = parseInt(userId);
      
      if (isNaN(numericUserId)) {
        console.log('❌ Неверный формат userId:', userId);
        return res.status(400).json({ 
          success: false,
          error: 'Invalid userId format. Must be a number or web_* format.',
          code: 'INVALID_USER_ID',
          received: userId,
          expected: 'number or "web_*"'
        });
      }
    }
    
    console.log(`📊 Получение статистики для пользователя ${numericUserId} (оригинальный: ${userId}, isWebApp: ${isWebApp}), игра: ${gameType}`);
    
    // Получаем статистику из базы данных
    const stats = await getGameStats(numericUserId, gameType);
    
    console.log('📈 Статистика из БД:', stats);
    
    // Форматируем дату последней игры
    let lastPlayedFormatted = null;
    if (stats?.last_played) {
      try {
        const lastPlayed = new Date(stats.last_played);
        lastPlayedFormatted = lastPlayed.toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (e) {
        console.log('⚠️ Ошибка форматирования даты:', e.message);
      }
    }
    
    // Рассчитываем следующий рубеж
    const nextMilestone = calculateNextMilestone(stats?.best_score || 0);
    
    // Определяем, является ли игрок топовым
    const isTopPlayer = (stats?.best_score || 0) >= 1000;
    
    // Форматируем ответ
    const response = {
      success: true,
      userId: userId, // Оригинальный ID
      dbUserId: numericUserId, // ID в базе данных
      gameType: gameType,
      timestamp: new Date().toISOString(),
      isWebApp: isWebApp,
      requestMethod: req.method,
      
      // Основная статистика
      stats: {
        games_played: stats?.games_played || 0,
        best_score: stats?.best_score || 0,
        best_level: stats?.best_level || 1,
        best_lines: stats?.best_lines || 0,
        avg_score: stats?.avg_score ? Math.round(stats.avg_score) : 0,
        avg_score_float: stats?.avg_score ? parseFloat(stats.avg_score.toFixed(2)) : 0,
        last_played: stats?.last_played || null,
        last_played_formatted: lastPlayedFormatted,
        total_score: stats?.total_score || 0
      },
      
      // Дополнительная информация
      meta: {
        has_played: (stats?.games_played || 0) > 0,
        is_top_player: isTopPlayer,
        player_level: getPlayerLevel(stats?.best_score || 0),
        next_milestone: nextMilestone,
        achievements: getAchievements(stats || {})
      },
      
      // Для отладки
      debug: process.env.NODE_ENV === 'development' ? {
        original_request: {
          method: req.method,
          query: req.query,
          body: req.body
        },
        db_stats_raw: stats
      } : undefined
    };
    
    console.log('✅ Статистика успешно получена:', {
      games_played: response.stats.games_played,
      best_score: response.stats.best_score,
      player_level: response.meta.player_level
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
        endpoint: '/api/user-stats',
        request_method: req.method,
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
      },
      help: {
        example_requests: [
          'GET /api/user-stats?userId=123456',
          'POST /api/user-stats with JSON: {"userId": "123456"}',
          'GET /api/user-stats?userId=web_1770548758686'
        ],
        contact: 'Если проблема сохраняется, проверьте подключение к базе данных'
      }
    };
    
    return res.status(500).json(errorResponse);
  }
}

// Вспомогательная функция для расчета следующего рубежа
function calculateNextMilestone(currentScore) {
  const milestones = [
    { score: 100, name: 'Новичок', emoji: '🎯' },
    { score: 500, name: 'Любитель', emoji: '⭐' },
    { score: 1000, name: 'Профи', emoji: '🏆' },
    { score: 2500, name: 'Эксперт', emoji: '👑' },
    { score: 5000, name: 'Мастер', emoji: '🔥' },
    { score: 10000, name: 'Гуру', emoji: '🚀' },
    { score: 25000, name: 'Легенда', emoji: '👁️' },
    { score: 50000, name: 'Бог игры', emoji: '👑🔥' },
    { score: 100000, name: 'Невозможное', emoji: '🦄' }
  ];
  
  // Находим текущий и следующий рубежи
  let currentMilestone = null;
  let nextMilestone = null;
  
  for (let i = 0; i < milestones.length; i++) {
    if (currentScore >= milestones[i].score) {
      currentMilestone = milestones[i];
    } else {
      nextMilestone = milestones[i];
      break;
    }
  }
  
  // Если прошли все рубежи
  if (!nextMilestone) {
    return {
      target: 200000,
      name: 'Абсолют',
      emoji: '⚡',
      needed: 0,
      progress: 100,
      progress_percent: '100%',
      message: 'Вы достигли максимального уровня! 🏆',
      current_milestone: currentMilestone
    };
  }
  
  const progress = (currentScore / nextMilestone.score * 100);
  
  return {
    target: nextMilestone.score,
    name: nextMilestone.name,
    emoji: nextMilestone.emoji,
    needed: nextMilestone.score - currentScore,
    progress: Math.round(progress),
    progress_percent: progress.toFixed(1) + '%',
    message: `Следующий уровень: ${nextMilestone.name} (${nextMilestone.score} очков)`,
    current_milestone: currentMilestone
  };
}

// Функция для определения уровня игрока
function getPlayerLevel(score) {
  if (score >= 100000) return { level: 10, name: 'Легенда', emoji: '👑🔥' };
  if (score >= 50000) return { level: 9, name: 'Мастер', emoji: '🔥' };
  if (score >= 25000) return { level: 8, name: 'Эксперт', emoji: '👑' };
  if (score >= 10000) return { level: 7, name: 'Профи', emoji: '🏆' };
  if (score >= 5000) return { level: 6, name: 'Опытный', emoji: '⭐' };
  if (score >= 2500) return { level: 5, name: 'Продвинутый', emoji: '🎯' };
  if (score >= 1000) return { level: 4, name: 'Средний', emoji: '⚡' };
  if (score >= 500) return { level: 3, name: 'Начинающий', emoji: '🌱' };
  if (score >= 100) return { level: 2, name: 'Новичок', emoji: '🎮' };
  return { level: 1, name: 'Первопроходец', emoji: '👶' };
}

// Функция для определения достижений
function getAchievements(stats) {
  const achievements = [];
  
  if (stats.games_played >= 1) {
    achievements.push({
      id: 'first_game',
      name: 'Первая игра',
      emoji: '🎮',
      unlocked: true,
      description: 'Сыграли первую игру'
    });
  }
  
  if (stats.games_played >= 10) {
    achievements.push({
      id: 'ten_games',
      name: 'Десять игр',
      emoji: '🔟',
      unlocked: true,
      description: 'Сыграли 10 игр'
    });
  }
  
  if (stats.best_score >= 1000) {
    achievements.push({
      id: 'thousand_points',
      name: 'Тысячник',
      emoji: '💯',
      unlocked: true,
      description: 'Набрали 1000 очков'
    });
  }
  
  if (stats.best_level >= 10) {
    achievements.push({
      id: 'level_10',
      name: '10 уровень',
      emoji: '🎯',
      unlocked: true,
      description: 'Достигли 10 уровня'
    });
  }
  
  if (stats.best_lines >= 100) {
    achievements.push({
      id: 'hundred_lines',
      name: '100 линий',
      emoji: '📈',
      unlocked: true,
      description: 'Собрали 100 линий'
    });
  }
  
  // Предстоящие достижения
  const upcoming = [];
  
  if (stats.games_played < 10) {
    upcoming.push({
      id: 'goal_ten_games',
      name: 'Сыграть 10 игр',
      progress: stats.games_played,
      target: 10,
      emoji: '🎯'
    });
  }
  
  if (stats.best_score < 1000) {
    upcoming.push({
      id: 'goal_thousand',
      name: 'Набрать 1000 очков',
      progress: stats.best_score,
      target: 1000,
      emoji: '💯'
    });
  }
  
  return {
    unlocked: achievements,
    upcoming: upcoming,
    total: achievements.length,
    upcoming_count: upcoming.length
  };
}

// Хэш-функция для строк (для Web App ID) - ИСПРАВЛЕНА!
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}  // ← Закрывающая скобка была!

// Экспортируем вспомогательные функции для тестов
export { calculateNextMilestone, getPlayerLevel, getAchievements };
