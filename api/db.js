import pg from 'pg';
const { Pool } = pg;
import { URL } from 'url';
import crypto from 'crypto';

// ===================== ГЕНЕРАТОР АНОНИМНЫХ ИМЕН =====================
const cloudEmojis = ['☁️', '🌤️', '⛅', '🌥️', '🌦️', '🌧️', '⛈️', '🌩️', '❄️', '🌈'];
const cloudNames = [
    'Облачко', 'Тучка', 'Перистое', 'Кучевое', 'Слоистое', 'Дождевое', 'Грозовое',
    'Пушистое', 'Легкое', 'Воздушное', 'Мягкое', 'Белое', 'Серебристое', 'Жемчужное',
    'Нежное', 'Летнее', 'Весеннее', 'Осеннее', 'Зимнее', 'Утреннее', 'Вечернее',
    'Золотое', 'Розовое', 'Лазурное', 'Солнечное', 'Лунное', 'Звездное'
];

export function generateAnonymousName(userId) {
    const userIdStr = String(userId);
    const hash = crypto.createHash('md5').update(userIdStr).digest('hex');
    const emojiIndex = parseInt(hash.substring(0, 4), 16) % cloudEmojis.length;
    const nameIndex = parseInt(hash.substring(4, 8), 16) % cloudNames.length;
    const numberSuffix = parseInt(hash.substring(8, 12), 16) % 100;

    return `${cloudEmojis[emojiIndex]} ${cloudNames[nameIndex]} ${numberSuffix}`;
}

// ===================== КОНВЕРТАЦИЯ ID =====================
function convertUserIdForDb(userId) {
    if (!userId) return null;

    const userIdStr = String(userId).trim();

    // Оставляем только цифры для технического ID
    const digitsOnly = userIdStr.replace(/[^0-9]/g, '');

    if (digitsOnly && digitsOnly.length > 0) {
        console.log(`✅ convertUserIdForDb: ${userIdStr} -> ${digitsOnly}`);
        return digitsOnly;
    }

    return null;
}

// ===================== ПОДКЛЮЧЕНИЕ К БД =====================
const parseDatabaseUrl = () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('❌ DATABASE_URL не установлен');
        return null;
    }

    try {
        const url = new URL(dbUrl);

        const maskedUrl = `${url.protocol}//${url.username}:***@${url.host}${url.pathname}`;
        console.log(`🔗 Подключение к БД: ${maskedUrl}`);

        let sslConfig;
        if (url.hostname.includes('neon.tech')) {
            sslConfig = {
                rejectUnauthorized: true,
                sslmode: 'require'
            };
        } else {
            sslConfig = process.env.NODE_ENV === 'production' ? {
                rejectUnauthorized: true
            } : {
                rejectUnauthorized: false
            };
        }

        return {
            connectionString: url.toString(),
            ssl: sslConfig,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 20,
            allowExitOnIdle: true
        };
    } catch (error) {
        console.error('❌ Ошибка парсинга DATABASE_URL:', error.message);
        return {
            connectionString: dbUrl,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 20,
            allowExitOnIdle: true
        };
    }
};

const poolConfig = parseDatabaseUrl();
const pool = poolConfig ? new Pool(poolConfig) : null;

// ===================== ФУНКЦИИ ДЛЯ ТЕСТИРОВАНИЯ =====================
async function testConnection() {
    if (!pool) {
        return { success: false, error: 'Пул подключения не инициализирован' };
    }

    let client;
    try {
        console.log('🧪 Тестирование подключения к БД...');
        client = await pool.connect();
        const result = await client.query('SELECT version() as version, NOW() as now, current_database() as db');

        console.log('✅ Подключение успешно:');
        console.log('   База данных:', result.rows[0].db);
        console.log('   Версия PostgreSQL:', result.rows[0].version.split(',')[0]);

        return { success: true, version: result.rows[0].version, time: result.rows[0].now, database: result.rows[0].db };
    } catch (error) {
        console.error('❌ Ошибка подключения к БД:', error.message);
        return { success: false, error: error.message, code: error.code };
    } finally {
        if (client) client.release();
    }
}

