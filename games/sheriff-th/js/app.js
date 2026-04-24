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
const role = rawRole === 'host' || rawRole === 'join' ? rawRole : '';
const requestedUid = String(params.get('uid') || '').trim();
const requestedPlayerName = String(params.get('player') || '').trim();
const ROOM_UID_CACHE_PREFIX = 'sheriff_th_room_uid_v1:';


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const roomRef = roomId ? ref(db, `sheriff_th_rooms/${roomId}/public`) : null;
const duelRoomPlayersRef = roomId ? ref(db, `rooms/${roomId}/players`) : null;
const duelRoomHostRef = roomId ? ref(db, `rooms/${roomId}/hostUid`) : null;

const state = {
  uid: '',
  room: null,
  duelPlayers: [],
  isHostMode: role ? role === 'host' : roomId ? null : true,
};

function isPermissionDenied(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code.includes('permission-denied')
    || code.includes('permission_denied')
    || message.includes('permission_denied')
    || message.includes('permission denied')
    || message.includes('missing or insufficient permissions');
}

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
  inspectionSummary: document.getElementById('inspectionSummary'),
  inspectMerchantInput: document.getElementById('inspectMerchantInput'),
  inspectionActionInput: document.getElementById('inspectionActionInput'),
  inspectionBribeInput: document.getElementById('inspectionBribeInput'),
  resolveInspectionBtn: document.getElementById('resolveInspectionBtn'),
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
  return state.isHostMode === true;
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

function getCurrentRoundInspection(room = state.room) {
  const inspection = room?.inspection;
  if (!inspection || typeof inspection !== 'object') return null;
  const merchantIds = Array.isArray(inspection.merchantIds) ? inspection.merchantIds : [];
  const resolvedMap = inspection?.resolvedMap && typeof inspection.resolvedMap === 'object' ? inspection.resolvedMap : {};
  const resolvedCount = merchantIds.filter((id) => Boolean(resolvedMap[id])).length;
  return {
    ...inspection,
    merchantIds,
    resolvedMap,
    resolvedCount,
    isComplete: merchantIds.length > 0 && resolvedCount >= merchantIds.length,
  };
}

function buildInspectionState(players = [], sheriffId = '') {
  return {
    sheriffId,
    merchantIds: players.map((player) => String(player.id || '')).filter((id) => id && id !== sheriffId),
    resolvedMap: {},
    startedAtMs: Date.now(),
    completedAtMs: null,
  };
}

function sumFineByHand(hand = {}, type = 'all') {
  return CARD_CATALOG.reduce((sum, card) => {
    const qty = Math.max(0, Number(hand?.[card.id] || 0));
    if (qty <= 0) return sum;
    if (type === 'legal' && card.type !== 'legal') return sum;
    if (type === 'contraband' && card.type !== 'contraband') return sum;
    return sum + (Number(card.fine || 0) * qty);
  }, 0);
}

function splitHandByType(hand = {}) {
  const legal = createEmptyPile();
  const contraband = createEmptyPile();
  CARD_CATALOG.forEach((card) => {
    const qty = Math.max(0, Number(hand?.[card.id] || 0));
    if (card.type === 'legal') legal[card.id] = qty;
    if (card.type === 'contraband') contraband[card.id] = qty;
  });
  return { legal, contraband };
}

function formatHandSummary(hand = {}) {
  return CARD_CATALOG
    .map((card) => ({ card, qty: Math.max(0, Number(hand?.[card.id] || 0)) }))
    .filter((entry) => entry.qty > 0)
    .map((entry) => `${getCardIcon(entry.card.id)} ${entry.card.name} x${entry.qty}`)
    .join(' • ') || '-';
}

