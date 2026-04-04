import {
  createDuelRoom,
  ensureDuelAuthReady,
  finalizeDuelByTimeout,
  getQuestionsByCourse,
  joinDuelRoom,
  startDuelRoom,
  submitDuelAnswer,
  subscribeAuthStatus,
  subscribeCourses,
  subscribeDuelRoom,
} from './db.js';
import { isQuestionCorrect, normalizeQuestion, pickRandomQuestions } from './quiz.js';
import {
  buildPersonalQuestionLoop,
  buildQuestionLoop,
  getRoundState,
  LOOP_QUESTION_COUNT,
  normalizeRoomIdInput,
  ROOM_ID_LENGTH,
  START_HP,
} from './duelCore.js';

const el = {
  showHostSetupBtn: document.getElementById('showHostSetupBtn'),
  showJoinSetupBtn: document.getElementById('showJoinSetupBtn'),
  hostModal: document.getElementById('hostModal'),
  joinModal: document.getElementById('joinModal'),
  finishModal: document.getElementById('duelFinishModal'),
  finishMessage: document.getElementById('duelFinishMessage'),
  entrySection: document.getElementById('duelEntrySection'),
  courseIdInput: document.getElementById('duelCourseId'),
  hostNameInput: document.getElementById('duelHostName'),
  joinNameInput: document.getElementById('duelJoinName'),
  durationInput: document.getElementById('duelDuration'),
  gameModeInput: document.getElementById('duelGameMode'),
  matchTypeInput: document.getElementById('duelMatchType'),
  roomIdInput: document.getElementById('duelRoomId'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  startGameBtn: document.getElementById('startGameBtn'),
  statusText: document.getElementById('duelStatusText'),
  lobbySection: document.getElementById('duelLobbySection'),
  lobbyModeText: document.getElementById('duelLobbyModeText'),
  lobbyRoomIdText: document.getElementById('duelLobbyRoomId'),
  lobbyHint: document.getElementById('duelLobbyHint'),
  lobbyMeta: document.getElementById('duelLobbyMeta'),
  lobbyPlayers: document.getElementById('duelLobbyPlayers'),
  battleSection: document.getElementById('duelBattleSection'),
  battleRoomId: document.getElementById('duelBattleRoomId'),
  duelModeTitle: document.getElementById('duelModeTitle'),
  roundText: document.getElementById('duelRoundText'),
  timerText: document.getElementById('duelTimerText'),
  resultHint: document.getElementById('duelResultHint'),
  stunHint: document.getElementById('duelStunHint'),
  soundToggle: document.getElementById('duelSoundToggle'),
  audioHint: document.getElementById('duelAudioHint'),
  questionTitle: document.getElementById('duelQuestionTitle'),
  choicesWrap: document.getElementById('duelChoices'),
  skipBtn: document.getElementById('duelSkipBtn'),
  raceBoard: document.getElementById('duelRaceBoard'),
  othersHpWrap: document.getElementById('duelOthersHp'),
};

const state = {
  uid: '', roomId: '', room: null, unsubRoom: null, timerId: null, questionBank: [], loadedCourseId: '',
  selectedAnswer: null, currentQuestionId: '', isSubmitting: false, hasRequestedFinalize: false,
  authReady: false, soundEnabled: true, shownFinishRoomId: '', personalQuestionLoop: [],
};

const setStatus = (text) => { el.statusText.textContent = text; };
const getRoomStatus = (room) => String(room?.status || room?.state?.status || 'lobby');
let audioCtx = null;

function playUiTone(type = 'ok') {
  if (!state.soundEnabled) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) audioCtx = new AC();
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.value = type === 'warn' ? 220 : 580;
  gain.gain.value = 0.05;
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.06);
}

function openModal(modal) { modal?.classList.remove('hidden'); }
function closeModal(modal) { modal?.classList.add('hidden'); }

