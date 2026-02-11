import { getGameStats } from './db.js';
import { pool } from './db.js'; // Добавляем pool для запросов к users

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
    let userId, telegramId, webGameId, gameType;
    
    // Получаем параметры в зависимости от метода
    if (req.method === 'GET') {
      userId = req.query.userId || req.query.user_id;
      telegramId = req.query.telegramId || req.query.telegram_id;
      webGameId = req.query.webGameId || req.query.web_game_id;
      gameType = req.query.gameType || req.query.game_type || 'tetris';
    } else if (req.method === 'POST') {
      userId = req.body.userId || req.body.user_id;
      telegramId = req.body.telegramId || req.body.telegram_id;
      webGameId = req.body.webGameId || req.body.web_game_id;
      gameType = req.body.gameType || req.body.game_type || 'tetris';
    }
    
    console.log('👤 Извлеченные параметры:', { userId, telegramId, webGameId, gameType });
    
    // 🔴 ОПРЕДЕЛЯЕМ ID ДЛЯ ПОИСКА
    let searchTelegramId = null;
    let searchWebGameId = null;
    
    // Приоритет 1: явно переданный telegramId
    if (telegramId) {
      searchTelegramId = String(telegramId).replace(/[^0-9]/g, '');
      console.log(`🔍 Поиск по Telegram ID: ${searchTelegramId}`);
    }
    
    // Приоритет 2: явно переданный webGameId
    if (webGameId) {
      searchWebGameId = String(webGameId).replace(/[^0-9]/g, '');
      console.log(`🔍 Поиск по Web Game ID: ${searchWebGameId}`);
    }
    
    // Приоритет 3: userId - очищаем от префиксов
    if (userId && !searchTelegramId && !searchWebGameId) {
      const cleanId = String(userId).replace(/^(web_|test_user_)/, '');
      if (/^\d+$/.test(cleanId)) {
        searchTelegramId = cleanId;
        searchWebGameId = cleanId;
        console.log(`🔍 Поиск по очищенному userId: ${cleanId}`);
      }
    }
    
    // 🔴 ЕСЛИ НЕТ TELEGRAM ID, ИЩЕМ СВЯЗЬ ПО WEB GAME ID
    if (!searchTelegramId && searchWebGameId) {
      try {
        const linkResult = await pool.query(
          'SELECT telegram_id FROM user_links WHERE web_game_id = $1',
          [searchWebGameId]
        );
        if (linkResult.rows.length > 0) {
          searchTelegramId = linkResult.rows[0].telegram_id;
          console.log(`🔗 Найдена связь: веб-ID ${searchWebGameId} -> Telegram ID ${searchTelegramId}`);
        }
      } catch (error) {
        console.error('Ошибка поиска связи:', error);
      }
    }
    
    // 🔴 ЕСЛИ НЕТ WEB GAME ID, ИЩЕМ СВЯЗЬ ПО TELEGRAM ID
    if (!searchWebGameId && searchTelegramId) {
      try {
        const linkResult = await pool.query(
          'SELECT web_game_id FROM user_links WHERE telegram_id = $1 ORDER BY created_at DESC LIMIT 1',
          [searchTelegramId]
        );
        if (linkResult.rows.length > 0) {
          searchWebGameId = linkResult.rows[0].web_game_id;
          console.log(`🔗 Найдена связь: Telegram ID ${searchTelegramId} -> веб-ID ${searchWebGameId}`);
        }
      } catch (error) {
        console.error('Ошибка поиска связи:', error);
      }
    }
    
    // 🔴 ПОЛУЧАЕМ ГОРОД ИЗ ТАБЛИЦЫ users (по Telegram ID)
    let city = 'Не указан';
    let username = 'Web Player';
    let citySource = 'none';
    
    if (searchTelegramId) {
      try {
        const userResult = await pool.query(
          'SELECT city, username FROM users WHERE user_id = $1',
          [searchTelegramId]
        );
        
        if (userResult.rows.length > 0) {
          city = userResult.rows[0].city || 'Не указан';
          username = userResult.rows[0].username || 'Web Player';
          citySource = 'users_table';
          console.log(`🏙️ Найден город из users: "${city}" для Telegram ID: ${searchTelegramId}`);
        } else {
          console.log(`🏙️ Пользователь с Telegram ID ${searchTelegramId} не найден в users`);
        }
      } catch (error) {
        console.error('❌ Ошибка получения города:', error);
      }
    }
    
    // 🔴 ПОЛУЧАЕМ СТАТИСТИКУ ИГР ИЗ game_scores
    let stats = null;
    let statsUserId = null;
    
    // Приоритет для статистики: веб-ID, затем Telegram ID
    if (searchWebGameId) {
      stats = await getGameStats(searchWebGameId, gameType);
      statsUserId = searchWebGameId;
      console.log(`🎮 Статистика по веб-ID ${searchWebGameId}:`, stats);
    } else if (searchTelegramId) {
      stats = await getGameStats(searchTelegramId, gameType);
      statsUserId = searchTelegramId;
      console.log(`🎮 Статистика по Telegram ID ${searchTelegramId}:`, stats);
    }
    
    // 🔴 ЕСЛИ СТАТИСТИКИ НЕТ, ПРОВЕРЯЕМ НАЛИЧИЕ ПРОГРЕССА
    let hasUnfinishedGame = false;
    let currentProgress = null;
    
    if (statsUserId) {
      try {
        const progressResult = await pool.query(
          'SELECT score, level, lines, updated_at FROM game_progress WHERE user_id = $1 AND game_type = $2',
          [statsUserId, gameType]
        );
        
        if (progressResult.rows.length > 0) {
          hasUnfinishedGame = true;
          currentProgress = progressResult.rows[0];
          console.log(`🎮 Найден незавершенный прогресс для ${statsUserId}`);
        }
      } catch (error) {
        console.error('Ошибка получения прогресса:', error);
      }
    }
    
    console.log('📊 Итоговые данные:', {
      telegramId: searchTelegramId,
      webGameId: searchWebGameId,
      statsUserId,
      city,
      username,
      games_played: stats?.games_played || 0,
      best_score: stats?.best_score || 0
    });
    
    // 🔴 ФОРМИРУЕМ ОТВЕТ - ОБЪЕДИНЯЕМ ГОРОД ИЗ users И СТАТИСТИКУ ИЗ game_scores
    const response = {
      success: true,
      userId: userId || statsUserId || null, // Оригинальный ID запроса
      telegramId: searchTelegramId || null,
      webGameId: searchWebGameId || null,
      gameType: gameType,
      timestamp: new Date().toISOString(),
      isWebApp: false, // Никаких web_ префиксов!
      
      // 🔴 ГОРОД ИЗ users
      city: city,
      username: username,
      city_source: citySource,
      
      // 🔴 СТАТИСТИКА ИЗ game_scores
      stats: {
        // Основные поля
        games_played: parseInt(stats?.games_played) || 0,
        best_score: parseInt(stats?.best_score) || 0,
        best_level: parseInt(stats?.best_level) || 1,
        best_lines: parseInt(stats?.best_lines) || 0,
        avg_score: stats?.avg_score ? parseFloat(parseFloat(stats.avg_score).toFixed(2)) : 0,
        total_score: parseInt(stats?.total_score) || 0,
        last_played: stats?.last_played || null,
        
        // Поля побед/поражений
        wins: parseInt(stats?.wins) || 0,
        losses: parseInt(stats?.losses) || 0,
        win_rate: stats?.games_played > 0 
          ? ((parseInt(stats?.wins) || 0) / parseInt(stats?.games_played) * 100).toFixed(1)
          : 0,
        
        // Дополнительные поля
        first_played: stats?.first_played || null,
        rank: stats?.rank || 'Не определен'
      },
      
      // 🔴 ПРОГРЕСС ТЕКУЩЕЙ ИГРЫ
      current_progress: currentProgress ? {
        score: parseInt(currentProgress.score) || 0,
        level: parseInt(currentProgress.level) || 1,
        lines: parseInt(currentProgress.lines) || 0,
        last_saved: currentProgress.updated_at || null,
        has_unfinished_game: true
      } : null,
      
      has_unfinished_game: hasUnfinishedGame,
      
      // 🔴 МЕТА-ИНФОРМАЦИЯ
      meta: {
        has_played: (parseInt(stats?.games_played) || 0) > 0,
        has_unfinished_game: hasUnfinishedGame,
        has_city: city !== 'Не указан',
        is_top_player: false,
        next_milestone: calculateNextMilestone(parseInt(stats?.best_score) || 0),
        player_level: calculatePlayerLevel(parseInt(stats?.games_played) || 0)
      }
    };
    
    console.log('✅ ИТОГОВЫЙ ОТВЕТ:');
    console.log(`   🏙️ Город: ${response.city}`);
    console.log(`   👤 Имя: ${response.username}`);
    console.log(`   🎮 Игр: ${response.stats.games_played}`);
    console.log(`   🏆 Рекорд: ${response.stats.best_score}`);
    console.log(`   📊 Побед: ${response.stats.wins}`);
    console.log(`   🔄 Прогресс: ${response.has_unfinished_game ? 'Есть' : 'Нет'}`);
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('🔥 Критическая ошибка получения статистики:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        code: 'DATABASE_ERROR',
        timestamp: new Date().toISOString()
      },
      fallback: {
        city: 'Не указан',
        username: 'Web Player',
        stats: {
          games_played: 0,
          best_score: 0,
          best_level: 1,
          best_lines: 0,
          avg_score: 0,
          wins: 0,
          losses: 0,
          win_rate: 0
        }
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

// Вспомогательная функция для расчета уровня игрока
function calculatePlayerLevel(gamesPlayed) {
  if (gamesPlayed === 0) return 'Новичок';
  if (gamesPlayed < 5) return 'Начинающий';
  if (gamesPlayed < 15) return 'Любитель';
  if (gamesPlayed < 30) return 'Опытный';
  if (gamesPlayed < 50) return 'Профессионал';
  if (gamesPlayed < 100) return 'Эксперт';
  return 'Мастер';
}
