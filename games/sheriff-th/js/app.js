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
const uiState = {
  handSelections: new Set(),
  selectionMode: 'discard',
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
  smoke: '💨',
  rare_sea: '🥤',
  herb: '💊',
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
  phaseGuide: document.getElementById('phaseGuide'),
  phaseActions: document.getElementById('phaseActions'),
  scoreMiniBoard: document.getElementById('scoreMiniBoard'),
  playerHandCards: document.getElementById('playerHandCards'),
  merchantPlayerInput: document.getElementById('merchantPlayerInput'),
  merchantCardTypeInput: document.getElementById('merchantCardTypeInput'),
  merchantQtyInput: document.getElementById('merchantQtyInput'),
  discardRedrawBtn: document.getElementById('discardRedrawBtn'),
  addBagBtn: document.getElementById('addBagBtn'),
  clearBagBtn: document.getElementById('clearBagBtn'),
  submitBagBtn: document.getElementById('submitBagBtn'),
  playerHandSummary: document.getElementById('playerHandSummary'),
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
  const resolveDuelPlayerName = (player = {}, uid = '') => {
    const candidates = [
      player?.name,
      player?.displayName,
      player?.studentName,
      player?.nickname,
      player?.nickName,
      uid ? `ผู้เล่น-${String(uid).slice(0, 4)}` : '',
      'ผู้เล่น',
    ];
    return String(candidates.find((value) => String(value || '').trim()) || 'ผู้เล่น').trim();
  };

  return Object.entries(playersMap)
    .map(([uid, player]) => ({
      uid: String(uid || '').trim(),
      name: resolveDuelPlayerName(player, uid),
    }))
    .filter((entry) => entry.uid);
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

function getCurrentViewerPlayer(room = state.room) {
  const players = getPlayers(room);
  return players.find((player) => player.sourceUid && player.sourceUid === state.uid) || null;
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
  const prepMap = inspection?.prepMap && typeof inspection.prepMap === 'object' ? inspection.prepMap : {};
  const resolvedMap = inspection?.resolvedMap && typeof inspection.resolvedMap === 'object' ? inspection.resolvedMap : {};
  const submittedCount = merchantIds.filter((id) => Boolean(prepMap[id]?.bagSubmitted)).length;
  const resolvedCount = merchantIds.filter((id) => Boolean(resolvedMap[id])).length;
  const phase = String(inspection.phase || 'prepare');
  return {
    ...inspection,
    phase,
    merchantIds,
    prepMap,
    resolvedMap,
    submittedCount,
    resolvedCount,
    isReadyForInspection: merchantIds.length > 0 && submittedCount >= merchantIds.length,
    isComplete: phase === 'inspect' && merchantIds.length > 0 && resolvedCount >= merchantIds.length,
  };
}

function buildInspectionState(players = [], sheriffId = '') {
  return {
    phase: 'prepare',
    sheriffId,
    merchantIds: players.map((player) => String(player.id || '')).filter((id) => id && id !== sheriffId),
    prepMap: players.reduce((acc, player) => {
      if (player.id && player.id !== sheriffId) {
        acc[player.id] = {
          redrawCount: 0,
          bag: createEmptyPile(),
          bagSubmitted: false,
        };
      }
      return acc;
    }, {}),
    resolvedMap: {},
    startedAtMs: Date.now(),
    completedAtMs: null,
  };
}

function getInspectionPhase(room = state.room) {
  return String(room?.inspection?.phase || 'prepare');
}

function countPileCards(pile = {}) {
  return CARD_CATALOG.reduce((sum, card) => sum + Math.max(0, Number(pile?.[card.id] || 0)), 0);
}

function getVisibleRoundScore(player = {}) {
  const hand = addPile(player?.hand || createEmptyPile(), player?.sold || createEmptyPile());
  let legalPoints = 0;
  let contrabandPoints = 0;
  CARD_CATALOG.forEach((card) => {
    const qty = Math.max(0, Number(hand?.[card.id] || 0));
    const points = qty * Number(card.points || 0);
    if (card.type === 'legal') legalPoints += points;
    if (card.type === 'contraband') contrabandPoints += points;
  });
  return {
    legalPoints,
    contrabandPoints,
    publicTotal: Number(player?.money || 0) + legalPoints,
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

function subtractPileFromHand(hand = {}, pile = {}) {
  const next = { ...(hand || createEmptyPile()) };
  CARD_CATALOG.forEach((card) => {
    const current = Math.max(0, Number(next[card.id] || 0));
    const used = Math.max(0, Number(pile?.[card.id] || 0));
    next[card.id] = Math.max(0, current - used);
  });
  return next;
}

function addPile(target = {}, pile = {}) {
  const next = { ...(target || createEmptyPile()) };
  CARD_CATALOG.forEach((card) => {
    const current = Math.max(0, Number(next[card.id] || 0));
    const incoming = Math.max(0, Number(pile?.[card.id] || 0));
    next[card.id] = current + incoming;
  });
  return next;
}

function getPlayersForScoring(players = []) {
  return players.map((player) => ({
    ...player,
    hand: addPile(player?.hand || createEmptyPile(), player?.sold || createEmptyPile()),
  }));
}

function formatHandSummary(hand = {}) {
  return CARD_CATALOG
    .map((card) => ({ card, qty: Math.max(0, Number(hand?.[card.id] || 0)) }))
    .filter((entry) => entry.qty > 0)
    .map((entry) => `${getCardIcon(entry.card.id)} ${entry.card.name} x${entry.qty}`)
    .join(' • ') || '-';
}

function drawWithAutoReshuffle(room = {}, playerId = '', qty = 1) {
  const firstDraw = drawRandomCards(room, { playerId, qty });
  if (firstDraw.ok) return { ...firstDraw, reshuffled: false };
  if (String(firstDraw.message || '') !== 'deck_empty') return { ...firstDraw, reshuffled: false };
  const reshuffledRoom = reshuffleDiscard(firstDraw.room || room);
  const secondDraw = drawRandomCards(reshuffledRoom, { playerId, qty });
  return {
    ...secondDraw,
    reshuffled: true,
  };
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
  const legalCards = CARD_CATALOG.filter((card) => card.type === 'legal');
  const contrabandCards = CARD_CATALOG.filter((card) => card.type === 'contraband');
  const renderGroup = (title, cards) => `
    <section>
      <h4>${title}</h4>
      <div class="cards-list">
        ${cards.map((card) => (
          `<article class="card-item">
            <div class="card-item-head">
              <span class="card-icon" aria-hidden="true">${getCardIcon(card.id)}</span>
              <strong>${card.name}</strong>
            </div>
            <small>แต้ม ${card.points} • ค่าปรับ ${card.fine} • ในกองเริ่มต้น ${card.deckCount}</small>
          </article>`
        )).join('')}
      </div>
    </section>
  `;
  el.cardsInfoList.innerHTML = [
    renderGroup('หมวดของดี ✅', legalCards),
    renderGroup('หมวดของเถื่อน ⚠️', contrabandCards),
  ].join('');
}

function renderPlayerSelects() {
  const players = getPlayers();
  const sheriffId = getCurrentSheriffId();
  const merchants = players.filter((player) => player.id !== sheriffId);
  if (!el.merchantPlayerInput || !el.merchantCardTypeInput) return;
  el.merchantPlayerInput.innerHTML = merchants.map((player) => `<option value="${player.id}">${player.name}</option>`).join('');
  el.merchantCardTypeInput.innerHTML = CARD_CATALOG.map((card) => `<option value="${card.id}">${getCardIcon(card.id)} ${card.name}</option>`).join('');
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
  const soldOut = state.room?.soldOut || createEmptyPile();
  const totalDeck = Object.values(deck).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalDiscard = Object.values(discard).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalSoldOut = Object.values(soldOut).reduce((sum, value) => sum + Number(value || 0), 0);

  el.deckStatus.innerHTML = [
    ['🃏 กองกลาง', `${totalDeck} ใบ`],
    ['🗑️ กองทิ้ง', `${totalDiscard} ใบ`],
    ['📦 ขายแล้ว', `${totalSoldOut} ใบ`],
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
  const inspection = getCurrentRoundInspection();
  const pendingCount = inspection ? Math.max(0, inspection.merchantIds.length - inspection.resolvedCount) : 0;
  const submittedCount = inspection ? Number(inspection.submittedCount || 0) : 0;
  const currentMerchant = getPlayers().find((p) => p.id === String(el.merchantPlayerInput?.value || ''))?.name || '-';
  const phase = inspection?.phase === 'inspect' ? 'ด่านตำรวจ' : 'เตรียมกระเช้า';

  el.gameStatus.innerHTML = [
    ['สถานะ', status === 'finished' ? 'จบเกม' : status === 'playing' ? 'กำลังเล่น' : 'ตั้งค่า'],
    ['รอบ', `${Math.min(activeRound + 1, Math.max(queue.length, 1))}/${Math.max(queue.length, 1)}`],
    ['👮 ตำรวจ', currentSheriff],
    ['🎯 ผู้เล่นที่กำลังเล่น', currentMerchant],
    ['เฟส', phase],
    ['🧺 ส่งแล้ว', `${submittedCount}/${inspection?.merchantIds?.length || 0}`],
    ['⏳ รอตรวจ', `${pendingCount} คน`],
  ].map(([label, value]) => `<div class="chip"><small>${label}</small><strong>${value}</strong></div>`).join('');
}

function renderPhaseGuide() {
  if (!el.phaseGuide) return;
  const viewer = getCurrentViewerPlayer();
  const sheriffId = getCurrentSheriffId();
  const isSheriff = viewer?.id && viewer.id === sheriffId;
  const inspection = getCurrentRoundInspection();
  const phaseText = inspection?.phase === 'inspect'
    ? 'หน้า 3: ตำรวจตรวจทีละคน'
    : 'หน้า 1-2: เลือกทิ้ง แล้วจัดกระเช้า';
  const viewerRoleText = isSheriff ? 'คุณเป็นตำรวจ 👮' : 'คุณเป็นพ่อค้า 🧺';
  el.phaseGuide.textContent = `${phaseText} • ${viewerRoleText}`;
}

function renderInspectionBoard() {
  if (!el.inspectionSummary) return;
  const room = state.room || {};
  const players = getPlayers(room);
  const inspection = getCurrentRoundInspection(room);
  const sheriffId = getCurrentSheriffId(room);
  const sheriffName = players.find((player) => player.id === sheriffId)?.name || '-';
  const viewer = getCurrentViewerPlayer(room);
  const viewerId = String(viewer?.id || '');
  const canSeeAllHands = viewerId && viewerId === sheriffId;

  if (!inspection) {
    el.inspectionSummary.innerHTML = '';
    if (el.inspectMerchantInput) el.inspectMerchantInput.innerHTML = '';
    return;
  }

  const unresolvedIds = inspection.phase === 'inspect'
    ? inspection.merchantIds.filter((id) => !inspection.resolvedMap[id])
    : inspection.merchantIds;
  if (el.inspectMerchantInput) {
    el.inspectMerchantInput.innerHTML = unresolvedIds
      .map((id) => `<option value="${id}">${players.find((player) => player.id === id)?.name || id}</option>`)
      .join('');
  }

  const merchantCards = inspection.merchantIds.map((id) => {
    const merchant = players.find((player) => player.id === id);
    const resolved = inspection.resolvedMap[id];
    const bagMap = inspection?.prepMap?.[id]?.bag || createEmptyPile();
    const handCount = countPileCards(bagMap);
    const canRevealHand = canSeeAllHands || viewerId === id;
    const decision = resolved?.action === 'inspect'
      ? '🔎 ตรวจสอบ'
      : resolved?.action === 'pass'
        ? '✅ ปล่อยผ่าน'
        : '⏳ รอตัดสิน';
    const handText = canRevealHand ? formatHandSummary(bagMap) : `🂠 ซ่อนการ์ด (${handCount} ใบ)`;
    return `<div class="chip"><small>${merchant?.name || id} • ${decision}</small><strong>${handText}</strong></div>`;
  }).join('');

  const stageText = inspection.phase === 'prepare'
    ? `เฟสเตรียมกระเช้า ${inspection.submittedCount}/${inspection.merchantIds.length}`
    : `เฟสตรวจ ${inspection.resolvedCount}/${inspection.merchantIds.length}`;
  el.inspectionSummary.innerHTML = [
    `<div class="chip"><small>ตำรวจรอบนี้</small><strong>${sheriffName}</strong></div>`,
    `<div class="chip"><small>สถานะรอบ</small><strong>${stageText}</strong></div>`,
    merchantCards,
  ].join('');
}

function renderPlayerHandSummary() {
  if (!el.playerHandSummary) return;
  const room = state.room || {};
  const players = getPlayers(room);
  const merchantId = String(el.merchantPlayerInput?.value || '');
  const merchant = players.find((player) => player.id === merchantId) || players[0];
  const inspection = getCurrentRoundInspection(room);
  if (!merchant) {
    el.playerHandSummary.innerHTML = '';
    return;
  }
  const prep = inspection?.prepMap?.[merchant.id] || { redrawCount: 0, bag: createEmptyPile(), bagSubmitted: false };
  const bagTotal = countPileCards(prep.bag || {});
  const sold = merchant?.sold || createEmptyPile();
  el.playerHandSummary.innerHTML = [
    ['ทิ้ง/จั่วใหม่', `${Math.max(0, Number(prep.redrawCount || 0))}/3`],
    ['ในกระเช้า', `${bagTotal}/4`],
    ['การ์ดขายแล้ว', formatHandSummary(sold)],
    ['สถานะ', prep.bagSubmitted ? '✅ ส่งแล้ว' : '⏳ ยังไม่ส่ง'],
  ].map(([label, value]) => `<div class="chip"><small>${label}</small><strong>${value}</strong></div>`).join('');
}

function renderTable() {
  if (!el.scoreMiniBoard) return;
  const status = String(state.room?.status || 'setup');
  const rows = computePlayerTotals(getPlayersForScoring(getPlayers()));
  el.scoreMiniBoard.innerHTML = rows.map((player) => {
    const publicScore = getVisibleRoundScore(player).publicTotal;
    const total = status === 'finished' ? player.total : publicScore;
    return `<div class="chip"><small>${player.name}</small><strong>🏆 ${total} • 💰 ${player.money}</strong></div>`;
  }).join('');
}

function renderWinner() {
  const ranked = buildWinnerSummary(getPlayersForScoring(getPlayers()));
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

function getHandEntries(hand = {}) {
  const entries = [];
  CARD_CATALOG.forEach((card) => {
    const qty = Math.max(0, Number(hand?.[card.id] || 0));
    for (let i = 0; i < qty; i += 1) entries.push({ token: `${card.id}#${i + 1}`, cardId: card.id });
  });
  return entries.slice(0, 6);
}

function renderHandCards() {
  if (!el.playerHandCards) return;
  const players = getPlayers();
  const merchantId = String(el.merchantPlayerInput?.value || '');
  const merchant = players.find((player) => player.id === merchantId) || players[0];
  if (!merchant) {
    el.playerHandCards.innerHTML = '';
    return;
  }
  const inspection = getCurrentRoundInspection();
  const prep = inspection?.prepMap?.[merchant.id] || { bag: createEmptyPile() };
  const bag = prep.bag || createEmptyPile();
  const entries = getHandEntries(merchant.hand || {});
  el.playerHandCards.innerHTML = entries.map((entry) => {
    const card = getCardById(entry.cardId);
    const selected = uiState.handSelections.has(entry.token);
    const inBag = Number(bag?.[entry.cardId] || 0) > 0;
    const classes = ['hand-card'];
    if (selected && uiState.selectionMode === 'discard') classes.push('selected-discard');
    if (selected && uiState.selectionMode === 'bag') classes.push('selected-bag');
    if (card?.type === 'contraband') classes.push('illegal');
    if (!selected && inBag) classes.push('selected-bag');
    return `<button type="button" class="${classes.join(' ')}" data-token="${entry.token}" data-card-id="${entry.cardId}">
      <div class="big">${getCardIcon(entry.cardId)}</div>
      <div>${card?.name || entry.cardId}</div>
    </button>`;
  }).join('');
}

function renderPhaseActions() {
  if (!el.phaseActions) return;
  const phase = getInspectionPhase();
  if (phase === 'inspect') {
    el.phaseActions.innerHTML = `
      <button type="button" class="btn" id="btnInspect">ให้ตรวจ</button>
      <button type="button" class="btn btn-secondary" id="btnPassBribe">รับสินบน</button>
      <button type="button" class="btn btn-danger" id="btnForceFinish">ยึดของ</button>
      <button type="button" class="btn btn-secondary" id="btnNextRound">ผ่าน/รอบถัดไป</button>
    `;
    return;
  }
  el.phaseActions.innerHTML = `
    <button type="button" class="btn btn-secondary" id="btnSelectDiscard">โหมดทิ้งการ์ด</button>
    <button type="button" class="btn btn-secondary" id="btnSelectBag">โหมดใส่กระเช้า</button>
    <button type="button" class="btn" id="btnApplySelection">${uiState.selectionMode === 'bag' ? 'ส่งให้ตรวจ' : 'ทิ้งการ์ด + จั่วใหม่'}</button>
    <button type="button" class="btn btn-secondary" id="btnClearSelection">ยกเลิกเลือก</button>
  `;
}

function setControlAvailability() {
  const isHost = canHostMutate();
  const status = String(state.room?.status || 'setup');
  const playing = status === 'playing';
  const duelPlayerCount = state.duelPlayers.length;
  const canStartByPlayerCount = duelPlayerCount >= 2 && duelPlayerCount <= 24;
  const inspection = getCurrentRoundInspection();
  const phase = getInspectionPhase();
  const roundComplete = !playing || !inspection || inspection.isComplete;

  [el.startGameBtn, el.discardRedrawBtn, el.addBagBtn, el.clearBagBtn, el.submitBagBtn, el.reshuffleBtn, el.nextSheriffBtn, el.finishGameBtn].forEach((button) => {
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
        : 'ต้องมีผู้เล่นจากห้อง Duel 2-24 คน';
  }

  const allowPrepareActions = isHost && playing && phase === 'prepare';
  if (el.discardRedrawBtn) el.discardRedrawBtn.disabled = !allowPrepareActions;
  if (el.addBagBtn) el.addBagBtn.disabled = !allowPrepareActions;
  if (el.clearBagBtn) el.clearBagBtn.disabled = !allowPrepareActions;
  if (el.submitBagBtn) el.submitBagBtn.disabled = !allowPrepareActions;
  if (el.nextSheriffBtn) el.nextSheriffBtn.disabled = !isHost || !playing || !roundComplete;
  if (el.resolveInspectionBtn) el.resolveInspectionBtn.disabled = !isHost || !playing || phase !== 'inspect' || roundComplete;
  if (el.finishGameBtn) el.finishGameBtn.disabled = !isHost || status === 'finished';
  if (el.reshuffleBtn) el.reshuffleBtn.disabled = !isHost || status === 'setup';
}

function renderAll() {
  renderRoomSummary();
  renderDuelPlayersPreview();
  renderPlayerSelects();
  renderDeckStatus();
  renderGameStatus();
  renderPhaseGuide();
  renderPlayerHandSummary();
  renderHandCards();
  renderInspectionBoard();
  renderPhaseActions();
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
    soldOut: createEmptyPile(),
    lastEvent: 'รอ Host ตั้งค่าผู้เล่นและเริ่มเกม',
  };
}

async function startGame() {
  try {
    const rounds = normalizeRounds(el.roundsPerPlayerInput?.value || 1);
    const duelEntries = state.duelPlayers;
    if (duelEntries.length < 2 || duelEntries.length > 24) {
      if (el.setupError) {
        el.setupError.textContent = 'ยังมีผู้เล่นในห้องไม่พอ (ต้องมี 2 ถึง 24 คนจากห้อง Duel)';
        el.setupError.classList.remove('hidden');
      }
      return;
    }
    el.setupError?.classList.add('hidden');

    const players = duelEntries.slice(0, 24).map((entry, index) => ({
      ...createPlayer(entry.name, `p${index + 1}`),
      sourceUid: entry.uid,
      sold: createEmptyPile(),
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
      soldOut: createEmptyPile(),
      lastEvent: `เริ่มเกมแล้ว • แจกการ์ดเริ่มต้นคนละ ${dealtCards} ใบ${dealWarning} • 🚨 ${readyPlayers.find((p) => p.id === firstSheriffId)?.name || '-'} เริ่มตรวจด่าน`,
      startedAtMs: Date.now(),
    }));
  } catch (error) {
    if (el.setupError) {
      el.setupError.textContent = `เริ่มเกมไม่สำเร็จ: ${String(error?.message || 'ลองใหม่อีกครั้ง')}`;
      el.setupError.classList.remove('hidden');
    }
  }
}

async function discardAndRedrawForMerchant() {
  const playerId = String(el.merchantPlayerInput?.value || '');
  const cardId = String(el.merchantCardTypeInput?.value || '');
  const qty = Math.max(1, Math.min(3, Number(el.merchantQtyInput?.value || 1)));
  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const inspection = getCurrentRoundInspection(room);
    if (!inspection || inspection.phase !== 'prepare') return room;
    const prep = inspection.prepMap?.[playerId];
    if (!prep || prep.bagSubmitted) return room;
    const used = Math.max(0, Number(prep.redrawCount || 0));
    if (used + qty > 3) {
      return { ...room, lastEvent: 'ทิ้ง+สุ่มใหม่ได้รวมไม่เกิน 3 ใบต่อรอบ' };
    }
    const discardResult = discardCard(room, { playerId, cardId, qty });
    if (!discardResult.ok) {
      return { ...room, lastEvent: 'ทิ้งการ์ดไม่สำเร็จ: การ์ดในมือไม่พอ' };
    }
    const drawResult = drawWithAutoReshuffle(discardResult.room, playerId, qty);
    if (!drawResult.ok) {
      return { ...room, lastEvent: 'สุ่มการ์ดใหม่ไม่สำเร็จ: กองกลางไม่พอ' };
    }
    const nextInspection = {
      ...inspection,
      prepMap: {
        ...inspection.prepMap,
        [playerId]: {
          ...prep,
          redrawCount: used + qty,
        },
      },
    };
    const players = getPlayers(drawResult.room);
    const playerName = players.find((player) => player.id === playerId)?.name || 'พ่อค้า';
    return {
      ...room,
      players,
      deck: drawResult.room.deck,
      discard: drawResult.room.discard,
      inspection: nextInspection,
      lastEvent: `${playerName} ทิ้ง+สุ่มใหม่ ${qty} ใบ (ใช้สิทธิ์ ${used + qty}/3)${drawResult.reshuffled ? ' • สับกองทิ้งอัตโนมัติ' : ''}`,
    };
  });
}

async function addCardToMerchantBag() {
  const playerId = String(el.merchantPlayerInput?.value || '');
  const cardId = String(el.merchantCardTypeInput?.value || '');
  const qty = Math.max(1, Math.min(4, Number(el.merchantQtyInput?.value || 1)));
  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const inspection = getCurrentRoundInspection(room);
    if (!inspection || inspection.phase !== 'prepare') return room;
    const prep = inspection.prepMap?.[playerId];
    if (!prep || prep.bagSubmitted) return room;
    const merchant = getPlayers(room).find((player) => player.id === playerId);
    const handQty = Math.max(0, Number(merchant?.hand?.[cardId] || 0));
    const bag = { ...(prep.bag || createEmptyPile()) };
    const nextQty = Math.max(0, Number(bag[cardId] || 0)) + qty;
    const bagTotal = countPileCards(bag) + qty;
    if (nextQty > handQty) return { ...room, lastEvent: 'ใส่กระเช้าไม่สำเร็จ: เกินจำนวนการ์ดในมือ' };
    if (bagTotal > 4) return { ...room, lastEvent: 'ใส่กระเช้าได้สูงสุด 4 ใบ' };
    bag[cardId] = nextQty;
    return {
      ...room,
      inspection: {
        ...inspection,
        prepMap: {
          ...inspection.prepMap,
          [playerId]: { ...prep, bag },
        },
      },
      lastEvent: `${merchant?.name || 'พ่อค้า'} ใส่ ${getCardIcon(cardId)} ${getCardById(cardId)?.name || cardId} x${qty} เข้ากระเช้า`,
    };
  });
}

async function clearMerchantBag() {
  const playerId = String(el.merchantPlayerInput?.value || '');
  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const inspection = getCurrentRoundInspection(room);
    if (!inspection || inspection.phase !== 'prepare') return room;
    const prep = inspection.prepMap?.[playerId];
    if (!prep || prep.bagSubmitted) return room;
    return {
      ...room,
      inspection: {
        ...inspection,
        prepMap: {
          ...inspection.prepMap,
          [playerId]: { ...prep, bag: createEmptyPile() },
        },
      },
      lastEvent: 'ล้างกระเช้าพ่อค้าแล้ว',
    };
  });
}

