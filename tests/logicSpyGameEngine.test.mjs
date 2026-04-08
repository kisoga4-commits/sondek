import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoundAssignments, calculateRoundScore, normalizeQuestionSets, pickQuestionSet } from '../games/logic-spy/js/gameEngine.js';

test('normalizeQuestionSets keeps only valid 4-option question entries', () => {
  const normalized = normalizeQuestionSets([
    {
      options: [{ value: 'a', hint: 'ha' }, { value: 'b', hint: 'hb' }, { value: 'c', hint: 'hc' }, { value: 'd', hint: 'hd' }],
      answer: 'd',
      explanation: 'd is odd',
    },
    {
      options: [{ value: 'a' }, { value: 'b' }],
      answer: 'a',
      explanation: '',
    },
    ['x', 'x', 'y', 'z'],
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].answer, 'd');
});

test('buildRoundAssignments shuffles 4 options and keeps correct answer (even with 3 players)', () => {
  const randomSteps = [0.99, 0, 0.5, 0];
  const result = buildRoundAssignments(
    ['u1', 'u2', 'u3'],
    {
      options: [{ value: 'x', hint: 'hx' }, { value: 'y', hint: 'hy' }, { value: 'z', hint: 'hz' }, { value: 'odd', hint: 'ho' }],
      answer: 'odd',
      explanation: 'odd',
    },
    () => randomSteps.shift() ?? 0,
  );

  assert.equal(result.correctAnswer, 'odd');
  assert.equal(result.optionsForRound.length, 4);
  assert.equal(result.optionsForRound.some((entry) => entry.value === 'odd'), true);
});

test('pickQuestionSet returns one question set', () => {
  const set = pickQuestionSet([{
    options: [{ value: 'a', hint: '' }, { value: 'b', hint: '' }, { value: 'c', hint: '' }, { value: 'd', hint: '' }],
    answer: 'd',
    explanation: 'd',
  }], () => 0);
  assert.equal(set.answer, 'd');
});

test('calculateRoundScore gives point on correct answer value', () => {
  const score = calculateRoundScore({
    correctAnswer: 'แมว',
    playerIds: ['u1', 'u2', 'u3'],
    votesByUid: { u1: 'แมว', u2: 'เสือ', u3: '' },
  });

  assert.deepEqual(score, { u1: 1, u2: 0, u3: 0 });
});