function renderRoomSummary() {
  const isHostMode = state.isHostMode === true;
  const isJoinMode = state.isHostMode === false;
  if (el.hostOnlyHint) {
    el.hostOnlyHint.textContent = isHostMode
      ? 'คุณเป็น Host: ระบบจะดึงรายชื่อผู้เล่นจาก Duel ให้อัตโนมัติ และเริ่มเกมได้ทันทีเมื่อครบจำนวน'
      : isJoinMode
        ? 'คุณเป็น Join: ไม่ต้องตั้งค่าเพิ่ม รอ Host เริ่มเกมแล้วกระดานจะอัปเดตแบบเรียลไทม์'
        : 'กำลังตรวจสอบสิทธิ์ Host จากห้อง Duel...';
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
  const status = String(state.room?.status || 'setup');
  const me = players.find((player) => player.sourceUid && player.sourceUid === state.uid)?.name || '-';
  const inspection = getCurrentRoundInspection();
  const pendingCount = inspection ? Math.max(0, inspection.merchantIds.length - inspection.resolvedCount) : 0;

  el.gameStatus.innerHTML = [
    ['สถานะ', status === 'finished' ? 'จบเกม' : status === 'playing' ? 'กำลังเล่น' : 'ตั้งค่า'],
    ['รอบปัจจุบัน', `${Math.min(activeRound + 1, Math.max(queue.length, 1))}/${Math.max(queue.length, 1)}`],
    ['🚨 ตำรวจรอบนี้', currentSheriff],
    ['🧺 พ่อค้าที่รอตัดสิน', `${pendingCount} คน`],
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
  const inspection = getCurrentRoundInspection(room);
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
      ok: !inspection || inspection.merchantIds.every((id) => id && id !== sheriffId),
      message: `🧺 รายชื่อพ่อค้า ${inspection ? inspection.merchantIds.length : 0} คน`,
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
  if (!players.length) {
    el.playerRoleStrip.innerHTML = '';
    return;
  }
  el.playerRoleStrip.innerHTML = players.map((player) => {
    const isSheriff = player.id === sheriffId;
    const isYou = Boolean(player.sourceUid && player.sourceUid === state.uid);
    const classes = ['role-pill'];
    if (isSheriff) classes.push('is-sheriff');
    if (isYou) classes.push('is-you');
    return `<span class="${classes.join(' ')}">${isSheriff ? '🚨 ' : ''}${player.name}${isYou ? ' (คุณ)' : ''}</span>`;
  }).join('');
}

function renderInspectionBoard() {
  if (!el.inspectionSummary) return;
  const room = state.room || {};
  const players = getPlayers(room);
  const inspection = getCurrentRoundInspection(room);
  const sheriffId = getCurrentSheriffId(room);
  const sheriffName = players.find((player) => player.id === sheriffId)?.name || '-';

  if (!inspection) {
    el.inspectionSummary.innerHTML = '';
    if (el.inspectMerchantInput) el.inspectMerchantInput.innerHTML = '';
    return;
  }

  const unresolvedIds = inspection.merchantIds.filter((id) => !inspection.resolvedMap[id]);
  if (el.inspectMerchantInput) {
    el.inspectMerchantInput.innerHTML = unresolvedIds
      .map((id) => `<option value="${id}">${players.find((player) => player.id === id)?.name || id}</option>`)
      .join('');
  }

  const merchantCards = inspection.merchantIds.map((id) => {
    const merchant = players.find((player) => player.id === id);
    const resolved = inspection.resolvedMap[id];
    const decision = resolved?.action === 'inspect'
      ? '🔎 ตรวจสอบ'
      : resolved?.action === 'pass'
        ? '✅ ปล่อยผ่าน'
        : '⏳ รอตัดสิน';
    return `<div class="chip"><small>${merchant?.name || id} • ${decision}</small><strong>${formatHandSummary(merchant?.hand || {})}</strong></div>`;
  }).join('');

  el.inspectionSummary.innerHTML = [
    `<div class="chip"><small>ตำรวจรอบนี้</small><strong>${sheriffName}</strong></div>`,
    `<div class="chip"><small>สถานะการตัดสิน</small><strong>${inspection.resolvedCount}/${inspection.merchantIds.length} คน</strong></div>`,
    merchantCards,
  ].join('');
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
      ? state.isHostMode === null
        ? 'กำลังตรวจสอบสิทธิ์ Host...'
        : 'เฉพาะ Host เท่านั้นที่เริ่มเกมได้'
      : canStartByPlayerCount
        ? ''
        : 'ต้องมีผู้เล่นจากห้อง Duel 3-24 คน';
  }

  if (el.drawCardBtn) el.drawCardBtn.disabled = !isHost || !playing;
  if (el.discardCardBtn) el.discardCardBtn.disabled = !isHost || !playing;
  const inspection = getCurrentRoundInspection();
  const roundComplete = !playing || !inspection || inspection.isComplete;
  if (el.nextSheriffBtn) el.nextSheriffBtn.disabled = !isHost || !playing || !roundComplete;
  if (el.resolveInspectionBtn) el.resolveInspectionBtn.disabled = !isHost || !playing || roundComplete;
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
  renderInspectionBoard();
  renderSystemHealth();
  renderTable();
  renderWinner();

  const status = String(state.room?.status || 'setup');
  const shouldHideSetup = status !== 'setup' || state.isHostMode !== true;
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
  const applyMutation = async () => {
    await runTransaction(roomRef, (current) => {
      const base = current && typeof current === 'object' ? current : buildInitialRoomState();
      return mutator(base);
    });
  };
  try {
    await applyMutation();
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
    await ensureDuelMembershipForCurrentUser();
    try {
      await applyMutation();
    } catch (retryError) {
      if (!isPermissionDenied(retryError)) throw retryError;
      throw new Error('ยังไม่มีสิทธิ์เริ่มเกมในห้องนี้ กรุณากลับหน้า Duel แล้วกดเข้าห้องใหม่ก่อนเริ่มเกม');
    }
  }
}

function buildInitialRoomState() {
  const rounds = normalizeRounds(params.get('sheriffRoundsPerPlayer'));
  return {
    createdAtMs: Date.now(),
    createdByRole: canHostMutate() ? 'host' : 'join',
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
  try {
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
      marketPlayerId: pickMarketPlayerId(readyPlayers, firstSheriffId),
      activeRoundIndex: 0,
      inspection: buildInspectionState(readyPlayers, firstSheriffId),
      deck: readyDeck,
      discard: createEmptyPile(),
      lastEvent: `เริ่มเกมแล้ว • แจกการ์ดเริ่มต้นคนละ ${dealtCards} ใบ${dealWarning} • 🚨 ${readyPlayers.find((p) => p.id === firstSheriffId)?.name || '-'} • แสดงกระเป๋าพ่อค้าทุกคนแล้ว`,
      startedAtMs: Date.now(),
    }));
  } catch (error) {
    if (el.setupError) {
      el.setupError.textContent = `เริ่มเกมไม่สำเร็จ: ${String(error?.message || 'ลองใหม่อีกครั้ง')}`;
      el.setupError.classList.remove('hidden');
    }
  }
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
    const inspection = getCurrentRoundInspection(room);
    if (inspection && !inspection.isComplete) {
      return {
        ...room,
        lastEvent: 'ยังจบรอบไม่ได้: ตำรวจต้องตัดสินพ่อค้าทุกคนก่อน (ตรวจ/ปล่อยผ่าน)',
      };
    }
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
    const nextPlayers = getPlayers(room);
    return {
      ...room,
      marketPlayerId: pickMarketPlayerId(nextPlayers, nextSheriffId),
      activeRoundIndex: nextIndex,
      inspection: buildInspectionState(nextPlayers, nextSheriffId),
      lastEvent: `เริ่มรอบ ${nextIndex + 1}: 🚨 ตำรวจคือ ${nextSheriffName} • รอตัดสินพ่อค้าทุกคน`,
    };
  });
}