async function checkDatabaseConnection() {
    return await testConnection();
}

// ===================== ФУНКЦИИ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ =====================
export async function saveOrUpdateUser(userData) {
    console.log('👤🔄 ========== СОХРАНЕНИЕ ПОЛЬЗОВАТЕЛЯ ==========');

    if (!pool) {
        console.error('❌ saveOrUpdateUser: Пул подключения не инициализирован');
        return null;
    }

    // ✅ Берем только технические данные, персональные НЕ сохраняем
    const { user_id, chat_id = null, city = 'Не указан' } = userData;

    const dbUserId = convertUserIdForDb(user_id);
    if (!dbUserId) {
        console.error('❌ Некорректный user_id:', user_id);
        return null;
    }

    // ✅ Генерируем анонимное имя (НЕ персональные данные)
    const anonymousName = generateAnonymousName(dbUserId);

    console.log(`👤 Сохранение профиля: user_id="${dbUserId}", анонимное имя="${anonymousName}", city="${city}"`);

    const client = await pool.connect();
    try {
        const query = `
            INSERT INTO users (
                user_id, chat_id, username, first_name, city, created_at, last_active
            ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET
                username = COALESCE(EXCLUDED.username, users.username),
                first_name = COALESCE(EXCLUDED.first_name, users.first_name),
                city = COALESCE(EXCLUDED.city, users.city),
                last_active = NOW()
            RETURNING id
        `;

        const values = [
            dbUserId,                    // технический ID (число)
            chat_id,                     // технический ID чата
            anonymousName,               // анонимное имя (НЕ персональные данные)
            anonymousName,               // анонимное имя (НЕ персональные данные)
            city || 'Не указан'          // город (опционально)
        ];

        const result = await client.query(query, values);
        console.log(`✅ Профиль сохранен: ${anonymousName}`);
        return result.rows[0]?.id;

    } catch (error) {
        console.error('❌ Ошибка сохранения профиля:', error.message);
        return null;
    } finally {
        client.release();
    }
}

export async function getUserProfile(userId) {
    console.log(`👤📥 Получение профиля: ${userId}`);

    if (!pool) return null;

    const dbUserId = convertUserIdForDb(userId);
    if (!dbUserId) return null;

    const client = await pool.connect();
    try {
        const query = 'SELECT user_id, city, created_at, last_active FROM users WHERE user_id = $1';
        const result = await client.query(query, [dbUserId]);

        if (result.rows[0]) {
            // ✅ Возвращаем только технические данные, без персональных
            return {
                user_id: result.rows[0].user_id,
                city: result.rows[0].city,
                created_at: result.rows[0].created_at,
                last_active: result.rows[0].last_active
            };
        }
        return null;
    } catch (error) {
        console.error('❌ Ошибка получения профиля:', error.message);
        return null;
    } finally {
        client.release();
    }
}

// ===================== ФУНКЦИИ ДЛЯ ГОРОДОВ =====================
export async function saveUserCity(userId, city, username = null) {
    const dbUserId = convertUserIdForDb(userId);
    if (!dbUserId) {
        return { success: false, error: 'Некорректный ID' };
    }

    console.log(`📍 Сохранение города: ${dbUserId} -> "${city}"`);

    try {
        const result = await saveOrUpdateUser({
            user_id: dbUserId,
            city: city || 'Не указан',
            chat_id: null
        });

        return { success: !!result, user_id: dbUserId, city: city || 'Не указан' };
    } catch (error) {
        console.error('❌ Ошибка saveUserCity:', error.message);
        return { success: false, error: error.message, user_id: dbUserId };
    }
}

