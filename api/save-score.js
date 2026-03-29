// api/save-score.js
import { saveGameScore } from './db.js';

export default async function handler(req, res) {
  console.log('🎮 API: /api/save-score - сохранение счета');
  console.log('🎮 Метод:', req.method);
  console.log('🎮 Body:', req.body);
  
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
  
  if (req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use POST.',
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  try {
    // Пытаемся парсить JSON тело
    let body = req.body;
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch (e) {
        console.log('⚠️ Тело запроса не JSON, используем как есть');
      }
    }
    
    const { 
      userId, 
      gameType = 'tetris', 
      score, 
      level = 1, 
      lines = 0,
      source = 'web_app'
    } = body;
    
    console.log('🎮 Данные для сохранения:', { userId, gameType, score, level, lines, source });
    
    // Валидация параметров
    if (!userId) {
      console.log('❌ Отсутствует userId');
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: userId',
        code: 'MISSING_USER_ID'
      });
    }
    
    if (score === undefined || score === null) {
      console.log('❌ Отсутствует score');
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: score',
        code: 'MISSING_SCORE'
      });
    }
    
    // Парсим числовые значения
    let numericUserId;
    let isWebApp = false;
    
    if (typeof userId === 'string' && userId.startsWith('web_')) {
      // Это ID из веб-приложения
      isWebApp = true;
      const webIdStr = userId.replace('web_', '');
      numericUserId = parseInt(webIdStr);
      
      if (isNaN(numericUserId)) {
        // Если не удалось преобразовать в число, используем хэш
        numericUserId = Math.abs(hashString(userId) % 1000000000);
      }
    } else {
      numericUserId = parseInt(userId);
    }
    
    if (isNaN(numericUserId)) {
      console.log('❌ Неверный формат userId:', userId);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid userId format. Must be a number or web_* format.',
        code: 'INVALID_USER_ID'
      });
    }
    
    const numericScore = parseInt(score);
    const numericLevel = parseInt(level);
    const numericLines = parseInt(lines);
    
    if (isNaN(numericScore)) {
      console.log('❌ Неверный формат score:', score);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid score format. Must be a number.',
        code: 'INVALID_SCORE'
      });
    }
    
    console.log(`🎮 Сохранение счета: user=${numericUserId}, score=${numericScore}, level=${numericLevel}, lines=${numericLines}`);
    
    // Сохраняем в базу данных
    const resultId = await saveGameScore(
      numericUserId, 
      gameType, 
      numericScore, 
      numericLevel, 
      numericLines
    );
    
    if (resultId) {
      console.log('✅ Счет успешно сохранен, ID:', resultId);
      
      const response = {
        success: true,
        id: resultId,
        userId: userId,
        dbUserId: numericUserId,
        gameType: gameType,
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        source: source,
        isWebApp: isWebApp,
        timestamp: new Date().toISOString(),
        message: 'Score saved successfully'
      };
      
      return res.status(200).json(response);
    } else {
      console.log('❌ Не удалось сохранить счет в БД');
      
      return res.status(500).json({ 
        success: false,
        error: 'Failed to save score to database',
        code: 'DATABASE_ERROR',
        userId: userId,
        dbUserId: numericUserId
      });
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка сохранения счета:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        code: 'SAVE_SCORE_ERROR',
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      message: 'Не удалось сохранить результат в базу данных'
    };
    
    return res.status(500).json(errorResponse);
  }
}

// Хэш-функция для строк (для Web App ID)
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// Экспортируем для тестов
export { hashString };
