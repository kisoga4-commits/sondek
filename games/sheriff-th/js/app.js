import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getDatabase, onValue, ref, runTransaction } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';
import {
  buildWinnerSummary,
  buildSheriffQueue,
  CARD_CATALOG,
  computePlayerTotals,
  createEmptyPile,
  createInitialDeck,
  createPlayer,
  dealInitialHands,
  discardCard,
  drawRandomCards,
  getCardById,
  reshuffleDiscard,
} from './gameEngine.js';

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
const rawRole = String(params.get('role') || '').trim().toLowerCase();
const role = rawRole || 'host';
const isHostMode = role === 'host';


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const roomRef = roomId ? ref(db, `sheriff_th_rooms/${roomId}`) : null;
const duelRoomPlayersRef = roomId ? ref(db, `rooms/${roomId}/players`) : null;

const state = {
  uid: '',
  room: null,
  duelPlayers: [],
};

const CARD_ICON_BY_ID = {
  rice: '🌾',
  egg: '🥚',
  veg: '🥬',
  mackerel: '🐟',
  liquor: '🍷',
  smoke: '🚬',
  rare_sea: '🦐',
  herb: '🌿',
};

const el = {
  hostOnlyHint: document.getElementById('hostOnlyHint'),
  roundsPerPlayerInput: document.getElementById('roundsPerPlayerInput'),
  duelPlayersPreview: document.getElementById('duelPlayersPreview'),
  startGameBtn: document.getElementById('startGameBtn'),
  setupError: document.getElementById('setupError'),
  setupCard: document.getElementById('setupCard'),
  gameCard: document.getElementById('gameCard'),
  gameStatus: document.getElementById('gameStatus'),
  scoreHighlights: document.getElementById('scoreHighlights'),
  playerRoleStrip: document.getElementById('playerRoleStrip'),
  systemHealth: document.getElementById('systemHealth'),
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
  winnerDetail: document.getElementById('winnerDetail'),
  cardsInfoList: document.getElementById('cardsInfoList'),
};

function normalizeRounds(value) {
  return [1, 2].includes(Number(value)) ? Number(value) : 1;
}

function getDuelPlayerEntries(playersMap = {}) {
  if (!playersMap || typeof playersMap !== 'object') return [];
  return Object.entries(playersMap)
    .map(([uid, player]) => ({
      uid: String(uid || '').trim(),
      name: String(player?.name || '').trim(),
    }))
    .filter((entry) => entry.uid && entry.name);
}

function getPlayers(room = state.room) {
  return Array.isArray(room?.players) ? room.players : [];
}

function getCardIcon(cardId = '') {
  return CARD_ICON_BY_ID[String(cardId || '')] || '🃏';
}

function canHostMutate() {
  return isHostMode;
}

function getCurrentSheriffId(room = state.room) {
  const queue = Array.isArray(room?.sheriffQueue) ? room.sheriffQueue : [];
  const activeRound = Math.max(0, Number(room?.activeRoundIndex || 0));
  return String(queue[activeRound] || '');
}

function pickMarketPlayerId(players = [], sheriffId = '') {
  const candidates = players.filter((player) => player.id !== sheriffId);
  const source = candidates.length ? candidates : players;
  if (!source.length) return '';
  const index = Math.floor(Math.random() * source.length);
  return String(source[index]?.id || '');
}

function renderRoomSummary() {
  if (el.hostOnlyHint) {
    el.hostOnlyHint.textContent = isHostMode
      ? 'คุณเป็น Host: ระบบจะดึงรายชื่อผู้เล่นจาก Duel ให้อัตโนมัติ และเริ่มเกมได้ทันทีเมื่อครบจำนวน'
      : 'คุณเป็น Join: ไม่ต้องตั้งค่าเพิ่ม รอ Host เริ่มเกมแล้วกระดานจะอัปเดตแบบเรียลไทม์';
  }
}

function renderCardsInfo() {
  if (!el.cardsInfoList) return;
  el.cardsInfoList.innerHTML = CARD_CATALOG.map((card) => (
    `<article class="card-item">
      <div class="card-item-head">
        <span class="card-icon" aria-hidden="true">${getCardIcon(card.id)}</span>
        <strong>${card.name}</strong>
      </div>
      <small>${card.type === 'legal' ? 'ของปกติ ✅' : 'ของเถื่อน ⚠️'} • แต้ม ${card.points} • ค่าปรับ ${card.fine} • ในกองกลาง ${card.deckCount}</small>
    </article>`
  )).join('');
}

