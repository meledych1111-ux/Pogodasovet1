import { pool } from './db.js';
import crypto from 'crypto';

function generateAuthHash(name) {
    const secret = process.env.BOT_TOKEN || 'fallback_secret';
    return crypto.createHash('sha256').update(name + secret).digest('hex').substring(0, 16);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { login, pin, hash, city } = req.body;

    // ПРОВЕРКА 1: Вход по секретному хэшу из Telegram (БЕЗ ПИН-КОДА)
    if (login && hash) {
        const expectedHash = generateAuthHash(login);
        if (hash === expectedHash) {
            // Если всё совпало, гарантируем, что пользователь есть в таблице users
            try {
                await pool.query(
                    'INSERT INTO users (user_id, city, last_active) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET last_active = NOW()',
                    [login, city || 'Не указан']
                );
                return res.json({ success: true, isNew: false, login });
            } catch (e) {
                console.error('DB Error in hash auth:', e);
            }
        }
    }

    // ПРОВЕРКА 2: Обычный вход по ПИН-коду (если зашли не из бота)
    if (!login || !pin || pin.length !== 4) {
        return res.status(400).json({ success: false, error: 'Неверные данные' });
    }

    const client = await pool.connect();
    try {
        const authResult = await client.query('SELECT pin_hash, salt FROM game_auth WHERE login = $1', [login]);
        
        if (authResult.rows.length > 0) {
            const { pin_hash, salt } = authResult.rows[0];
            const checkHash = crypto.createHash('sha256').update(pin + salt).digest('hex');
            if (checkHash !== pin_hash) return res.status(401).json({ success: false, error: 'Неверный PIN' });
            return res.json({ success: true, login });
        } else {
            // Регистрация нового ПИН-кода (только если зашли вручную)
            const salt = crypto.randomBytes(16).toString('hex');
            const pinHash = crypto.createHash('sha256').update(pin + salt).digest('hex');
            
            await client.query('INSERT INTO users (user_id, city) VALUES ($1, $2) ON CONFLICT DO NOTHING', [login, city || 'Не указан']);
            await client.query('INSERT INTO game_auth (login, pin_hash, salt) VALUES ($1, $2, $3)', [login, pinHash, salt]);
            
            return res.json({ success: true, isNew: true, login });
        }
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Ошибка БД' });
    } finally {
        client.release();
    }
}
