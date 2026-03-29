import { pool } from '../db.js';
import crypto from 'crypto';

function hashPin(pin, salt) {
    return crypto.createHash('sha256').update(pin + salt).digest('hex');
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { login, pin, city, action } = req.body;

    if (!login || !pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
        return res.status(400).json({ success: false, error: 'Неверный логин или PIN (PIN должен быть 4 цифры)' });
    }

    const client = await pool.connect();

    try {
        const existing = await client.query('SELECT user_id FROM users WHERE user_id = $1', [login]);

        if (existing.rows.length > 0) {
            const authResult = await client.query('SELECT pin_hash, salt FROM game_auth WHERE login = $1', [login]);

            if (authResult.rows.length === 0) {
                return res.status(401).json({ success: false, error: 'Аккаунт существует, но данные аутентификации не найдены' });
            }

            const { pin_hash, salt } = authResult.rows[0];
            const pinHash = hashPin(pin, salt);

            if (pinHash !== pin_hash) {
                return res.status(401).json({ success: false, error: 'Неверный PIN-код' });
            }

            await client.query(
                'UPDATE users SET city = $1, last_active = NOW() WHERE user_id = $2',
                [city || 'Не указан', login]
            );

            await client.query('UPDATE game_auth SET last_login = NOW() WHERE login = $1', [login]);

            return res.json({ success: true, isNew: false, login });
        } else {
            const salt = crypto.randomBytes(16).toString('hex');
            const pinHash = hashPin(pin, salt);

            await client.query(
                `INSERT INTO users (user_id, city, created_at, last_active)
                 VALUES ($1, $2, NOW(), NOW())`,
                [login, city || 'Не указан']
            );

            await client.query(
                `INSERT INTO game_auth (login, pin_hash, salt, created_at)
                 VALUES ($1, $2, $3, NOW())`,
                [login, pinHash, salt]
            );

            return res.json({ success: true, isNew: true, login });
        }

    } catch (error) {
        console.error('Auth error:', error);
        if (error.code === '23505') {
            return res.status(409).json({ success: false, error: 'Логин уже занят' });
        }
        return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
    } finally {
        client.release();
    }
}