// ===================== ФУНКЦИИ ПОГОДЫ С ПРАВИЛЬНЫМИ ОСАДКАМИ =====================
async function getWeatherData(cityName) {
    console.log(`🌤️ Запрашиваю погоду для: "${cityName}"`);
    
    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        console.log(`📍 Geo URL: ${geoUrl}`);
        
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        console.log('📍 Geo ответ:', JSON.stringify(geoData).slice(0, 200));
        
        if (!geoData.results || geoData.results.length === 0) {
            console.error('📍 Город не найден');
            throw new Error('Город не найден');
        }
        
        const { latitude, longitude, name, country, admin1 } = geoData.results[0];
        const fullCityName = admin1 ? `${name}, ${admin1}` : `${name}, ${country}`;
        console.log(`📍 Координаты: ${latitude}, ${longitude} (${fullCityName})`);
        
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
        console.log(`🌤️ Weather URL: ${weatherUrl}`);
        
        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();
        
        console.log('🌤️ Полный Weather ответ:', JSON.stringify(weatherData).slice(0, 500));
        console.log('🌤️ Текущая погода:', weatherData.current);
        
        if (!weatherData.current) {
            console.error('🌤️ Нет данных о погоде');
            throw new Error('Нет данных о погоде');
        }
        
        const current = weatherData.current;
        const precipitationValue = current.precipitation || 0;
        
        console.log('🌧️ Осадки raw:', precipitationValue, 'тип:', typeof precipitationValue);
        
        return {
            temp: Math.round(current.temperature_2m),
            feels_like: Math.round(current.apparent_temperature),
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m.toFixed(1),
            precipitation: precipitationValue, // Оставляем как число
            precipitation_display: precipitationValue.toFixed(1) + ' мм/ч', // Для отображения
            description: getWeatherDescription(current.weather_code),
            city: fullCityName,
            raw_data: current // Для отладки
        };
        
    } catch (error) {
        console.error('❌ Ошибка получения погоды:', error.message);
        return {
            temp: 20,
            feels_like: 19,
            humidity: 65,
            wind: '3.0',
            precipitation: 0,
            precipitation_display: '0.0 мм/ч',
            description: 'Ясно ☀️',
            city: cityName,
            is_fallback: true
        };
    }
}

async function getTomorrowWeather(cityName) {
    console.log(`📅 Запрашиваю прогноз на завтра для: "${cityName}"`);
    
    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        console.log('📍 Geo ответ для прогноза:', JSON.stringify(geoData).slice(0, 200));
        
        if (!geoData.results || geoData.results.length === 0) {
            throw new Error('Город не найден');
        }
        
        const { latitude, longitude, name } = geoData.results[0];
        
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=2`;
        console.log(`📅 Forecast URL: ${forecastUrl}`);
        
        const forecastResponse = await fetch(forecastUrl);
        const forecastData = await forecastResponse.json();
        
        console.log('📅 Полный Forecast ответ:', JSON.stringify(forecastData.daily).slice(0, 500));
        
        if (!forecastData.daily || forecastData.daily.time.length < 2) {
            console.error('📅 Нет данных прогноза');
            throw new Error('Нет данных прогноза');
        }
        
        const tomorrowCode = forecastData.daily.weather_code?.[1];
        const precipitationValue = forecastData.daily.precipitation_sum?.[1] || 0;
        
        console.log('📅 Данные на завтра:', {
            temp_max: forecastData.daily.temperature_2m_max?.[1],
            temp_min: forecastData.daily.temperature_2m_min?.[1],
            precipitation: precipitationValue,
            weather_code: tomorrowCode
        });
        
        return {
            city: name,
            temp_max: Math.round(forecastData.daily.temperature_2m_max[1]),
            temp_min: Math.round(forecastData.daily.temperature_2m_min[1]),
            precipitation: precipitationValue,
            precipitation_display: precipitationValue.toFixed(1) + ' мм',
            description: getWeatherDescription(tomorrowCode),
            rawCode: tomorrowCode
        };
        
    } catch (error) {
        console.error('❌ Ошибка прогноза:', error.message);
        return {
            city: cityName,
            temp_max: 24,
            temp_min: 18,
            precipitation: 0.5,
            precipitation_display: '0.5 мм',
            description: 'Переменная облачность ⛅',
            isFallback: true
        };
    }
}
