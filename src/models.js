export const ULTIMATE_ID = '1386';
export const MELEE_ID = '1';
export const SMASH_GAME_IDS = Object.freeze([ULTIMATE_ID, MELEE_ID]);

export class SmashEvent {
  constructor({
    id,
    name,
    startAt = null,
    state = null,
    numEntrants = 0,
    competitionTier = null,
    gameId,
    gameName,
    gameDisplayName = null,
  }) {
    Object.assign(this, {
      id,
      name,
      startAt,
      state,
      numEntrants,
      competitionTier,
      gameId,
      gameName,
      gameDisplayName,
    });
  }

  get shortGame() {
    if (this.gameId === ULTIMATE_ID) return 'Ultimate';
    if (this.gameId === MELEE_ID) return 'Melee';
    return this.gameDisplayName || this.gameName;
  }
}

export class TournamentSummary {
  constructor({
    id,
    name,
    slug,
    startAt,
    endAt,
    timezone = null,
    city = null,
    addrState = null,
    countryCode = null,
    numAttendees = 0,
    events = [],
  }) {
    Object.assign(this, {
      id,
      name,
      slug,
      startAt,
      endAt,
      timezone,
      city,
      addrState,
      countryCode,
      numAttendees,
      events,
    });
  }

  get maxSmashEntrants() {
    return this.events.reduce((max, event) => Math.max(max, event.numEntrants || 0), 0);
  }

  get hasCompetitionTier() {
    // start.gg describes competitionTier as a rough competitive-importance
    // categorization, but does not document its numeric ordering. Presence is
    // useful as a signal without inventing meanings for the number itself.
    return this.events.some((event) => event.competitionTier != null);
  }

  get games() {
    return [...new Set(this.events.map((event) => event.shortGame).filter(Boolean))];
  }

  get url() {
    return `https://www.start.gg/${this.slug}`;
  }
}

export class QueueSet {
  constructor({
    id,
    fullRoundText = null,
    startAt = null,
    startedAt = null,
    completedAt = null,
    state = null,
    entrants = [],
    eventName = null,
    gameId = null,
    gameName = null,
    gameDisplayName = null,
  }) {
    Object.assign(this, {
      id,
      fullRoundText,
      startAt,
      startedAt,
      completedAt,
      state,
      entrants,
      eventName,
      gameId,
      gameName,
      gameDisplayName,
    });
  }

  get shortGame() {
    if (this.gameId === ULTIMATE_ID) return 'Ultimate';
    if (this.gameId === MELEE_ID) return 'Melee';
    return this.gameDisplayName || this.gameName || null;
  }

  get matchup() {
    const names = this.entrants.filter(Boolean);
    if (names.length >= 2) return `${names[0]} vs ${names[1]}`;
    return names[0] ?? null;
  }

  get isStarted() {
    return this.startedAt != null && this.completedAt == null;
  }

  get isCompleted() {
    return this.completedAt != null;
  }
}

export class Broadcast {
  constructor({
    id,
    enabled = null,
    isOnline = null,
    streamName = null,
    streamSource = null,
    streamGame = null,
    streamStatus = null,
    urlOverride = null,
    origin = 'startgg',
    queueSets = [],
  }) {
    Object.assign(this, {
      id,
      enabled,
      isOnline,
      streamName,
      streamSource,
      streamGame,
      streamStatus,
      urlOverride,
      origin,
      queueSets,
    });
  }

  get url() {
    if (this.urlOverride) return this.urlOverride;
    if (!this.streamName || !this.streamSource) return null;
    const source = this.streamSource.toUpperCase();
    if (source === 'TWITCH') {
      return `https://www.twitch.tv/${encodeURIComponent(this.streamName)}`;
    }
    if (source === 'YOUTUBE') {
      // Organizer data can contain different identifier shapes. A search URL is
      // safer than pretending every streamName is a YouTube channel/video ID.
      return `https://www.youtube.com/results?search_query=${encodeURIComponent(this.streamName)}`;
    }
    return null;
  }

  currentAndNext() {
    const activeIndex = this.queueSets.findIndex((queueSet) => queueSet.isStarted);
    if (activeIndex >= 0) {
      const current = this.queueSets[activeIndex];
      const nextSet = this.queueSets.slice(activeIndex + 1).find((queueSet) => !queueSet.isCompleted) ?? null;
      return [current, nextSet];
    }

    // streamQueue is ordered, but without startedAt we do not claim that a set
    // is currently on stream. The first unfinished set is only the next queue item.
    const nextSet = this.queueSets.find((queueSet) => !queueSet.isCompleted) ?? null;
    return [null, nextSet];
  }
}

export class TournamentDetail {
  constructor(summary, broadcasts = [], relevantEvents = null) {
    this.summary = summary;
    this.broadcasts = broadcasts;
    // GuideService supplies the exact bracket set that made this tournament
    // relevant for the current snapshot. Keeping it with the detail prevents
    // the display from accidentally re-counting historical series brackets.
    this.relevantEvents = relevantEvents ?? summary.events ?? [];
  }
}

export class GuideSnapshot {
  constructor({ generatedAt, weekStart, weekEnd, weekly, today, errorNote = null }) {
    Object.assign(this, { generatedAt, weekStart, weekEnd, weekly, today, errorNote });
  }
}

export function safeInt(value, defaultValue = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : defaultValue;
}
