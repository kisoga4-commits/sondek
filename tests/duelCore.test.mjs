import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPersonalQuestionLoop,
  buildQuestionLoop,
  getRoundState,
  normalizeRoomIdInput,
  ROOM_ID_LENGTH,
} from '../js/duelCore.js';

test('normalizeRoomIdInput keeps only digits and limits length', () => {
  assert.equal(normalizeRoomIdInput('ab12-34_56'), '123456');
  assert.equal(normalizeRoomIdInput('1234567890'), '123456');
  assert.equal(normalizeRoomIdInput(''), '');
  assert.equal(normalizeRoomIdInput('12 3', 4), '123');
  assert.equal(ROOM_ID_LENGTH, 6);
});

test('getRoundState returns waiting state when room has not started', () => {
  const state = getRoundState({
    startedAtMs: 0,
    questionSeconds: 4,
    revealSeconds: 0,
  });

  assert.equal(state.roundIndex, -1);
  assert.equal(state.questionSeconds, 5);
  assert.equal(state.revealSeconds, 0.8);
  assert.equal(state.questionRemainMs, 5000);
  assert.equal(state.isReveal, false);
});

test('getRoundState computes active question and reveal windows correctly', () => {
  const room = {
    startedAtMs: 1_000,
    questionSeconds: 10,
    revealSeconds: 1,
  };

  const inQuestion = getRoundState(room, { nowMs: 6_000 });
  assert.equal(inQuestion.roundIndex, 0);
  assert.equal(inQuestion.isReveal, false);
  assert.equal(inQuestion.questionRemainMs, 5000);

  const inReveal = getRoundState(room, { nowMs: 10_500 });
  assert.equal(inReveal.roundIndex, 0);
  assert.equal(inReveal.isReveal, false);

  const deepReveal = getRoundState(room, { nowMs: 11_500 });
  assert.equal(deepReveal.isReveal, true);

  const secondRound = getRoundState(room, { nowMs: 12_200 });
  assert.equal(secondRound.roundIndex, 1);
  assert.equal(secondRound.isReveal, false);
});

test('buildQuestionLoop expands shuffled ids to fixed loop size', () => {
  const questionBank = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const loop = buildQuestionLoop(questionBank, {
    loopQuestionCount: 8,
    shuffleFn: (ids) => [...ids],
  });

  assert.equal(loop.length, 8);
  assert.deepEqual(loop.slice(0, 3), ['1', '2', '3']);
  assert.deepEqual(loop.slice(3, 6), ['1', '2', '3']);
  assert.deepEqual(loop.slice(6), ['1', '2']);
});

test('buildQuestionLoop returns empty when inputs are invalid', () => {
  assert.deepEqual(buildQuestionLoop([], { shuffleFn: (ids) => ids }), []);
  assert.deepEqual(buildQuestionLoop([{ id: 1 }, { id: 2 }], { shuffleFn: null }), []);
});

test('buildQuestionLoop does not mutate source question bank', () => {
  const questionBank = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const snapshot = JSON.stringify(questionBank);
  buildQuestionLoop(questionBank, { loopQuestionCount: 6, shuffleFn: (ids) => ids.reverse() });
  assert.equal(JSON.stringify(questionBank), snapshot);
});

test('buildPersonalQuestionLoop is deterministic per actor key and differs across actors', () => {
  const questionBank = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const first = buildPersonalQuestionLoop(questionBank, 'actor-a', { loopQuestionCount: 8 });
  const second = buildPersonalQuestionLoop(questionBank, 'actor-a', { loopQuestionCount: 8 });
  const third = buildPersonalQuestionLoop(questionBank, 'actor-b', { loopQuestionCount: 8 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 8);
  assert.notDeepEqual(first, third);
});

test('buildPersonalQuestionLoop avoids immediate repeats across shuffle boundaries', () => {
  const questionBank = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const loop = buildPersonalQuestionLoop(questionBank, 'actor-z', { loopQuestionCount: 15 });
  for (let i = 1; i < loop.length; i += 1) {
    assert.notEqual(loop[i], loop[i - 1]);
  }
});
