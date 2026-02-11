import { getTopPlayers } from './db.js';

export default async function handler(req, res) {
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка предварительного запроса OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Только GET запросы
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Метод не разрешен'
    });
  }
  
  console.log('🏆 /api/top-players - Запрос:', req.query);

  try {
    const { gameType = 'tetris', limit = 10 } = req.query;
    const numericLimit = Math.min(parseInt(limit) || 10, 100);
    
    // Получаем топ игроков из БД
    const result = await getTopPlayers(gameType, numericLimit);
    
    console.log(`🏆 Результат из БД:`, result);
    
    // Проверяем что функция вернула данные
    if (!result || !result.success) {
      console.error('❌ getTopPlayers вернул ошибку:', result?.error);
      return res.status(200).json({
        success: true,
        gameType: gameType,
        limit: numericLimit,
        count: 0,
        players: [],
        message: 'Топ временно недоступен'
      });
    }
    
    // Получаем массив игроков
    const playersArray = result.players || [];
    
    console.log(`🏆 Игроков в топе: ${playersArray.length}`);
    
    // Форматируем для фронтенда
    const formattedPlayers = playersArray.map((player, index) => {
      return {
        rank: index + 1,
        user_id: player.user_id,
        display_name: player.display_name || player.username || `Игрок ${String(player.user_id).slice(-4)}`,
        username: player.display_name || player.username,
        city: player.city || 'Не указан',
        best_score: player.best_score || 0,
        best_level: player.best_level || 1,
        best_lines: player.best_lines || 0,
        games_played: player.games_played || 1
      };
    });
    
    const response = {
      success: true,
      gameType: gameType,
      limit: numericLimit,
      count: formattedPlayers.length,
      players: formattedPlayers,
      timestamp: new Date().toISOString()
    };
    
    console.log(`✅ Отправляем ${formattedPlayers.length} игроков в топе`);
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Критическая ошибка получения топа:', error);
    
    // 🔴 ВСЕГДА возвращаем JSON, даже при ошибке!
    return res.status(200).json({
      success: true,
      gameType: req.query.gameType || 'tetris',
      limit: parseInt(req.query.limit) || 10,
      count: 0,
      players: [],
      message: 'Топ временно недоступен',
      timestamp: new Date().toISOString()
    });
  }
}
