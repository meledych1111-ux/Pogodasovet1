import { pool, generateAnonymousName } from './db.js';
import crypto from 'crypto';

function hashPin(pin, salt) {
    return crypto.createHash('sha256').update(pin + salt).digest('hex');
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { login, pin, tgId, city: providedCity } = req.body;

    if (!login || !pin || pin.length !== 4) {
        return res.status(400).json({ success: false, error: 'Неверный логин или PIN' });
    }

    const client = await pool.connect();

    try {
        // 1. ПРОВЕРЯЕМ, ЕСТЬ ЛИ ТАКОЙ ЛОГИН В ТАБЛИЦЕ АУТЕНТИФИКАЦИИ
        const authResult = await client.query('SELECT pin_hash, salt FROM game_auth WHERE login = $1', [login]);

        if (authResult.rows.length > 0) {
            // ЛОГИН СУЩЕСТВУЕТ - ПРОВЕРЯЕМ ПИН
            const { pin_hash, salt } = authResult.rows[0];
            const checkHash = hashPin(pin, salt);
            if (checkHash !== pin_hash) return res.status(401).json({ success: false, error: 'Неверный PIN-код' });
            
            // Если зашел под анонимным именем, но передал tgId, проверим/обновим связь
            if (tgId) {
                // Пытаемся найти пользователя по tgId
                const userCheck = await client.query('SELECT user_id FROM users WHERE user_id = $1', [String(tgId)]);
                if (userCheck.rows.length > 0) {
                    // Пользователь с таким ID уже есть, значит анонимное имя должно принадлежать ЕМУ.
                    // В данном случае мы просто разрешаем вход.
                }
            }

            return res.json({ success: true, isNew: false, login });
        } else {
            // НОВЫЙ ЛОГИН - РЕГИСТРАЦИЯ
            const salt = crypto.randomBytes(16).toString('hex');
            const pinHash = hashPin(pin, salt);

            let finalCity = providedCity || 'Не указан';
            let targetUserId = login; // По умолчанию ID = логину (анонимному имени)

            // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ ДУБЛЕЙ:
            // Если передан tgId (числовой ID из бота), мы должны использовать ЕГО как основной ключ в таблице users.
            if (tgId) {
                targetUserId = String(tgId);
                // Проверяем, есть ли уже такой пользователь в users (созданный ботом)
                const existingUser = await client.query('SELECT city FROM users WHERE user_id = $1', [targetUserId]);
                if (existingUser.rows.length > 0) {
                    // Город берем из существующего профиля, если он там есть
                    if (existingUser.rows[0].city !== 'Не указан') finalCity = existingUser.rows[0].city;
                }
            }

            // Создаем или обновляем запись в users по targetUserId (числовой ID или логин)
            await client.query(
                `INSERT INTO users (user_id, city, last_active) 
                 VALUES ($1, $2, NOW()) 
                 ON CONFLICT (user_id) DO UPDATE SET last_active = NOW()`,
                [targetUserId, finalCity]
            );

            // Сохраняем данные авторизации (логин -> хеш пина)
            // Здесь login — это "☁️ Облачко 42"
            await client.query(
                'INSERT INTO game_auth (login, pin_hash, salt) VALUES ($1, $2, $3)',
                [login, pinHash, salt]
            );

            return res.json({ success: true, isNew: true, login });
        }
    } catch (error) {
        console.error('Auth error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
    } finally {
        client.release();
    }
}