function ensurePersonalLoop(room) {
  const key = `${room?.roomId || state.roomId}_${state.uid}_${room?.startedAtMs || 0}`;
  if (!state.personalQuestionLoop.length || state.personalLoopKey !== key) {
    state.personalLoopKey = key;
    state.personalQuestionLoop = buildPersonalQuestionLoop(state.questionBank, key, {
      loopQuestionCount: LOOP_QUESTION_COUNT,
    });
  }
}

function getCurrentQuestion(room) {
  const me = (room?.players || {})[state.uid] || {};
  const idx = Math.max(0, Number(me.questionCursor || 0));
  ensurePersonalLoop(room);
  const sequence = state.personalQuestionLoop;
  if (!sequence.length) return null;
  const questionId = String(sequence[idx % sequence.length] || '');
  state.currentQuestionId = questionId;
  const row = state.questionBank.find((q) => String(q.id) === questionId);
  return row ? normalizeQuestion(row) : null;
}

function renderQuestion(room) {
  const question = getCurrentQuestion(room);
  const isLocked = state.isSubmitting || getRoomStatus(room) !== 'playing';
  el.skipBtn.disabled = isLocked;
  el.stunHint.classList.add('hidden');

  if (!question) {
    el.questionTitle.textContent = 'กำลังรอคำถาม...';
    el.choicesWrap.innerHTML = '';
    return;
  }
  el.questionTitle.textContent = question.question;
  el.choicesWrap.innerHTML = '';
  (question.choices || []).forEach((choice, idx) => {
    const label = document.createElement('label');
    label.className = 'choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `duelChoice_${state.currentQuestionId || 'q'}`;
    radio.value = String(idx);
    radio.disabled = isLocked;
    radio.addEventListener('change', () => {
      if (isLocked) return;
      state.selectedAnswer = Number(radio.value);
      void submitCurrentAnswer(false);
    });
    const span = document.createElement('span');
    span.textContent = choice;
    label.append(radio, span);
    el.choicesWrap.appendChild(label);
  });
}

function renderRace(room) {
  el.raceBoard.innerHTML = '';
  const players = Object.entries(room.players || {}).sort((a, b) => Number(b?.[1]?.hp || 0) - Number(a?.[1]?.hp || 0));
  players.forEach(([uid, p], idx) => {
    const lane = document.createElement('div');
    lane.className = 'duel-race-lane';
    const hp = Math.max(0, Number(p?.hp || 0));
    lane.innerHTML = `
      <div class="duel-race-top"><span class="duel-lane-runner">${idx === 0 ? '👑 ' : ''}${p?.name || uid}</span><span>${hp}/${START_HP} HP</span></div>
      <div class="duel-race-track"><span style="width:${Math.round((hp / START_HP) * 100)}%"></span></div>
    `;
    el.raceBoard.appendChild(lane);
  });
}

function renderBattle(room) {
  const me = (room?.players || {})[state.uid];
  if (!me) return;
  const roomStatus = getRoomStatus(room);
  el.lobbySection.classList.toggle('hidden', roomStatus !== 'lobby');
  el.battleSection.classList.toggle('hidden', roomStatus === 'lobby');
  el.entrySection.classList.add('hidden');
  el.battleRoomId.textContent = room.pin || room.roomId || state.roomId;
  const gameMode = String(room?.modeConfig?.gameMode || room?.settings?.gameMode || 'attack');
  const gameModeLabel = gameMode === 'worm' ? 'Worm Race' : 'Attack';
  el.duelModeTitle.textContent = `Duel Mode • ${gameModeLabel}`;

  el.othersHpWrap.innerHTML = '';
  Object.entries(room.players || {}).forEach(([uid, p]) => {
    const div = document.createElement('div');
    div.className = 'duel-mini-opponent';
    const isMe = uid === state.uid;
    const currentHp = Number(p?.hp || 0);
    const valueRatio = Math.max(0, Math.min(1, currentHp / START_HP));
    div.innerHTML = `
      <div class="duel-mini-opponent-name">${isMe ? 'ฉัน' : (p?.name || 'ผู้เล่น')}: ${currentHp} / ${START_HP} HP</div>
      <div class="duel-mini-opponent-bar"><span style="width:${Math.round(valueRatio * 100)}%"></span></div>
    `;
    el.othersHpWrap.appendChild(div);
  });

  renderRace(room);
  renderQuestion(room);
}

