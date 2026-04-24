import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getDatabase, onValue, ref, runTransaction } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC4jOmVcZp0HmmDqZCmHufnq2yyoPcvyVM',
  authDomain: 'pakdu-a26c4.firebaseapp.com',
  databaseURL: 'https://pakdu-a26c4-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'pakdu-a26c4',
  storageBucket: 'pakdu-a26c4.firebasestorage.app',
  messagingSenderId: '414809008203',
  appId: '1:414809008203:web:757dceafa78d91900d85ce',
};

const params = new URLSearchParams(window.location.search);
const roomId = String(params.get('roomId') || '').trim();
const role = String(params.get('role') || 'join').trim();
const isHostMode = role === 'host';

const CARD_CATALOG = [
  { id: 'rice', name: 'ข้าวสาร', type: 'legal', points: 2, fine: 2, legalKey: 'rice', deckCount: 14 },
  { id: 'egg', name: 'ไข่ไก่', type: 'legal', points: 3, fine: 2, legalKey: 'egg', deckCount: 12 },
  { id: 'veg', name: 'ผักสด', type: 'legal', points: 4, fine: 3, legalKey: 'veg', deckCount: 10 },
  { id: 'mackerel', name: 'ปลาทู', type: 'legal', points: 5, fine: 4, legalKey: 'mackerel', deckCount: 8 },
  { id: 'liquor', name: 'เหล้านอก', type: 'contraband', points: 7, fine: 4, deckCount: 6 },
  { id: 'smoke', name: 'บุหรี่เถื่อน', type: 'contraband', points: 8, fine: 4, deckCount: 4 },
  { id: 'rare_sea', name: 'ของทะเลหายาก', type: 'contraband', points: 9, fine: 5, deckCount: 3 },
  { id: 'herb', name: 'สมุนไพรห้ามขาย', type: 'contraband', points: 10, fine: 5, deckCount: 3 },
];

