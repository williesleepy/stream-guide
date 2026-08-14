import { existsSync } from 'node:fs';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(name) {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function integer(name, defaultValue, minimum = 1) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return defaultValue;

  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new ConfigError(`${name} must be an integer`);
  }
  if (value < minimum) {
    throw new ConfigError(`${name} must be >= ${minimum}`);
  }
  return value;
}

function snowflake(name) {
  const value = required(name);
  if (!/^\d+$/.test(value)) {
    throw new ConfigError(`${name} must be a Discord snowflake ID`);
  }
  return value;
}

function validateTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new ConfigError(`Unknown DISPLAY_TIMEZONE: ${timeZone}`);
  }
  return timeZone;
}

export function loadConfig() {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const displayTimeZone = validateTimeZone(
    (process.env.DISPLAY_TIMEZONE ?? 'America/New_York').trim(),
  );

  const twitchClientId = (process.env.TWITCH_CLIENT_ID ?? '').trim();
  const twitchClientSecret = (process.env.TWITCH_CLIENT_SECRET ?? '').trim();
  if (Boolean(twitchClientId) !== Boolean(twitchClientSecret)) {
    throw new ConfigError(
      'TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must either both be set or both be omitted',
    );
  }

  return Object.freeze({
    discordBotToken: required('DISCORD_BOT_TOKEN'),
    discordGuildId: snowflake('DISCORD_GUILD_ID'),
    discordChannelId: snowflake('DISCORD_CHANNEL_ID'),
    startggApiToken: required('STARTGG_API_TOKEN'),
    displayTimeZone,
    refreshSeconds: integer('REFRESH_SECONDS', 60, 30),
    discoveryRefreshSeconds: integer('DISCOVERY_REFRESH_SECONDS', 300, 60),
    minNotableOfflineEntrants: integer('MIN_NOTABLE_OFFLINE_ENTRANTS', 80, 1),
    minNotableOnlineEntrants: integer('MIN_NOTABLE_ONLINE_ENTRANTS', 128, 1),
    minNotableAttendees: integer('MIN_NOTABLE_ATTENDEES', 100, 1),
    maxWeeklyTournaments: integer('MAX_WEEKLY_TOURNAMENTS', 10, 1),
    maxTodayTournaments: integer('MAX_TODAY_TOURNAMENTS', 5, 1),
    startggMaxDiscoveryPages: integer('STARTGG_MAX_DISCOVERY_PAGES', 30, 1),
    broadcastOverridesPath:
      (process.env.BROADCAST_OVERRIDES_PATH ?? 'config/broadcast-overrides.json').trim() ||
      'config/broadcast-overrides.json',
    twitchClientId: twitchClientId || null,
    twitchClientSecret: twitchClientSecret || null,
    logLevel: (process.env.LOG_LEVEL ?? 'INFO').trim().toUpperCase() || 'INFO',
  });
}
