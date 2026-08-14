import { readFileSync } from 'node:fs';
import { Broadcast } from './models.js';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function broadcastKey(broadcast) {
  const source = clean(broadcast.streamSource).toUpperCase();
  const name = clean(broadcast.streamName).toLowerCase();
  const url = clean(broadcast.urlOverride || broadcast.url).toLowerCase();
  return `${source}|${name}|${url}`;
}

function overrideMatches(rule, summary) {
  const slug = clean(summary.slug).toLowerCase();
  const id = clean(summary.id).toLowerCase();

  if (rule.tournamentId && clean(rule.tournamentId).toLowerCase() !== id) return false;
  if (rule.tournamentSlug && clean(rule.tournamentSlug).toLowerCase() !== slug) return false;

  if (rule.namePattern) {
    try {
      if (!new RegExp(rule.namePattern, 'i').test(summary.name ?? '')) return false;
    } catch {
      return false;
    }
  }

  return Boolean(rule.tournamentId || rule.tournamentSlug || rule.namePattern);
}

function parseOverrideBroadcast(item, ruleIndex, itemIndex) {
  const streamName = clean(item.streamName) || 'Official broadcast information';
  const streamSource = clean(item.streamSource).toUpperCase() || 'WEB';
  const urlOverride = clean(item.url) || null;

  if (!urlOverride && (!streamName || !streamSource)) return null;

  return new Broadcast({
    id: `override:${ruleIndex}:${itemIndex}:${streamSource}:${streamName}`,
    enabled: true,
    isOnline: null,
    streamName,
    streamSource,
    streamGame: clean(item.streamGame) || null,
    streamStatus: clean(item.streamStatus) || null,
    urlOverride,
    origin: 'override',
  });
}

export class BroadcastResolver {
  constructor({ overridesPath = null, twitch = null, logger = console } = {}) {
    this.overridesPath = overridesPath;
    this.twitch = twitch;
    this.logger = logger;
    this.rules = this.loadRules();
  }

  loadRules() {
    if (!this.overridesPath) return [];

    try {
      const raw = readFileSync(this.overridesPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.logger.warn(`Broadcast override file ${this.overridesPath} must contain a JSON array`);
        return [];
      }
      return parsed;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.logger.warn(`Broadcast override file ${this.overridesPath} was not found`);
      } else {
        this.logger.warn(
          `Could not load broadcast overrides from ${this.overridesPath}: ${error?.message ?? error}`,
        );
      }
      return [];
    }
  }

  tournamentSlugs() {
    return [...new Set(
      this.rules
        .map((rule) => clean(rule.tournamentSlug))
        .filter(Boolean),
    )];
  }

  overrideBroadcasts(summary) {
    const broadcasts = [];
    this.rules.forEach((rule, ruleIndex) => {
      if (!overrideMatches(rule, summary)) return;
      (rule.broadcasts ?? []).forEach((item, itemIndex) => {
        const broadcast = parseOverrideBroadcast(item, ruleIndex, itemIndex);
        if (broadcast) broadcasts.push(broadcast);
      });
    });
    return broadcasts;
  }

  merge(summary, startggBroadcasts = []) {
    const merged = new Map();

    // Keep start.gg first so queue/set metadata wins when an override names the
    // same channel.
    for (const broadcast of startggBroadcasts ?? []) {
      merged.set(broadcastKey(broadcast), broadcast);
    }

    for (const broadcast of this.overrideBroadcasts(summary)) {
      const key = broadcastKey(broadcast);
      if (!merged.has(key)) merged.set(key, broadcast);
    }

    return [...merged.values()];
  }

  async resolve(summary, startggBroadcasts = []) {
    const broadcasts = this.merge(summary, startggBroadcasts)
      .filter((broadcast) => broadcast.enabled !== false);

    if (!this.twitch?.enabled) return this.sort(broadcasts);

    const twitchBroadcasts = broadcasts.filter(
      (broadcast) =>
        clean(broadcast.streamSource).toUpperCase() === 'TWITCH' &&
        clean(broadcast.streamName),
    );

    if (!twitchBroadcasts.length) return this.sort(broadcasts);

    try {
      const live = await this.twitch.liveStreams(
        twitchBroadcasts.map((broadcast) => broadcast.streamName),
      );
      if (live == null) return this.sort(broadcasts);

      for (const broadcast of twitchBroadcasts) {
        const info = live.get(clean(broadcast.streamName).toLowerCase()) ?? null;
        broadcast.isOnline = Boolean(info);
        if (info) {
          // Twitch is authoritative for live/offline state. Preserve start.gg's
          // Smash-specific streamGame when present; otherwise use Twitch's live
          // category and title as reliable platform metadata.
          if (!broadcast.streamGame && info.game_name) broadcast.streamGame = info.game_name;
          if (info.title) broadcast.streamStatus = info.title;
        }
      }
    } catch (error) {
      // Twitch verification is an accuracy enhancement, never a reason to hide
      // otherwise credible broadcast information.
      this.logger.warn(`Could not verify Twitch live status: ${error?.message ?? error}`);
    }

    return this.sort(broadcasts);
  }

  sort(broadcasts) {
    return [...broadcasts].sort((a, b) => {
      if ((a.isOnline === true) !== (b.isOnline === true)) return a.isOnline === true ? -1 : 1;
      return (a.streamName ?? '').localeCompare(b.streamName ?? '', undefined, {
        sensitivity: 'base',
      });
    });
  }
}
