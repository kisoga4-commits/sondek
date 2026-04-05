import test from 'node:test';
import assert from 'node:assert/strict';

import { getEffectiveFinishDistance, getWormWrongPenalty, pickWormComboTargetUid } from '../js/duelRules.js';

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

test('worm wrong streak applies 2/3/5 second stun and self penalty on third wrong', () => {
  assert.deepEqual(getWormWrongPenalty(1), {
    stunMs: 2000,
    distancePenalty: 0,
    message: 'ผิดสะสม: STUN 2 วินาที',
  });
  assert.deepEqual(getWormWrongPenalty(2), {
    stunMs: 3000,
    distancePenalty: 0,
    message: 'ผิดสะสม: STUN 3 วินาที',
  });
  assert.deepEqual(getWormWrongPenalty(3), {
    stunMs: 5000,
    distancePenalty: 1,
    message: 'ผิดสะสม: STUN 5 วินาที + ถอย -1',
  });
});

test('worm combo attack targets highest-score opponent outside actor team', () => {
  const players = {
    self: { uid: 'self', teamId: 'A', distance: 5 },
    mate: { uid: 'mate', teamId: 'A', distance: 9 },
    opp1: { uid: 'opp1', teamId: 'B', distance: 8 },
    opp2: { uid: 'opp2', teamId: 'B', distance: 6 },
  };
  const targetUid = pickWormComboTargetUid(players, 'self', 'A', 0.5);
  assert.equal(targetUid, 'opp1');
});

test('worm combo attack in solo with two players always targets the opponent', () => {
  const players = {
    self: { uid: 'self', teamId: null, distance: 5 },
    opp: { uid: 'opp', teamId: null, distance: 8 },
  };
  const targetUid = pickWormComboTargetUid(players, 'self', '', 0.5);
  assert.equal(targetUid, 'opp');
});

test('worm combo attack in solo with multiple players targets highest score excluding self', () => {
  const players = {
    self: { uid: 'self', teamId: null, distance: 5 },
    p1: { uid: 'p1', teamId: null, distance: 7 },
    p2: { uid: 'p2', teamId: null, distance: 9 },
    p3: { uid: 'p3', teamId: null, distance: 8 },
  };
  const targetUid = pickWormComboTargetUid(players, 'self', '', 0.5);
  assert.equal(targetUid, 'p2');
});

test('worm combo attack still targets opponent when actorTeamId payload is missing', () => {
  const players = {
    self: { uid: 'self', teamId: 'A', distance: 5 },
    mate: { uid: 'mate', teamId: 'A', distance: 9 },
    opp1: { uid: 'opp1', teamId: 'B', distance: 8 },
    opp2: { uid: 'opp2', teamId: 'B', distance: 6 },
  };
  const targetUid = pickWormComboTargetUid(players, 'self', '', 0.5);
  assert.equal(targetUid, 'opp1');
});

test('worm combo attack randomizes when top opponent scores tie', () => {
  const players = {
    self: { uid: 'self', teamId: 'A', distance: 5 },
    opp1: { uid: 'opp1', teamId: 'B', distance: 8 },
    opp2: { uid: 'opp2', teamId: 'B', distance: 8 },
  };
  assert.equal(pickWormComboTargetUid(players, 'self', 'A', 0.1), 'opp1');
  assert.equal(pickWormComboTargetUid(players, 'self', 'A', 0.9), 'opp2');
});
