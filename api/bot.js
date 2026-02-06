import fetch from 'node-fetch';

export async function getWeatherData(cityName) {
  try {
    // 1. Геокодирование: находим координаты города
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ru`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();

    if (!geoData.results || geoData.results.length === 0) {
      throw new Error(`Город "${cityName}" не найден.`);
    }

    const { latitude, longitude, name } = geoData.results[0];

    // 2. Запрос погоды по координатам [citation:2][citation:5]
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&wind_speed_unit=ms&timezone=auto`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();

    if (!weatherData.current) {
      throw new Error('Нет данных о текущей погоде.');
    }

    const current = weatherData.current;

    // Преобразуем числовой код погоды в понятное описание [citation:5]
    const weatherDescription = getWeatherDescription(current.weather_code);

    return {
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m.toFixed(1),
      precipitation: current.precipitation,
      description: weatherDescription,
      city: name
    };

  } catch (error) {
    console.error('Ошибка в модуле погоды:', error.message);
    // Возвращаем понятные данные по умолчанию в случае ошибки
    return {
      temp: 15,
      feels_like: 14,
      humidity: 65,
      wind: '3.2',
      precipitation: 0,
      description: 'Облачно',
      city: cityName,
      isFallback: true // Флаг, что это данные по умолчанию
    };
  }
}

function getWeatherDescription(code) {
  // Преобразует код погоды от Open-Meteo в текст
  const weatherMap = {
    0: 'Ясно ☀️', 1: 'В основном ясно 🌤️',
    2: 'Переменная облачность ⛅', 3: 'Пасмурно ☁️',
    45: 'Туман 🌫️', 48: 'Изморозь 🌫️',
    51: 'Лежащая морось 🌧️', 53: 'Умеренная морось 🌧️',
    55: 'Сильная морось 🌧️', 56: 'Ледяная морось',
    57: 'Сильная ледяная морось', 61: 'Небольшой дождь 🌧️',
    63: 'Умеренный дождь 🌧️', 65: 'Сильный дождь 🌧️',
    66: 'Ледяной дождь', 67: 'Сильный ледяной дождь',
    71: 'Небольшой снегопад ❄️', 73: 'Умеренный снегопад ❄️',
    75: 'Сильный снегопад ❄️', 77: 'Снежные зерна',
    80: 'Небольшие ливни 🌦️', 81: 'Умеренные ливни 🌦️',
    82: 'Сильные ливни 🌦️', 85: 'Небольшие снежные ливни',
    86: 'Сильные снежные ливни', 95: 'Гроза ⛈️',
    96: 'Гроза с небольшим градом', 99: 'Гроза с сильным градом'
  };
  return weatherMap[code] || 'Данные обновляются';
}