async function loadQuestionBank(courseId) {
  const rows = await getQuestionsByCourse(courseId);
  if (!rows.length) throw new Error('ไม่พบคลังโจทย์ของคอร์สนี้');
  state.questionBank = rows.map((q) => ({ ...q }));
  state.loadedCourseId = courseId;
  state.personalQuestionLoop = [];
}

async function handleCreateRoom() {
  try {
    if (!state.authReady) throw new Error('ยังเชื่อมต่อระบบไม่สำเร็จ');
    const hostName = String(el.hostNameInput.value || '').trim() || 'Host';
    const courseId = String(el.courseIdInput.value || '').trim();
    if (!courseId) throw new Error('เลือกบททดสอบก่อน');
    await loadQuestionBank(courseId);
    const matchType = String(el.matchTypeInput?.value || 'solo').toLowerCase() === 'party' ? 'party' : 'solo';
    const gameMode = String(el.gameModeInput?.value || 'attack').toLowerCase() === 'worm' ? 'worm' : 'attack';
    const questionSequence = buildQuestionLoop(state.questionBank, {
      loopQuestionCount: LOOP_QUESTION_COUNT,
      shuffleFn: (ids) => pickRandomQuestions(ids, ids.length),
    });
    const created = await createDuelRoom({
      hostName,
      courseId,
      durationSeconds: Number(el.durationInput.value || 120),
      matchType,
      gameMode,
      questionSequence,
    });
    state.roomId = created.roomId;
    state.uid = created.uid || state.uid;
    el.roomIdInput.value = created.roomId;
    closeModal(el.hostModal);
    setStatus(`สร้างห้องสำเร็จ PIN: ${created.roomId}`);
    subscribeRoom(created.roomId);
  } catch (error) {
    setStatus(error.message || 'สร้างห้องไม่สำเร็จ');
  }
}

async function handleJoinRoom() {
  try {
    if (!state.authReady) throw new Error('ยังเชื่อมต่อระบบไม่สำเร็จ');
    const roomId = normalizeRoomIdInput(el.roomIdInput.value);
    if (roomId.length !== ROOM_ID_LENGTH) throw new Error('PIN ไม่ถูกต้อง');
    const playerName = String(el.joinNameInput.value || '').trim() || 'ผู้เล่น';
    const joined = await joinDuelRoom(roomId, playerName);
    state.roomId = roomId;
    state.uid = joined.uid || state.uid;
    closeModal(el.joinModal);
    setStatus(`เข้าห้อง ${roomId} สำเร็จ`);
    subscribeRoom(roomId);
  } catch (error) {
    setStatus(error.message || 'เข้าห้องไม่สำเร็จ');
  }
}

async function handleStartGame() {
  try {
    await startDuelRoom(state.roomId);
    setStatus('เริ่มเกมแล้ว');
  } catch (error) {
    setStatus(error.message || 'เริ่มเกมไม่สำเร็จ');
  }
}

async function submitCurrentAnswer(forceWrong = false) {
  const room = state.room;
  if (!room || getRoomStatus(room) !== 'playing' || state.isSubmitting) return;

  let isCorrect = false;
  const question = getCurrentQuestion(room);
  if (!forceWrong && question && Number.isInteger(state.selectedAnswer)) {
    isCorrect = isQuestionCorrect(question, state.selectedAnswer);
  }

  state.isSubmitting = true;
  try {
    playUiTone(forceWrong ? 'warn' : 'ok');
    const result = await submitDuelAnswer(state.roomId, { isCorrect });
    if (result?.accepted) {
      state.selectedAnswer = null;
      el.resultHint.textContent = isCorrect ? '✅ ถูกต้อง ไปข้อต่อไป' : '❌ ไม่ถูก ไปข้อต่อไป';
    }
  } finally {
    state.isSubmitting = false;
  }
}

