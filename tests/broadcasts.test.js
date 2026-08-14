import assert from 'node:assert/strict';
import test from 'node:test';
import { BroadcastResolver } from '../src/broadcasts.js';
import { Broadcast, TournamentSummary } from '../src/models.js';

function summary(slug = 'tournament/ceo-2026') {
  return new TournamentSummary({
    id: 'ceo',
    name: 'CEO 2026',
    slug,
    startAt: 1,
    endAt: 2,
  });
}

test('official override supplies broadcast evidence when start.gg has no streams', () => {
  const resolver = new BroadcastResolver({
    overridesPath: 'config/broadcast-overrides.json',
    logger: { warn() {} },
  });

  const broadcasts = resolver.merge(summary(), []);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].streamName, 'Official CEO 2026 broadcast hub');
  assert.equal(broadcasts[0].streamSource, 'WEB');
  assert.equal(broadcasts[0].url, 'https://ceogaming.org/tv/');
  assert.equal(broadcasts[0].isOnline, null);
});

test('override is scoped to its exact tournament slug', () => {
  const resolver = new BroadcastResolver({
    overridesPath: 'config/broadcast-overrides.json',
    logger: { warn() {} },
  });

  assert.deepEqual(resolver.merge(summary('tournament/not-ceo'), []), []);
});

test('start.gg broadcasts are preserved when no override matches', () => {
  const resolver = new BroadcastResolver({
    overridesPath: 'config/broadcast-overrides.json',
    logger: { warn() {} },
  });
  const startgg = new Broadcast({
    id: 's1',
    streamName: 'vgbootcamp',
    streamSource: 'TWITCH',
    isOnline: false,
  });

  const broadcasts = resolver.merge(summary('tournament/another-major'), [startgg]);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0], startgg);
});

test('Twitch verification overrides stale start.gg live state without removing queue metadata', async () => {
  const twitch = {
    enabled: true,
    async liveStreams() {
      return new Map([
        ['vgbootcamp', {
          user_login: 'vgbootcamp',
          game_name: 'Super Smash Bros. Ultimate',
          title: 'Major Top 8',
        }],
      ]);
    },
  };
  const resolver = new BroadcastResolver({
    twitch,
    logger: { warn() {} },
  });
  const startgg = new Broadcast({
    id: 's1',
    streamName: 'vgbootcamp',
    streamSource: 'TWITCH',
    isOnline: false,
    queueSets: [{ id: 'set1' }],
  });

  const [broadcast] = await resolver.resolve(
    summary('tournament/another-major'),
    [startgg],
  );

  assert.equal(broadcast.isOnline, true);
  assert.equal(broadcast.streamGame, 'Super Smash Bros. Ultimate');
  assert.equal(broadcast.streamStatus, 'Major Top 8');
  assert.deepEqual(broadcast.queueSets, [{ id: 'set1' }]);
});

test('Twitch verification marks an attached Twitch channel offline when Helix reports no stream', async () => {
  const twitch = {
    enabled: true,
    async liveStreams() {
      return new Map([['vgbootcamp', null]]);
    },
  };
  const resolver = new BroadcastResolver({
    twitch,
    logger: { warn() {} },
  });
  const startgg = new Broadcast({
    id: 's1',
    streamName: 'vgbootcamp',
    streamSource: 'TWITCH',
    isOnline: true,
  });

  const [broadcast] = await resolver.resolve(
    summary('tournament/another-major'),
    [startgg],
  );

  assert.equal(broadcast.isOnline, false);
});