const LEGAL_BONUS = {
  rice: { first: 15, second: 10 },
  egg: { first: 12, second: 8 },
  veg: { first: 10, second: 6 },
  mackerel: { first: 8, second: 4 },
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const roomRef = roomId ? ref(db, `sheriff_th_rooms/${roomId}`) : null;

const state = {
  uid: '',
  room: null,
};

const el = {
  roomSummary: document.getElementById('roomSummary'),
  hostOnlyHint: document.getElementById('hostOnlyHint'),
  roundsPerPlayerInput: document.getElementById('roundsPerPlayerInput'),
  playerNamesInput: document.getElementById('playerNamesInput'),
  startGameBtn: document.getElementById('startGameBtn'),
  setupError: document.getElementById('setupError'),
  setupCard: document.getElementById('setupCard'),
  gameCard: document.getElementById('gameCard'),
  gameStatus: document.getElementById('gameStatus'),
  cardPlayerInput: document.getElementById('cardPlayerInput'),
  cardTypeInput: document.getElementById('cardTypeInput'),
  cardQtyInput: document.getElementById('cardQtyInput'),
  drawCardBtn: document.getElementById('drawCardBtn'),
  discardCardBtn: document.getElementById('discardCardBtn'),
  reshuffleBtn: document.getElementById('reshuffleBtn'),
  deckStatus: document.getElementById('deckStatus'),
  playersTableBody: document.getElementById('playersTableBody'),
  eventLog: document.getElementById('eventLog'),
  nextSheriffBtn: document.getElementById('nextSheriffBtn'),
  finishGameBtn: document.getElementById('finishGameBtn'),
  resultCard: document.getElementById('resultCard'),
  winnerText: document.getElementById('winnerText'),
  cardsInfoList: document.getElementById('cardsInfoList'),
};

function safeParam(name, fallback = '-') {
  const value = String(params.get(name) || '').trim();
  return value || fallback;
}

function normalizeRounds(value) {
  return [1, 2].includes(Number(value)) ? Number(value) : 1;
}

function splitPlayerNames(raw = '') {
  return [...new Set(
    String(raw || '')
      .split(/\n|,/)
      .map((name) => String(name || '').trim())
      .filter(Boolean),
  )];
}

function shuffle(list = []) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getCardById(cardId = '') {
  return CARD_CATALOG.find((card) => card.id === cardId) || null;
}

function createInitialDeck() {
  return CARD_CATALOG.reduce((acc, card) => {
    acc[card.id] = card.deckCount;
    return acc;
  }, {});
}

function createEmptyPile() {
  return CARD_CATALOG.reduce((acc, card) => {
    acc[card.id] = 0;
    return acc;
  }, {});
}

function createPlayer(name = '', id = '') {
  return {
    id,
    name,
    money: 50,
    hand: createEmptyPile(),
  };
}

function getPlayers(room = state.room) {
  return Array.isArray(room?.players) ? room.players : [];
}

function buildSheriffQueue(playerIds = [], roundsPerPlayer = 1) {
  const queue = [];
  for (let i = 0; i < roundsPerPlayer; i += 1) {
    queue.push(...shuffle(playerIds));
  }
  return queue;
}

function computeStatsForPlayer(player = {}) {
  const hand = player.hand || {};
  const legalCounts = { rice: 0, egg: 0, veg: 0, mackerel: 0 };
  let contrabandCount = 0;
  let cardPoints = 0;

  CARD_CATALOG.forEach((card) => {
    const qty = Math.max(0, Number(hand[card.id] || 0));
    cardPoints += qty * card.points;
    if (card.type === 'legal' && card.legalKey) {
      legalCounts[card.legalKey] = qty;
    }
    if (card.type === 'contraband') contrabandCount += qty;
  });

  return { legalCounts, contrabandCount, cardPoints };
}

function computePlayerTotals(players = getPlayers()) {
  const computed = players.map((player) => ({ ...player, ...computeStatsForPlayer(player) }));
  const bonusById = computed.reduce((acc, player) => {
    acc[player.id] = 0;
    return acc;
  }, {});

  Object.keys(LEGAL_BONUS).forEach((key) => {
    const ranked = computed
      .map((player) => ({ id: player.id, qty: Number(player.legalCounts?.[key] || 0) }))
      .sort((a, b) => b.qty - a.qty);

    const first = ranked[0]?.qty || 0;
    if (first <= 0) return;
    ranked.filter((row) => row.qty === first).forEach((row) => {
      bonusById[row.id] += LEGAL_BONUS[key].first;
    });

    const second = ranked.find((row) => row.qty < first)?.qty || 0;
    if (second <= 0) return;
    ranked.filter((row) => row.qty === second).forEach((row) => {
      bonusById[row.id] += LEGAL_BONUS[key].second;
    });
  });

  const rankedContra = computed
    .map((player) => ({ id: player.id, qty: Number(player.contrabandCount || 0) }))
    .sort((a, b) => b.qty - a.qty);
  const topContra = rankedContra[0]?.qty || 0;
  if (topContra > 0) {
    rankedContra.filter((row) => row.qty === topContra).forEach((row) => {
      bonusById[row.id] += 10;
    });
  }
  const secondContra = rankedContra.find((row) => row.qty < topContra)?.qty || 0;
  if (secondContra > 0) {
    rankedContra.filter((row) => row.qty === secondContra).forEach((row) => {
      bonusById[row.id] += 5;
    });
  }

  return computed.map((player) => {
    const bonus = Number(bonusById[player.id] || 0);
    const total = Number(player.money || 0) + Number(player.cardPoints || 0) + bonus;
    return { ...player, bonus, total };
  });
}

function canHostMutate() {
  return isHostMode;
}

function renderRoomSummary() {
  const rows = [
    ['Room', safeParam('roomId', '-')],
    ['PIN', safeParam('pin', '-')],
    ['สิทธิ์', isHostMode ? 'Host' : 'Join'],
    ['ผู้เล่นจาก Duel', safeParam('player', 'ผู้เล่น')],
    ['โหมด', 'Sheriff ตลาดไทย (ระบบเสริมแยกจาก Duel หลัก)'],
    ['การเชื่อมต่อ', state.room ? 'Sync แล้ว' : 'กำลังรอข้อมูล...'],
  ];

  if (el.roomSummary) {
    el.roomSummary.innerHTML = rows
      .map(([label, value]) => `<div class="chip"><small>${label}</small><strong>${value}</strong></div>`)
      .join('');
  }

  if (el.hostOnlyHint) {
    el.hostOnlyHint.textContent = isHostMode
      ? 'คุณเป็น Host: สามารถเริ่มเกม, จับ/ทิ้งการ์ด, ปรับเงิน และสรุปผลได้'
      : 'คุณเป็น Join: ดูกระดานกลางแบบเรียลไทม์ได้ (สิทธิ์แก้ไขอยู่ที่ Host)';
  }
}

function renderCardsInfo() {
  if (!el.cardsInfoList) return;
  el.cardsInfoList.innerHTML = CARD_CATALOG.map((card) => (
    `<article class="card-item"><strong>${card.name}</strong><br><small>${card.type === 'legal' ? 'ของปกติ' : 'ของเถื่อน'} • แต้ม ${card.points} • ค่าปรับ ${card.fine} • ในกองกลาง ${card.deckCount}</small></article>`
  )).join('');
}

function renderPlayerSelects() {
  const players = getPlayers();
  if (!el.cardPlayerInput || !el.cardTypeInput) return;
  el.cardPlayerInput.innerHTML = players.map((player) => `<option value="${player.id}">${player.name}</option>`).join('');
  el.cardTypeInput.innerHTML = CARD_CATALOG.map((card) => `<option value="${card.id}">${card.name}</option>`).join('');
}

function renderDeckStatus() {
  if (!el.deckStatus) return;
  const deck = state.room?.deck || createInitialDeck();
  const discard = state.room?.discard || createEmptyPile();
  const totalDeck = Object.values(deck).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalDiscard = Object.values(discard).reduce((sum, value) => sum + Number(value || 0), 0);

  el.deckStatus.innerHTML = [
    ['การ์ดในกองกลาง', `${totalDeck} ใบ`],
    ['การ์ดในกองทิ้ง', `${totalDiscard} ใบ`],
    ...CARD_CATALOG.map((card) => [`${card.name}`, `กองกลาง ${Number(deck[card.id] || 0)} • ทิ้ง ${Number(discard[card.id] || 0)}`]),
  ].map(([label, value]) => `<div class="chip"><small>${label}</small><strong>${value}</strong></div>`).join('');
}

function renderGameStatus() {
  if (!el.gameStatus) return;
  const queue = Array.isArray(state.room?.sheriffQueue) ? state.room.sheriffQueue : [];
  const activeRound = Math.max(0, Number(state.room?.activeRoundIndex || 0));
  const players = getPlayers();
  const currentSheriffId = String(queue[activeRound] || '');
  const currentSheriff = players.find((player) => player.id === currentSheriffId)?.name || '-';
  const status = String(state.room?.status || 'setup');

  el.gameStatus.innerHTML = [
    ['สถานะ', status === 'finished' ? 'จบเกม' : status === 'playing' ? 'กำลังเล่น' : 'ตั้งค่า'],
    ['รอบปัจจุบัน', `${Math.min(activeRound + 1, Math.max(queue.length, 1))}/${Math.max(queue.length, 1)}`],
    ['ตำรวจรอบนี้', currentSheriff],
    ['รอบตำรวจต่อคน', `${normalizeRounds(state.room?.roundsPerPlayer || 1)} รอบ`],
    ['ผู้เล่นรวม', `${players.length} คน`],
    ['รอบที่เหลือ', `${Math.max(0, queue.length - activeRound - 1)} รอบ`],
  ].map(([label, value]) => `<div class="chip"><small>${label}</small><strong>${value}</strong></div>`).join('');
}

function renderTable() {
  if (!el.playersTableBody) return;
  const ranked = computePlayerTotals().sort((a, b) => b.total - a.total);
  el.playersTableBody.innerHTML = ranked.map((player) => `
    <tr>
      <td>${player.name}</td>
      <td>${player.money}</td>
      <td>${player.cardPoints}</td>
      <td>${player.bonus}</td>
      <td><strong>${player.total}</strong></td>
      <td>
        <span class="money-actions">
          <button type="button" data-money="-5" data-player-id="${player.id}" ${canHostMutate() ? '' : 'disabled'}>-5</button>
          <button type="button" data-money="5" data-player-id="${player.id}" ${canHostMutate() ? '' : 'disabled'}>+5</button>
          <button type="button" data-money="10" data-player-id="${player.id}" ${canHostMutate() ? '' : 'disabled'}>+10</button>
        </span>
      </td>
    </tr>
  `).join('');

  el.playersTableBody.querySelectorAll('[data-money]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.money || 0);
      const playerId = String(btn.dataset.playerId || '');
      void adjustMoney(playerId, delta);
    });
  });
}

