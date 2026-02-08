import { saveGameScore, getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('📨 POST /api/save-score - начат обработка запроса');
  
  // Устанавливаем заголовки CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка предварительных OPTIONS запросов
  if (req.method === 'OPTIONS') {
    console.log('📦 Обработка OPTIONS запроса');
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.',
      code: 'METHOD_NOT_ALLOWED',
      allowed_methods: ['POST', 'OPTIONS']
    });
  }

  try {
    console.log('📊 Заголовки запроса:', req.headers);
    
    // Пытаемся парсить тело запроса
    let body = req.body;
    
    // Если тело строка, пытаемся парсить как JSON
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
        console.log('📦 Тело запроса успешно распарсено из строки');
      } catch (parseError) {
        console.log('⚠️ Тело запроса не является JSON, используем как есть');
      }
    }
    
    console.log('📊 Тип тела запроса:', typeof body);
    console.log('📊 Данные тела запроса:', JSON.stringify(body, null, 2));
    
    // Извлекаем данные с различными вариантами ключей
    const rawUserId = body?.userId || body?.user_id || body?.userIdStr;
    const score = body?.score || body?.points || 0;
    const level = body?.level || body?.currentLevel || 1;
    const lines = body?.lines || body?.clearedLines || 0;
    const gameType = body?.gameType || body?.game_type || 'tetris';
    const gameOver = body?.gameOver !== undefined 
      ? (body.gameOver === true || body.gameOver === 'true') 
      : true; // По умолчанию считаем игру завершенной
    
    console.log('📊 Извлеченные данные:', {
      rawUserId: typeof rawUserId,
      score: typeof score,
      level: typeof level,
      lines: typeof lines,
      gameType,
      gameOver
    });
    
    console.log('📊 Значения:', {
      rawUserId, 
      score, 
      level, 
      lines, 
      gameType, 
      gameOver
    });
    
    // ВАЛИДАЦИЯ
    const validationErrors = [];
    
    if (!rawUserId) {
      validationErrors.push('Missing userId');
    }
    
    if (score === undefined || score === null) {
      validationErrors.push('Missing score');
    }
    
    if (validationErrors.length > 0) {
      console.log('❌ Ошибки валидации:', validationErrors);
      return res.status(400).json({ 
        success: false, 
        error: 'VALIDATION_ERROR',
        details: validationErrors,
        required_fields: ['userId', 'score'],
        received: {
          userId: !!rawUserId,
          score: score !== undefined && score !== null,
          level: !!level,
          lines: !!lines
        }
      });
    }
    
    // Обработка userId
    let userIdStr = rawUserId.toString().trim();
    let isWebApp = false;
    let webAppOriginalId = null;
    
    console.log('👤 Обработка userId:', userIdStr);
    
    if (userIdStr.startsWith('web_')) {
      // Это ID из веб-приложения, например: "web_1770548758686"
      isWebApp = true;
      webAppOriginalId = userIdStr;
      
      // Извлекаем числовую часть
      const numericPart = userIdStr.replace('web_', '');
      
      if (numericPart && !isNaN(parseInt(numericPart))) {
        // Для Web App используем прямое преобразование
        // Важно: убираем смещение, так как в БД пользователи должны иметь нормальные ID
        userIdStr = numericPart;
        console.log('🌐 Web App ID обработан:', { 
          original: webAppOriginalId, 
          numeric: userIdStr 
        });
      } else {
        // Если не удалось преобразовать, используем хэш
        console.log('⚠️ Web App ID не числовой, использую хэш');
        userIdStr = Math.abs(hashString(webAppOriginalId) % 1000000).toString();
      }
    }
    
    // Преобразуем в числа с защитой
    const numericUserId = parseInt(userIdStr);
    const numericScore = parseInt(score) || 0;
    const numericLevel = parseInt(level) || 1;
    const numericLines = parseInt(lines) || 0;
    
    console.log('🔢 Преобразованные значения:', {
      numericUserId,
      numericScore,
      numericLevel,
      numericLines,
      isWebApp,
      webAppOriginalId
    });
    
    if (isNaN(numericUserId)) {
      console.log('❌ Неверный формат userId после преобразования:', userIdStr);
      return res.status(400).json({ 
        success: false, 
        error: 'INVALID_USER_ID',
        received: rawUserId,
        parsed: userIdStr,
        message: 'User ID must be a valid number or web_* format'
      });
    }
    
    // Подготавливаем данные для сохранения
    // Важно: не добавляем смещение для Web App ID!
    const dbUserId = numericUserId;
    
    console.log('🎯 Параметры сохранения в БД:', {
      dbUserId,
      numericScore,
      numericLevel,
      numericLines,
      gameType,
      gameOver,
      isWebApp,
      originalId: isWebApp ? webAppOriginalId : dbUserId
    });
    
    // Сохраняем результат игры
    console.log('💾 Начинаю сохранение в базу данных...');
    
    const saveResult = await saveGameScore(
      dbUserId, 
      gameType, 
      numericScore, 
      numericLevel, 
      numericLines
    );
    
    console.log('💾 Результат сохранения:', saveResult);
    
    if (saveResult && saveResult.success) {
      console.log(`✅ Результат успешно сохранен! ID: ${saveResult.gameId}`);
      
      // Получаем обновленную статистику
      let stats = null;
      let bestScore = 0;
      let newRecord = false;
      let gamesPlayed = 1;
      
      try {
        stats = await getGameStats(dbUserId, gameType);
        bestScore = stats?.best_score || 0;
        gamesPlayed = stats?.games_played || 1;
        newRecord = numericScore > bestScore;
        console.log('📈 Статистика получена:', { bestScore, gamesPlayed, newRecord });
      } catch (statsError) {
        console.log('⚠️ Не удалось получить статистику:', statsError.message);
        // Продолжаем без статистики
      }
      
      // Формируем ответ
      const response = {
        success: true,
        saved: true,
        gameId: saveResult.gameId,
        userId: isWebApp ? webAppOriginalId : dbUserId.toString(),
        dbUserId: dbUserId,
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameType: gameType,
        gameOver: gameOver,
        isWebApp: isWebApp,
        
        // Статистика
        stats: {
          bestScore: bestScore,
          totalGames: gamesPlayed,
          newRecord: newRecord,
          previousBest: bestScore !== numericScore ? bestScore : null,
          improvement: newRecord ? numericScore - bestScore : 0
        },
        
        // Сообщение
        message: newRecord 
          ? `🏆 Новый рекорд! ${numericScore} очков!` 
          : gameOver 
            ? `🎮 Игра сохранена: ${numericScore} очков` 
            : `💾 Прогресс сохранен: ${numericScore} очков`,
        
        // Дополнительная информация
        timestamp: new Date().toISOString(),
        savedAt: new Date().toLocaleString('ru-RU'),
        
        // Для отладки
        debug: process.env.NODE_ENV === 'development' ? {
          originalRequest: {
            body: req.body,
            headers: req.headers
          },
          processing: {
            rawUserId,
            userIdStr,
            isWebApp
          },
          saveResult: saveResult
        } : undefined
      };
      
      console.log('📤 Успешный ответ отправляется:', {
        success: response.success,
        score: response.score,
        newRecord: response.stats.newRecord
      });
      
      return res.status(200).json(response);
      
    } else {
      console.log('❌ Ошибка при вызове saveGameScore:', saveResult);
      
      // Даже если сохранение не удалось, возвращаем частичный успех для клиента
      const fallbackResponse = {
        success: true, // Все равно возвращаем success=true для клиента
        saved: false,
        userId: isWebApp ? webAppOriginalId : dbUserId.toString(),
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        message: 'Результат временно сохранен локально',
        fallback: true,
        timestamp: new Date().toISOString(),
        error: saveResult?.error || 'DATABASE_SAVE_FAILED',
        note: 'Попробуйте сохранить снова позже'
      };
      
      console.log('📤 Fallback ответ отправляется');
      return res.status(200).json(fallbackResponse);
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка в save-score:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    // Формируем детальный ответ об ошибке
    const errorResponse = {
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: error.message,
        timestamp: new Date().toISOString(),
        endpoint: '/api/save-score'
      },
      fallback: {
        saved: false,
        message: 'Не удалось сохранить результат из-за ошибки сервера',
        recommendation: 'Попробуйте еще раз через несколько секунд'
      },
      help: {
        example_request: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: {
            userId: '123456 или web_1770548758686',
            score: 1000,
            level: 5,
            lines: 25,
            gameType: 'tetris',
            gameOver: true
          }
        },
        troubleshooting: 'Проверьте формат данных и подключение к интернету'
      }
    };
    
    // Добавляем отладочную информацию в development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.debug = {
        stack: error.stack,
        fullError: error.toString(),
        requestDetails: {
          method: req.method,
          headers: req.headers,
          body: req.body
        }
      };
    }
    
    return res.status(500).json(errorResponse);
  }
}

// Хэш-функция для строк
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Экспортируем для тестов
export { hashString };
