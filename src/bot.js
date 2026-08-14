import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  RESTJSONErrorCodes,
} from 'discord.js';
import { buildComponents, DISPLAY_TITLE } from './display.js';

function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function componentContainsDisplayTitle(component) {
  const data = typeof component?.toJSON === 'function' ? component.toJSON() : component;
  if (!data) return false;
  if (typeof data.content === 'string' && data.content.includes(DISPLAY_TITLE)) return true;
  return Array.isArray(data.components) && data.components.some(componentContainsDisplayTitle);
}

export class StreamGuideBot {
  constructor(config, service, logger = console) {
    this.config = config;
    this.service = service;
    this.logger = logger;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.displayMessage = null;
    this.abortController = new AbortController();
    this.refreshPromise = null;
  }

  async start() {
    this.client.once(Events.ClientReady, (readyClient) => {
      this.logger.info(`Discord ready as ${readyClient.user.tag}`);
      this.refreshPromise = this.refreshLoop();
    });
    await this.client.login(this.config.discordBotToken);
  }

  async stop() {
    this.abortController.abort();
    this.client.destroy();
    await this.refreshPromise?.catch(() => {});
  }

  async getChannel() {
    const channel = await this.client.channels.fetch(this.config.discordChannelId);
    if (!channel) throw new Error(`Discord channel ${this.config.discordChannelId} was not found`);
    if (channel.guildId !== this.config.discordGuildId) {
      throw new Error(
        `DISCORD_CHANNEL_ID=${this.config.discordChannelId} does not belong to DISCORD_GUILD_ID=${this.config.discordGuildId}`,
      );
    }
    if (!channel.isTextBased() || typeof channel.send !== 'function' || !channel.messages) {
      throw new Error('Configured Discord channel is not a message channel');
    }
    return channel;
  }

  async findExistingDisplay(channel) {
    const botUserId = this.client.user?.id;
    if (!botUserId) return null;

    try {
      let before;
      for (let page = 0; page < 10; page += 1) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        for (const message of batch.values()) {
          if (message.author.id !== botUserId) continue;

          // Recognize both the previous embed-based display and the new
          // Components V2 display so the first V2 deployment edits in place.
          const hasLegacyEmbed = message.embeds.some((embed) => embed.title === DISPLAY_TITLE);
          const hasV2Display = message.components.some(componentContainsDisplayTitle);
          if (hasLegacyEmbed || hasV2Display) return message;
        }
        if (batch.size < 100) break;
        before = batch.last()?.id;
        if (!before) break;
      }
    } catch (error) {
      this.logger.warn(
        'Could not scan Discord message history for the prior display. Grant Read Message History to avoid a replacement post after restart.',
        error?.message ?? error,
      );
    }
    return null;
  }

  async upsertDisplay() {
    const channel = await this.getChannel();
    if (!this.displayMessage) this.displayMessage = await this.findExistingDisplay(channel);

    const snapshot = await this.service.snapshot();
    const components = buildComponents(snapshot, this.config.displayTimeZone);
    const payload = {
      components,
      flags: MessageFlags.IsComponentsV2,
    };

    if (!this.displayMessage) {
      this.displayMessage = await channel.send(payload);
      this.logger.info(`Created Stream Guide display message ${this.displayMessage.id}`);
      return;
    }

    try {
      this.displayMessage = await this.displayMessage.edit({
        ...payload,
        // Clear the old fields when migrating the existing embed message to V2.
        content: null,
        embeds: [],
      });
    } catch (error) {
      if (error?.code !== RESTJSONErrorCodes.UnknownMessage) throw error;
      this.logger.warn('Display message was deleted; creating a replacement');
      this.displayMessage = await channel.send(payload);
    }
  }

  async refreshLoop() {
    const { signal } = this.abortController;
    while (!signal.aborted) {
      try {
        await this.upsertDisplay();
      } catch (error) {
        this.logger.error('Stream Guide refresh failed', error);
      }
      await abortableSleep(this.config.refreshSeconds * 1000, signal);
    }
  }
}