export async function getUserCity(userId) {
    const dbUserId = convertUserIdForDb(userId);
    if (!dbUserId) {
        return { success: false, city: 'Не указан', found: false };
    }

    console.log(`📍 Запрос города для: "${dbUserId}"`);

    if (!pool) {
        return { success: false, city: 'Не указан', found: false };
    }

    const client = await pool.connect();
    try {
        const userQuery = 'SELECT city FROM users WHERE user_id = $1';
        const userResult = await client.query(userQuery, [dbUserId]);

        if (userResult.rows[0]?.city && userResult.rows[0].city !== 'Не указан') {
            return { success: true, city: userResult.rows[0].city, found: true };
        }

        return { success: true, city: 'Не указан', found: false };

    } catch (error) {
        console.error('❌ Ошибка получения города:', error.message);
        return { success: false, city: 'Не указан', found: false };
    } finally {
        client.release();
    }
}

// ===================== ФУНКЦИИ ДЛЯ ИГР =====================
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
    console.log('🎮🔄 ========== СОХРАНЕНИЕ ИГРЫ ==========');

    if (!pool) {
        return { success: false, error: 'Нет подключения к БД' };
    }

    const dbUserId = convertUserIdForDb(userId);
    if (!dbUserId) {
        return { success: false, error: 'Некорректный ID' };
    }

    if (parseInt(score) === 0 && isWin) {
        console.log('⚠️ Игра с 0 очков, пропускаем сохранение');
        return { success: false, error: 'Игра с нулевым счетом' };
    }

    // ✅ Генерируем анонимное имя (НЕ персональные данные)
    const anonymousName = generateAnonymousName(dbUserId);
    const client = await pool.connect();

    try {
        let currentCity = 'Не указан';
        const cityResult = await getUserCity(dbUserId);
        if (cityResult.success && cityResult.city !== 'Не указан') {
            currentCity = cityResult.city;
        }

        const gameQuery = `
            INSERT INTO game_scores (
                user_id, username, game_type, score, level, lines, is_win, city, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id
        `;

        const result = await client.query(gameQuery, [
            dbUserId,                    // технический ID (число)
            anonymousName,               // анонимное имя (НЕ персональные данные)
            gameType || 'tetris',
            parseInt(score) || 0,
            parseInt(level) || 1,
            parseInt(lines) || 0,
            isWin,
            currentCity
        ]);

        const savedId = result.rows[0]?.id;
        console.log(`✅ Игра сохранена! ID: ${savedId}, игрок: ${anonymousName}, очки: ${score}`);

        // Удаляем прогресс после сохранения финального результата
        await client.query(
            'DELETE FROM game_progress WHERE user_id = $1 AND game_type = $2',
            [dbUserId, gameType || 'tetris']
        );

        return { success: true, id: savedId, user_id: dbUserId, score: parseInt(score) || 0, username: anonymousName };

    } catch (error) {
        console.error('❌ Ошибка сохранения игры:', error.message);
        return { success: false, error: error.message };
    } finally {
        client.release();
    }
}

export async function saveGameProgress(userId, gameType, score, level, lines, username = null) {
    console.log('💾🔄 ========== СОХРАНЕНИЕ ПРОГРЕССА ==========');

    if (!pool) {
        return { success: false, error: 'Нет подключения к БД' };
    }

    const dbUserId = convertUserIdForDb(userId);
    if (!dbUserId) {
        return { success: false, error: 'Некорректный ID' };
    }

    const client = await pool.connect();

    try {
        const query = `
            INSERT INTO game_progress (user_id, game_type, score, level, lines, last_saved)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (user_id, game_type)
            DO UPDATE SET
                score = EXCLUDED.score,
                level = EXCLUDED.level,
                lines = EXCLUDED.lines,
                last_saved = NOW()
            RETURNING user_id
        `;

        const result = await client.query(query, [
            dbUserId,
            gameType || 'tetris',
            parseInt(score) || 0,
            parseInt(level) || 1,
            parseInt(lines) || 0
        ]);

        console.log(`✅ Прогресс сохранен для пользователя ${dbUserId}`);
        return { success: true, user_id: result.rows[0]?.user_id };

    } catch (error) {
        console.error('❌ Ошибка сохранения прогресса:', error.message);
        return { success: false, error: error.message };
    } finally {
        client.release();
    }
}

