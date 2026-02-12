// server.js - просто скопируйте и вставьте!
app.get('/api/user-all-games', async (req, res) => {
    const { telegramId, gameType } = req.query;
    
    try {
        const query = `
            SELECT score, lines 
            FROM scores 
            WHERE telegram_id = $1 AND game_type = $2 
            ORDER BY created_at DESC
        `;
        
        const result = await pool.query(query, [telegramId, gameType]);
        
        res.json({
            success: true,
            games: result.rows  // ✅ ВСЕ ИГРЫ ИЗ БАЗЫ!
        });
    } catch (error) {
        res.json({ success: false, games: [] });
    }
});
