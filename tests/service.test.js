import assert from 'node:assert/strict';
import test from 'node:test';
import { Broadcast, SmashEvent, TournamentDetail, TournamentSummary } from '../src/models.js';
import { GuideService } from '../src/service.js';

function config() {
  return {
    displayTimeZone: 'America/New_York',
    refreshSeconds: 60,
    discoveryRefreshSeconds: 300,
    minNotableOfflineEntrants: 64,
    minNotableOnlineEntrants: 128,
    minNotableAttendees: 100,
    maxWeeklyTournaments: 10,
    maxTodayTournaments: 5,
  };
}

function tournament({
  id = 't1',
  name = 'Test',
  attendees = 0,
  entrants = 0,
  tier = null,
  state = 'ACTIVE',
  startAt = 1,
  endAt = 2,
  events = null,
  timezone = null,
  city = 'Test City',
  addrState = 'TS',
  countryCode = 'US',
  eventStartAt = null,
} = {}) {
  const event = new SmashEvent({
    id: 'e1',
    name: 'Ultimate Singles',
    startAt: eventStartAt ?? startAt,
    state,
    numEntrants: entrants,
    competitionTier: tier,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
    gameDisplayName: 'Ultimate',
  });
  return new TournamentSummary({
    id,
    name,
    slug: `tournament/${id}`,
    startAt,
    endAt,
    timezone,
    city,
    addrState,
    countryCode,
    numAttendees: attendees,
    events: events ?? [event],
  });
}

test('notability requires bracket size, with attendance only as a missing-data fallback', () => {
  const service = new GuideService(config(), {});
  assert.equal(service.isNotable(tournament({ attendees: 100 })), true);
  assert.equal(service.isNotable(tournament({ entrants: 64 })), true);
  assert.equal(service.isNotable(tournament({ tier: 3 })), false);
  assert.equal(service.isNotable(tournament({ attendees: 20, entrants: 16 })), false);
});

test('online or location-unlisted tournaments use the higher entrant threshold', () => {
  const service = new GuideService(config(), {});
  const locationless = { city: null, addrState: null, countryCode: null };

  assert.equal(
    service.isNotable(tournament({ entrants: 127, ...locationless })),
    false,
  );
  assert.equal(
    service.isNotable(tournament({ entrants: 128, ...locationless })),
    true,
  );
  assert.equal(service.isNotable(tournament({ entrants: 64 })), true);
});

test('any listed location field uses the offline entrant threshold', () => {
  const service = new GuideService(config(), {});

  assert.equal(
    service.isNotable(
      tournament({ entrants: 64, city: null, addrState: null, countryCode: 'JP' }),
    ),
    true,
  );
});

test('week bounds are Monday to Monday', () => {
  const service = new GuideService(config(), {});
  const [start, end] = service.weekBounds(new Date('2026-08-09T14:30:00Z'));
  assert.equal(start.toISOString(), '2026-08-03T04:00:00.000Z');
  assert.equal(end.toISOString(), '2026-08-10T04:00:00.000Z');
});

test('week bounds preserve local midnight across DST', () => {
  const service = new GuideService(config(), {});
  const [start, end] = service.weekBounds(new Date('2026-03-08T16:00:00Z'));
  assert.equal(start.toISOString(), '2026-03-02T05:00:00.000Z');
  assert.equal(end.toISOString(), '2026-03-09T04:00:00.000Z');
});

test('weekly discovery starts at the current week boundary', async () => {
  const calls = [];
  const startgg = {
    async discoverWeek(afterDate, beforeDate) {
      calls.push({ afterDate, beforeDate });
      return [];
    },
  };
  const service = new GuideService(config(), startgg);
  await service.discover(new Date('2026-08-11T18:00:00Z'));

  assert.deepEqual(calls, [
    {
      afterDate: Math.floor(new Date('2026-08-10T04:00:00.000Z').getTime() / 1000),
      beforeDate: Math.floor(new Date('2026-08-17T04:00:00.000Z').getTime() / 1000),
    },
  ]);
});