export async function getGameProgress(userId, gameType = 'tetris') {
    if (!pool) return { success: false, found: false };

    const dbUserId = convertUserIdForDb(userId);
    if (!dbUserId) return { success: false, found: false };

    const client = await pool.connect();

    try {
        const query = `
            SELECT score, level, lines, last_saved
            FROM game_progress
            WHERE user_id = $1 AND game_type = $2
        `;

        const result = await client.query(query, [dbUserId, gameType]);

        if (result.rows[0]) {
            const progress = result.rows[0];
            return {
                success: true,
                found: true,
                progress: {
                    score: parseInt(progress.score) || 0,
                    level: parseInt(progress.level) || 1,
                    lines: parseInt(progress.lines) || 0,
                    last_saved: progress.last_saved
                }
            };
        }

        return { success: true, found: false, progress: null };

    } catch (error) {
        console.error('❌ Ошибка получения прогресса:', error.message);
        return { success: false, found: false };
    } finally {
        client.release();
    }
}

export async function deleteGameProgress(userId, gameType = 'tetris') {
    if (!pool) return { success: false };

    const dbUserId = convertUserIdForDb(userId);
    if (!dbUserId) return { success: false };

    const client = await pool.connect();

    try {
        await client.query(
            'DELETE FROM game_progress WHERE user_id = $1 AND game_type = $2',
            [dbUserId, gameType]
        );
        return { success: true };
    } catch (error) {
        console.error('❌ Ошибка удаления прогресса:', error.message);
        return { success: false };
    } finally {
        client.release();
    }
}

export async function getGameStats(userId, gameType = 'tetris') {
    console.log('📊🔄 ========== ПОЛУЧЕНИЕ СТАТИСТИКИ ==========');

    if (!pool) return { success: false, stats: null };

    const dbUserId = convertUserIdForDb(userId);
    if (!dbUserId) return { success: false, stats: null };

    const client = await pool.connect();

    try {
        const statsQuery = `
            SELECT
                COUNT(*) as games_played,
                COUNT(CASE WHEN is_win THEN 1 END) as wins,
                COUNT(CASE WHEN NOT is_win THEN 1 END) as losses,
                COALESCE(MAX(score), 0) as best_score,
                COALESCE(AVG(score), 0) as avg_score,
                COALESCE(MAX(level), 1) as best_level,
                COALESCE(MAX(lines), 0) as best_lines,
                COALESCE(SUM(score), 0) as total_score,
                MIN(created_at) as first_played,
                MAX(created_at) as last_played
            FROM game_scores
            WHERE user_id = $1 AND game_type = $2 AND score > 0
        `;

        const statsResult = await client.query(statsQuery, [dbUserId, gameType]);
        const rawStats = statsResult.rows[0] || {};

        // Получаем анонимное имя из последней игры
        let anonymousName = generateAnonymousName(dbUserId);
        try {
            const nameQuery = `
                SELECT username FROM game_scores
                WHERE user_id = $1 AND game_type = $2 AND username IS NOT NULL
                ORDER BY created_at DESC LIMIT 1
            `;
            const nameResult = await client.query(nameQuery, [dbUserId, gameType]);
            if (nameResult.rows[0]?.username) {
                anonymousName = nameResult.rows[0].username;
            }
        } catch (e) {}

        const progressQuery = `
            SELECT score, level, lines, last_saved
            FROM game_progress
            WHERE user_id = $1 AND game_type = $2
        `;

        const progressResult = await client.query(progressQuery, [dbUserId, gameType]);

        let city = 'Не указан';
        const cityResult = await getUserCity(dbUserId);
        if (cityResult.success && cityResult.city !== 'Не указан') {
            city = cityResult.city;
        }

        const gamesPlayed = parseInt(rawStats.games_played) || 0;

        const stats = {
            games_played: gamesPlayed,
            wins: parseInt(rawStats.wins) || 0,
            losses: parseInt(rawStats.losses) || 0,
            win_rate: gamesPlayed > 0 ? Math.round((parseInt(rawStats.wins) || 0) / gamesPlayed * 100) : 0,
            best_score: parseInt(rawStats.best_score) || 0,
            avg_score: Math.round(parseFloat(rawStats.avg_score) || 0),
            best_level: parseInt(rawStats.best_level) || 1,
            best_lines: parseInt(rawStats.best_lines) || 0,
            total_score: parseInt(rawStats.total_score) || 0,
            first_played: rawStats.first_played,
            last_played: rawStats.last_played,
            username: anonymousName,           // анонимное имя (НЕ персональные данные)
            current_progress: progressResult.rows[0] ? {
                score: parseInt(progressResult.rows[0].score) || 0,
                level: parseInt(progressResult.rows[0].level) || 1,
                lines: parseInt(progressResult.rows[0].lines) || 0,
                last_saved: progressResult.rows[0].last_saved
            } : null,
            has_unfinished_game: progressResult.rows.length > 0,
            has_any_games: gamesPlayed > 0 || progressResult.rows.length > 0,
            has_completed_games: gamesPlayed > 0,
            city: city,
            user_id: dbUserId
        };

        return { success: true, stats: stats };

    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error.message);
        return { success: false, stats: null };
    } finally {
        client.release();
    }
}

