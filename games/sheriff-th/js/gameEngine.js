export const CARD_CATALOG = [
  { id: 'rice', name: 'ข้าวสาร', type: 'legal', points: 2, fine: 2, legalKey: 'rice', deckCount: 14 },
  { id: 'egg', name: 'ไข่ไก่', type: 'legal', points: 3, fine: 2, legalKey: 'egg', deckCount: 12 },
  { id: 'veg', name: 'ผักสด', type: 'legal', points: 4, fine: 3, legalKey: 'veg', deckCount: 10 },
  { id: 'mackerel', name: 'ปลาทู', type: 'legal', points: 5, fine: 4, legalKey: 'mackerel', deckCount: 8 },
  { id: 'liquor', name: 'เหล้าเถื่อน', type: 'contraband', points: 7, fine: 4, deckCount: 6 },
  { id: 'smoke', name: 'บุหรี่ไฟฟ้า', type: 'contraband', points: 8, fine: 4, deckCount: 4 },
  { id: 'rare_sea', name: 'น้ำกระท่อม', type: 'contraband', points: 9, fine: 5, deckCount: 3 },
  { id: 'herb', name: 'ยาเถื่อน', type: 'contraband', points: 10, fine: 5, deckCount: 3 },
];

export const LEGAL_BONUS = {
  rice: { first: 15, second: 10 },
  egg: { first: 12, second: 8 },
  veg: { first: 10, second: 6 },
  mackerel: { first: 8, second: 4 },
};

export function getCardById(cardId = '') {
  return CARD_CATALOG.find((card) => card.id === cardId) || null;
}

export function createInitialDeck() {
  return CARD_CATALOG.reduce((acc, card) => {
    acc[card.id] = card.deckCount;
    return acc;
  }, {});
}

export function createEmptyPile() {
  return CARD_CATALOG.reduce((acc, card) => {
    acc[card.id] = 0;
    return acc;
  }, {});
}

export function createPlayer(name = '', id = '') {
  return { id, name, money: 50, hand: createEmptyPile() };
}

export function shuffle(list = [], randomFn = Math.random) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomFn() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildSheriffQueue(playerIds = [], roundsPerPlayer = 1, randomFn = Math.random) {
  const queue = [];
  for (let i = 0; i < roundsPerPlayer; i += 1) {
    queue.push(...shuffle(playerIds, randomFn));
  }
  return queue;
}

export function computeStatsForPlayer(player = {}) {
  const hand = player.hand || {};
  const legalCounts = { rice: 0, egg: 0, veg: 0, mackerel: 0 };
  let contrabandCount = 0;
  let cardPoints = 0;
  CARD_CATALOG.forEach((card) => {
    const qty = Math.max(0, Number(hand[card.id] || 0));
    cardPoints += qty * card.points;
    if (card.type === 'legal' && card.legalKey) legalCounts[card.legalKey] = qty;
    if (card.type === 'contraband') contrabandCount += qty;
  });
  return { legalCounts, contrabandCount, cardPoints };
}

export function computePlayerTotals(players = []) {
  const computed = players.map((player) => ({ ...player, ...computeStatsForPlayer(player) }));
  const bonusById = computed.reduce((acc, player) => ({ ...acc, [player.id]: 0 }), {});

  Object.keys(LEGAL_BONUS).forEach((key) => {
    const ranked = computed
      .map((player) => ({ id: player.id, qty: Number(player.legalCounts?.[key] || 0) }))
      .sort((a, b) => b.qty - a.qty);
    const first = ranked[0]?.qty || 0;
    if (first <= 0) return;
    ranked.filter((row) => row.qty === first).forEach((row) => { bonusById[row.id] += LEGAL_BONUS[key].first; });
    const second = ranked.find((row) => row.qty < first)?.qty || 0;
    if (second <= 0) return;
    ranked.filter((row) => row.qty === second).forEach((row) => { bonusById[row.id] += LEGAL_BONUS[key].second; });
  });

  const rankedContra = computed
    .map((player) => ({ id: player.id, qty: Number(player.contrabandCount || 0) }))
    .sort((a, b) => b.qty - a.qty);
  const topContra = rankedContra[0]?.qty || 0;
  if (topContra > 0) rankedContra.filter((row) => row.qty === topContra).forEach((row) => { bonusById[row.id] += 10; });
  const secondContra = rankedContra.find((row) => row.qty < topContra)?.qty || 0;
  if (secondContra > 0) rankedContra.filter((row) => row.qty === secondContra).forEach((row) => { bonusById[row.id] += 5; });

  return computed.map((player) => {
    const bonus = Number(bonusById[player.id] || 0);
    const total = Number(player.money || 0) + Number(player.cardPoints || 0) + bonus;
    return { ...player, bonus, total };
  });
}

