import { saveGameScore, saveGameProgress, deleteGameProgress, getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('📨 POST /api/save-score - начат');
  console.log('📨 Headers:', req.headers);
  console.log('📨 Метод:', req.method);
  
  if (req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }

  try {
    // Проверяем Content-Type
    const contentType = req.headers['content-type'] || '';
    console.log('📨 Content-Type:', contentType);
    
    // Логируем сырые данные
    console.log('📨 Сырые данные запроса:', req.body);
    
    // Парсим тело запроса
    let data;
    if (contentType.includes('application/json')) {
      data = req.body;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      // Для form-data
      data = req.body;
    } else {
      // Пробуем парсить как JSON в любом случае
      try {
        if (typeof req.body === 'string') {
          data = JSON.parse(req.body);
        } else {
          data = req.body;
        }
      } catch (e) {
        data = req.body;
      }
    }
    
    console.log('📊 Распарсенные данные:', data);
    
    // Проверяем основные поля
    if (!data) {
      console.log('❌ Нет данных в запросе');
      return res.status(400).json({ 
        success: false, 
        error: 'No data received' 
      });
    }
    
    // Извлекаем данные с проверкой
    const rawUserId = data.userId || data.user_id || data.user || data.initDataUnsafe?.user?.id;
    const score = data.score || data.points || data.result;
    const level = data.level || data.lvl || 1;
    const lines = data.lines || data.line || 0;
    const gameType = data.gameType || data.game_type || data.type || 'tetris';
    const gameOver = data.gameOver || data.game_over || data.finished || data.completed || false;
    
    console.log('📊 Извлеченные поля:', {
      rawUserId,
      score,
      level,
      lines,
      gameType,
      gameOver,
      hasInitData: !!data.initDataUnsafe
    });
    
    // ВАЛИДАЦИЯ
    if (!rawUserId) {
      console.log('❌ Отсутствует userId');
      console.log('❌ Все поля запроса:', Object.keys(data));
      return res.status(400).json({ 
        success: false, 
        error: 'Missing userId field',
        received_fields: Object.keys(data)
      });
    }
    
    if (score === undefined || score === null) {
      console.log('❌ Отсутствует score');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing score field' 
      });
    }
    
    // Обработка userId
    let userId = rawUserId.toString().trim();
    let isWebApp = false;
    
    // Проверяем на Web App формат (web_123456)
    if (userId.startsWith('web_')) {
      const numericPart = userId.replace('web_', '');
      if (numericPart && !isNaN(parseInt(numericPart))) {
        userId = numericPart;
        isWebApp = true;
        console.log('🌐 Web App ID обработан:', { original: rawUserId, processed: userId });
      } else {
        console.log('❌ Некорректный Web App ID:', userId);
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid Web App ID format' 
        });
      }
    }
    
    // Преобразуем в числа
    const numericUserId = parseInt(userId);
    const numericScore = parseInt(score);
    const numericLevel = parseInt(level) || 1;
    const numericLines = parseInt(lines) || 0;
    
    if (isNaN(numericUserId)) {
      console.log('❌ Неверный формат userId после обработки:', userId);
      return res.status(400).json({ 
        success: false, 
        error: `Invalid userId format: ${userId}` 
      });
    }
    
    if (isNaN(numericScore)) {
      console.log('❌ Неверный формат score:', score);
      return res.status(400).json({ 
        success: false, 
        error: `Invalid score format: ${score}` 
      });
    }
    
    // Для Web App добавляем смещение
    const dbUserId = isWebApp ? numericUserId + 1000000000 : numericUserId;
    
    console.log('🎯 Параметры для сохранения:', {
      originalUserId: rawUserId,
      processedUserId: userId,
      dbUserId: dbUserId,
      score: numericScore,
      level: numericLevel,
      lines: numericLines,
      gameType: gameType,
      gameOver: gameOver,
      isWebApp: isWebApp
    });
    
    // СОХРАНЕНИЕ В БАЗУ ДАННЫХ
    console.log('💾 Начинаем сохранение в БД...');
    
    let resultId;
    let operation = '';
    
    if (gameOver) {
      operation = 'FINAL_SCORE';
      console.log('🎮 Сохраняем ФИНАЛЬНЫЙ результат игры...');
      resultId = await saveGameScore(dbUserId, gameType, numericScore, numericLevel, numericLines);
      
      if (resultId) {
        console.log(`✅ Финальный результат сохранен! ID: ${resultId}`);
        // Удаляем прогресс после сохранения финального результата
        await deleteGameProgress(dbUserId, gameType);
        console.log('🗑️ Прогресс удален (игра завершена)');
      }
    } else {
      operation = 'PROGRESS';
      console.log('💾 Сохраняем ПРОГРЕСС игры...');
      resultId = await saveGameProgress(dbUserId, gameType, numericScore, numericLevel, numericLines);
      console.log(`✅ Прогресс сохранен! User ID: ${resultId}`);
    }
    
    // ПРОВЕРКА СОХРАНЕНИЯ
    if (resultId) {
      console.log('🔍 Проверяем сохранение в БД...');
      
      // Получаем статистику для проверки
      const stats = await getGameStats(dbUserId, gameType);
      const bestScore = stats?.best_score || 0;
      const newRecord = numericScore > bestScore;
      
      console.log('📊 Результат проверки:', {
        saved: true,
        operation: operation,
        savedId: resultId,
        currentBestScore: bestScore,
        newScore: numericScore,
        isNewRecord: newRecord,
        totalGames: stats?.games_played || 0
      });
      
      const response = {
        success: true,
        operation: operation,
        saved: true,
        id: resultId,
        userId: isWebApp ? `web_${userId}` : numericUserId,
        dbUserId: dbUserId,
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameType: gameType,
        gameOver: gameOver,
        stats: {
          bestScore: bestScore,
          totalGames: stats?.games_played || 0,
          newRecord: newRecord
        },
        message: gameOver 
          ? (newRecord ? '🏆 Новый рекорд!' : 'Игра завершена!') 
          : 'Прогресс сохранен',
        timestamp: new Date().toISOString()
      };
      
      console.log('📤 Отправляем успешный ответ:', response);
      return res.status(200).json(response);
      
    } else {
      console.log('❌ ОШИБКА: Не удалось сохранить в БД!');
      console.log('❌ Параметры которые не сохранились:', {
        dbUserId,
        gameType,
        score: numericScore,
        level: numericLevel,
        lines: numericLines
      });
      
      return res.status(500).json({ 
        success: false,
        error: 'DATABASE_SAVE_FAILED',
        message: 'Не удалось сохранить результат в базу данных',
        details: {
          userId: dbUserId,
          score: numericScore,
          operation: operation
        }
      });
    }
    
  } catch (error) {
    console.error('🔥 КРИТИЧЕСКАЯ ОШИБКА в save-score:', error);
    console.error('🔥 Stack trace:', error.stack);
    console.error('🔥 Полный контекст ошибки:', {
      method: req.method,
      headers: req.headers,
      body: req.body,
      url: req.url
    });
    
    return res.status(500).json({ 
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Внутренняя ошибка сервера',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
