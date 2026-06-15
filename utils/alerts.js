// utils/alerts.js
const Alert = require('../models/Alert');
const { formatBangkokDateTime } = require('./time');
const {
  assessEarthquakeMagnitude,
  assessStormWind,
  assessTsunamiWave,
  describeAsiaRegion
} = require('./riskAssessment');

const URGENT_SEVERITIES = ['urgent', 'emergency', 'critical', 'warning', 'watch'];
const BANGKOK_COORDINATES = { latitude: 13.7563, longitude: 100.5018 };

const THAILAND_COUNTRY_VALUES = ['TH', 'th', 'THA', 'tha', 'Thailand', 'thailand', 'ประเทศไทย', 'ไทย'];
const ASEAN_COUNTRY_VALUES = [
  ...THAILAND_COUNTRY_VALUES,
  'BN', 'BRN', 'Brunei', 'Brunei Darussalam', 'บรูไน',
  'KH', 'KHM', 'Cambodia', 'กัมพูชา',
  'ID', 'IDN', 'Indonesia', 'อินโดนีเซีย',
  'LA', 'LAO', 'Laos', 'Lao PDR', 'ลาว',
  'MY', 'MYS', 'Malaysia', 'มาเลเซีย',
  'MM', 'MMR', 'Myanmar', 'Burma', 'เมียนมา', 'พม่า',
  'PH', 'PHL', 'Philippines', 'ฟิลิปปินส์',
  'SG', 'SGP', 'Singapore', 'สิงคโปร์',
  'VN', 'VNM', 'Vietnam', 'Viet Nam', 'เวียดนาม'
];

const THAILAND_AREA_REGEX = /Thailand|ประเทศไทย|ไทย|Bangkok|กรุงเทพ|กระบี่|กาญจนบุรี|กาฬสินธุ์|กำแพงเพชร|ขอนแก่น|จันทบุรี|ฉะเชิงเทรา|ชลบุรี|ชัยนาท|ชัยภูมิ|ชุมพร|เชียงราย|เชียงใหม่|ตรัง|ตราด|ตาก|นครนายก|นครปฐม|นครพนม|นครราชสีมา|นครศรีธรรมราช|นครสวรรค์|นนทบุรี|นราธิวาส|น่าน|บึงกาฬ|บุรีรัมย์|ปทุมธานี|ประจวบคีรีขันธ์|ปราจีนบุรี|ปัตตานี|พระนครศรีอยุธยา|พะเยา|พังงา|พัทลุง|พิจิตร|พิษณุโลก|เพชรบุรี|เพชรบูรณ์|แพร่|ภูเก็ต|มหาสารคาม|มุกดาหาร|แม่ฮ่องสอน|ยโสธร|ยะลา|ร้อยเอ็ด|ระนอง|ระยอง|ราชบุรี|ลพบุรี|ลำปาง|ลำพูน|เลย|ศรีสะเกษ|สกลนคร|สงขลา|สตูล|สมุทรปราการ|สมุทรสงคราม|สมุทรสาคร|สระแก้ว|สระบุรี|สิงห์บุรี|สุโขทัย|สุพรรณบุรี|สุราษฎร์ธานี|สุรินทร์|หนองคาย|หนองบัวลำภู|อ่างทอง|อำนาจเจริญ|อุดรธานี|อุตรดิตถ์|อุทัยธานี|อุบลราชธานี/i;
const ASEAN_AREA_REGEX = /ASEAN|Southeast Asia|South-East Asia|อาเซียน|เอเชียตะวันออกเฉียงใต้|Thailand|ประเทศไทย|ไทย|Bangkok|กรุงเทพ|Brunei|บรูไน|Cambodia|กัมพูชา|Indonesia|อินโดนีเซีย|Laos|Lao PDR|ลาว|Malaysia|มาเลเซีย|Myanmar|Burma|เมียนมา|พม่า|Philippines|ฟิลิปปินส์|Singapore|สิงคโปร์|Vietnam|Viet Nam|เวียดนาม|Java|Sumatra|Sulawesi|Bali|Luzon|Mindanao|Manila|Kuala Lumpur|Phnom Penh|Vientiane|Yangon|Hanoi|Ho Chi Minh/i;

const THAILAND_BOUNDS = {
  minLatitude: 5,
  maxLatitude: 21,
  minLongitude: 97,
  maxLongitude: 106
};

