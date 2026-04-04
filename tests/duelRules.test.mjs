import test from 'node:test';
import assert from 'node:assert/strict';

import { getEffectiveFinishDistance } from '../js/duelRules.js';

test('returns base distance for non-worm modes', () => {
  const result = getEffectiveFinishDistance({
    gameMode: 'quick',
    matchType: 'party',
    teamSize: 3,
    finishDistance: 10,
  });
  assert.equal(result, 10);
});

test('returns base distance for worm solo mode', () => {
  const result = getEffectiveFinishDistance({
    gameMode: 'worm',
    matchType: 'solo',
    teamSize: 3,
    finishDistance: 20,
  });
  assert.equal(result, 20);
});

test('scales distance for worm party mode (team size 2)', () => {
  const result = getEffectiveFinishDistance({
    gameMode: 'worm',
    matchType: 'party',
    teamSize: 2,
    finishDistance: 10,
  });
  assert.equal(result, 20);
});

test('scales distance for worm party mode (team size 3)', () => {
  const result = getEffectiveFinishDistance({
    gameMode: 'worm',
    matchType: 'party',
    teamSize: 3,
    finishDistance: 10,
  });
  assert.equal(result, 30);
});