function renderWinner() {
  const ranked = computePlayerTotals().sort((a, b) => b.total - a.total);
  const winner = ranked[0];
  const status = String(state.room?.status || 'setup');
  if (status !== 'finished' || !winner) {
    el.resultCard?.classList.add('hidden');
    return;
  }
  el.resultCard?.classList.remove('hidden');
  if (el.winnerText) {
    el.winnerText.textContent = `🏆 ผู้ชนะคือ ${winner.name} • รวม ${winner.total} (เงิน ${winner.money} + แต้มการ์ด ${winner.cardPoints} + โบนัส ${winner.bonus})`;
  }
}

function setControlAvailability() {
  const isHost = canHostMutate();
  const status = String(state.room?.status || 'setup');
  const playing = status === 'playing';

  [el.startGameBtn, el.drawCardBtn, el.discardCardBtn, el.reshuffleBtn, el.nextSheriffBtn, el.finishGameBtn].forEach((button) => {
    if (!button) return;
    button.disabled = !isHost;
  });

  if (el.drawCardBtn) el.drawCardBtn.disabled = !isHost || !playing;
  if (el.discardCardBtn) el.discardCardBtn.disabled = !isHost || !playing;
  if (el.nextSheriffBtn) el.nextSheriffBtn.disabled = !isHost || !playing;
  if (el.finishGameBtn) el.finishGameBtn.disabled = !isHost || status === 'finished';
  if (el.reshuffleBtn) el.reshuffleBtn.disabled = !isHost || status === 'setup';
}