// ===================== ФУНКЦИИ ДЛЯ ТОПА ИГРОКОВ =====================
export async function getTopPlayers(gameType = 'tetris', limit = 10) {
    console.log(`🏆 getTopPlayers: gameType=${gameType}, limit=${limit}`);

    if (!pool) {
        console.error('❌ Нет подключения к БД');
        return { success: false, players: [] };
    }

    const client = await pool.connect();

    try {
        const query = `
            SELECT DISTINCT ON (gs.user_id)
                gs.user_id,
                gs.username as display_name,
                COALESCE(u.city, gs.city, 'Не указан') as city,
                MAX(gs.score) OVER (PARTITION BY gs.user_id) as best_score,
                COUNT(*) OVER (PARTITION BY gs.user_id) as games_played,
                MAX(gs.level) OVER (PARTITION BY gs.user_id) as best_level,
                MAX(gs.lines) OVER (PARTITION BY gs.user_id) as best_lines
            FROM game_scores gs
            LEFT JOIN users u ON gs.user_id = u.user_id
            WHERE gs.game_type = $1
                AND gs.score > 0
                AND gs.is_win = true
                AND gs.user_id NOT LIKE 'test_%'
                AND gs.user_id NOT LIKE 'web_%'
                AND gs.user_id ~ '^[0-9]+$'
            ORDER BY gs.user_id, gs.score DESC
        `;

        const result = await client.query(query, [gameType]);

        // Фильтруем только игроков с 1000+ очков
        const filteredRows = result.rows.filter(row => parseInt(row.best_score) >= 1000);

        // Убираем дубликаты
        const uniqueMap = new Map();
        filteredRows.forEach(row => {
            const existing = uniqueMap.get(row.user_id);
            const currentScore = parseInt(row.best_score) || 0;

            if (!existing || currentScore > (parseInt(existing.best_score) || 0)) {
                uniqueMap.set(row.user_id, {
                    user_id: row.user_id,
                    display_name: row.display_name || generateAnonymousName(row.user_id),
                    username: row.display_name || generateAnonymousName(row.user_id),
                    city: row.city || 'Не указан',
                    best_score: currentScore,
                    best_level: parseInt(row.best_level) || 1,
                    best_lines: parseInt(row.best_lines) || 0,
                    games_played: parseInt(row.games_played) || 1
                });
            }
        });

        // Сортируем по очкам
        const uniquePlayers = Array.from(uniqueMap.values())
            .sort((a, b) => b.best_score - a.best_score)
            .slice(0, limit)
            .map((player, index) => ({
                ...player,
                rank: index + 1
            }));

        console.log(`🏆 Топ игроков: ${uniquePlayers.length} игроков с 1000+ очков`);
        if (uniquePlayers[0]) {
            console.log(`🥇 1 место: ${uniquePlayers[0].display_name} - ${uniquePlayers[0].best_score} очков`);
        }

        return { success: true, players: uniquePlayers, count: uniquePlayers.length };

    } catch (error) {
        console.error('❌ Ошибка топа:', error.message);
        return { success: false, players: [] };
    } finally {
        client.release();
    }
}