const ASEAN_BOUNDS = {
  minLatitude: -11,
  maxLatitude: 29,
  minLongitude: 92,
  maxLongitude: 142
};

const EARTHQUAKE_TYPES = ['earthquake', 'quake', 'แผ่นดินไหว'];
const STORM_TYPES = ['storm', 'thunderstorm', 'typhoon', 'cyclone', 'tropical_storm', 'พายุ'];
const TSUNAMI_TYPES = ['tsunami', 'tidal_wave', 'สึนามิ', 'สึมามิ', 'คลื่นสึนามิ'];
const FLOOD_TYPES = ['flood', 'flooding', 'flash_flood', 'น้ำท่วม'];
const GENERAL_DISASTER_TYPES = ['disaster', 'natural_disaster', 'ภัยพิบัติ'];
const ASEAN_ALERT_TYPES = [...EARTHQUAKE_TYPES, ...STORM_TYPES, ...TSUNAMI_TYPES];
const DISASTER_TYPES = [...new Set([
  ...GENERAL_DISASTER_TYPES,
  ...ASEAN_ALERT_TYPES,
  ...FLOOD_TYPES
])];

const THAI_NUMBER_FORMAT = new Intl.NumberFormat('th-TH-u-nu-latn', {
  maximumFractionDigits: 1
});

const THAI_INTEGER_FORMAT = new Intl.NumberFormat('th-TH-u-nu-latn', {
  maximumFractionDigits: 0
});

function buildAreaScopeQuery(countryValues, areaRegex, bounds) {
  return {
    $or: [
      { country: { $in: countryValues } },
      { countryCode: { $in: countryValues } },
      { isoCountryCode: { $in: countryValues } },
      { 'area.country': { $in: countryValues } },
      { 'location.country': { $in: countryValues } },
      { 'location.countryCode': { $in: countryValues } },
      { areaText: areaRegex },
      { areaName: areaRegex },
      { locationName: areaRegex },
      { title: areaRegex },
      { message: areaRegex },
      { areas: areaRegex },
      {
        $and: [
          { latitude: { $gte: bounds.minLatitude, $lte: bounds.maxLatitude } },
          { longitude: { $gte: bounds.minLongitude, $lte: bounds.maxLongitude } }
        ]
      }
    ]
  };
}

function buildThailandScopeQuery() {
  return buildAreaScopeQuery(THAILAND_COUNTRY_VALUES, THAILAND_AREA_REGEX, THAILAND_BOUNDS);
}

function buildAseanScopeQuery() {
  return buildAreaScopeQuery(ASEAN_COUNTRY_VALUES, ASEAN_AREA_REGEX, ASEAN_BOUNDS);
}

function buildAlertScopeQuery() {
  return {
    $or: [
      { $and: [{ type: { $in: ASEAN_ALERT_TYPES } }, buildAseanScopeQuery()] },
      { $and: [{ type: { $nin: ASEAN_ALERT_TYPES } }, buildThailandScopeQuery()] },
      { $and: [{ type: { $exists: false } }, buildThailandScopeQuery()] }
    ]
  };
}

function buildScopeQueryForTypes(types) {
  const regionalTypes = types.filter(type => ASEAN_ALERT_TYPES.includes(type));
  const localTypes = types.filter(type => !ASEAN_ALERT_TYPES.includes(type));

  if (regionalTypes.length > 0 && localTypes.length === 0) {
    return buildAseanScopeQuery();
  }

  if (regionalTypes.length === 0) {
    return buildThailandScopeQuery();
  }

  return {
    $or: [
      { $and: [{ type: { $in: regionalTypes } }, buildAseanScopeQuery()] },
      { $and: [{ type: { $in: localTypes } }, buildThailandScopeQuery()] }
    ]
  };
}

function buildActiveAlertQuery(now = new Date(), extraQuery = {}) {
  const { $and: extraAnd = [], ...query } = extraQuery;

  return {
    active: true,
    ...query,
    $and: [
      {
        $or: [
          { severity: { $in: URGENT_SEVERITIES } },
          { type: { $in: DISASTER_TYPES } }
        ]
      },
      {
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gte: now } }
        ]
      },
      buildAlertScopeQuery(),
      ...extraAnd
    ]
  };
}