function ensureTimer(room) {
  if (state.timerId) window.clearInterval(state.timerId);
  const tick = () => {
    if (!room || getRoomStatus(room) !== 'playing') return;
    const duration = Number(room.durationSeconds || 120);
    const remainSec = Math.ceil((Number(room.startedAtMs || 0) + duration * 1000 - Date.now()) / 1000);
    const roundState = getRoundState(room);
    const gameRemainSec = Math.max(0, remainSec);
    const mm = String(Math.floor(gameRemainSec / 60)).padStart(2, '0');
    const ss = String(gameRemainSec % 60).padStart(2, '0');
    el.timerText.textContent = `เวลารวม ${mm}:${ss}`;
    el.roundText.textContent = roundState.isReveal ? 'กำลังเปลี่ยนข้อ...' : `ข้อ ${roundState.roundIndex + 1}`;
    if (remainSec <= 0 && !state.hasRequestedFinalize) {
      state.hasRequestedFinalize = true;
      void finalizeDuelByTimeout(state.roomId);
    }
  };
  tick();
  state.timerId = window.setInterval(tick, 400);
}

function renderLobbyMeta(room) {
  const duration = `${Math.max(2, Math.round(Number(room.durationSeconds || 120) / 60))} นาที`;
  const courseId = String(room.courseId || '-');
  const matchType = String(room?.modeConfig?.matchType || room?.settings?.competitionType || 'solo');
  const gameMode = String(room?.modeConfig?.gameMode || room?.settings?.gameMode || 'attack');
  const matchLabel = matchType === 'party' ? 'Party' : 'Solo';
  const gameModeLabel = gameMode === 'worm' ? 'Worm Race' : 'Attack';
  const items = [
    `โหมด: Duel (${gameModeLabel} / ${matchLabel})`,
    `บททดสอบ: ${courseId}`,
    `เวลาเกม: ${duration}`,
    `สถานะ: ${getRoomStatus(room) === 'lobby' ? 'รอเริ่ม' : (getRoomStatus(room) === 'playing' ? 'กำลังเล่น' : 'จบเกม')}`,
  ];
  el.lobbyMeta.innerHTML = items.map((item) => `<div class="duel-lobby-chip">${item}</div>`).join('');
  if (el.lobbyModeText) el.lobbyModeText.textContent = `DUEL ${gameModeLabel.toUpperCase()} • ${matchLabel.toUpperCase()}`;
}

function maybeShowFinishModal(room) {
  if (getRoomStatus(room) !== 'finished') return;
  const marker = `${room.roomId || state.roomId}_${room.endedAtMs || 0}`;
  if (state.shownFinishRoomId === marker) return;
  state.shownFinishRoomId = marker;

  const winnerUid = String(room.winnerUid || '');
  let message = 'เสมอ';
  if (winnerUid === state.uid) message = '🎉 คุณชนะ';
  else if (winnerUid) message = 'แพ้แล้ว ลองใหม่อีกครั้ง';
  el.finishMessage.textContent = message;
  openModal(el.finishModal);
}

