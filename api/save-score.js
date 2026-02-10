import { saveGameScore, getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('🎮 API: /api/save-score - сохранение результата игры');
  
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
      userId,
      gameType = 'tetris',
      score,
      level = 1,
      lines = 0,
      username = null,
      gameOver = true,
      city = null // Добавляем город для сессии
    } = req.body;
    
    console.log('🎮 Данные для сохранения:', { 
      userId, 
      gameType, 
      score, 
      level, 
      lines,
      username: username ? `${username.substring(0, 10)}...` : 'null',
      gameOver,
      city 
    });
    
    // Валидация данных
    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: userId',
        code: 'MISSING_USER_ID'
      });
    }
    
    if (!score && score !== 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: score',
        code: 'MISSING_SCORE'
      });
    }
    
    // Преобразуем типы
    const numericScore = parseInt(score) || 0;
    const numericLevel = parseInt(level) || 1;
    const numericLines = parseInt(lines) || 0;
    
    console.log(`🎮 СОХРАНЕНИЕ ИГРЫ: user=${userId}, score=${numericScore}, type=${gameType}`);
    console.log(`ID преобразован: ${userId} → ${userId}`);
    
    if (username) {
      console.log(`👤 Имя пользователя: ${username}`);
    }
    
    if (city) {
      console.log(`📍 Город: ${city}`);
    }
    
    // Если счет 0, просто возвращаем успех без сохранения
    if (numericScore === 0 && numericLines === 0) {
      console.log('🎮 Нулевой счет и линии, пропускаем сохранение');
      return res.status(200).json({
        success: true,
        message: 'Нулевой счет не сохранен',
        saved: false,
        score: 0
      });
    }
    
    // Сохраняем результат игры
    console.log(`🎮 Сохраняем результат: ${numericScore} очков для пользователя ${userId}`);
    console.log(`📊 Сохранение результата игры...`);
    
    const saveResult = await saveGameScore(
      userId,
      gameType,
      numericScore,
      numericLevel,
      numericLines,
      username,
      gameOver,
      city // Передаем город в функцию сохранения
    );
    
    if (!saveResult || !saveResult.success) {
      console.error('❌ Ошибка сохранения результата:', saveResult?.error);
      return res.status(500).json({
        success: false,
        error: saveResult?.error || 'Ошибка сохранения результата',
        code: 'SAVE_ERROR',
        details: saveResult?.details
      });
    }
    
    console.log(`✅ Результат игры сохранен! ID: ${saveResult.id}, время: ${new Date().toISOString()}`);
    console.log(`📈 Обновление статистики...`);
    
    // Получаем обновленную статистику
    console.log(`📊 Запрос статистики: user=${userId}, type=${gameType}`);
    
    let statsResult;
    try {
      statsResult = await getGameStats(userId, gameType);
    } catch (statsError) {
      console.warn('⚠️ Ошибка при получении статистики:', statsError.message);
      // Продолжаем выполнение даже если статистика не получена
      statsResult = { success: false };
    }
    
    console.log(`🔍 Проверяем game_progress для пользователя ${userId}...`);
    console.log(`🔍 Проверяем game_scores для пользователя ${userId}...`);
    
    const response = {
      success: true,
      saved: true,
      message: 'Результат успешно сохранен!',
      save_details: {
        id: saveResult.id,
        created_at: saveResult.created_at,
        user_id: saveResult.user_id
      },
      score: numericScore,
      level: numericLevel,
      lines: numericLines,
      gameOver: gameOver,
      timestamp: new Date().toISOString(),
      user_id: userId
    };
    
    // Добавляем информацию о сессии, если город передан
    if (city) {
      response.session = {
        city: city,
        location_logged: true
      };
    }
    
    // Добавляем статистику, если она есть
    if (statsResult && statsResult.success && statsResult.stats) {
      const stats = statsResult.stats;
      response.stats = {
        games_played: stats.games_played || stats.total_games || 0,
        best_score: stats.best_score || 0,
        best_level: stats.best_level || stats.max_level || 1,
        best_lines: stats.best_lines || stats.max_lines || 0,
        avg_score: stats.avg_score || 0,
        total_score: stats.total_score || numericScore,
        total_lines: stats.total_lines || numericLines
      };
      
      // Проверяем, является ли это новым рекордом
      const currentBest = response.stats.best_score || 0;
      if (numericScore > currentBest && numericScore > 0) {
        response.is_new_record = true;
        response.record_details = {
          old_record: currentBest,
          new_record: numericScore,
          improvement: numericScore - currentBest
        };
        
        if (currentBest > 0) {
          response.message = `🎉 НОВЫЙ РЕКОРД! ${numericScore} очков!`;
          console.log(`🏆 Новый рекорд! ${numericScore} очков (было: ${currentBest})`);
        } else {
          response.message = `🎮 Первая игра сохранена! ${numericScore} очков!`;
          console.log(`📝 Первая игра для пользователя: ${numericScore} очков`);
        }
      } else if (currentBest > 0) {
        response.message = `Игра сохранена! Ваш рекорд: ${currentBest} очков`;
      }
    } else {
      console.log(`📊 Нет данных статистики для пользователя ${userId}`);
      response.message = `Игра сохранена! Счет: ${numericScore} очков`;
    }
    
    console.log(`✅ Результат сохранен: ${numericScore} очков, ID: ${saveResult.id}`);
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('🔥 Критическая ошибка сохранения результата:', error);
    console.error('🔥 Stack trace:', error.stack);
    console.error('🔥 Request body:', req.body);
    
    // Логируем дополнительные детали для отладки
    if (error.code) {
      console.error('🔥 Error code:', error.code);
    }
    if (error.constraint) {
      console.error('🔥 Constraint violation:', error.constraint);
    }
    
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: error.code || 'INTERNAL_ERROR',
        constraint: error.constraint,
        timestamp: new Date().toISOString()
      },
      request_info: {
        method: req.method,
        has_body: !!req.body,
        body_keys: req.body ? Object.keys(req.body) : []
      }
    });
  }
}