async function resolveInspectionDecision() {
  const merchantId = String(el.inspectMerchantInput?.value || '').trim();
  const action = String(el.inspectionActionInput?.value || 'inspect').trim();
  const bribe = Math.max(0, Number(el.inspectionBribeInput?.value || 0));
  if (!merchantId) return;

  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const inspection = getCurrentRoundInspection(room);
    if (!inspection) return room;
    if (!inspection.merchantIds.includes(merchantId) || inspection.resolvedMap[merchantId]) return room;

    const players = getPlayers(room).map((player) => ({ ...player, hand: { ...(player.hand || createEmptyPile()) } }));
    const sheriffId = String(inspection.sheriffId || getCurrentSheriffId(room) || '');
    const sheriff = players.find((player) => player.id === sheriffId);
    const merchant = players.find((player) => player.id === merchantId);
    if (!sheriff || !merchant) return room;

    const resolvedMap = { ...inspection.resolvedMap };
    const discard = { ...(room.discard || createEmptyPile()) };
    let lastEvent = '';

    if (action === 'pass') {
      const paidBribe = Math.min(Math.max(0, Math.floor(bribe)), Math.max(0, Number(merchant.money || 0)));
      merchant.money = Math.max(0, Number(merchant.money || 0) - paidBribe);
      sheriff.money = Math.max(0, Number(sheriff.money || 0) + paidBribe);
      resolvedMap[merchantId] = { action: 'pass', bribe: paidBribe, atMs: Date.now() };
      lastEvent = `✅ ${sheriff.name} ปล่อยผ่าน ${merchant.name} (จ่ายส่วย ${paidBribe})`;
    } else {
      const { legal, contraband } = splitHandByType(merchant.hand || {});
      const hasContraband = CARD_CATALOG.some((card) => card.type === 'contraband' && Number(contraband[card.id] || 0) > 0);
      if (hasContraband) {
        CARD_CATALOG.forEach((card) => {
          if (card.type !== 'contraband') return;
          const qty = Math.max(0, Number(merchant.hand?.[card.id] || 0));
          if (qty <= 0) return;
          merchant.hand[card.id] = 0;
          discard[card.id] = Math.max(0, Number(discard[card.id] || 0) + qty);
        });
        const fine = Math.min(sumFineByHand(contraband, 'contraband'), Math.max(0, Number(merchant.money || 0)));
        merchant.money = Math.max(0, Number(merchant.money || 0) - fine);
        sheriff.money = Math.max(0, Number(sheriff.money || 0) + fine);
        resolvedMap[merchantId] = { action: 'inspect', fine, confiscated: true, atMs: Date.now() };
        lastEvent = `🔎 ${sheriff.name} ตรวจเจอของเถื่อนจาก ${merchant.name} • ปรับ ${fine} และยึดของเถื่อน`;
      } else {
        const compensation = Math.min(sumFineByHand(legal, 'legal'), Math.max(0, Number(sheriff.money || 0)));
        sheriff.money = Math.max(0, Number(sheriff.money || 0) - compensation);
        merchant.money = Math.max(0, Number(merchant.money || 0) + compensation);
        resolvedMap[merchantId] = { action: 'inspect', compensation, confiscated: false, atMs: Date.now() };
        lastEvent = `🔎 ${sheriff.name} ตรวจไม่เจอของเถื่อนของ ${merchant.name} • ตำรวจจ่ายชดเชย ${compensation}`;
      }
    }

    const resolvedCount = inspection.merchantIds.filter((id) => Boolean(resolvedMap[id])).length;
    const isComplete = inspection.merchantIds.length > 0 && resolvedCount >= inspection.merchantIds.length;
    return {
      ...room,
      players,
      discard,
      inspection: {
        ...inspection,
        resolvedMap,
        completedAtMs: isComplete ? Date.now() : null,
      },
      lastEvent: isComplete ? `${lastEvent} • ✅ จบรอบแล้ว` : lastEvent,
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
  el.resolveInspectionBtn?.addEventListener('click', () => { void resolveInspectionDecision(); });
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

function getRoomUidCacheKey() {
  return `${ROOM_UID_CACHE_PREFIX}${roomId}`;
}

function readCachedRoomUid() {
  try {
    return String(window.localStorage.getItem(getRoomUidCacheKey()) || '').trim();
  } catch (_error) {
    return '';
  }
}

function cacheRoomUid(uid) {
  const safeUid = String(uid || '').trim();
  if (!safeUid) return;
  try {
    window.localStorage.setItem(getRoomUidCacheKey(), safeUid);
  } catch (_error) {
    // ignore storage limitation
  }
}

function buildLegacyUidCandidates(players = {}) {
  const fromQuery = String(requestedUid || '').trim();
  const fromCache = readCachedRoomUid();
  return [...new Set([fromQuery, fromCache])]
    .filter((uid) => uid && uid !== state.uid && Boolean(players?.[uid]));
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
    if (!data && canHostMutate()) {
      await mutateRoom(() => buildInitialRoomState());
      return;
    }
    state.room = data || buildInitialRoomState();
    if (!data && !canHostMutate()) {
      state.room.lastEvent = 'รอ Host เปิดเกมจ่ายส่วยในห้องนี้';
    }
    renderAll();
  }, (error) => {
    if (!isPermissionDenied(error)) return;
    state.room = {
      ...buildInitialRoomState(),
      lastEvent: 'ยังไม่มีสิทธิ์เข้าห้องเกมจ่ายส่วย กรุณากลับหน้า Duel แล้วเข้าห้องใหม่',
    };
    if (el.setupError) {
      el.setupError.textContent = 'ยังไม่มีสิทธิ์เข้าห้องเกมจ่ายส่วย กรุณากลับหน้า Duel แล้วเข้าห้องใหม่';
      el.setupError.classList.remove('hidden');
    }
    renderAll();
  });
}

