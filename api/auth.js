import { getOrRegisterPin, pool } from './db.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    
    try {
        const { pin, city } = req.body;

        if (!pin) {
            return res.status(400).json({ success: false, error: 'Введите ПИН-код' });
        }

        // Получаем имя по ПИНу
        const { cloudName } = await getOrRegisterPin(pin);

        // Если город передан (например, из бота), сохраняем его. 
        // Если НЕТ (просто вход по ПИНу), ничего не трогаем в таблице городов.
        if (city && city !== 'Не указан') {
            await pool.query(
                `INSERT INTO users_cloud (cloud_name, city, last_active) 
                 VALUES ($1, $2, NOW()) 
                 ON CONFLICT (cloud_name) DO UPDATE SET city = $2, last_active = NOW()`,
                [cloudName, city]
            );
        } else {
            // Просто обновляем время активности
            await pool.query(
                `INSERT INTO users_cloud (cloud_name, city, last_active) 
                 VALUES ($1, 'Не указан', NOW()) 
                 ON CONFLICT (cloud_name) DO UPDATE SET last_active = NOW()`,
                [cloudName]
            );
        }

        return res.json({ 
            success: true, 
            login: cloudName,
            pin: pin
        });

    } catch (error) {
        console.error('❌ Auth Error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сервера при входе' });
    }
}
