import fetch from 'node-fetch';

export async function getWeatherData(cityName) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();
    
    if (!geoData.results || geoData.results.length === 0) {
      throw new Error('Город не найден');
    }
    
    const { latitude, longitude, name } = geoData.results[0];
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    return {
      temp: Math.round(weatherData.current.temperature_2m),
      feels_like: Math.round(weatherData.current.apparent_temperature),
      humidity: weatherData.current.relative_humidity_2m,
      wind: weatherData.current.wind_speed_10m.toFixed(1),
      precipitation: weatherData.current.precipitation + ' мм',
      description: 'Погодные данные',
      city: name
    };
  } catch (error) {
    console.error('Ошибка погоды:', error);
    return {
      temp: 15,
      feels_like: 14,
      humidity: 65,
      wind: '3.2',
      precipitation: '0 мм',
      description: 'Облачно',
      city: cityName,
      isFallback: true
    };
  }
}