function handleRoomUpdate(room) {
  if (!room) return;
  state.room = room;
  const roomCourseId = String(room.courseId || room?.settings?.quizId || '');
  if (roomCourseId && roomCourseId !== state.loadedCourseId) {
    void loadQuestionBank(roomCourseId).then(() => renderQuestion(room));
  }

  const players = Object.values(room.players || {});
  el.lobbyRoomIdText.textContent = room.pin || room.roomId || state.roomId;
  el.lobbyPlayers.innerHTML = '';
  players.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'duel-lobby-chip';
    if (p?.isHost) chip.classList.add('is-host');
    chip.textContent = `${p?.name || 'ผู้เล่น'}${p?.isHost ? ' • HOST' : ''}`;
    el.lobbyPlayers.appendChild(chip);
  });

  renderLobbyMeta(room);
  const isHost = String(room.hostUid || '') === state.uid;
  const roomStatus = getRoomStatus(room);
  const matchType = String(room?.modeConfig?.matchType || room?.settings?.competitionType || 'solo');
  const needsPartyPlayers = matchType === 'party';
  const canStart = isHost && roomStatus === 'lobby' && (!needsPartyPlayers || players.length >= 2);
  el.startGameBtn.classList.toggle('hidden', !canStart);
  if (roomStatus !== 'lobby') {
    el.lobbyHint.textContent = 'กำลังแข่งขัน...';
  } else if (needsPartyPlayers && players.length < 2) {
    el.lobbyHint.textContent = 'โหมด Party ต้องมีผู้เล่นอย่างน้อย 2 คน';
  } else if (!needsPartyPlayers) {
    const gameMode = String(room?.modeConfig?.gameMode || room?.settings?.gameMode || 'attack');
    el.lobbyHint.textContent = gameMode === 'worm'
      ? 'โหมดหนอนกระดื้บพร้อมเริ่มได้ทันที'
      : 'โหมด Solo พร้อมเริ่มได้ทันที';
  } else {
    el.lobbyHint.textContent = 'พร้อมเริ่มเกม';
  }

  if (roomStatus === 'finished') {
    const winnerUid = String(room.winnerUid || '');
    if (!winnerUid) el.resultHint.textContent = 'เสมอ';
    else if (winnerUid === state.uid) el.resultHint.textContent = '🎉 คุณชนะ';
    else el.resultHint.textContent = 'คุณแพ้';
  }

  if (roomStatus === 'playing') {
    el.resultHint.textContent = 'เลือกคำตอบได้เลย ระบบจะส่งทันที ไม่มีปุ่มยืนยัน';
  }

  renderBattle(room);
  ensureTimer(room);
  maybeShowFinishModal(room);
}

function subscribeRoom(roomId) {
  if (state.unsubRoom) state.unsubRoom();
  state.unsubRoom = subscribeDuelRoom(roomId, handleRoomUpdate, () => {
    setStatus('ยังเชื่อมต่อระบบไม่สำเร็จ');
  });
}

function renderCourseIdOptions(courses) {
  const rows = Array.isArray(courses) ? courses : [];
  const current = String(el.courseIdInput.value || '');
  el.courseIdInput.innerHTML = '<option value="">-- เลือกบททดสอบ --</option>';
  rows.forEach((course) => {
    const cid = String(course?.courseId || '').trim();
    if (!cid) return;
    const option = document.createElement('option');
    option.value = cid;
    option.textContent = course?.title ? `${course.title} (${cid})` : cid;
    el.courseIdInput.appendChild(option);
  });
  el.courseIdInput.value = current;
}

async function init() {
  setStatus('กำลังเชื่อมต่อระบบ...');
  subscribeAuthStatus((authState) => { if (authState.uid) state.uid = authState.uid; });
  try {
    await ensureDuelAuthReady();
    state.authReady = true;
    setStatus('พร้อมเข้าเล่น เลือก Host หรือ Join ได้เลย');
  } catch (_error) {
    setStatus('ยังเชื่อมต่อระบบไม่สำเร็จ');
  }

  subscribeCourses(renderCourseIdOptions, () => {});
  el.showHostSetupBtn.addEventListener('click', () => openModal(el.hostModal));
  el.showJoinSetupBtn.addEventListener('click', () => openModal(el.joinModal));
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(document.getElementById(btn.dataset.closeModal)));
  });
  [el.hostModal, el.joinModal].forEach((modal) => {
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  el.roomIdInput.addEventListener('input', () => { el.roomIdInput.value = normalizeRoomIdInput(el.roomIdInput.value); });
  el.createRoomBtn.addEventListener('click', () => { void handleCreateRoom(); });
  el.joinRoomBtn.addEventListener('click', () => { void handleJoinRoom(); });
  el.startGameBtn.addEventListener('click', () => { void handleStartGame(); });
  el.skipBtn.addEventListener('click', () => { void submitCurrentAnswer(true); });
  el.soundToggle?.addEventListener('change', () => {
    state.soundEnabled = Boolean(el.soundToggle.checked);
    el.audioHint.textContent = state.soundEnabled ? 'เปิด' : 'ปิด';
  });
}

void init();