function renderPlayerSelects() {
  const players = getPlayers();
  if (!el.cardPlayerInput || !el.cardTypeInput) return;
  el.cardPlayerInput.innerHTML = players.map((player) => `<option value="${player.id}">${player.name}</option>`).join('');
  el.cardTypeInput.innerHTML = CARD_CATALOG.map((card) => `<option value="${card.id}">${getCardIcon(card.id)} ${card.name}</option>`).join('');
}

function renderDuelPlayersPreview() {
  if (!el.duelPlayersPreview) return;
  const players = state.duelPlayers;
  if (!players.length) {
    el.duelPlayersPreview.innerHTML = '<li>ยังไม่พบผู้เล่นจากห้อง Duel</li>';
    return;
  }
  const shownPlayers = players.slice(0, 24);
  const overflowCount = Math.max(0, players.length - shownPlayers.length);
  el.duelPlayersPreview.innerHTML = shownPlayers
    .map((player, index) => `<li>${index + 1}. ${player.name}</li>`)
    .join('');
  if (overflowCount > 0) {
    el.duelPlayersPreview.innerHTML += `<li>…และอีก ${overflowCount} คน (ระบบรองรับสูงสุด 24 คน)</li>`;
  }
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
    ...CARD_CATALOG.map((card) => [`${getCardIcon(card.id)} ${card.name}`, `กองกลาง ${Number(deck[card.id] || 0)} • ทิ้ง ${Number(discard[card.id] || 0)}`]),
  ].map(([label, value]) => `<div class="chip"><small>${label}</small><strong>${value}</strong></div>`).join('');
}

function renderGameStatus() {
  if (!el.gameStatus) return;
  const queue = Array.isArray(state.room?.sheriffQueue) ? state.room.sheriffQueue : [];
  const activeRound = Math.max(0, Number(state.room?.activeRoundIndex || 0));
  const players = getPlayers();
  const currentSheriffId = getCurrentSheriffId();
  const currentSheriff = players.find((player) => player.id === currentSheriffId)?.name || '-';
  const marketPlayerId = String(state.room?.marketPlayerId || '');
  const marketPlayer = players.find((player) => player.id === marketPlayerId)?.name || '-';
  const status = String(state.room?.status || 'setup');
  const me = players.find((player) => player.sourceUid && player.sourceUid === state.uid)?.name || '-';

  el.gameStatus.innerHTML = [
    ['สถานะ', status === 'finished' ? 'จบเกม' : status === 'playing' ? 'กำลังเล่น' : 'ตั้งค่า'],
    ['รอบปัจจุบัน', `${Math.min(activeRound + 1, Math.max(queue.length, 1))}/${Math.max(queue.length, 1)}`],
    ['🚨 ตำรวจรอบนี้', currentSheriff],
    ['🛒 คนเข้าตลาดรอบนี้', marketPlayer],
    ['🙋 คุณคือ', me],
    ['รอบตำรวจต่อคน', `${normalizeRounds(state.room?.roundsPerPlayer || 1)} รอบ`],
    ['ผู้เล่นรวม', `${players.length} คน`],
    ['รอบที่เหลือ', `${Math.max(0, queue.length - activeRound - 1)} รอบ`],
  ].map(([label, value]) => `<div class="chip"><small>${label}</small><strong>${value}</strong></div>`).join('');
}

function renderScoreHighlights() {
  if (!el.scoreHighlights) return;
  const ranked = computePlayerTotals(getPlayers()).sort((a, b) => b.total - a.total);
  if (!ranked.length) {
    el.scoreHighlights.innerHTML = '';
    return;
  }
  const top = ranked.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const highestMoney = [...ranked].sort((a, b) => b.money - a.money)[0];
  el.scoreHighlights.innerHTML = [
    ...top.map((player, index) => `
      <article class="score-card">
        <small>${medals[index] || '🏅'} อันดับ ${index + 1}</small>
        <strong>${player.name} • ${player.total} แต้ม</strong>
        <small>💰 ${player.money} + 🃏 ${player.cardPoints} + 🎁 ${player.bonus}</small>
      </article>
    `),
    `<article class="score-card">
      <small>💸 เงินมากสุดตอนนี้</small>
      <strong>${highestMoney?.name || '-'} • ${highestMoney?.money || 0}</strong>
      <small>ช่วยดูว่าระบบปรับเงินทำงานถูกต้องไหม</small>
    </article>`,
  ].join('');
}