export function drawCard(room = {}, { playerId = '', cardId = '', qty = 1 } = {}) {
  const deck = { ...(room.deck || createInitialDeck()) };
  if (Number(deck[cardId] || 0) < qty) return { ok: false, room, message: 'deck_not_enough' };
  const players = (Array.isArray(room.players) ? room.players : []).map((player) => {
    if (player.id !== playerId) return player;
    const hand = { ...(player.hand || createEmptyPile()) };
    hand[cardId] = Number(hand[cardId] || 0) + qty;
    return { ...player, hand };
  });
  deck[cardId] = Number(deck[cardId] || 0) - qty;
  return { ok: true, room: { ...room, players, deck } };
}

function pickRandomCardIdFromDeck(deck = {}, randomFn = Math.random) {
  const totalCards = CARD_CATALOG.reduce((sum, card) => sum + Math.max(0, Number(deck[card.id] || 0)), 0);
  if (totalCards <= 0) return '';
  let cursor = Math.floor(randomFn() * totalCards);
  for (const card of CARD_CATALOG) {
    const count = Math.max(0, Number(deck[card.id] || 0));
    if (count <= 0) continue;
    if (cursor < count) return card.id;
    cursor -= count;
  }
  return '';
}

export function drawRandomCards(room = {}, { playerId = '', qty = 1, randomFn = Math.random } = {}) {
  const rounds = Math.max(1, Number(qty || 1));
  let nextRoom = room;
  const drawnCards = [];

  for (let i = 0; i < rounds; i += 1) {
    const nextCardId = pickRandomCardIdFromDeck(nextRoom?.deck || createInitialDeck(), randomFn);
    if (!nextCardId) {
      return {
        ok: false,
        room: nextRoom,
        message: 'deck_empty',
        drawnCards,
      };
    }
    const step = drawCard(nextRoom, { playerId, cardId: nextCardId, qty: 1 });
    if (!step.ok) {
      return {
        ok: false,
        room: nextRoom,
        message: step.message || 'draw_failed',
        drawnCards,
      };
    }
    nextRoom = step.room;
    drawnCards.push(nextCardId);
  }

  return {
    ok: true,
    room: nextRoom,
    drawnCards,
  };
}

export function dealInitialHands(room = {}, { cardsPerPlayer = 6, randomFn = Math.random } = {}) {
  const players = Array.isArray(room.players) ? room.players : [];
  if (!players.length) {
    return { ok: false, room, message: 'players_required', cardsPerPlayer: 0 };
  }

  const deck = room.deck || createInitialDeck();
  const totalDeck = CARD_CATALOG.reduce((sum, card) => sum + Math.max(0, Number(deck[card.id] || 0)), 0);
  const requestedCards = Math.max(1, Number(cardsPerPlayer || 1));
  const maxCardsPerPlayer = Math.floor(totalDeck / players.length);
  const effectiveCardsPerPlayer = Math.max(0, Math.min(requestedCards, maxCardsPerPlayer));

  if (effectiveCardsPerPlayer <= 0) {
    return { ok: false, room, message: 'deck_not_enough', cardsPerPlayer: 0 };
  }

  let nextRoom = room;
  for (const player of players) {
    const result = drawRandomCards(nextRoom, {
      playerId: player.id,
      qty: effectiveCardsPerPlayer,
      randomFn,
    });
    if (!result.ok) {
      return {
        ok: false,
        room: nextRoom,
        message: result.message || 'deal_failed',
        cardsPerPlayer: 0,
      };
    }
    nextRoom = result.room;
  }

  return {
    ok: true,
    room: nextRoom,
    cardsPerPlayer: effectiveCardsPerPlayer,
  };
}

export function discardCard(room = {}, { playerId = '', cardId = '', qty = 1 } = {}) {
  const discard = { ...(room.discard || createEmptyPile()) };
  let success = false;
  const players = (Array.isArray(room.players) ? room.players : []).map((player) => {
    if (player.id !== playerId) return player;
    const hand = { ...(player.hand || createEmptyPile()) };
    const currentQty = Number(hand[cardId] || 0);
    if (currentQty < qty) return player;
    hand[cardId] = currentQty - qty;
    success = true;
    return { ...player, hand };
  });
  if (!success) return { ok: false, room, message: 'hand_not_enough' };
  discard[cardId] = Number(discard[cardId] || 0) + qty;
  return { ok: true, room: { ...room, players, discard } };
}

export function reshuffleDiscard(room = {}) {
  const deck = { ...(room.deck || createInitialDeck()) };
  const discard = { ...(room.discard || createEmptyPile()) };
  CARD_CATALOG.forEach((card) => {
    deck[card.id] = Number(deck[card.id] || 0) + Number(discard[card.id] || 0);
    discard[card.id] = 0;
  });
  return { ...room, deck, discard };
}

export function buildWinnerSummary(players = []) {
  const ranked = computePlayerTotals(players).sort((a, b) => b.total - a.total);
  return ranked.map((player, index) => ({
    rank: index + 1,
    id: player.id,
    name: player.name,
    money: player.money,
    cardPoints: player.cardPoints,
    bonus: player.bonus,
    total: player.total,
  }));
}
