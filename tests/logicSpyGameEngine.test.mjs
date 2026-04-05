import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoundAssignments, calculateRoundScore, normalizeWordSets, pickWordSet } from '../games/logic-spy/js/gameEngine.js';

test('normalizeWordSets keeps only valid 4-word entries and removes duplicated words', () => {
  const normalized = normalizeWordSets([
    ['a', 'b', 'c', 'd'],
    ['a', 'b'],
    ['a', '', 'c', 'd'],
    ['x', 'x', 'y', 'z'],
  ]);

  assert.deepEqual(normalized, [['a', 'b', 'c', 'd']]);
});

test('buildRoundAssignments assigns exactly one odd player and rotates common words', () => {
  const randomSteps = [0.99, 0, 0.5, 0];
  const result = buildRoundAssignments(
    ['u1', 'u2', 'u3', 'u4'],
    ['x', 'y', 'z', 'odd'],
    () => randomSteps.shift() ?? 0,
  );

  assert.equal(result.oddUid, 'u4');
  assert.equal(result.secretWordsByUid.u4, 'odd');

  const commonWords = [
    result.secretWordsByUid.u1,
    result.secretWordsByUid.u2,
    result.secretWordsByUid.u3,
  ];

  assert.deepEqual(new Set(commonWords), new Set(['x', 'y', 'z']));
});

test('pickWordSet returns one 4-word set', () => {
  const set = pickWordSet([['a', 'b', 'c', 'd']], () => 0);
  assert.deepEqual(set, ['a', 'b', 'c', 'd']);
});

test('calculateRoundScore ignores self vote and invalid target', () => {
  const score = calculateRoundScore({
    oddUid: 'u3',
    playerIds: ['u1', 'u2', 'u3'],
    votesByUid: { u1: 'u3', u2: 'u2', u3: 'nobody' },
  });

  assert.deepEqual(score, { u1: 1, u2: 0, u3: 1 });
});
