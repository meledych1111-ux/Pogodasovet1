import { createTables } from './db.js';

async function init() {
  try {
    await createTables();
    console.log('✅ Таблицы созданы успешно!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

init();