function renderAll() {
  renderRoomSummary();
  renderPlayerSelects();
  renderDeckStatus();
  renderGameStatus();
  renderTable();
  renderWinner();

  const status = String(state.room?.status || 'setup');
  el.setupCard?.classList.toggle('hidden', status !== 'setup');
  el.gameCard?.classList.toggle('hidden', status === 'setup');

  if (el.eventLog) {
    el.eventLog.textContent = String(state.room?.lastEvent || 'รอ Host เริ่มโหมด Sheriff');
  }
  setControlAvailability();
}

async function mutateRoom(mutator) {
  if (!roomRef || !canHostMutate()) return;
  await runTransaction(roomRef, (current) => {
    const base = current && typeof current === 'object' ? current : buildInitialRoomState();
    return mutator(base);
  });
}

function buildInitialRoomState() {
  const rounds = normalizeRounds(params.get('sheriffRoundsPerPlayer'));
  return {
    createdAtMs: Date.now(),
    createdByRole: role,
    status: 'setup',
    roundsPerPlayer: rounds,
    players: [],
    sheriffQueue: [],
    activeRoundIndex: 0,
    deck: createInitialDeck(),
    discard: createEmptyPile(),
    lastEvent: 'รอ Host ตั้งค่าผู้เล่นและเริ่มเกม',
  };
}

