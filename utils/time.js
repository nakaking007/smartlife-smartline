const THAILAND_TIME_ZONE = 'Asia/Bangkok';
const THAILAND_UTC_OFFSET = '+07:00';

if (!process.env.TZ) {
  process.env.TZ = THAILAND_TIME_ZONE;
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function normalizeYear(rawYear) {
  const year = Number(rawYear);
  return year > 2400 ? year - 543 : year;
}

function normalizeMillisecond(rawMillisecond) {
  if (!rawMillisecond) {
    return 0;
  }

  return Number(String(rawMillisecond).padEnd(3, '0').slice(0, 3));
}

function normalizeClockTime(rawHour, rawMinute, rawSecond, rawMillisecond) {
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const second = Number(rawSecond);
  const millisecond = Number(rawMillisecond);

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    Number.isNaN(second) ||
    Number.isNaN(millisecond) ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    millisecond < 0 ||
    millisecond > 999
  ) {
    throw new Error('Invalid appointment date');
  }

  if (hour === 24) {
    if (minute !== 0 || second !== 0 || millisecond !== 0) {
      throw new Error('Invalid appointment date');
    }

    return { hour: 0, minute, second, millisecond, addDays: 1 };
  }

  if (hour < 0 || hour > 23) {
    throw new Error('Invalid appointment date');
  }

  return { hour, minute, second, millisecond, addDays: 0 };
}

function buildBangkokDate({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }) {
  const clock = normalizeClockTime(hour, minute, second, millisecond);
  const date = new Date(
    `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}.${pad(clock.millisecond, 3)}${THAILAND_UTC_OFFSET}`
  );

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid appointment date');
  }

  if (clock.addDays) {
    date.setTime(date.getTime() + clock.addDays * 24 * 60 * 60 * 1000);
  }

  return date;
}

function parseBangkokDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('Invalid appointment date');
    }
    return date;
  }

  const text = String(value).trim();
  const thaiDateTime = text.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s*:?\s*(\d{1,2})[:.](\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:\s*น\.?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/i
  );

  if (thaiDateTime) {
    return buildBangkokDate({
      day: Number(thaiDateTime[1]),
      month: Number(thaiDateTime[2]),
      year: normalizeYear(thaiDateTime[3]),
      hour: Number(thaiDateTime[4] || 0),
      minute: Number(thaiDateTime[5] || 0),
      second: Number(thaiDateTime[6] || 0),
      millisecond: normalizeMillisecond(thaiDateTime[7])
    });
  }

  const isoLikeDateTime = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})[:.](\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:\s*น\.?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/i
  );

  if (isoLikeDateTime) {
    return buildBangkokDate({
      year: normalizeYear(isoLikeDateTime[1]),
      month: Number(isoLikeDateTime[2]),
      day: Number(isoLikeDateTime[3]),
      hour: Number(isoLikeDateTime[4] || 0),
      minute: Number(isoLikeDateTime[5] || 0),
      second: Number(isoLikeDateTime[6] || 0),
      millisecond: normalizeMillisecond(isoLikeDateTime[7])
    });
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid appointment date');
  }

  return date;
}

function parseBangkokClockTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?(?:\s*น\.?)?$/i);

  if (!match) {
    return null;
  }

  return normalizeClockTime(
    Number(match[1]),
    Number(match[2]),
    Number(match[3] || 0),
    0
  );
}

function setBangkokClockTime(baseDate, timeValue) {
  if (!baseDate) {
    throw new Error('Existing appointment date is required for time-only edit');
  }

  const clock = parseBangkokClockTime(timeValue);
  if (!clock) {
    throw new Error('Invalid appointment time');
  }

  const dateKey = getBangkokDateKey(baseDate);
  const date = new Date(`${dateKey}T${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}.000${THAILAND_UTC_OFFSET}`);

  if (clock.addDays) {
    date.setTime(date.getTime() + clock.addDays * 24 * 60 * 60 * 1000);
  }

  return date;
}

function addThaiTimeSuffix(value) {
  const formatted = value.replace(/(\d{1,2}):(\d{2})(?=\s*(?:น\.?)?$)/, '$1.$2');
  return /น\.?\s*$/.test(formatted) ? formatted : `${formatted} น.`;
}

function formatBangkokDateTime(date, options = {}) {
  if (!date) {
    return '-';
  }

  const formatted = new Intl.DateTimeFormat('th-TH', {
    timeZone: THAILAND_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    numberingSystem: 'latn',
    ...options
  }).format(new Date(date));

  return addThaiTimeSuffix(formatted);
}

function formatBangkokTime(date) {
  if (!date) {
    return '-';
  }

  const formatted = new Intl.DateTimeFormat('th-TH', {
    timeZone: THAILAND_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    numberingSystem: 'latn'
  }).format(new Date(date));

  return addThaiTimeSuffix(formatted);
}

function getBangkokDateKey(baseDate = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: THAILAND_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(baseDate);
}

function getBangkokMinuteKey(baseDate = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: THAILAND_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    numberingSystem: 'latn'
  }).formatToParts(baseDate).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }

    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function getBangkokDayRange(baseDate = new Date()) {
  const dateKey = getBangkokDateKey(baseDate);

  return {
    start: new Date(`${dateKey}T00:00:00.000${THAILAND_UTC_OFFSET}`),
    end: new Date(`${dateKey}T23:59:59.999${THAILAND_UTC_OFFSET}`)
  };
}

function getBangkokWeekRange(baseDate = new Date()) {
  const dayRange = getBangkokDayRange(baseDate);
  const day = dayRange.start.getDay();
  const start = new Date(dayRange.start.getTime() - day * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

  return { start, end };
}

module.exports = {
  THAILAND_TIME_ZONE,
  parseBangkokDate,
  parseBangkokClockTime,
  setBangkokClockTime,
  formatBangkokDateTime,
  formatBangkokTime,
  getBangkokDateKey,
  getBangkokMinuteKey,
  getBangkokDayRange,
  getBangkokWeekRange
};
