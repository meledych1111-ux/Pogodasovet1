import { 
  testGameSave,
  getTopPlayers,
  getGameStats,
  checkDatabaseConnection,
  debugDatabase
} from './db.js';

async function runTests() {
  console.log('🧪 ЗАПУСК ТЕСТОВ БАЗЫ ДАННЫХ 🧪\n');
  
  // 1. Проверка подключения
  console.log('1. Проверка подключения к БД...');
  const connection = await checkDatabaseConnection();
  if (!connection.success) {
    console.error('❌ Не удалось подключиться к БД:', connection.error);
    return;
  }
  console.log('✅ Подключение успешно\n');
  
  // 2. Диагностика базы
  console.log('2. Диагностика базы данных...');
  const diagnosis = await debugDatabase();
  if (!diagnosis.success) {
    console.error('❌ Диагностика не удалась:', diagnosis.error);
  } else {
    console.log('✅ Диагностика завершена\n');
  }
  
  // 3. Тест сохранения игры
  console.log('3. Тест сохранения игры...');
  const testResult = await testGameSave();
  if (testResult.success) {
    console.log('✅ Тест сохранения игры пройден\n');
  } else {
    console.log('❌ Тест сохранения игры не пройден:', testResult.error, '\n');
  }
  
  // 4. Проверка топа
  console.log('4. Проверка топа игроков...');
  const topResult = await getTopPlayers('tetris', 5);
  if (topResult.success) {
    console.log(`✅ Топ загружен: ${topResult.count} игроков`);
    if (topResult.players.length > 0) {
      topResult.players.forEach((player, i) => {
        console.log(`   ${i+1}. ${player.username} - ${player.score} очков (${player.city})`);
      });
    } else {
      console.log('   ℹ️ Топ пока пуст');
    }
  } else {
    console.log('❌ Не удалось загрузить топ:', topResult.error);
  }
  console.log();
  
  // 5. Проверка статистики тестового пользователя
  if (testResult.success) {
    console.log('5. Проверка статистики тестового пользователя...');
    const statsResult = await getGameStats(testResult.user_id);
    if (statsResult.success) {
      console.log('✅ Статистика загружена:');
      console.log('   Игр сыграно:', statsResult.stats.games_played);
      console.log('   Лучший счет:', statsResult.stats.best_score);
      console.log('   Город:', statsResult.stats.city);
    } else {
      console.log('❌ Не удалось загрузить статистику:', statsResult.error);
    }
  }
  
  console.log('\n🧪 ТЕСТЫ ЗАВЕРШЕНЫ 🧪');
}

runTests().catch(console.error);
