import assert from 'node:assert/strict';
import test from 'node:test';
import { Broadcast, QueueSet } from '../src/models.js';

function qset(id, { startedAt = null, completedAt = null, entrants = ['A', 'B'] } = {}) {
  return new QueueSet({
    id,
    fullRoundText: 'Winners Quarters',
    startedAt,
    completedAt,
    entrants,
    eventName: 'Ultimate Singles',
    gameId: '1386',
    gameName: 'Super Smash Bros. Ultimate',
    gameDisplayName: 'Ultimate',
  });
}

test('stream queue returns current and next set', () => {
  const broadcast = new Broadcast({
    id: 's1',
    enabled: true,
    isOnline: true,
    streamName: 'channel',
    streamSource: 'TWITCH',
    queueSets: [
      qset('done', { startedAt: 1, completedAt: 2 }),
      qset('live', { startedAt: 3 }),
      qset('next'),
    ],
  });
  const [current, nextSet] = broadcast.currentAndNext();
  assert.equal(current?.id, 'live');
  assert.equal(nextSet?.id, 'next');
});

test('stream queue does not guess a current match', () => {
  const broadcast = new Broadcast({
    id: 's1',
    enabled: true,
    isOnline: true,
    streamName: 'channel',
    streamSource: 'TWITCH',
    queueSets: [qset('queued')],
  });
  const [current, nextSet] = broadcast.currentAndNext();
  assert.equal(current, null);
  assert.equal(nextSet?.id, 'queued');
});
