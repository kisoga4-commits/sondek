import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWinnerSummary,
  buildSheriffQueue,
  computePlayerTotals,
  createEmptyPile,
  createInitialDeck,
  createPlayer,
  dealInitialHands,
  discardCard,
  drawCard,
  drawRandomCards,
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

test('drawRandomCards picks cards from deck using weighted random and updates hand/deck', () => {
  const base = {
    players: [createPlayer('A', 'p1')],
    deck: { ...createEmptyPile(), rice: 2, egg: 1 },
    discard: createEmptyPile(),
  };

  const values = [0.0, 0.7, 0.0];
  let idx = 0;
  const randomFn = () => {
    const val = values[idx] ?? 0;
    idx += 1;
    return val;
  };

  const result = drawRandomCards(base, { playerId: 'p1', qty: 3, randomFn });
  assert.equal(result.ok, true);
  assert.deepEqual(result.drawnCards, ['rice', 'egg', 'rice']);
  assert.equal(result.room.players[0].hand.rice, 2);
  assert.equal(result.room.players[0].hand.egg, 1);
  assert.equal(result.room.deck.rice, 0);
  assert.equal(result.room.deck.egg, 0);
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

test('dealInitialHands distributes starter cards to every player within deck limit', () => {
  const room = {
    players: [createPlayer('A', 'p1'), createPlayer('B', 'p2'), createPlayer('C', 'p3')],
    deck: { ...createEmptyPile(), rice: 6, egg: 3 },
    discard: createEmptyPile(),
  };

  const values = [0.0, 0.8, 0.2, 0.0, 0.5, 0.0];
  let idx = 0;
  const randomFn = () => {
    const val = values[idx] ?? 0;
    idx += 1;
    return val;
  };

  const dealt = dealInitialHands(room, { cardsPerPlayer: 2, randomFn });
  assert.equal(dealt.ok, true);
  assert.equal(dealt.cardsPerPlayer, 2);
  const players = dealt.room.players;
  assert.equal(players.every((player) => Object.values(player.hand).reduce((sum, qty) => sum + Number(qty || 0), 0) === 2), true);
  assert.equal(dealt.room.deck.rice + dealt.room.deck.egg, 3);
});

test('dealInitialHands reduces starting cards when deck cannot support requested amount', () => {
  const room = {
    players: [createPlayer('A', 'p1'), createPlayer('B', 'p2'), createPlayer('C', 'p3'), createPlayer('D', 'p4')],
    deck: { ...createEmptyPile(), rice: 6 },
    discard: createEmptyPile(),
  };

  const dealt = dealInitialHands(room, { cardsPerPlayer: 3, randomFn: () => 0 });
  assert.equal(dealt.ok, true);
  assert.equal(dealt.cardsPerPlayer, 1);
  assert.equal(dealt.room.deck.rice, 2);
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
