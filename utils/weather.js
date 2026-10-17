// utils/weather.js
const axios = require('axios');
const config = require('../config');
const assessment = require('./riskAssessment');
const CACHE_TTL_MS = 10 * 60 * 1000;
const reportCache = new Map();
const inFlight = new Map();

const DEFAULT_LOCATION = {
  name: 'Bangkok',
  latitude: 13.7563,
  longitude: 100.5018
};

function normalizeLocation(location = {}) {
  const source = location || {};
  const latitude = toNumber(source.latitude ?? source.lat);
  const longitude = toNumber(source.longitude ?? source.lon ?? source.lng);
  const hasValidCoordinates = (
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
  const hasAnyCoordinate = latitude !== null || longitude !== null;
  const fallbackName = hasAnyCoordinate ? 'ตำแหน่งที่ส่งมา' : DEFAULT_LOCATION.name;
  const rawName = source.name || source.title || source.address || fallbackName;
  const name = String(rawName || fallbackName).trim() || fallbackName;

  return {
    name: hasValidCoordinates ? name : DEFAULT_LOCATION.name,
    latitude: hasValidCoordinates ? latitude : DEFAULT_LOCATION.latitude,
    longitude: hasValidCoordinates ? longitude : DEFAULT_LOCATION.longitude,
    isDefault: !hasValidCoordinates
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 1) {
  const number = toNumber(value);
  if (number === null) {
    return null;
  }

  const multiplier = 10 ** digits;
  return Math.round(number * multiplier) / multiplier;
}

function getRainMm1h(data) {
  return toNumber(data && data.rain && data.rain['1h']) || 0;
}

function getRainChancePercent(forecastData) {
  const list = Array.isArray(forecastData && forecastData.list) ? forecastData.list : [];
  const next12Hours = list.slice(0, 4);
  const maxPop = next12Hours.reduce((max, item) => Math.max(max, toNumber(item.pop) || 0), 0);

  return Math.round(maxPop * 100);
}

function getNextRainForecast(forecastData) {
  const list = Array.isArray(forecastData && forecastData.list) ? forecastData.list : [];
  const now = Date.now();
  const nextRain = list.find(item => {
    const pop = toNumber(item.pop) || 0;
    const rainMm = toNumber(item.rain && item.rain['3h']) || 0;
    return pop >= 0.3 || rainMm > 0;
  });

  if (!nextRain) {
    return {
      nextRainAt: null,
      nextRainInHours: null,
      nextRainChance: null,
      nextRainMm3h: null
    };
  }

  const nextRainAt = nextRain.dt ? new Date(nextRain.dt * 1000) : null;
  const nextRainInHours = nextRainAt ? Math.max(0, (nextRainAt.getTime() - now) / (60 * 60 * 1000)) : null;

  return {
    nextRainAt,
    nextRainInHours: nextRainInHours === null ? null : Math.round(nextRainInHours * 10) / 10,
    nextRainChance: Math.round((toNumber(nextRain.pop) || 0) * 100),
    nextRainMm3h: toNumber(nextRain.rain && nextRain.rain['3h']) || 0
  };
}

async function getOptionalData(url, required = false, options = {}) {
  try {
    const { onResponse, ...requestOptions } = options;
    const res = await axios.get(url, {
      timeout: 6000, signal: AbortSignal.timeout(6500), ...requestOptions
    });
    if (onResponse) onResponse(res);
    return res.data;
  } catch (err) {
    const code = err.response ? `HTTP_${err.response.status}` : (err.code || 'REQUEST_FAILED');
    // Never log a URL or axios error object: OpenWeather URLs contain API keys.
    console.warn(`SmartLife weather source error: ${code}`);
    if (required) throw Object.assign(new Error('Weather source unavailable'), { code });
    return null;
  }
}

function parseBangkokApiTime(value) {
  if (!value) {
    return null;
  }

  const text = String(value);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const withSeconds = text.length === 16 ? `${text}:00` : text;
  const date = new Date(`${withSeconds}+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildAssessedReport(raw) {
  const heatIndex = raw.temp === null || raw.humidity === null ? null : assessment.calculateHeatIndex(raw.temp, raw.humidity);
  const tempAssessment = (raw.tempMax ?? raw.temp) === null ? null : assessment.assessTemperature(raw.tempMax ?? raw.temp);
  const heatIndexAssessment = heatIndex === null ? null : assessment.assessHeatIndex(heatIndex);
  const rainChanceAssessment = raw.rainChance === null ? null : assessment.assessRainChance(raw.rainChance);
  const rainAmountAssessment = raw.rainMm1h === null ? null : assessment.assessRainAmount(raw.rainMm1h, '1 ชั่วโมงที่ผ่านมา');
  const nextRainAssessment = raw.nextRainAt && raw.nextRainMm3h !== null
    ? assessment.assessRainAmount(raw.nextRainMm3h, '3 ชั่วโมงรอบคาดการณ์')
    : null;
  const pm25Assessment = raw.pm25 === null ? null : assessment.assessPm25(raw.pm25);
  const stormAssessment = raw.windSpeedKph === null ? null : assessment.assessStormWind(raw.windSpeedKph);

  const healthAdvice = [
    tempAssessment && tempAssessment.advice,
    heatIndexAssessment && heatIndexAssessment.advice,
    rainChanceAssessment && rainChanceAssessment.advice,
    pm25Assessment && pm25Assessment.maskAdvice
  ].filter(Boolean).join("\n");

  return {
    locationName: raw.locationName || DEFAULT_LOCATION.name,
    tempMax: raw.tempMax,
    temp: raw.temp,
    humidity: raw.humidity,
    heatIndex,
    tempAssessment,
    heatIndexAssessment,
    rainMm1h: raw.rainMm1h,
    rainLatestText: raw.rainMm1h === null ? 'ยังไม่มีข้อมูลฝนย้อนหลัง 1 ชั่วโมง' :
      (raw.rainMm1h > 0 ? 'พบฝนในช่วง 1 ชั่วโมงที่ผ่านมา' : 'ยังไม่พบฝนใน 1 ชั่วโมงที่ผ่านมา'),
    rainChance: raw.rainChance,
    rainChanceAssessment,
    rainAmountAssessment,
    nextRainAt: raw.nextRainAt,
    nextRainInHours: raw.nextRainInHours,
    nextRainChance: raw.nextRainChance,
    nextRainMm3h: raw.nextRainMm3h,
    nextRainAssessment,
    pm25: raw.pm25,
    pm25Assessment,
    windSpeedKph: raw.windSpeedKph,
    stormAssessment,
    healthAdvice,
    source: raw.source,
    observedAt: raw.observedAt || null,
    dataKind: raw.dataKind || 'weather',
    sourceUrl: raw.sourceUrl || null,
    licenseUrl: raw.licenseUrl || null,
    providerExpiresAt: raw.providerExpiresAt || null
  };
}

async function getOpenWeatherReport(location) {
  const normalizedLocation = normalizeLocation(location);
  const lat = normalizedLocation.latitude;
  const lon = normalizedLocation.longitude;
  const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${config.weatherApiKey}&units=metric`;
  const airUrl = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${config.weatherApiKey}`;
  const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${config.weatherApiKey}&units=metric`;

  const [weatherData, airData, forecastData] = await Promise.all([
    getOptionalData(weatherUrl, true),
    getOptionalData(airUrl),
    getOptionalData(forecastUrl)
  ]);

  if (toNumber(weatherData?.main?.temp) === null) {
    throw new Error('Weather data is unavailable');
  }

  const airComponents = airData && airData.list && airData.list[0] && airData.list[0].components;

  const temp = toNumber(weatherData.main && weatherData.main.temp);
  const tempMax = toNumber(weatherData.main && weatherData.main.temp_max);
  const humidity = toNumber(weatherData.main && weatherData.main.humidity);
  const rainMm1h = getRainMm1h(weatherData);
  const rainChance = forecastData ? getRainChancePercent(forecastData) : null;
  const nextRain = forecastData ? getNextRainForecast(forecastData) : {
    nextRainAt: null,
    nextRainInHours: null,
    nextRainChance: null,
    nextRainMm3h: null
  };
  const pm25 = airComponents ? toNumber(airComponents.pm2_5) : null;
  const windSpeedKph = weatherData.wind && weatherData.wind.speed !== undefined
    ? round(Number(weatherData.wind.speed) * 3.6)
    : null;

  return buildAssessedReport({
    locationName: normalizedLocation.name,
    tempMax: round(tempMax),
    temp: round(temp),
    humidity: round(humidity, 0),
    rainMm1h: round(rainMm1h),
    rainChance,
    ...nextRain,
    nextRainMm3h: round(nextRain.nextRainMm3h),
    pm25: round(pm25),
    windSpeedKph,
    source: 'OpenWeather',
    observedAt: weatherData.dt ? new Date(weatherData.dt * 1000) : null
  });
}

function getOpenMeteoHourlyItems(data) {
  const hourly = data && data.hourly ? data.hourly : {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];

  return times.map((time, index) => ({
    time,
    date: parseBangkokApiTime(time),
    temp: toNumber(hourly.temperature_2m && hourly.temperature_2m[index]),
    precipitationProbability: toNumber(hourly.precipitation_probability && hourly.precipitation_probability[index]),
    precipitation: toNumber(hourly.precipitation && hourly.precipitation[index]),
    rain: toNumber(hourly.rain && hourly.rain[index]),
    windSpeedKph: toNumber(hourly.wind_speed_10m && hourly.wind_speed_10m[index])
  })).filter(item => item.date);
}

function getOpenMeteoRainChancePercent(data) {
  const now = Date.now();
  const next12Hours = getOpenMeteoHourlyItems(data)
    .filter(item => item.date.getTime() >= now - 30 * 60 * 1000)
    .slice(0, 12);

  if (!next12Hours.length) {
    return null;
  }

  const probabilities = next12Hours.map(item => item.precipitationProbability).filter(value => value !== null);
  return probabilities.length ? Math.round(Math.max(...probabilities)) : null;
}

function getOpenMeteoNextRainForecast(data) {
  const now = Date.now();
  const hours = getOpenMeteoHourlyItems(data);
  const nextRain = hours
    .filter(item => item.date.getTime() >= now - 30 * 60 * 1000)
    .find(item => {
      const probability = item.precipitationProbability || 0;
      const rainMm = item.rain !== null ? item.rain : item.precipitation || 0;
      return probability >= 30 || rainMm > 0;
    });

  if (!nextRain) {
    return {
      nextRainAt: null,
      nextRainInHours: null,
      nextRainChance: null,
      nextRainMm3h: null
    };
  }

  const nextRainInHours = Math.max(0, (nextRain.date.getTime() - now) / (60 * 60 * 1000));
  const nextThree = hours.filter(item => item.date >= nextRain.date).slice(0, 3);
  const amounts = nextThree.map(item => item.rain ?? item.precipitation);
  const completeThreeHours = amounts.length === 3 && amounts.every(value => value !== null) &&
    nextThree[2].date.getTime() - nextThree[0].date.getTime() === 2 * 60 * 60 * 1000;

  return {
    nextRainAt: nextRain.date,
    nextRainInHours: round(nextRainInHours),
    nextRainChance: nextRain.precipitationProbability === null ? null : Math.round(nextRain.precipitationProbability),
    nextRainMm3h: completeThreeHours ? round(amounts.reduce((sum, value) => sum + value, 0)) : null
  };
}

function getOpenMeteoTempMax(data) {
  const now = Date.now();
  const temperatures = getOpenMeteoHourlyItems(data)
    .filter(item => item.date.getTime() >= now - 30 * 60 * 1000)
    .slice(0, 24)
    .map(item => item.temp)
    .filter(value => value !== null);

  if (!temperatures.length) {
    return null;
  }

  return round(Math.max(...temperatures));
}

async function getOpenMeteoReport(location) {
  const normalizedLocation = normalizeLocation(location);
  const lat = normalizedLocation.latitude;
  const lon = normalizedLocation.longitude;
  const forecastParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,precipitation,rain,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,precipitation,rain,wind_speed_10m',
    timezone: 'Asia/Bangkok',
    forecast_days: '2',
    past_days: '1'
  });
  const airParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'pm2_5',
    hourly: 'pm2_5',
    timezone: 'Asia/Bangkok'
  });

  const [forecastData, airData] = await Promise.all([
    getOptionalData(`https://api.open-meteo.com/v1/forecast?${forecastParams.toString()}`, true),
    getOptionalData(`https://air-quality-api.open-meteo.com/v1/air-quality?${airParams.toString()}`)
  ]);

  if (toNumber(forecastData?.current?.temperature_2m) === null) {
    throw new Error('Open-Meteo data is unavailable');
  }

  const current = forecastData.current || {};
  const nextRain = getOpenMeteoNextRainForecast(forecastData);
  const latestHour = getOpenMeteoHourlyItems(forecastData)
    .filter(item => item.date.getTime() <= Date.now()).at(-1);
  const rainMm1h = latestHour ? (latestHour.rain ?? latestHour.precipitation) : null;
  const temp = round(current.temperature_2m);
  const tempMax = getOpenMeteoTempMax(forecastData) ?? temp;
  const observedAt = parseBangkokApiTime(current.time);
  const pm25 = airData && airData.current ? round(airData.current.pm2_5) : null;

  return buildAssessedReport({
    locationName: normalizedLocation.name,
    tempMax,
    temp,
    humidity: round(current.relative_humidity_2m, 0),
    rainMm1h: round(rainMm1h),
    rainChance: getOpenMeteoRainChancePercent(forecastData),
    ...nextRain,
    pm25,
    windSpeedKph: round(current.wind_speed_10m),
    source: pm25 === null ? 'Open-Meteo — แบบจำลองพยากรณ์ (ยังไม่มีข้อมูลฝุ่น)' :
      'Open-Meteo + Open-Meteo Air Quality — แบบจำลองพยากรณ์',
    sourceUrl: 'https://open-meteo.com/',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    dataKind: 'forecast_model',
    observedAt
  });
}

