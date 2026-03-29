import { pool } from './db.js';
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

    const { login, pin, telegramId, city: providedCity } = req.body;

    if (!login || !pin || pin.length !== 4) {
        return res.status(400).json({ success: false, error: 'Неверный логин или PIN' });
    }

    const client = await pool.connect();

    try {
        const authResult = await client.query('SELECT pin_hash, salt FROM game_auth WHERE login = $1', [login]);

        if (authResult.rows.length > 0) {
            const { pin_hash, salt } = authResult.rows[0];
            const checkHash = hashPin(pin, salt);
            if (checkHash !== pin_hash) return res.status(401).json({ success: false, error: 'Неверный PIN-код' });
            return res.json({ success: true, isNew: false, login });
        } else {
            const salt = crypto.randomBytes(16).toString('hex');
            const pinHash = hashPin(pin, salt);

            // ПРИОРМТЕТ: 1. Город из запроса (от бота) 2. Поиск по ID 3. Не указан
            let finalCity = providedCity || 'Не указан';
            if (finalCity === 'Не указан' && telegramId) {
                const tgUser = await client.query('SELECT city FROM users WHERE user_id = $1', [String(telegramId)]);
                if (tgUser.rows.length > 0) finalCity = tgUser.rows[0].city;
            }

            await client.query(
                'INSERT INTO users (user_id, city, last_active) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET city = EXCLUDED.city',
                [login, finalCity]
            );

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