async function listActiveUrgentAlerts(now = new Date(), limit = 10) {
  return Alert.find(buildActiveAlertQuery(now)).sort({ startsAt: -1 }).limit(limit);
}

async function listUnsentUrgentAlerts(lineUserId, now = new Date()) {
  return Alert.find(buildActiveAlertQuery(now, {
    sentTo: { $ne: lineUserId }
  })).sort({ startsAt: -1 }).limit(10);
}

async function listActiveAlertsByTypes(types, now = new Date(), limit = 10) {
  return Alert.find({
    active: true,
    type: { $in: types },
    $and: [
      {
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gte: now } }
        ]
      },
      buildScopeQueryForTypes(types)
    ]
  }).sort({ startsAt: -1 }).limit(limit);
}

async function markAlertSent(alertId, lineUserId) {
  return Alert.updateOne(
    { _id: alertId },
    { $addToSet: { sentTo: lineUserId } }
  );
}

function toPlainObject(alert) {
  if (alert && typeof alert.toObject === 'function') {
    return alert.toObject({ depopulate: true });
  }

  return alert || {};
}

function getPath(source, path) {
  if (!source) {
    return undefined;
  }

  if (source[path] !== undefined) {
    return source[path];
  }

  return path.split('.').reduce((value, key) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    return value[key];
  }, source);
}

