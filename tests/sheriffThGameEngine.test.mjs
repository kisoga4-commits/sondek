import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWinnerSummary,
  buildSheriffQueue,
  computePlayerTotals,
  createEmptyPile,
  createInitialDeck,
  createPlayer,
  discardCard,
  drawCard,
  reshuffleDiscard,
} from '../games/sheriff-th/js/gameEngine.js';

test('buildSheriffQueue includes each player exactly roundsPerPlayer times', () => {
  const queue = buildSheriffQueue(['p1', 'p2', 'p3'], 2, () => 0.1);
  assert.equal(queue.length, 6);
  assert.equal(queue.filter((id) => id === 'p1').length, 2);
  assert.equal(queue.filter((id) => id === 'p2').length, 2);
  assert.equal(queue.filter((id) => id === 'p3').length, 2);
});

test('draw and discard update deck/hand/discard correctly', () => {
  const base = {
    players: [createPlayer('A', 'p1')],
    deck: createInitialDeck(),
    discard: createEmptyPile(),
  };

  const drew = drawCard(base, { playerId: 'p1', cardId: 'rice', qty: 2 });
  assert.equal(drew.ok, true);
  assert.equal(drew.room.deck.rice, 12);
  assert.equal(drew.room.players[0].hand.rice, 2);

  const discarded = discardCard(drew.room, { playerId: 'p1', cardId: 'rice', qty: 1 });
  assert.equal(discarded.ok, true);
  assert.equal(discarded.room.players[0].hand.rice, 1);
  assert.equal(discarded.room.discard.rice, 1);
});

test('reshuffleDiscard moves all discard cards back to deck', () => {
  const room = {
    players: [],
    deck: { ...createEmptyPile(), rice: 5 },
    discard: { ...createEmptyPile(), rice: 3, egg: 2 },
  };
  const next = reshuffleDiscard(room);
  assert.equal(next.deck.rice, 8);
  assert.equal(next.deck.egg, 2);
  assert.equal(next.discard.rice, 0);
  assert.equal(next.discard.egg, 0);
});

test('computePlayerTotals includes bonus and totals', () => {
  const p1 = createPlayer('A', 'p1');
  const p2 = createPlayer('B', 'p2');
  p1.hand.rice = 4;
  p2.hand.rice = 2;
  p1.hand.liquor = 1;
  p2.hand.smoke = 2;

  const ranked = computePlayerTotals([p1, p2]);
  const first = ranked.find((p) => p.id === 'p1');
  const second = ranked.find((p) => p.id === 'p2');

  assert.equal(first.cardPoints, 15);
  assert.equal(second.cardPoints, 20);
  assert.ok(first.bonus >= 15);
  assert.ok(second.bonus >= 10);
  assert.equal(typeof first.total, 'number');
  assert.equal(typeof second.total, 'number');
});

test('buildWinnerSummary sorts players by total and returns rank metadata', () => {
  const p1 = createPlayer('A', 'p1');
  const p2 = createPlayer('B', 'p2');
  p1.money = 80;
  p2.money = 50;
  p2.hand.herb = 2;

  const summary = buildWinnerSummary([p1, p2]);
  assert.equal(summary.length, 2);
  assert.equal(summary[0].rank, 1);
  assert.equal(summary[1].rank, 2);
  assert.equal(summary[0].name, 'A');
  assert.equal(summary[0].total >= summary[1].total, true);
});
