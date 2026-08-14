import {
  Broadcast,
  QueueSet,
  SMASH_GAME_IDS,
  SmashEvent,
  TournamentDetail,
  TournamentSummary,
  safeInt,
} from './models.js';

const STARTGG_ENDPOINT = 'https://api.start.gg/gql/alpha';

const DISCOVERY_QUERY = String.raw`
query WeeklySmashTournaments(
  $page: Int!
  $perPage: Int!
  $afterDate: Timestamp!
  $beforeDate: Timestamp!
  $videogameIds: [ID]!
) {
  tournaments(query: {
    page: $page
    perPage: $perPage
    sortBy: "startAt asc"
    filter: {
      afterDate: $afterDate
      beforeDate: $beforeDate
      published: true
      videogameIds: $videogameIds
    }
  }) {
    pageInfo { page perPage total totalPages }
    nodes {
      id name slug startAt endAt timezone city addrState countryCode numAttendees
      events(limit: 8, filter: { videogameId: $videogameIds, published: true }) {
        id name startAt state numEntrants competitionTier
        videogame { id name displayName }
      }
    }
  }
}
`;

const SUMMARY_QUERY = String.raw`
query StreamGuideTournamentSummary($id: ID!, $videogameIds: [ID]!) {
  tournament(id: $id) {
    id name slug startAt endAt timezone city addrState countryCode numAttendees
    events(filter: { videogameId: $videogameIds, published: true }) {
      id name startAt state numEntrants competitionTier
      videogame { id name displayName }
    }
  }
}
`;

const STREAMS_QUERY = String.raw`
query StreamGuideTournamentStreams($id: ID!) {
  tournament(id: $id) {
    streams { id enabled isOnline streamName streamSource streamGame streamStatus }
  }
}
`;

const DETAIL_QUERY = String.raw`
query StreamGuideTournament($id: ID!, $videogameIds: [ID]!) {
  tournament(id: $id) {
    id name slug startAt endAt timezone city addrState countryCode numAttendees
    events(filter: { videogameId: $videogameIds, published: true }) {
      id name startAt state numEntrants competitionTier
      videogame { id name displayName }
    }
    streams { id enabled isOnline streamName streamSource streamGame streamStatus }
  }
}
`;

const QUEUE_QUERY = String.raw`
query StreamGuideQueue($id: ID!) {
  streamQueue(tournamentId: $id, includePlayerStreams: false) {
    stream { id enabled isOnline streamName streamSource streamGame streamStatus }
    sets {
      id fullRoundText startAt startedAt completedAt state
      slots { entrant { id name } }
      event { id name videogame { id name displayName } }
    }
  }
}
`;

export class StartGGError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'StartGGError';
  }
}

class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release() {
    this.active -= 1;
    this.waiters.shift()?.();
  }

  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return 2000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 15_000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 0), 15_000);
  return 2000;
}

export class StartGGClient {
  constructor(token, maxDiscoveryPages = 30, logger = console) {
    this.token = token;
    this.maxDiscoveryPages = maxDiscoveryPages;
    this.logger = logger;
    this.semaphore = new Semaphore(4);
  }