async function getMetNorwayReport(location) {
  const params = new URLSearchParams({
    lat: location.latitude.toFixed(4), lon: location.longitude.toFixed(4)
  });
  let providerExpiresAt = null;
  const data = await getOptionalData(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?${params}`, true,
    { headers: { 'User-Agent': 'SmartLife/1.0 https://github.com/nakaking007/smartlife-smartline' },
      onResponse: response => {
        const expires = Date.parse(response.headers?.expires);
        if (Number.isFinite(expires)) providerExpiresAt = expires;
      }
    }
  );
  const now = Date.now();
  const rows = (Array.isArray(data?.properties?.timeseries) ? data.properties.timeseries : [])
    .map(row => ({ ...row, date: new Date(row.time) }))
    .filter(row => Number.isFinite(row.date.getTime()) && row.date.getTime() >= now - 60 * 60 * 1000);
  const first = rows[0];
  const current = first?.data?.instant?.details;
  if (!current || toNumber(current.air_temperature) === null) {
    throw new Error('MET Norway data is unavailable');
  }
  const temperatures = rows.filter(row => row.date.getTime() <= now + 24 * 60 * 60 * 1000)
    .map(row => toNumber(row.data?.instant?.details?.air_temperature)).filter(value => value !== null);
  return buildAssessedReport({
    locationName: location.name,
    temp: round(current.air_temperature),
    tempMax: temperatures.length ? round(Math.max(...temperatures)) : null,
    humidity: round(current.relative_humidity, 0),
    // MET forecasts are not observations: do not label future rain as rain in the past hour.
    rainMm1h: null,
    rainChance: round(first.data?.next_12_hours?.details?.probability_of_precipitation, 0),
    nextRainAt: null, nextRainInHours: null, nextRainChance: null, nextRainMm3h: null,
    pm25: null,
    windSpeedKph: toNumber(current.wind_speed) === null ? null : round(current.wind_speed * 3.6),
    observedAt: first.date,
    dataKind: 'forecast_model',
    source: 'MET Norway — แบบจำลองพยากรณ์ (ไม่มีข้อมูลฝุ่น/ฝนย้อนหลัง)',
    sourceUrl: 'https://api.met.no/',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    providerExpiresAt
  });
}

async function fetchReport(normalizedLocation) {
  const attempts = [];
  const providers = [];
  if (config.weatherApiKey) {
    providers.push(['OpenWeather', getOpenWeatherReport]);
  }
  providers.push(['Open-Meteo', getOpenMeteoReport], ['MET Norway', getMetNorwayReport]);
  for (const [source, fetcher] of providers) {
    try {
      return await fetcher(normalizedLocation);
    } catch (err) {
      attempts.push({ source, code: err.code || 'INVALID_RESPONSE' });
    }
  }
  throw Object.assign(new Error('Weather data is unavailable'), { code: 'WEATHER_UNAVAILABLE', attempts });
}

async function getReport(location = {}) {
  const normalized = normalizeLocation(location);
  const key = `${normalized.latitude.toFixed(4)},${normalized.longitude.toFixed(4)}`;
  const cached = reportCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.report, locationName: normalized.name };
  if (!inFlight.has(key)) {
    const pending = fetchReport(normalized).then(report => {
      if (reportCache.size >= 50) reportCache.delete(reportCache.keys().next().value);
      reportCache.set(key, { report, expiresAt: Math.max(Date.now() + CACHE_TTL_MS, report.providerExpiresAt || 0) });
      return report;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const report = await inFlight.get(key);
  return { ...report, locationName: normalized.name };
}

module.exports = { getReport, normalizeLocation };