async function startGame() {
  const rounds = normalizeRounds(el.roundsPerPlayerInput?.value || 1);
  const names = splitPlayerNames(el.playerNamesInput?.value || '');
  if (names.length < 3 || names.length > 24) {
    if (el.setupError) {
      el.setupError.textContent = 'กรุณาใส่ชื่อผู้เล่นตั้งแต่ 3 ถึง 24 คน';
      el.setupError.classList.remove('hidden');
    }
    return;
  }
  el.setupError?.classList.add('hidden');

  const players = names.map((name, index) => createPlayer(name, `p${index + 1}`));
  const queue = buildSheriffQueue(players.map((player) => player.id), rounds);

  await mutateRoom((room) => ({
    ...room,
    status: 'playing',
    roundsPerPlayer: rounds,
    players,
    sheriffQueue: queue,
    activeRoundIndex: 0,
    deck: createInitialDeck(),
    discard: createEmptyPile(),
    lastEvent: `เริ่มเกมแล้ว • ตำรวจรอบแรก: ${players.find((p) => p.id === queue[0])?.name || '-'}`,
    startedAtMs: Date.now(),
  }));
}

async function adjustMoney(playerId = '', delta = 0) {
  if (!playerId || !Number.isFinite(delta)) return;
  await mutateRoom((room) => {
    const players = getPlayers(room).map((player) => (
      player.id !== playerId
        ? player
        : { ...player, money: Math.max(0, Number(player.money || 0) + delta) }
    ));
    const name = players.find((player) => player.id === playerId)?.name || 'ผู้เล่น';
    return {
      ...room,
      players,
      lastEvent: `${name} ปรับเงิน ${delta > 0 ? '+' : ''}${delta}`,
    };
  });
}

async function drawCardToPlayer() {
  const playerId = String(el.cardPlayerInput?.value || '');
  const cardId = String(el.cardTypeInput?.value || '');
  const qty = Math.max(1, Math.min(10, Number(el.cardQtyInput?.value || 1)));
  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const deck = { ...(room.deck || createInitialDeck()) };
    if (Number(deck[cardId] || 0) < qty) {
      return {
        ...room,
        lastEvent: `การ์ด ${getCardById(cardId)?.name || cardId} ในกองกลางไม่พอสำหรับจับ ${qty} ใบ`,
      };
    }
    const players = getPlayers(room).map((player) => {
      if (player.id !== playerId) return player;
      const hand = { ...(player.hand || createEmptyPile()) };
      hand[cardId] = Number(hand[cardId] || 0) + qty;
      return { ...player, hand };
    });
    deck[cardId] = Number(deck[cardId] || 0) - qty;

    return {
      ...room,
      players,
      deck,
      lastEvent: `${players.find((player) => player.id === playerId)?.name || 'ผู้เล่น'} จับ ${getCardById(cardId)?.name || cardId} x${qty}`,
    };
  });
}

async function discardCardFromPlayer() {
  const playerId = String(el.cardPlayerInput?.value || '');
  const cardId = String(el.cardTypeInput?.value || '');
  const qty = Math.max(1, Math.min(10, Number(el.cardQtyInput?.value || 1)));
  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const discard = { ...(room.discard || createEmptyPile()) };
    let canDiscard = false;
    const players = getPlayers(room).map((player) => {
      if (player.id !== playerId) return player;
      const hand = { ...(player.hand || createEmptyPile()) };
      const currentQty = Number(hand[cardId] || 0);
      if (currentQty < qty) return player;
      hand[cardId] = currentQty - qty;
      canDiscard = true;
      return { ...player, hand };
    });
    if (!canDiscard) {
      return {
        ...room,
        lastEvent: `ทิ้งการ์ดไม่สำเร็จ: ผู้เล่นมี ${getCardById(cardId)?.name || cardId} ไม่พอ`,
      };
    }

    discard[cardId] = Number(discard[cardId] || 0) + qty;
    return {
      ...room,
      players,
      discard,
      lastEvent: `${players.find((player) => player.id === playerId)?.name || 'ผู้เล่น'} ทิ้ง ${getCardById(cardId)?.name || cardId} x${qty}`,
    };
  });
}