function pickValue(source, paths) {
  for (const path of paths) {
    const value = getPath(source, path);

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return undefined;
}

function pickText(source, paths) {
  const value = pickValue(source, paths);

  if (Array.isArray(value)) {
    return value.filter(Boolean).join(', ');
  }

  if (value && typeof value === 'object') {
    return pickText(value, ['name', 'label', 'text', 'title']);
  }

  return value === undefined ? undefined : String(value).trim();
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getCoordinates(data) {
  const geoJsonCoordinates = pickValue(data, ['geometry.coordinates', 'location.coordinates', 'coordinates']);

  if (Array.isArray(geoJsonCoordinates) && geoJsonCoordinates.length >= 2) {
    const longitude = toNumber(geoJsonCoordinates[0]);
    const latitude = toNumber(geoJsonCoordinates[1]);

    if (latitude !== null && longitude !== null) {
      return { latitude, longitude };
    }
  }

  const latitude = toNumber(pickValue(data, ['latitude', 'lat', 'location.latitude', 'location.lat', 'area.latitude']));
  const longitude = toNumber(pickValue(data, ['longitude', 'lon', 'lng', 'location.longitude', 'location.lon', 'location.lng', 'area.longitude']));

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function calculateDistanceKm(from, to) {
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const latitude1 = toRadians(from.latitude);
  const latitude2 = toRadians(to.latitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceFromBangkok(data) {
  const coordinates = getCoordinates(data);

  if (!coordinates) {
    return 'ไกลจาก กทม.: ยังไม่มีพิกัดสำหรับคำนวณ';
  }

  const distanceKm = calculateDistanceKm(BANGKOK_COORDINATES, coordinates);
  return `ไกลจาก กทม.: ประมาณ ${THAI_INTEGER_FORMAT.format(distanceKm)} กม.`;
}

function getAlertLocation(data) {
  return pickText(data, [
    'areaText',
    'areaName',
    'locationName',
    'place',
    'region',
    'province',
    'location.name',
    'title'
  ]) || '-';
}

function formatAsiaRegionLine(data) {
  const coordinates = getCoordinates(data);
  return `ส่วนของเอเชีย: ${describeAsiaRegion({ ...data, ...(coordinates || {}) })}`;
}

function getMagnitude(data) {
  return toNumber(pickValue(data, [
    'magnitude',
    'mag',
    'richter',
    'richterScale',
    'properties.mag',
    'details.magnitude'
  ]));
}

function sanitizeObservation(text) {
  if (!text) {
    return '';
  }

  return String(text)
    .replace(/(?:ควร|กรุณา|โปรด)?\s*(?:หลบภัย|อพยพ|หนี|เตรียมอพยพ|อย่าตื่นตระหนก|ป้องกัน|ระมัดระวัง)[^\n。.]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getExplicitObservation(data) {
  return sanitizeObservation(pickText(data, [
    'feltText',
    'feltReport',
    'observedEffects',
    'effects',
    'impactText',
    'intensityDescription',
    'details.effects'
  ]));
}

function describeEarthquakeObservation(data, magnitude) {
  const explicitObservation = getExplicitObservation(data);
  if (explicitObservation) {
    return explicitObservation;
  }

  const intensity = pickText(data, ['intensity', 'mmi', 'shindo']);
  if (intensity) {
    return `รายงานความสั่นไหวระดับ ${intensity}`;
  }

  if (magnitude === null) {
    return 'ยังไม่มีรายงานอาการที่รับรู้ได้';
  }

  if (magnitude < 3.5) {
    return 'โดยทั่วไปมักรับรู้ได้น้อยมาก';
  }

  if (magnitude < 5) {
    return 'อาจรู้สึกสั่นเบาถึงปานกลางใกล้ศูนย์กลาง';
  }

  if (magnitude < 6) {
    return 'อาจรู้สึกสั่นชัดในอาคารและพื้นที่ใกล้ศูนย์กลาง';
  }

  return 'อาจรู้สึกสั่นแรงเป็นบริเวณกว้างตามพื้นที่ที่รายงาน';
}

function describeStormObservation(data) {
  const explicitObservation = getExplicitObservation(data);
  if (explicitObservation) {
    return explicitObservation;
  }

  const windSpeed = toNumber(pickValue(data, ['windSpeedKph', 'windSpeed', 'windKph', 'maxWindKph']));
  if (windSpeed !== null) {
    if (windSpeed >= 118) {
      return 'ลมแรงมาก ฝนหนัก และคลื่นลมสูงในพื้นที่ที่รายงาน';
    }

    if (windSpeed >= 63) {
      return 'ลมแรงและฝนต่อเนื่องในพื้นที่ที่รายงาน';
    }

    return 'ฝนและลมอาจเพิ่มขึ้นตามพื้นที่ที่รายงาน';
  }

  return 'อาจรับรู้ได้เป็นฝน ลมแรง หรือคลื่นลมตามพื้นที่ที่รายงาน';
}

function describeTsunamiObservation(data) {
  const explicitObservation = getExplicitObservation(data);
  if (explicitObservation) {
    return explicitObservation;
  }

  const waveHeight = toNumber(pickValue(data, ['waveHeightMeters', 'waveHeight', 'maxWaveHeightMeters']));
  if (waveHeight !== null) {
    return `ระดับน้ำทะเลเปลี่ยนแปลงตามรายงาน ประมาณ ${THAI_NUMBER_FORMAT.format(waveHeight)} เมตร`;
  }

  return 'อาจรับรู้ได้เป็นระดับน้ำทะเลเปลี่ยนแปลงหรือคลื่นผิดปกติในพื้นที่ชายฝั่งที่รายงาน';
}

function formatSourceLine(data) {
  const source = pickText(data, ['source', 'sourceName']);
  const sourceUrl = pickText(data, ['sourceUrl', 'url']);

  if (source && sourceUrl) {
    return `ที่มา: ${source} ${sourceUrl}`;
  }

  if (source) {
    return `ที่มา: ${source}`;
  }

  if (sourceUrl) {
    return `ที่มา: ${sourceUrl}`;
  }

  return null;
}

function formatAlertTimeLine(data) {
  const rawDate = pickValue(data, ['startsAt', 'eventAt', 'observedAt', 'issuedAt', 'updatedAt', 'createdAt']);

  if (!rawDate) {
    return 'ข้อมูล ณ: ยังไม่มีเวลารายงานจากแหล่งข้อมูล';
  }

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return 'ข้อมูล ณ: ยังไม่มีเวลารายงานจากแหล่งข้อมูล';
  }

  return `ข้อมูล ณ: ${formatBangkokDateTime(date)}`;
}

function getAlertType(data) {
  return String(data.type || '').trim();
}

function hasType(data, types) {
  return types.includes(getAlertType(data));
}

function formatEarthquakeAlert(data) {
  const magnitude = getMagnitude(data);
  const magnitudeAssessment = assessEarthquakeMagnitude(magnitude);

  return [
    'เรียน นายท่าน รายงานแผ่นดินไหวค่ะ',
    `เกิดที่: ${getAlertLocation(data)}`,
    `ขนาด: ${magnitude === null ? '-' : `${THAI_NUMBER_FORMAT.format(magnitude)} ริกเตอร์`}`,
    `ระดับความรุนแรง: ${magnitudeAssessment.level} (${magnitudeAssessment.description})`,
    formatAsiaRegionLine(data),
    formatDistanceFromBangkok(data),
    `อาการที่รับรู้ได้: ${describeEarthquakeObservation(data, magnitude)}`,
    formatAlertTimeLine(data),
    formatSourceLine(data)
  ].filter(Boolean).join('\n');
}

function formatStormAlert(data) {
  const category = pickText(data, ['category', 'stormCategory', 'severity']) || '-';
  const windSpeed = toNumber(pickValue(data, ['windSpeedKph', 'windSpeed', 'windKph', 'maxWindKph']));
  const stormAssessment = assessStormWind(windSpeed);

  return [
    'เรียน นายท่าน รายงานพายุค่ะ',
    `พื้นที่/ตำแหน่ง: ${getAlertLocation(data)}`,
    `ระดับ/ชนิด: ${category}`,
    windSpeed === null ? null : `ความเร็วลม: ประมาณ ${THAI_NUMBER_FORMAT.format(windSpeed)} กม./ชม.`,
    `ระดับความรุนแรง: ${stormAssessment.level} (${stormAssessment.description})`,
    formatAsiaRegionLine(data),
    formatDistanceFromBangkok(data),
    `อาการที่รับรู้ได้: ${describeStormObservation(data)}`,
    formatAlertTimeLine(data),
    formatSourceLine(data)
  ].filter(Boolean).join('\n');
}

function formatTsunamiAlert(data) {
  const level = pickText(data, ['level', 'category', 'severity']) || '-';
  const waveHeight = toNumber(pickValue(data, ['waveHeightMeters', 'waveHeight', 'maxWaveHeightMeters']));
  const tsunamiAssessment = assessTsunamiWave(waveHeight);

  return [
    'เรียน นายท่าน รายงานสึนามิค่ะ',
    `พื้นที่/ตำแหน่ง: ${getAlertLocation(data)}`,
    `ระดับ: ${level}`,
    waveHeight === null ? null : `ความสูงคลื่นตามรายงาน: ประมาณ ${THAI_NUMBER_FORMAT.format(waveHeight)} เมตร`,
    `ระดับความรุนแรง: ${tsunamiAssessment.level} (${tsunamiAssessment.description})`,
    formatAsiaRegionLine(data),
    formatDistanceFromBangkok(data),
    `อาการที่รับรู้ได้: ${describeTsunamiObservation(data)}`,
    formatAlertTimeLine(data),
    formatSourceLine(data)
  ].filter(Boolean).join('\n');
}

function formatGenericAlert(data) {
  const typeLabel = {
    flood: 'น้ำท่วม',
    flooding: 'น้ำท่วม',
    flash_flood: 'น้ำป่า/น้ำท่วมฉับพลัน',
    disaster: 'ภัยพิบัติ',
    natural_disaster: 'ภัยพิบัติ',
    ภัยพิบัติ: 'ภัยพิบัติ',
    น้ำท่วม: 'น้ำท่วม'
  }[data.type] || data.type || '-';

  return [
    'เรียน นายท่าน รายงานภัยธรรมชาติค่ะ',
    `หัวข้อ: ${data.title || '-'}`,
    `ประเภท: ${typeLabel}`,
    `พื้นที่/ตำแหน่ง: ${getAlertLocation(data)}`,
    `ระดับ: ${data.severity || '-'}`,
    formatDistanceFromBangkok(data),
    getExplicitObservation(data) ? `อาการที่รับรู้ได้: ${getExplicitObservation(data)}` : null,
    formatAlertTimeLine(data),
    formatSourceLine(data)
  ].filter(Boolean).join('\n');
}

function formatAlert(alert) {
  const data = toPlainObject(alert);

  if (hasType(data, EARTHQUAKE_TYPES)) {
    return formatEarthquakeAlert(data);
  }

  if (hasType(data, STORM_TYPES)) {
    return formatStormAlert(data);
  }

  if (hasType(data, TSUNAMI_TYPES)) {
    return formatTsunamiAlert(data);
  }

  return formatGenericAlert(data);
}

module.exports = {
  listActiveUrgentAlerts,
  listUnsentUrgentAlerts,
  listActiveAlertsByTypes,
  markAlertSent,
  formatAlert
};