  async graphql(query, variables, operationName) {
    return this.semaphore.run(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response;
        let payload;
        try {
          response = await fetch(STARTGG_ENDPOINT, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Content-Type': 'application/json',
              'User-Agent': 'stream-guide-discord-bot/2.0',
            },
            body: JSON.stringify({ query, variables, operationName }),
            signal: AbortSignal.timeout(20_000),
          });

          if (response.status === 429) {
            const wait = retryAfterMs(response);
            this.logger.warn(`start.gg rate limited request; retrying in ${(wait / 1000).toFixed(1)}s`);
            await sleep(wait);
            continue;
          }
          if (response.status >= 500 && attempt < 2) {
            await sleep(1500 * (attempt + 1));
            continue;
          }
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new StartGGError(`start.gg HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
          }
          payload = await response.json();
        } catch (error) {
          if (error instanceof StartGGError) throw error;
          if (attempt < 2) {
            await sleep(1500 * (attempt + 1));
            continue;
          }
          throw new StartGGError(`start.gg request failed: ${error.message}`, { cause: error });
        }

        if (payload?.errors?.length) {
          throw new StartGGError(`start.gg GraphQL error: ${JSON.stringify(payload.errors)}`);
        }
        if (payload?.success === false) {
          throw new StartGGError(payload.message || 'start.gg request failed');
        }
        if (!payload?.data || typeof payload.data !== 'object') {
          throw new StartGGError('start.gg returned no data');
        }
        return payload.data;
      }
      throw new StartGGError('start.gg request failed after retries');
    });
  }

  async discoverWeek(afterDate, beforeDate) {
    const tournaments = [];
    const perPage = 50;
    let page = 1;
    let reachedLimit = false;

    while (page <= this.maxDiscoveryPages) {
      const data = await this.graphql(
        DISCOVERY_QUERY,
        { page, perPage, afterDate, beforeDate, videogameIds: [...SMASH_GAME_IDS] },
        'WeeklySmashTournaments',
      );
      const connection = data.tournaments ?? {};
      const nodes = connection.nodes ?? [];
      tournaments.push(...nodes.filter(Boolean).map((node) => this.parseSummary(node)));

      const totalPages = safeInt(connection.pageInfo?.totalPages, page);
      if (!nodes.length || page >= totalPages) break;
      if (page === this.maxDiscoveryPages) reachedLimit = true;
      page += 1;
    }

    if (reachedLimit) {
      this.logger.warn(`Reached STARTGG_MAX_DISCOVERY_PAGES=${this.maxDiscoveryPages}; weekly discovery may be incomplete`);
    }
    return tournaments;
  }

  async getTournamentSummary(tournamentId) {
    const data = await this.graphql(
      SUMMARY_QUERY,
      { id: tournamentId, videogameIds: [...SMASH_GAME_IDS] },
      'StreamGuideTournamentSummary',
    );
    const node = data.tournament;
    if (!node) throw new StartGGError(`Tournament ${tournamentId} was not found`);
    return this.parseSummary(node);
  }

  async getTournamentBroadcasts(tournamentId) {
    const data = await this.graphql(
      STREAMS_QUERY,
      { id: tournamentId },
      'StreamGuideTournamentStreams',
    );
    const node = data.tournament;
    if (!node) throw new StartGGError(`Tournament ${tournamentId} was not found`);

    return (node.streams ?? [])
      .map((stream) => this.parseBroadcast(stream))
      .filter((broadcast) => broadcast.enabled !== false)
      .sort((a, b) => {
        if ((a.isOnline === true) !== (b.isOnline === true)) return a.isOnline === true ? -1 : 1;
        return (a.streamName ?? '').localeCompare(b.streamName ?? '', undefined, { sensitivity: 'base' });
      });
  }

  async getTournamentDetail(tournamentId) {
    const data = await this.graphql(
      DETAIL_QUERY,
      { id: tournamentId, videogameIds: [...SMASH_GAME_IDS] },
      'StreamGuideTournament',
    );
    const node = data.tournament;
    if (!node) throw new StartGGError(`Tournament ${tournamentId} was not found`);

    const summary = this.parseSummary(node);
    const streams = node.streams ?? [];
    let queues = [];
    try {
      const queueData = await this.graphql(
        QUEUE_QUERY,
        { id: tournamentId },
        'StreamGuideQueue',
      );
      queues = queueData.streamQueue ?? [];
    } catch (error) {
      if (!(error instanceof StartGGError)) throw error;
      // Top-level stream metadata remains useful even when queue detail fails.
      this.logger.warn(`Could not load stream queue for tournament ${tournamentId}: ${error.message}`);
    }

    const broadcastsById = new Map();
    for (const stream of streams) {
      const broadcast = this.parseBroadcast(stream);
      broadcastsById.set(broadcast.id, broadcast);
    }

    for (const queue of queues) {
      const broadcast = this.parseBroadcast(queue.stream ?? {});
      const existing = broadcastsById.get(broadcast.id) ?? broadcast;
      if (!broadcastsById.has(broadcast.id)) broadcastsById.set(broadcast.id, existing);

      existing.enabled = broadcast.enabled;
      existing.isOnline = broadcast.isOnline;
      existing.streamName = broadcast.streamName || existing.streamName;
      existing.streamSource = broadcast.streamSource || existing.streamSource;
      existing.streamGame = broadcast.streamGame || existing.streamGame;
      existing.streamStatus = broadcast.streamStatus || existing.streamStatus;
      existing.queueSets = (queue.sets ?? []).filter(Boolean).map((set) => this.parseQueueSet(set));
    }

    const broadcasts = [...broadcastsById.values()]
      .filter((broadcast) => broadcast.enabled !== false)
      .sort((a, b) => {
        if ((a.isOnline === true) !== (b.isOnline === true)) return a.isOnline === true ? -1 : 1;
        return (a.streamName ?? '').localeCompare(b.streamName ?? '', undefined, { sensitivity: 'base' });
      });

    return new TournamentDetail(summary, broadcasts);
  }

  parseSummary(node) {
    const events = (node.events ?? []).flatMap((event) => {
      const game = event.videogame ?? {};
      if (!SMASH_GAME_IDS.includes(String(game.id))) return [];
      return [
        new SmashEvent({
          id: String(event.id ?? ''),
          name: event.name || 'Unnamed event',
          startAt: event.startAt ?? null,
          state: event.state ?? null,
          numEntrants: safeInt(event.numEntrants),
          competitionTier: event.competitionTier ?? null,
          gameId: String(game.id ?? ''),
          gameName: game.name || 'Smash',
          gameDisplayName: game.displayName ?? null,
        }),
      ];
    });

    return new TournamentSummary({
      id: String(node.id ?? ''),
      name: node.name || 'Unnamed tournament',
      slug: node.slug || '',
      startAt: safeInt(node.startAt),
      endAt: safeInt(node.endAt ?? node.startAt),
      timezone: node.timezone ?? null,
      city: node.city ?? null,
      addrState: node.addrState ?? null,
      countryCode: node.countryCode ?? null,
      numAttendees: safeInt(node.numAttendees),
      events,
    });
  }

  parseBroadcast(stream) {
    const id = String(stream.id ?? `${stream.streamSource}:${stream.streamName}`);
    return new Broadcast({
      id,
      enabled: stream.enabled ?? null,
      isOnline: stream.isOnline ?? null,
      streamName: stream.streamName ?? null,
      streamSource: stream.streamSource ?? null,
      streamGame: stream.streamGame ?? null,
      streamStatus: stream.streamStatus ?? null,
    });
  }

  parseQueueSet(item) {
    const event = item.event ?? {};
    const game = event.videogame ?? {};
    const entrants = (item.slots ?? [])
      .map((slot) => slot?.entrant?.name)
      .filter(Boolean);

    return new QueueSet({
      id: String(item.id ?? ''),
      fullRoundText: item.fullRoundText ?? null,
      startAt: item.startAt ?? null,
      startedAt: item.startedAt ?? null,
      completedAt: item.completedAt ?? null,
      state: item.state ?? null,
      entrants,
      eventName: event.name ?? null,
      gameId: game.id == null ? null : String(game.id),
      gameName: game.name ?? null,
      gameDisplayName: game.displayName ?? null,
    });
  }
}