function renderSystemHealth() {
  if (!el.systemHealth) return;
  const room = state.room;
  const players = getPlayers(room);
  if (!room || !players.length) {
    el.systemHealth.innerHTML = '';
    return;
  }
  const deck = room.deck || createInitialDeck();
  const discard = room.discard || createEmptyPile();
  const totalDeck = Object.values(deck).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalDiscard = Object.values(discard).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalHands = players.reduce((sum, player) => (
    sum + Object.values(player?.hand || {}).reduce((inner, qty) => inner + Number(qty || 0), 0)
  ), 0);
  const expectedTotalCards = CARD_CATALOG.reduce((sum, card) => sum + Number(card.deckCount || 0), 0);
  const activeRound = Number(room?.activeRoundIndex || 0);
  const queue = Array.isArray(room?.sheriffQueue) ? room.sheriffQueue : [];
  const rounds = normalizeRounds(room?.roundsPerPlayer || 1);
  const sheriffId = getCurrentSheriffId(room);
  const marketId = String(room?.marketPlayerId || '');
  const checks = [
    {
      ok: players.length >= 3 && players.length <= 24,
      message: `👥 จำนวนผู้เล่น ${players.length} คน`,
    },
    {
      ok: String(room?.status || '') === 'setup' || queue.length === players.length * rounds,
      message: `🚨 คิวตำรวจ ${queue.length}/${players.length * rounds} รอบ`,
    },
    {
      ok: activeRound >= 0 && activeRound <= queue.length,
      message: `🔁 ดัชนีรอบ ${activeRound + 1}/${Math.max(queue.length, 1)}`,
    },
    {
      ok: totalDeck + totalDiscard + totalHands === expectedTotalCards,
      message: `🧮 การ์ดรวม ${totalDeck + totalDiscard + totalHands}/${expectedTotalCards}`,
    },
    {
      ok: players.length <= 1 || !marketId || marketId !== sheriffId,
      message: `🛒 ตลาด/ตำรวจ ${marketId && sheriffId && marketId === sheriffId ? 'ซ้ำกัน' : 'ไม่ซ้ำ'}`,
    },
  ];
  el.systemHealth.innerHTML = checks
    .map((check) => `<div class="health-item ${check.ok ? 'ok' : 'warn'}">${check.ok ? '✅' : '⚠️'} ${check.message}</div>`)
    .join('');
}

function renderRoleStrip() {
  if (!el.playerRoleStrip) return;
  const players = getPlayers();
  const sheriffId = getCurrentSheriffId();
  const marketPlayerId = String(state.room?.marketPlayerId || '');
  if (!players.length) {
    el.playerRoleStrip.innerHTML = '';
    return;
  }
  el.playerRoleStrip.innerHTML = players.map((player) => {
    const isSheriff = player.id === sheriffId;
    const isMarket = player.id === marketPlayerId;
    const isYou = Boolean(player.sourceUid && player.sourceUid === state.uid);
    const classes = ['role-pill'];
    if (isSheriff) classes.push('is-sheriff');
    if (isMarket) classes.push('is-market');
    if (isYou) classes.push('is-you');
    return `<span class="${classes.join(' ')}">${isSheriff ? '🚨 ' : ''}${isMarket ? '🛒 ' : ''}${player.name}${isYou ? ' (คุณ)' : ''}</span>`;
  }).join('');
}