test('concluded tournaments are removed when every Smash event is completed', () => {
  const service = new GuideService(config(), {});
  const now = new Date('2026-08-12T16:00:00Z');
  const summary = tournament({
    state: 'COMPLETED',
    startAt: Math.floor(new Date('2026-08-12T12:00:00Z').getTime() / 1000),
    endAt: Math.floor(new Date('2026-08-12T22:00:00Z').getTime() / 1000),
  });

  assert.equal(service.isConcluded(summary, now), true);
});

test('a tournament stays visible while any Smash event is not completed', () => {
  const service = new GuideService(config(), {});
  const now = new Date('2026-08-12T16:00:00Z');
  const completed = new SmashEvent({
    id: 'e1',
    name: 'Melee Singles',
    state: 'COMPLETED',
    gameId: '1',
    gameName: 'Super Smash Bros. Melee',
  });
  const active = new SmashEvent({
    id: 'e2',
    name: 'Ultimate Singles',
    state: 'ACTIVE',
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const summary = tournament({
    startAt: Math.floor(new Date('2026-08-12T12:00:00Z').getTime() / 1000),
    endAt: Math.floor(new Date('2026-08-12T22:00:00Z').getTime() / 1000),
    events: [completed, active],
  });

  assert.equal(service.isConcluded(summary, now), false);
});

test('a prior-day tournament cannot linger when start.gg completion state is stale', () => {
  const service = new GuideService(config(), {});
  const now = new Date('2026-08-12T16:00:00Z');
  const summary = tournament({
    state: 'ACTIVE',
    startAt: Math.floor(new Date('2026-08-11T12:00:00Z').getTime() / 1000),
    endAt: Math.floor(new Date('2026-08-11T23:00:00Z').getTime() / 1000),
  });

  assert.equal(service.isConcluded(summary, now), true);
});

test('a tournament may run late but disappears four hours after its scheduled end', () => {
  const service = new GuideService(config(), {});
  const summary = tournament({
    state: 'ACTIVE',
    startAt: Math.floor(new Date('2026-08-12T12:00:00Z').getTime() / 1000),
    endAt: Math.floor(new Date('2026-08-12T20:00:00Z').getTime() / 1000),
  });

  assert.equal(service.isConcluded(summary, new Date('2026-08-12T23:59:59Z')), false);
  assert.equal(service.isConcluded(summary, new Date('2026-08-13T00:00:00Z')), true);
});


test('scheduled-end grace still applies when a tournament runs past local midnight', () => {
  const service = new GuideService(config(), {});
  const summary = tournament({
    timezone: 'America/New_York',
    state: 'ACTIVE',
    startAt: Math.floor(new Date('2026-08-12T20:00:00Z').getTime() / 1000),
    endAt: Math.floor(new Date('2026-08-13T04:30:00Z').getTime() / 1000),
  });

  assert.equal(service.isConcluded(summary, new Date('2026-08-13T05:30:00Z')), false);
  assert.equal(service.isConcluded(summary, new Date('2026-08-13T08:30:00Z')), true);
});

test('happening today uses the tournament timezone instead of the display timezone', () => {
  const service = new GuideService(config(), {});
  // 00:30 Wednesday in London is still Tuesday evening in New York.
  const summary = tournament({
    timezone: 'Europe/London',
    startAt: Math.floor(new Date('2026-08-12T00:30:00Z').getTime() / 1000),
    endAt: Math.floor(new Date('2026-08-12T18:00:00Z').getTime() / 1000),
  });

  assert.equal(service.isToday(summary, new Date('2026-08-11T23:30:00Z')), true);
  assert.equal(service.isToday(summary, new Date('2026-08-11T22:30:00Z')), false);
});

test('invalid tournament timezone falls back to the configured display timezone', () => {
  const service = new GuideService(config(), {});
  const summary = tournament({
    timezone: 'Not/A_Time_Zone',
    startAt: Math.floor(new Date('2026-08-12T04:30:00Z').getTime() / 1000),
    endAt: Math.floor(new Date('2026-08-12T20:00:00Z').getTime() / 1000),
  });

  assert.equal(service.tournamentTimeZone(summary), 'America/New_York');
  assert.equal(service.isToday(summary, new Date('2026-08-12T12:00:00Z')), true);
});


test('series pages ignore historical bracket entrants when judging today', () => {
  const service = new GuideService(config(), {});
  const todayStart = Math.floor(new Date('2026-08-12T14:00:00Z').getTime() / 1000);
  const oldLarge = new SmashEvent({
    id: 'old',
    name: 'Ultimate Singles 2024',
    startAt: Math.floor(new Date('2024-08-12T14:00:00Z').getTime() / 1000),
    state: 'COMPLETED',
    numEntrants: 2000,
    competitionTier: 1,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const todayTiny = new SmashEvent({
    id: 'today',
    name: 'Ultimate Singles',
    startAt: todayStart,
    state: 'ACTIVE',
    numEntrants: 24,
    competitionTier: null,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const summary = tournament({
    attendees: 2000,
    startAt: todayStart,
    endAt: todayStart + 8 * 60 * 60,
    events: [oldLarge, todayTiny],
    timezone: 'America/New_York',
  });

  assert.equal(service.isSeriesContainer(summary), true);
  const relevant = service.relevantTodayEvents(summary, new Date('2026-08-12T16:00:00Z'));
  assert.deepEqual(relevant.map((event) => event.id), ['today']);
  assert.equal(service.isNotable(summary, relevant), false);
  assert.equal(service.isTodayNotable(summary, new Date('2026-08-12T16:00:00Z')), false);
});

test('series pages use only brackets scheduled in the current week for weekly notability', () => {
  const service = new GuideService(config(), {});
  const weekStart = new Date('2026-08-10T04:00:00Z');
  const weekEnd = new Date('2026-08-17T04:00:00Z');
  const oldLarge = new SmashEvent({
    id: 'old',
    name: 'Melee 2024',
    startAt: Math.floor(new Date('2024-01-10T18:00:00Z').getTime() / 1000),
    numEntrants: 2000,
    gameId: '1',
    gameName: 'Super Smash Bros. Melee',
  });
  const currentSmall = new SmashEvent({
    id: 'current',
    name: 'Melee Weekly',
    startAt: Math.floor(new Date('2026-08-14T18:00:00Z').getTime() / 1000),
    numEntrants: 32,
    gameId: '1',
    gameName: 'Super Smash Bros. Melee',
  });
  const summary = tournament({
    attendees: 2000,
    startAt: Math.floor(new Date('2026-08-14T17:00:00Z').getTime() / 1000),
    endAt: Math.floor(new Date('2026-08-14T23:00:00Z').getTime() / 1000),
    events: [oldLarge, currentSmall],
  });

  const relevant = service.relevantWeekEvents(summary, weekStart, weekEnd);
  assert.deepEqual(relevant.map((event) => event.id), ['current']);
  assert.equal(service.isNotable(summary, relevant), false);
});

test('compact multi-day tournaments keep their large bracket notable on later days', () => {
  const service = new GuideService(config(), {});
  const main = new SmashEvent({
    id: 'main',
    name: 'Ultimate Singles',
    startAt: Math.floor(new Date('2026-08-14T16:00:00Z').getTime() / 1000),
    state: 'ACTIVE',
    numEntrants: 512,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const summary = tournament({
    startAt: Math.floor(new Date('2026-08-14T14:00:00Z').getTime() / 1000),
    endAt: Math.floor(new Date('2026-08-16T23:00:00Z').getTime() / 1000),
    events: [main],
    timezone: 'America/New_York',
  });

  const saturday = new Date('2026-08-15T16:00:00Z');
  assert.equal(service.isSeriesContainer(summary), false);
  assert.equal(service.isToday(summary, saturday), true);
  assert.equal(service.isTodayNotable(summary, saturday), true);
});

test('competition tier alone does not make a tiny bracket notable', () => {
  const service = new GuideService(config(), {});
  const summary = tournament({ entrants: 12, attendees: 500, tier: 1 });
  assert.equal(service.isNotable(summary), false);
});

test('suspicious reused tournament pages are hydrated before notability is decided', async () => {
  const now = new Date('2026-08-12T16:00:00Z');
  const startAt = Math.floor(new Date('2026-08-12T14:00:00Z').getTime() / 1000);
  const partial = tournament({
    attendees: 2000,
    entrants: 2000,
    startAt,
    endAt: startAt + 8 * 60 * 60,
    eventStartAt: Math.floor(new Date('2024-08-12T14:00:00Z').getTime() / 1000),
  });
  const currentTiny = new SmashEvent({
    id: 'current',
    name: 'Ultimate Singles',
    startAt,
    state: 'ACTIVE',
    numEntrants: 24,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const hydrated = tournament({
    attendees: 2000,
    startAt,
    endAt: startAt + 8 * 60 * 60,
    events: [
      ...partial.events,
      currentTiny,
    ],
  });

  const calls = [];
  const startgg = {
    async discoverWeek() {
      return [partial];
    },
    async getTournamentSummary(id) {
      calls.push(id);
      return hydrated;
    },
    async getTournamentDetail() {
      throw new Error('should not select this tournament');
    },
  };

  const service = new GuideService(config(), startgg);
  await service.discover(now);

  assert.deepEqual(calls, ['t1']);
  assert.deepEqual(service.selected, []);
});


test('notable tournaments without a start.gg broadcast are omitted', async () => {
  const now = new Date('2026-08-12T16:00:00Z');
  const startAt = Math.floor(new Date('2026-08-12T14:00:00Z').getTime() / 1000);
  const summary = tournament({
    entrants: 256,
    startAt,
    endAt: startAt + 8 * 60 * 60,
    timezone: 'America/New_York',
  });

  const startgg = {
    async discoverWeek() {
      return [summary];
    },
    async getTournamentBroadcasts() {
      return [];
    },
    async getTournamentDetail() {
      throw new Error('streamless tournament should not be selected');
    },
  };

  const service = new GuideService(config(), startgg);
  await service.discover(now);

  assert.deepEqual(service.selected, []);
});

test('stream eligibility backfills a lower-ranked notable tournament', async () => {
  const now = new Date('2026-08-12T16:00:00Z');
  const friday = Math.floor(new Date('2026-08-14T14:00:00Z').getTime() / 1000);
  const saturday = Math.floor(new Date('2026-08-15T14:00:00Z').getTime() / 1000);

  const noStream = tournament({
    id: 'no-stream',
    name: 'Large But Unstreamed',
    entrants: 512,
    startAt: friday,
    endAt: friday + 8 * 60 * 60,
    timezone: 'America/New_York',
  });
  const streamed = tournament({
    id: 'streamed',
    name: 'Streamed Major',
    entrants: 256,
    startAt: saturday,
    endAt: saturday + 8 * 60 * 60,
    timezone: 'America/New_York',
  });

  const broadcast = new Broadcast({
    id: 'b1',
    enabled: true,
    isOnline: false,
    streamName: 'smashchannel',
    streamSource: 'TWITCH',
  });

  const localConfig = { ...config(), maxWeeklyTournaments: 1 };
  const startgg = {
    async discoverWeek() {
      return [noStream, streamed];
    },
    async getTournamentBroadcasts(id) {
      return id === 'streamed' ? [broadcast] : [];
    },
    async getTournamentDetail(id) {
      assert.equal(id, 'streamed');
      return new TournamentDetail(streamed, [broadcast]);
    },
  };

  const service = new GuideService(localConfig, startgg);
  await service.discover(now);

  assert.deepEqual(service.selected.map((item) => item.summary.id), ['streamed']);
});

test('a selected today tournament is removed if its start.gg broadcasts disappear', async () => {
  const now = new Date('2026-08-12T16:00:00Z');
  const startAt = Math.floor(new Date('2026-08-12T14:00:00Z').getTime() / 1000);
  const summary = tournament({
    entrants: 256,
    startAt,
    endAt: startAt + 8 * 60 * 60,
    timezone: 'America/New_York',
  });
  const broadcast = new Broadcast({
    id: 'b1',
    enabled: true,
    streamName: 'smashchannel',
    streamSource: 'TWITCH',
  });

  const startgg = {
    async getTournamentDetail() {
      return new TournamentDetail(summary, []);
    },
  };

  const service = new GuideService(config(), startgg);
  service.selected = [new TournamentDetail(summary, [broadcast])];

  await service.refreshTodayDetails(now);

  assert.deepEqual(service.selected, []);
});


test('series pages ignore earlier same-week brackets when judging an upcoming bracket', () => {
  const service = new GuideService(config(), {});
  const now = new Date('2026-08-13T04:53:00Z'); // 12:53 AM ET on Aug 13
  const weekStart = new Date('2026-08-10T04:00:00Z');
  const weekEnd = new Date('2026-08-17T04:00:00Z');

  const historical = new SmashEvent({
    id: 'historical',
    name: 'Alrest Series #8',
    startAt: Math.floor(new Date('2026-05-01T23:00:00Z').getTime() / 1000),
    state: 'COMPLETED',
    numEntrants: 180,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const aug11 = new SmashEvent({
    id: 'aug11',
    name: 'Alrest Series #12',
    startAt: Math.floor(new Date('2026-08-11T23:00:00Z').getTime() / 1000),
    state: 'COMPLETED',
    numEntrants: 134,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const aug13 = new SmashEvent({
    id: 'aug13',
    name: 'Alrest Series #13',
    startAt: Math.floor(new Date('2026-08-13T23:00:00Z').getTime() / 1000),
    state: 'ACTIVE',
    numEntrants: 9,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const summary = tournament({
    name: 'Alrest Series',
    attendees: 500,
    startAt: aug13.startAt,
    endAt: aug13.startAt + 5 * 60 * 60,
    timezone: 'America/New_York',
    events: [historical, aug11, aug13],
  });

  assert.equal(service.isSeriesContainer(summary), true);
  const relevant = service.relevantWeekEvents(summary, weekStart, weekEnd, now);
  assert.deepEqual(relevant.map((event) => event.id), ['aug13']);
  assert.equal(service.notabilityMetrics(summary, relevant).maxEntrants, 9);
  assert.equal(service.isNotable(summary, relevant), false);
});

test('series pages ignore stale prior-day brackets even if start.gg never marked them completed', () => {
  const service = new GuideService(config(), {});
  const now = new Date('2026-08-13T04:53:00Z');
  const weekStart = new Date('2026-08-10T04:00:00Z');
  const weekEnd = new Date('2026-08-17T04:00:00Z');

  const historical = new SmashEvent({
    id: 'historical',
    name: 'Old Series Bracket',
    startAt: Math.floor(new Date('2026-03-01T18:00:00Z').getTime() / 1000),
    state: 'COMPLETED',
    numEntrants: 256,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const staleAug11 = new SmashEvent({
    id: 'stale-aug11',
    name: 'Series #12',
    startAt: Math.floor(new Date('2026-08-11T23:00:00Z').getTime() / 1000),
    state: 'ACTIVE',
    numEntrants: 134,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const upcoming = new SmashEvent({
    id: 'upcoming',
    name: 'Series #13',
    startAt: Math.floor(new Date('2026-08-13T23:00:00Z').getTime() / 1000),
    state: 'ACTIVE',
    numEntrants: 9,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const summary = tournament({
    startAt: upcoming.startAt,
    endAt: upcoming.startAt + 5 * 60 * 60,
    timezone: 'America/New_York',
    events: [historical, staleAug11, upcoming],
  });

  const relevant = service.relevantWeekEvents(summary, weekStart, weekEnd, now);
  assert.deepEqual(relevant.map((event) => event.id), ['upcoming']);
});

test('an Alrest-style series with only a tiny upcoming bracket is not selected', async () => {
  const now = new Date('2026-08-13T04:53:00Z');
  const historical = new SmashEvent({
    id: 'historical',
    name: 'Alrest Series #8',
    startAt: Math.floor(new Date('2026-05-01T23:00:00Z').getTime() / 1000),
    state: 'COMPLETED',
    numEntrants: 180,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const aug11 = new SmashEvent({
    id: 'aug11',
    name: 'Alrest Series #12',
    startAt: Math.floor(new Date('2026-08-11T23:00:00Z').getTime() / 1000),
    state: 'COMPLETED',
    numEntrants: 134,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const aug13 = new SmashEvent({
    id: 'aug13',
    name: 'Alrest Series #13',
    startAt: Math.floor(new Date('2026-08-13T23:00:00Z').getTime() / 1000),
    state: 'ACTIVE',
    numEntrants: 9,
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
  });
  const summary = tournament({
    name: 'Alrest Series',
    attendees: 500,
    startAt: aug13.startAt,
    endAt: aug13.startAt + 5 * 60 * 60,
    timezone: 'America/New_York',
    events: [historical, aug11, aug13],
  });

  let broadcastChecks = 0;
  const startgg = {
    async discoverWeek() {
      return [summary];
    },
    async getTournamentSummary() {
      return summary;
    },
    async getTournamentBroadcasts() {
      broadcastChecks += 1;
      return [new Broadcast({
        id: 'stream',
        enabled: true,
        streamName: 'alrest',
        streamSource: 'TWITCH',
      })];
    },
  };

  const service = new GuideService(config(), startgg);
  await service.discover(now);

  assert.deepEqual(service.selected, []);
  assert.equal(broadcastChecks, 0);
});


test('official broadcast fallback can qualify a notable tournament with no start.gg streams', async () => {
  const now = new Date('2026-08-13T20:00:00Z');
  const friday = Math.floor(new Date('2026-08-14T16:00:00Z').getTime() / 1000);
  const summary = tournament({
    id: 'ceo',
    name: 'CEO 2026',
    entrants: 324,
    startAt: friday,
    endAt: friday + 2 * 24 * 60 * 60,
    timezone: 'America/New_York',
  });
  summary.slug = 'tournament/ceo-2026';

  const fallback = new Broadcast({
    id: 'override:ceo',
    streamName: 'Official CEO 2026 broadcast hub',
    streamSource: 'WEB',
    urlOverride: 'https://ceogaming.org/tv/',
    origin: 'override',
  });
  const resolver = {
    merge(candidateSummary, broadcasts) {
      return candidateSummary.slug === 'tournament/ceo-2026' && broadcasts.length === 0
        ? [fallback]
        : broadcasts;
    },
    async resolve(candidateSummary, broadcasts) {
      return this.merge(candidateSummary, broadcasts);
    },
  };
  const startgg = {
    async discoverWeek() {
      return [summary];
    },
    async getTournamentBroadcasts() {
      return [];
    },
    async getTournamentDetail() {
      return new TournamentDetail(summary, []);
    },
  };

  const service = new GuideService(config(), startgg, console, resolver);
  const snapshot = await service.snapshot(now);

  assert.deepEqual(snapshot.weekly.map((item) => item.summary.id), ['ceo']);
  assert.equal(snapshot.weekly[0].broadcasts[0].url, 'https://ceogaming.org/tv/');
});

test('official broadcast fallback still works when the start.gg streams query fails', async () => {
  const now = new Date('2026-08-13T20:00:00Z');
  const friday = Math.floor(new Date('2026-08-14T16:00:00Z').getTime() / 1000);
  const summary = tournament({
    id: 'ceo',
    name: 'CEO 2026',
    entrants: 324,
    startAt: friday,
    endAt: friday + 2 * 24 * 60 * 60,
    timezone: 'America/New_York',
  });
  summary.slug = 'tournament/ceo-2026';

  const fallback = new Broadcast({
    id: 'override:ceo',
    streamName: 'Official CEO 2026 broadcast hub',
    streamSource: 'WEB',
    urlOverride: 'https://ceogaming.org/tv/',
  });
  const resolver = {
    merge(candidateSummary, broadcasts) {
      return candidateSummary.slug === 'tournament/ceo-2026' ? [fallback, ...broadcasts] : broadcasts;
    },
    async resolve(candidateSummary, broadcasts) {
      return this.merge(candidateSummary, broadcasts);
    },
  };
  const startgg = {
    async discoverWeek() {
      return [summary];
    },
    async getTournamentBroadcasts() {
      throw new Error('start.gg stream metadata unavailable');
    },
    async getTournamentDetail() {
      return new TournamentDetail(summary, []);
    },
  };

  const service = new GuideService(config(), startgg, { warn() {}, error() {} }, resolver);
  const snapshot = await service.snapshot(now);

  assert.equal(snapshot.weekly.length, 1);
  assert.equal(snapshot.weekly[0].summary.id, 'ceo');
});


test('entrant count outranks competition tier when filling weekly slots', async () => {
  const now = new Date('2026-08-13T20:00:00Z');
  const friday = Math.floor(new Date('2026-08-14T16:00:00Z').getTime() / 1000);

  const ceo = tournament({
    id: 'ceo-2026',
    name: 'CEO 2026',
    entrants: 246,
    tier: null,
    startAt: friday,
    endAt: friday + 2 * 24 * 60 * 60,
    timezone: 'America/New_York',
  });
  ceo.slug = 'tournament/ceo-2026';

  const smallerTiered = Array.from({ length: 10 }, (_, index) =>
    tournament({
      id: `tiered-${index}`,
      name: `Tiered ${index}`,
      entrants: 80 + index,
      tier: 1,
      startAt: friday + index * 60,
      endAt: friday + 8 * 60 * 60,
      timezone: 'America/New_York',
    }),
  );

  const broadcast = new Broadcast({
    id: 'stream',
    enabled: true,
    streamName: 'stream',
    streamSource: 'TWITCH',
  });

  const startgg = {
    async discoverWeek() {
      return [ceo, ...smallerTiered];
    },
    async getTournamentBroadcasts() {
      return [broadcast];
    },
    async getTournamentDetail(id) {
      const summary = [ceo, ...smallerTiered].find((item) => item.id === id);
      return new TournamentDetail(summary, [broadcast]);
    },
  };

  const service = new GuideService(config(), startgg);
  await service.discover(now);

  assert.equal(service.selected.length, 10);
  assert.equal(service.selected.some((item) => item.summary.id === 'ceo-2026'), true);
  assert.equal(service.selected[0].summary.id, 'ceo-2026');
});

test('exact broadcast override slug is directly seeded when generic discovery misses CEO', async () => {
  const now = new Date('2026-08-13T21:08:00-04:00');
  const startAt = Math.floor(new Date('2026-08-14T12:00:00-04:00').getTime() / 1000);
  const endAt = Math.floor(new Date('2026-08-16T23:00:00-04:00').getTime() / 1000);
  const ceo = tournament({
    id: 'ceo-id',
    name: 'CEO 2026',
    entrants: 324,
    startAt,
    endAt,
    eventStartAt: startAt,
    timezone: 'America/New_York',
    city: 'Orlando',
    addrState: 'FL',
    countryCode: 'US',
  });
  ceo.slug = 'tournament/ceo-2026';

  const fallback = new Broadcast({
    id: 'override:ceo',
    enabled: true,
    isOnline: null,
    streamName: 'Official CEO 2026 broadcast hub',
    streamSource: 'WEB',
    urlOverride: 'https://ceogaming.org/tv/',
    origin: 'override',
  });

  const seededSlugs = [];
  const startgg = {
    async discoverWeek() {
      return []; // Reproduces the real failure: broad discovery misses CEO.
    },
    async getTournamentSummaryBySlug(slug) {
      seededSlugs.push(slug);
      return ceo;
    },
    async getTournamentBroadcasts() {
      return [];
    },
    async getTournamentDetail() {
      return new TournamentDetail(ceo, []);
    },
  };

  const resolver = {
    tournamentSlugs() {
      return ['tournament/ceo-2026'];
    },
    merge(summary, broadcasts) {
      return summary.slug === 'tournament/ceo-2026' ? [...broadcasts, fallback] : broadcasts;
    },
    async resolve(summary, broadcasts) {
      return this.merge(summary, broadcasts);
    },
  };

  const service = new GuideService(config(), startgg, { warn() {}, info() {} }, resolver);
  await service.discover(now);

  assert.deepEqual(seededSlugs, ['tournament/ceo-2026']);
  assert.deepEqual(service.selected.map((item) => item.summary.slug), ['tournament/ceo-2026']);
  assert.equal(service.selected[0].broadcasts[0].streamName, 'Official CEO 2026 broadcast hub');
});
