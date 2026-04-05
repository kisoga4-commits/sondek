import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoundAssignments, calculateRoundScore, normalizeWordSets, pickWordSet } from '../games/logic-spy/js/gameEngine.js';

test('normalizeWordSets keeps only valid 4-word entries', () => {
  const normalized = normalizeWordSets([['a', 'b', 'c', 'd'], ['a', 'b'], ['a', '', 'c', 'd']]);
  assert.deepEqual(normalized, [['a', 'b', 'c', 'd']]);
});

test('buildRoundAssignments assigns odd word to one player', () => {
  const result = buildRoundAssignments(['u1', 'u2', 'u3'], ['x', 'y', 'z', 'odd'], () => 0.99);
  assert.equal(result.oddUid, 'u3');
  assert.equal(result.secretWordsByUid.u1, 'x');
  assert.equal(result.secretWordsByUid.u3, 'odd');
});

test('pickWordSet returns one 4-word set', () => {
  const set = pickWordSet([['a', 'b', 'c', 'd']], () => 0);
  assert.deepEqual(set, ['a', 'b', 'c', 'd']);
});

test('calculateRoundScore follows voting rules', () => {
  const score = calculateRoundScore({ oddUid: 'u3', playerIds: ['u1', 'u2', 'u3'], votesByUid: { u1: 'u3', u2: 'u1' } });
  assert.deepEqual(score, { u1: 1, u2: 0, u3: 1 });
});