function renderTable() {
  if (!el.playersTableBody) return;
  const ranked = computePlayerTotals(getPlayers()).sort((a, b) => b.total - a.total);
  el.playersTableBody.innerHTML = ranked.map((player) => `
    <tr>
      <td>${player.name}</td>
      <td><strong>${player.money}</strong></td>
      <td><strong>${player.cardPoints}</strong></td>
      <td><strong>${player.bonus}</strong></td>
      <td><strong>🏆 ${player.total}</strong></td>
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
  const ranked = buildWinnerSummary(getPlayers());
  const winner = ranked[0];
  const status = String(state.room?.status || 'setup');
  if (status !== 'finished' || !winner) {
    el.resultCard?.classList.add('hidden');
    if (el.winnerDetail) el.winnerDetail.innerHTML = '';
    return;
  }
  el.resultCard?.classList.remove('hidden');
  if (el.winnerText) {
    el.winnerText.textContent = `🏆 ผู้ชนะคือ ${winner.name} • รวม ${winner.total} (เงิน ${winner.money} + แต้มการ์ด ${winner.cardPoints} + โบนัส ${winner.bonus})`;
  }
  if (el.winnerDetail) {
    el.winnerDetail.innerHTML = ranked
      .slice(0, 5)
      .map((player) => `${player.rank}. ${player.name} = ${player.total} คะแนน`)
      .join('<br/>');
  }
}

function setControlAvailability() {
  const isHost = canHostMutate();
  const status = String(state.room?.status || 'setup');
  const playing = status === 'playing';
  const duelPlayerCount = state.duelPlayers.length;
  const canStartByPlayerCount = duelPlayerCount >= 3 && duelPlayerCount <= 24;

  [el.startGameBtn, el.drawCardBtn, el.discardCardBtn, el.reshuffleBtn, el.nextSheriffBtn, el.finishGameBtn].forEach((button) => {
    if (!button) return;
    button.disabled = !isHost;
  });
  if (el.startGameBtn) {
    el.startGameBtn.disabled = !isHost || !canStartByPlayerCount;
    el.startGameBtn.title = !isHost
      ? 'เฉพาะ Host เท่านั้นที่เริ่มเกมได้'
      : canStartByPlayerCount
        ? ''
        : 'ต้องมีผู้เล่นจากห้อง Duel 3-24 คน';
  }

  if (el.drawCardBtn) el.drawCardBtn.disabled = !isHost || !playing;
  if (el.discardCardBtn) el.discardCardBtn.disabled = !isHost || !playing;
  if (el.nextSheriffBtn) el.nextSheriffBtn.disabled = !isHost || !playing;
  if (el.finishGameBtn) el.finishGameBtn.disabled = !isHost || status === 'finished';
  if (el.reshuffleBtn) el.reshuffleBtn.disabled = !isHost || status === 'setup';
}

function renderAll() {
  renderRoomSummary();
  renderDuelPlayersPreview();
  renderPlayerSelects();
  renderDeckStatus();
  renderGameStatus();
  renderScoreHighlights();
  renderRoleStrip();
  renderSystemHealth();
  renderTable();
  renderWinner();

  const status = String(state.room?.status || 'setup');
  const shouldHideSetup = status !== 'setup' || !isHostMode;
  el.setupCard?.classList.toggle('hidden', shouldHideSetup);
  el.gameCard?.classList.toggle('hidden', status === 'setup');

  if (el.eventLog) {
    el.eventLog.textContent = String(state.room?.lastEvent || 'รอ Host เริ่มโหมดจ่ายส่วย');
  }
  setControlAvailability();
}

async function mutateRoom(mutator) {
  if (!canHostMutate()) return;
  if (!roomRef) {
    const base = state.room && typeof state.room === 'object' ? state.room : buildInitialRoomState();
    state.room = mutator(base);
    renderAll();
    return;
  }
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
  const duelEntries = state.duelPlayers;
  if (duelEntries.length < 3 || duelEntries.length > 24) {
    if (el.setupError) {
      el.setupError.textContent = 'ยังมีผู้เล่นในห้องไม่พอ (ต้องมี 3 ถึง 24 คนจากห้อง Duel)';
      el.setupError.classList.remove('hidden');
    }
    return;
  }
  el.setupError?.classList.add('hidden');

  const players = duelEntries.slice(0, 24).map((entry, index) => ({
    ...createPlayer(entry.name, `p${index + 1}`),
    sourceUid: entry.uid,
  }));
  const queue = buildSheriffQueue(players.map((player) => player.id), rounds);
  const firstSheriffId = String(queue[0] || '');
  const marketPlayerId = pickMarketPlayerId(players, firstSheriffId);
  const baseRoom = {
    players,
    deck: createInitialDeck(),
    discard: createEmptyPile(),
  };
  const dealt = dealInitialHands(baseRoom, { cardsPerPlayer: 6 });
  const readyPlayers = getPlayers(dealt.room);
  const readyDeck = dealt.room?.deck || createInitialDeck();
  const dealtCards = Number(dealt.cardsPerPlayer || 0);
  const dealWarning = dealtCards < 6
    ? ` (การ์ดเริ่มต้นเฉลี่ยคนละ ${dealtCards} ใบ เพราะจำนวนผู้เล่นเยอะ)`
    : '';

  await mutateRoom((room) => ({
    ...room,
    status: 'playing',
    roundsPerPlayer: rounds,
    players: readyPlayers,
    sheriffQueue: queue,
    marketPlayerId,
    activeRoundIndex: 0,
    deck: readyDeck,
    discard: createEmptyPile(),
    lastEvent: `เริ่มเกมแล้ว • แจกการ์ดเริ่มต้นคนละ ${dealtCards} ใบ${dealWarning} • 🚨 ${readyPlayers.find((p) => p.id === firstSheriffId)?.name || '-'} • 🛒 ${readyPlayers.find((p) => p.id === marketPlayerId)?.name || '-'}`,
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
  const qty = Math.max(1, Math.min(10, Number(el.cardQtyInput?.value || 1)));
  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const result = drawRandomCards(room, { playerId, qty });
    if (!result.ok) {
      return {
        ...room,
        lastEvent: 'กองกลางไม่พอสำหรับการสุ่มจับการ์ด',
      };
    }
    const players = getPlayers(result.room);
    const deck = result.room.deck;
    const drawnSummary = result.drawnCards
      .map((id) => `${getCardIcon(id)} ${getCardById(id)?.name || id}`)
      .filter(Boolean)
      .join(', ');

    return {
      ...room,
      players,
      deck,
      lastEvent: `${players.find((player) => player.id === playerId)?.name || 'ผู้เล่น'} สุ่มจับ ${qty} ใบ: ${drawnSummary || '-'}`,
    };
  });
}

async function discardCardFromPlayer() {
  const playerId = String(el.cardPlayerInput?.value || '');
  const cardId = String(el.cardTypeInput?.value || '');
  const qty = Math.max(1, Math.min(10, Number(el.cardQtyInput?.value || 1)));
  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const result = discardCard(room, { playerId, cardId, qty });
    if (!result.ok) {
      return {
        ...room,
        lastEvent: `ทิ้งการ์ดไม่สำเร็จ: ผู้เล่นมี ${getCardById(cardId)?.name || cardId} ไม่พอ`,
      };
    }
    const players = getPlayers(result.room);
    const discard = result.room.discard;
    return {
      ...room,
      players,
      discard,
      lastEvent: `${players.find((player) => player.id === playerId)?.name || 'ผู้เล่น'} ทิ้ง ${getCardIcon(cardId)} ${getCardById(cardId)?.name || cardId} x${qty}`,
    };
  });
}

async function reshuffleDiscardToDeck() {
  await mutateRoom((room) => {
    const nextRoom = reshuffleDiscard(room);
    return {
      ...nextRoom,
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
    const marketPlayerId = pickMarketPlayerId(getPlayers(room), nextSheriffId);
    const marketPlayerName = getPlayers(room).find((player) => player.id === marketPlayerId)?.name || '-';
    return {
      ...room,
      marketPlayerId,
      activeRoundIndex: nextIndex,
      lastEvent: `เริ่มรอบ ${nextIndex + 1}: 🚨 ตำรวจคือ ${nextSheriffName} • 🛒 เข้าตลาดคือ ${marketPlayerName}`,
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
      state.room.lastEvent = 'รอ Host เปิดเกมจ่ายส่วยในห้องนี้';
    }
    renderAll();
  });
}

function subscribeDuelPlayersForPrefill() {
  if (!duelRoomPlayersRef) return;
  onValue(duelRoomPlayersRef, (snapshot) => {
    const playersRaw = snapshot.val();
    const entries = getDuelPlayerEntries(playersRaw);
    state.duelPlayers = entries;
    if (el.setupError) el.setupError.classList.add('hidden');
    renderAll();
  });
}

async function init() {
  renderCardsInfo();
  renderRoomSummary();
  wireEvents();
  await ensureAuth();
  subscribeRoom();
  subscribeDuelPlayersForPrefill();
}

void init();
