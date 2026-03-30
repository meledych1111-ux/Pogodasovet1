import { getOrRegisterPin, pool } from './db.js';

// Простейшая защита от спама (в памяти сервера)
const loginAttempts = new Map();

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    
    // Защита от перебора: 5 попыток в 15 минут для одного IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || [];
    const recentAttempts = attempts.filter(time => now - time < 15 * 60 * 1000);
    
    if (recentAttempts.length >= 5) {
        return res.status(429).json({ success: false, error: 'Слишком много попыток. Подождите 15 минут.' });
    }
    loginAttempts.set(ip, [...recentAttempts, now]);

    try {
        const { pin, city } = req.body;

        if (!pin) {
            return res.status(400).json({ success: false, error: 'Введите ПИН-код' });
        }

        const { cloudName } = await getOrRegisterPin(pin);

        if (city && city !== 'Не указан') {
            await pool.query(
                `INSERT INTO users_cloud (cloud_name, city, last_active) 
                 VALUES ($1, $2, NOW()) 
                 ON CONFLICT (cloud_name) DO UPDATE SET city = $2, last_active = NOW()`,
                [cloudName, city]
            );
        } else {
            await pool.query(
                `INSERT INTO users_cloud (cloud_name, city, last_active) 
                 VALUES ($1, 'Не указан', NOW()) 
                 ON CONFLICT (cloud_name) DO UPDATE SET last_active = NOW()`,
                [cloudName]
            );
        }

        return res.json({ success: true, login: cloudName, pin: pin });

    } catch (error) {
        console.error('❌ Auth Error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
}