function subscribeHostRoleFallback() {
  if (role) return;
  if (!duelRoomHostRef) {
    state.isHostMode = true;
    renderAll();
    return;
  }
  onValue(duelRoomHostRef, (snapshot) => {
    const hostUid = String(snapshot.val() || '').trim();
    state.isHostMode = Boolean(hostUid) && Boolean(state.uid) && hostUid === state.uid;
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

async function ensureDuelMembershipForCurrentUser() {
  if (!roomId || !state.uid) return;
  const duelRoomRef = ref(db, `rooms/${roomId}`);
  const roomSnap = await new Promise((resolve, reject) => {
    onValue(duelRoomRef, (snap) => resolve(snap), reject, { onlyOnce: true });
  });
  const room = roomSnap.val() || {};
  const players = room?.players && typeof room.players === 'object' ? room.players : {};

  if (players?.[state.uid]) {
    cacheRoomUid(state.uid);
    return;
  }

  const legacyCandidates = buildLegacyUidCandidates(players);
  for (const legacyUid of legacyCandidates) {
    const tx = await runTransaction(duelRoomRef, (current) => {
      if (!current || typeof current !== 'object') return current;
      const currentPlayers = current?.players && typeof current.players === 'object' ? { ...current.players } : {};
      if (currentPlayers[state.uid]) return current;
      const legacyPlayer = currentPlayers[legacyUid];
      if (!legacyPlayer) return current;

      const now = Date.now();
      delete currentPlayers[legacyUid];
      currentPlayers[state.uid] = {
        ...legacyPlayer,
        uid: state.uid,
        online: true,
        isHost: role === 'host',
        disconnectedAtMs: null,
        updatedAt: now,
      };

      const nextRoom = {
        ...current,
        players: currentPlayers,
        hostUid: String(current?.hostUid || '') === legacyUid ? state.uid : current?.hostUid,
        updatedAtMs: now,
      };
      if (role === 'host' && String(nextRoom.hostUid || '') === state.uid) {
        nextRoom.hostName = String(legacyPlayer?.name || nextRoom.hostName || 'Host');
      }
      return nextRoom;
    });

    const recoveredRoom = tx?.snapshot?.val() || {};
    if (recoveredRoom?.players?.[state.uid]) {
      cacheRoomUid(state.uid);
      return;
    }
  }

  const normalizedRequestedName = String(requestedPlayerName || '').trim().toLowerCase();
  if (normalizedRequestedName) {
    const matchedEntries = Object.entries(players)
      .filter(([uid, player]) => uid !== state.uid && String(player?.name || '').trim().toLowerCase() === normalizedRequestedName);
    if (matchedEntries.length === 1) {
      const [legacyUid] = matchedEntries[0];
      const tx = await runTransaction(duelRoomRef, (current) => {
        if (!current || typeof current !== 'object') return current;
        const currentPlayers = current?.players && typeof current.players === 'object' ? { ...current.players } : {};
        if (currentPlayers[state.uid]) return current;
        const legacyPlayer = currentPlayers[legacyUid];
        if (!legacyPlayer) return current;
        if (String(legacyPlayer?.name || '').trim().toLowerCase() !== normalizedRequestedName) return current;

        const now = Date.now();
        delete currentPlayers[legacyUid];
        currentPlayers[state.uid] = {
          ...legacyPlayer,
          uid: state.uid,
          online: true,
          isHost: role === 'host',
          disconnectedAtMs: null,
          updatedAt: now,
        };

        const nextRoom = {
          ...current,
          players: currentPlayers,
          hostUid: String(current?.hostUid || '') === legacyUid ? state.uid : current?.hostUid,
          updatedAtMs: now,
        };
        if (role === 'host' && String(nextRoom.hostUid || '') === state.uid) {
          nextRoom.hostName = String(legacyPlayer?.name || nextRoom.hostName || 'Host');
        }
        return nextRoom;
      });

      const recoveredRoom = tx?.snapshot?.val() || {};
      if (recoveredRoom?.players?.[state.uid]) {
        cacheRoomUid(state.uid);
        return;
      }
    }
  }

  const tx = await runTransaction(duelRoomRef, (current) => {
    if (!current || typeof current !== 'object') return current;
    const currentPlayers = current?.players && typeof current.players === 'object' ? { ...current.players } : {};
    if (currentPlayers[state.uid]) return current;
    const existingByRequestedUid = requestedUid ? currentPlayers[requestedUid] : null;
    const displayName = String(
      requestedPlayerName
      || existingByRequestedUid?.name
      || `ผู้เล่น-${state.uid.slice(0, 4)}`
    ).trim();
    const now = Date.now();
    currentPlayers[state.uid] = {
      uid: state.uid,
      name: displayName || 'ผู้เล่น',
      online: true,
      isHost: role === 'host',
      joinedAt: now,
      updatedAt: now,
    };
    const nextRoom = {
      ...current,
      players: currentPlayers,
      updatedAtMs: now,
    };
    if (role === 'host') {
      const currentHostUid = String(current?.hostUid || '');
      if (!currentHostUid || (requestedUid && currentHostUid === requestedUid)) {
        nextRoom.hostUid = state.uid;
        nextRoom.hostName = displayName || 'Host';
      }
    }
    return nextRoom;
  });

  const finalRoom = tx?.snapshot?.val() || {};
  if (finalRoom?.players?.[state.uid]) {
    cacheRoomUid(state.uid);
    return;
  }
  throw new Error('ไม่พบสิทธิ์ผู้เล่นในห้อง Duel กรุณากลับหน้า Duel แล้วเข้าห้องใหม่');
}

async function init() {
  renderCardsInfo();
  renderRoomSummary();
  wireEvents();
  await ensureAuth();
  await ensureDuelMembershipForCurrentUser();
  subscribeHostRoleFallback();
  subscribeRoom();
  subscribeDuelPlayersForPrefill();
}

void init();
