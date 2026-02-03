// IANA to POSIX timezone conversion
// ESP32 uses POSIX-style timezone strings for configTime()

// Map of common IANA timezones to POSIX format
// Format: STDoffset[DST[offset],start[/time],end[/time]]
const TIMEZONE_MAP: Record<string, string> = {
  // US Timezones
  'America/New_York': 'EST5EDT,M3.2.0,M11.1.0',
  'America/Chicago': 'CST6CDT,M3.2.0,M11.1.0',
  'America/Denver': 'MST7MDT,M3.2.0,M11.1.0',
  'America/Phoenix': 'MST7',  // Arizona doesn't observe DST
  'America/Los_Angeles': 'PST8PDT,M3.2.0,M11.1.0',
  'America/Anchorage': 'AKST9AKDT,M3.2.0,M11.1.0',
  'Pacific/Honolulu': 'HST10',  // Hawaii doesn't observe DST

  // Canada
  'America/Toronto': 'EST5EDT,M3.2.0,M11.1.0',
  'America/Vancouver': 'PST8PDT,M3.2.0,M11.1.0',
  'America/Edmonton': 'MST7MDT,M3.2.0,M11.1.0',

  // Europe
  'Europe/London': 'GMT0BST,M3.5.0/1,M10.5.0',
  'Europe/Paris': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/Berlin': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/Amsterdam': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/Rome': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/Madrid': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/Lisbon': 'WET0WEST,M3.5.0/1,M10.5.0',
  'Europe/Stockholm': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/Helsinki': 'EET-2EEST,M3.5.0/3,M10.5.0/4',
  'Europe/Moscow': 'MSK-3',  // No DST

  // Asia/Pacific
  'Asia/Tokyo': 'JST-9',  // No DST
  'Asia/Shanghai': 'CST-8',  // No DST
  'Asia/Hong_Kong': 'HKT-8',  // No DST
  'Asia/Singapore': 'SGT-8',  // No DST
  'Asia/Seoul': 'KST-9',  // No DST
  'Asia/Kolkata': 'IST-5:30',  // No DST
  'Asia/Dubai': 'GST-4',  // No DST
  'Australia/Sydney': 'AEST-10AEDT,M10.1.0,M4.1.0/3',
  'Australia/Melbourne': 'AEST-10AEDT,M10.1.0,M4.1.0/3',
  'Australia/Brisbane': 'AEST-10',  // Queensland doesn't observe DST
  'Australia/Perth': 'AWST-8',  // No DST
  'Pacific/Auckland': 'NZST-12NZDT,M9.5.0,M4.1.0/3',

  // South America
  'America/Sao_Paulo': 'BRT3',  // Brazil no longer observes DST
  'America/Buenos_Aires': 'ART3',  // No DST
  'America/Santiago': 'CLT4CLST,M9.1.6/24,M4.1.6/24',

  // UTC
  'UTC': 'UTC0',
  'Etc/UTC': 'UTC0',
};

// List of supported timezones for UI dropdown
export const SUPPORTED_TIMEZONES = Object.keys(TIMEZONE_MAP).sort();

/**
 * Convert IANA timezone to POSIX format for ESP32
 * @param ianaTimezone IANA timezone string (e.g., "America/Denver")
 * @returns POSIX timezone string (e.g., "MST7MDT,M3.2.0,M11.1.0")
 */
export function ianaToPosix(ianaTimezone: string): string {
  const posix = TIMEZONE_MAP[ianaTimezone];
  if (posix) {
    return posix;
  }

  // If timezone not found, default to UTC and log warning
  console.warn(`Unknown timezone "${ianaTimezone}", defaulting to UTC`);
  return 'UTC0';
}

/**
 * Parse HH:MM time string into hour and minute components
 * @param timeStr Time string in HH:MM format (24-hour)
 * @returns Object with hour (0-23) and minute (0-59)
 */
export function parseTimeString(timeStr: string): { hour: number; minute: number } {
  const [hourStr, minuteStr] = timeStr.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  // Validate
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.warn(`Invalid time string "${timeStr}", defaulting to 00:00`);
    return { hour: 0, minute: 0 };
  }

  return { hour, minute };
}
