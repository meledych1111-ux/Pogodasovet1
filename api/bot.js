import fetch from 'node-fetch';

const WEATHER_API_KEY = process.env.WEATHER_API_KEY || 'ваш_ключ';

export async function getWeatherData(city) {
  try {
    // Используем OpenWeatherMap API
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`
    );
    
    if (!response.ok) {
      throw new Error('Город не найден');
    }
    
    const data = await response.json();
    
    return {
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      wind: data.wind.speed,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      precipitation: getPrecipitation(data),
      city: data.name
    };
  } catch (error) {
    console.error('Weather API error:', error);
    return getMockWeatherData(city);
  }
}

function getPrecipitation(data) {
  if (data.rain) {
    return `Дождь: ${data.rain['1h'] || 0} мм`;
  }
  if (data.snow) {
    return `Снег: ${data.snow['1h'] || 0} мм`;
  }
  return 'Без осадков';
}

function getMockWeatherData(city) {
  // Заглушка на случай ошибки API
  return {
    temp: 15,
    feels_like: 14,
    humidity: 65,
    wind: 3.2,
    description: 'Облачно',
    icon: '04d',
    precipitation: 'Лёгкий дождь',
    city: city
  };
}

export function getWeatherIcon(iconCode) {
  const icons = {
    '01d': '☀️', '01n': '🌙',
    '02d': '⛅', '02n': '☁️',
    '03d': '☁️', '03n': '☁️',
    '04d': '☁️', '04n': '☁️',
    '09d': '🌧️', '09n': '🌧️',
    '10d': '🌦️', '10n': '🌧️',
    '11d': '⛈️', '11n': '⛈️',
    '13d': '❄️', '13n': '❄️',
    '50d': '🌫️', '50n': '🌫️'
  };
  return icons[iconCode] || '🌡️';
}