export async function getTopPlayersWithCities(limit = 10) {
    const result = await getTopPlayers('tetris', limit);
    return result.success ? result.players : [];
}

// ===================== ФУНКЦИИ ДЛЯ ДИАГНОСТИКИ =====================
export async function debugDatabase() {
    try {
        const connection = await testConnection();
        if (!connection.success) {
            return { success: false, error: connection.error };
        }

        const client = await pool.connect();
        try {
            const tablesInfo = await client.query(`
                SELECT
                    table_name,
                    (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = t.table_name) as columns_count,
                    (xpath('/row/cnt/text()',
                        query_to_xml(format('SELECT COUNT(*) as cnt FROM %I', table_name),
                        false, true, '')))[1]::text::int as rows_count
                FROM information_schema.tables t
                WHERE table_schema = 'public'
                ORDER BY table_name
            `);

            return { success: true, connection, tables: tablesInfo.rows };
        } finally {
            client.release();
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ===================== ИНИЦИАЛИЗАЦИЯ =====================
if (process.env.DATABASE_URL) {
    console.log('📊 Инициализация базы данных...');
    console.log('☁️ Анонимная система включена');
    console.log('🔒 Персональные данные НЕ сохраняются');
    setTimeout(() => {
        const createTables = async () => {
            const client = await pool?.connect();
            if (!client) return;
            try {
                await client.query(`
                    CREATE TABLE IF NOT EXISTS users (
                        id SERIAL PRIMARY KEY,
                        user_id VARCHAR(50) UNIQUE NOT NULL,
                        chat_id BIGINT,
                        username VARCHAR(255),
                        first_name VARCHAR(255),
                        city VARCHAR(100) DEFAULT 'Не указан',
                        created_at TIMESTAMP DEFAULT NOW(),
                        last_active TIMESTAMP DEFAULT NOW(),
                        stickers_created INTEGER DEFAULT 0,
                        premium_level INTEGER DEFAULT 0
                    )
                `);

                await client.query(`
                    CREATE TABLE IF NOT EXISTS game_scores (
                        id SERIAL PRIMARY KEY,
                        user_id VARCHAR(50) NOT NULL,
                        game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
                        score INTEGER NOT NULL DEFAULT 0,
                        level INTEGER NOT NULL DEFAULT 1,
                        lines INTEGER NOT NULL DEFAULT 0,
                        is_win BOOLEAN DEFAULT TRUE,
                        username VARCHAR(100),
                        city VARCHAR(100) DEFAULT 'Не указан',
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    )
                `);

                await client.query(`
                    CREATE TABLE IF NOT EXISTS game_progress (
                        user_id VARCHAR(50) NOT NULL,
                        game_type VARCHAR(50) NOT NULL DEFAULT 'tetris',
                        score INTEGER DEFAULT 0,
                        level INTEGER DEFAULT 1,
                        lines INTEGER DEFAULT 0,
                        last_saved TIMESTAMP DEFAULT NOW(),
                        PRIMARY KEY (user_id, game_type)
                    )
                `);

                console.log('✅ Таблицы созданы/проверены');
            } catch (error) {
                console.error('❌ Ошибка создания таблиц:', error.message);
            } finally {
                client.release();
            }
        };

        createTables().catch(console.error);
    }, 1500);
}

// ===================== ЭКСПОРТ =====================
export {
    pool,
    testConnection,
    checkDatabaseConnection,
    convertUserIdForDb,
    generateAnonymousName
};