async function submitMerchantBag() {
  const playerId = String(el.merchantPlayerInput?.value || '');
  await mutateRoom((room) => {
    if (String(room.status || '') !== 'playing') return room;
    const inspection = getCurrentRoundInspection(room);
    if (!inspection || inspection.phase !== 'prepare') return room;
    const prep = inspection.prepMap?.[playerId];
    if (!prep || prep.bagSubmitted) return room;
    const prepMap = {
      ...inspection.prepMap,
      [playerId]: { ...prep, bagSubmitted: true },
    };
    const submittedCount = inspection.merchantIds.filter((id) => prepMap[id]?.bagSubmitted).length;
    const phase = submittedCount >= inspection.merchantIds.length ? 'inspect' : 'prepare';
    const merchantName = getPlayers(room).find((player) => player.id === playerId)?.name || 'พ่อค้า';
    return {
      ...room,
      inspection: {
        ...inspection,
        prepMap,
        phase,
      },
      lastEvent: phase === 'inspect'
        ? `${merchantName} ส่งกระเช้าแล้ว • พ่อค้าครบทุกคน เริ่มเฟสตรวจ`
        : `${merchantName} ส่งกระเช้าแล้ว (${submittedCount}/${inspection.merchantIds.length})`,
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
    if (inspection.phase !== 'inspect') return { ...room, lastEvent: 'ยังตรวจไม่ได้: รอพ่อค้าส่งกระเช้าให้ครบก่อน' };
    if (!inspection.merchantIds.includes(merchantId) || inspection.resolvedMap[merchantId]) return room;

    const players = getPlayers(room).map((player) => ({ ...player, hand: { ...(player.hand || createEmptyPile()) } }));
    const sheriffId = String(inspection.sheriffId || getCurrentSheriffId(room) || '');
    const sheriff = players.find((player) => player.id === sheriffId);
    const merchant = players.find((player) => player.id === merchantId);
    if (!sheriff || !merchant) return room;

    const prep = inspection.prepMap?.[merchantId] || { bag: createEmptyPile() };
    const bag = prep?.bag || createEmptyPile();
    const resolvedMap = { ...inspection.resolvedMap };
    const discard = { ...(room.discard || createEmptyPile()) };
    let soldOut = { ...(room.soldOut || createEmptyPile()) };
    let lastEvent = '';

    if (action === 'pass') {
      const paidBribe = Math.min(Math.max(0, Math.floor(bribe)), Math.max(0, Number(merchant.money || 0)));
      merchant.money = Math.max(0, Number(merchant.money || 0) - paidBribe);
      sheriff.money = Math.max(0, Number(sheriff.money || 0) + paidBribe);
      merchant.hand = subtractPileFromHand(merchant.hand, bag);
      merchant.sold = addPile(merchant.sold || createEmptyPile(), bag);
      soldOut = addPile(soldOut, bag);
      resolvedMap[merchantId] = { action: 'pass', bribe: paidBribe, atMs: Date.now() };
      lastEvent = `✅ ${sheriff.name} ปล่อยผ่าน ${merchant.name} (จ่ายส่วย ${paidBribe}) • ส่งขาย ${countPileCards(bag)} ใบ`;
    } else {
      const { legal, contraband } = splitHandByType(bag);
      const hasContraband = CARD_CATALOG.some((card) => card.type === 'contraband' && Number(contraband[card.id] || 0) > 0);
      if (hasContraband) {
        merchant.hand = subtractPileFromHand(merchant.hand, contraband);
        CARD_CATALOG.forEach((card) => {
          if (card.type !== 'contraband') return;
          const qty = Math.max(0, Number(contraband?.[card.id] || 0));
          if (qty <= 0) return;
          discard[card.id] = Math.max(0, Number(discard[card.id] || 0) + qty);
        });
        merchant.hand = subtractPileFromHand(merchant.hand, legal);
        merchant.sold = addPile(merchant.sold || createEmptyPile(), legal);
        soldOut = addPile(soldOut, legal);
        const fine = Math.min(sumFineByHand(contraband, 'contraband'), Math.max(0, Number(merchant.money || 0)));
        merchant.money = Math.max(0, Number(merchant.money || 0) - fine);
        sheriff.money = Math.max(0, Number(sheriff.money || 0) + fine);
        resolvedMap[merchantId] = { action: 'inspect', fine, confiscated: true, atMs: Date.now() };
        lastEvent = `🔎 ${sheriff.name} ตรวจเจอของเถื่อนจาก ${merchant.name} • ปรับ ${fine}, ยึดของเถื่อน และขายของดี ${countPileCards(legal)} ใบ`;
      } else {
        merchant.hand = subtractPileFromHand(merchant.hand, legal);
        merchant.sold = addPile(merchant.sold || createEmptyPile(), legal);
        soldOut = addPile(soldOut, legal);
        const compensation = Math.min(sumFineByHand(legal, 'legal'), Math.max(0, Number(sheriff.money || 0)));
        sheriff.money = Math.max(0, Number(sheriff.money || 0) - compensation);
        merchant.money = Math.max(0, Number(merchant.money || 0) + compensation);
        resolvedMap[merchantId] = { action: 'inspect', compensation, confiscated: false, atMs: Date.now() };
        lastEvent = `🔎 ${sheriff.name} ตรวจไม่เจอของเถื่อนของ ${merchant.name} • ตำรวจจ่ายชดเชย ${compensation} และส่งขาย ${countPileCards(legal)} ใบ`;
      }
    }

    const resolvedCount = inspection.merchantIds.filter((id) => Boolean(resolvedMap[id])).length;
    const isComplete = inspection.merchantIds.length > 0 && resolvedCount >= inspection.merchantIds.length;
    return {
      ...room,
      players,
      discard,
      soldOut,
      inspection: {
        ...inspection,
        phase: 'inspect',
        prepMap: {
          ...inspection.prepMap,
          [merchantId]: {
            ...(inspection.prepMap?.[merchantId] || {}),
            bag: createEmptyPile(),
          },
        },
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

async function applyHandSelection() {
  const selected = Array.from(uiState.handSelections);
  if (!selected.length) return;
  const cardIds = selected.map((token) => String(token).split('#')[0]);
  const counts = cardIds.reduce((acc, cardId) => {
    acc[cardId] = (acc[cardId] || 0) + 1;
    return acc;
  }, {});
  const playerId = String(el.merchantPlayerInput?.value || '');
  if (uiState.selectionMode === 'discard') {
    for (const [cardId, qty] of Object.entries(counts)) {
      if (el.merchantCardTypeInput) el.merchantCardTypeInput.value = cardId;
      if (el.merchantQtyInput) el.merchantQtyInput.value = String(Math.min(3, Number(qty)));
      await discardAndRedrawForMerchant();
    }
  } else {
    await clearMerchantBag();
    for (const [cardId, qty] of Object.entries(counts)) {
      if (el.merchantCardTypeInput) el.merchantCardTypeInput.value = cardId;
      if (el.merchantQtyInput) el.merchantQtyInput.value = String(Math.min(4, Number(qty)));
      await addCardToMerchantBag();
    }
    if (playerId) await submitMerchantBag();
  }
  uiState.handSelections.clear();
}

function wireEvents() {
  el.startGameBtn?.addEventListener('click', () => { void startGame(); });
  el.discardRedrawBtn?.addEventListener('click', () => { void discardAndRedrawForMerchant(); });
  el.addBagBtn?.addEventListener('click', () => { void addCardToMerchantBag(); });
  el.clearBagBtn?.addEventListener('click', () => { void clearMerchantBag(); });
  el.submitBagBtn?.addEventListener('click', () => { void submitMerchantBag(); });
  el.reshuffleBtn?.addEventListener('click', () => { void reshuffleDiscardToDeck(); });
  el.resolveInspectionBtn?.addEventListener('click', () => { void resolveInspectionDecision(); });
  el.nextSheriffBtn?.addEventListener('click', () => { void nextSheriffRound(); });
  el.finishGameBtn?.addEventListener('click', () => { void finishGame(); });
  el.merchantPlayerInput?.addEventListener('change', () => { uiState.handSelections.clear(); renderAll(); });
  el.playerHandCards?.addEventListener('click', (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest('[data-token]') : null;
    if (!button) return;
    const token = String(button.getAttribute('data-token') || '');
    if (!token) return;
    if (uiState.handSelections.has(token)) uiState.handSelections.delete(token);
    else {
      const limit = uiState.selectionMode === 'discard' ? 3 : 4;
      if (uiState.handSelections.size >= limit) return;
      uiState.handSelections.add(token);
    }
    renderHandCards();
  });
  el.phaseActions?.addEventListener('click', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    if (target.id === 'btnSelectDiscard') { uiState.selectionMode = 'discard'; uiState.handSelections.clear(); renderAll(); }
    if (target.id === 'btnSelectBag') { uiState.selectionMode = 'bag'; uiState.handSelections.clear(); renderAll(); }
    if (target.id === 'btnClearSelection') { uiState.handSelections.clear(); renderAll(); }
    if (target.id === 'btnApplySelection') { void applyHandSelection(); }
    if (target.id === 'btnInspect') {
      if (el.inspectionActionInput) el.inspectionActionInput.value = 'inspect';
      void resolveInspectionDecision();
    }
    if (target.id === 'btnPassBribe') {
      if (el.inspectionActionInput) el.inspectionActionInput.value = 'pass';
      if (el.inspectionBribeInput && !el.inspectionBribeInput.value) el.inspectionBribeInput.value = '5';
      void resolveInspectionDecision();
    }
    if (target.id === 'btnForceFinish') { void finishGame(); }
    if (target.id === 'btnNextRound') { void nextSheriffRound(); }
  });

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