async function reshuffleDiscardToDeck() {
  await mutateRoom((room) => {
    const deck = { ...(room.deck || createInitialDeck()) };
    const discard = { ...(room.discard || createEmptyPile()) };
    CARD_CATALOG.forEach((card) => {
      deck[card.id] = Number(deck[card.id] || 0) + Number(discard[card.id] || 0);
      discard[card.id] = 0;
    });
    return {
      ...room,
      deck,
      discard,
      lastEvent: 'สับกองทิ้งกลับเข้ากองกลางแล้ว',
    };
  });
}

async function nextSheriffRound() {
  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const queue = Array.isArray(room.sheriffQueue) ? room.sheriffQueue : [];
    const nextIndex = Number(room.activeRoundIndex || 0) + 1;
    if (nextIndex >= queue.length) {
      return {
        ...room,
        status: 'finished',
        activeRoundIndex: queue.length,
        lastEvent: 'จบเกมอัตโนมัติ: ครบรอบตำรวจทุกคน',
        endedAtMs: Date.now(),
      };
    }
    const nextSheriffId = String(queue[nextIndex] || '');
    const nextSheriffName = getPlayers(room).find((player) => player.id === nextSheriffId)?.name || '-';
    return {
      ...room,
      activeRoundIndex: nextIndex,
      lastEvent: `เริ่มรอบ ${nextIndex + 1}: ตำรวจคือ ${nextSheriffName}`,
    };
  });
}

async function finishGame() {
  await mutateRoom((room) => ({
    ...room,
    status: 'finished',
    endedAtMs: Date.now(),
    lastEvent: 'Host สรุปผลและปิดเกมแล้ว',
  }));
}

function wireEvents() {
  el.startGameBtn?.addEventListener('click', () => { void startGame(); });
  el.drawCardBtn?.addEventListener('click', () => { void drawCardToPlayer(); });
  el.discardCardBtn?.addEventListener('click', () => { void discardCardFromPlayer(); });
  el.reshuffleBtn?.addEventListener('click', () => { void reshuffleDiscardToDeck(); });
  el.nextSheriffBtn?.addEventListener('click', () => { void nextSheriffRound(); });
  el.finishGameBtn?.addEventListener('click', () => { void finishGame(); });

  document.querySelectorAll('[data-open-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = String(button.getAttribute('data-open-modal') || '');
      const modal = document.getElementById(modalId);
      if (modal && typeof modal.showModal === 'function') modal.showModal();
    });
  });
}

async function ensureAuth() {
  await new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        state.uid = user.uid;
        unsub();
        resolve();
        return;
      }
      try {
        await signInAnonymously(auth);
      } catch (error) {
        reject(error);
      }
    }, reject);
  });
}

function subscribeRoom() {
  if (!roomRef) {
    state.room = buildInitialRoomState();
    renderAll();
    return;
  }
  onValue(roomRef, async (snapshot) => {
    const data = snapshot.val();
    if (!data && isHostMode) {
      await mutateRoom(() => buildInitialRoomState());
      return;
    }
    state.room = data || buildInitialRoomState();
    if (!data && !isHostMode) {
      state.room.lastEvent = 'รอ Host เปิดเกม Sheriff ในห้องนี้';
    }
    renderAll();
  });
}

async function init() {
  renderCardsInfo();
  renderRoomSummary();
  wireEvents();
  await ensureAuth();
  subscribeRoom();
}

void init();
