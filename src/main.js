import { StreamGuideBot } from './bot.js';
import { BroadcastResolver } from './broadcasts.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { GuideService } from './service.js';
import { StartGGClient } from './startgg.js';
import { TwitchClient } from './twitch.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`);
    process.exit(2);
  }
  throw error;
}

const logger = createLogger(config.logLevel);
const startgg = new StartGGClient(
  config.startggApiToken,
  config.startggMaxDiscoveryPages,
  logger,
);
const twitch = new TwitchClient(config.twitchClientId, config.twitchClientSecret, logger);
const broadcastResolver = new BroadcastResolver({
  overridesPath: config.broadcastOverridesPath,
  twitch,
  logger,
});
const service = new GuideService(config, startgg, logger, broadcastResolver);
const bot = new StreamGuideBot(config, service, logger);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down`);
  await bot.stop();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

bot.start().catch((error) => {
  logger.error('Discord bot failed to start', error);
  process.exitCode = 1;
});
