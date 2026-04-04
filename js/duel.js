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
} from './duelDb.js';
import { isQuestionCorrect, normalizeQuestion, pickRandomQuestions } from './quiz.js';
import {
  buildPersonalQuestionLoop,
  buildQuestionLoop,
  getRoundState,
  LOOP_QUESTION_COUNT,
  normalizeRoomIdInput,
  ROOM_ID_LENGTH,
} from './duelCore.js';
import { getEffectiveFinishDistance } from './duelRules.js';

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
  gameModeInput: document.getElementById('duelGameMode'),
  quickOptionsWrap: document.getElementById('duelQuickOptions'),
  wormOptionsWrap: document.getElementById('duelWormOptions'),
  durationInput: document.getElementById('duelDuration'),
  quickDurationInput: document.getElementById('duelQuickDuration'),
  matchTypeInput: document.getElementById('duelMatchType'),
  quickMatchTypeInput: document.getElementById('duelQuickMatchType'),
  teamSizeInput: document.getElementById('duelTeamSize'),
  teamSizeLabel: document.getElementById('duelTeamSizeLabel'),
  quickTeamSizeInput: document.getElementById('duelQuickTeamSize'),
  finishDistanceInput: document.getElementById('duelFinishDistance'),
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
  questionTitle: document.getElementById('duelQuestionTitle'),
  choicesWrap: document.getElementById('duelChoices'),
  raceBoard: document.getElementById('duelRaceBoard'),
};


const GAME_DEFINITIONS = {
  quick: {
    label: 'ตอบไว',
    getConfig: () => ({
      matchType: String(el.quickMatchTypeInput?.value || 'solo'),
      teamSize: Number(el.quickTeamSizeInput?.value || 2),
      finishDistance: 10,
      durationSeconds: Number(el.quickDurationInput?.value || 120),
    }),
  },
  worm: {
    label: 'หนอนกระดื้บ',
    getConfig: () => ({
      matchType: String(el.matchTypeInput?.value || 'solo'),
      teamSize: Number(el.teamSizeInput?.value || 2),
      finishDistance: Number(el.finishDistanceInput?.value || 10),
      durationSeconds: Number(el.durationInput?.value || 120),
    }),
  },
};

const PRAISE_LINES = ['โคตรคม!', 'สุดจัด!', 'แม่นมาก!', 'เก่งเว่อร์!', 'เครื่องติดแล้ว!'];
const ROAST_LINES = ['หลับอยู่ปะเนี่ย?', 'พลาดอีกแล้ว!', 'ฮึบอีกนิด!', 'สมาธิหน่อย!', 'อย่าเพิ่งยอม!'];

const getSelectedGameMode = () => {
  const requested = String(el.gameModeInput?.value || 'quick');
  return Object.prototype.hasOwnProperty.call(GAME_DEFINITIONS, requested) ? requested : 'quick';
};

function syncHostModeOptions() {
  const mode = getSelectedGameMode();
  el.quickOptionsWrap?.classList.toggle('hidden', mode !== 'quick');
  el.wormOptionsWrap?.classList.toggle('hidden', mode !== 'worm');
  syncWormMatchOptions();
}

function syncWormMatchOptions() {
  const isParty = String(el.matchTypeInput?.value || 'solo') === 'party';
  el.teamSizeLabel?.classList.toggle('hidden', !isParty);
}

const state = {
  uid: '',
  roomId: '',
  room: null,
  unsubRoom: null,
  timerId: null,
  questionBank: [],
  loadedCourseId: '',
  loadingCourseId: '',
  selectedAnswer: null,
  isSubmitting: false,
  authReady: false,
  shownFinishMarker: '',
  personalLoopKey: '',
  personalQuestionSequence: [],
  optimisticAnsweredRound: -1,
};

const roomStatus = (room) => String(room?.status || room?.state?.status || 'lobby');
const setStatus = (text) => { el.statusText.textContent = text; };
const openModal = (modal) => modal?.classList.remove('hidden');
const closeModal = (modal) => modal?.classList.add('hidden');

function getQuestionByRound(room, roundIdx) {
  const gameMode = String(room?.modeConfig?.gameMode || 'quick');
  const sequence = gameMode === 'worm'
    ? getPersonalQuestionSequence(room)
    : (Array.isArray(room?.questionSequence) ? room.questionSequence : []);
  if (!sequence.length || !state.questionBank.length || roundIdx < 0) return null;
  const qid = String(sequence[roundIdx % sequence.length] || '');
  const row = state.questionBank.find((q) => String(q.id) === qid);
  return row ? normalizeQuestion(row) : null;
}

function getPersonalQuestionSequence(room) {
  const roomId = String(room?.roomId || room?.id || state.roomId || '');
  const actorKey = `${roomId}:${state.uid}`;
  const cacheKey = `${roomId}:${state.uid}:${state.loadedCourseId}:${state.questionBank.length}`;
  if (state.personalLoopKey !== cacheKey) {
    state.personalQuestionSequence = buildPersonalQuestionLoop(state.questionBank, actorKey, { loopQuestionCount: LOOP_QUESTION_COUNT });
    state.personalLoopKey = cacheKey;
  }
  return state.personalQuestionSequence;
}

function getActiveRound(room) {
  const gameMode = String(room?.modeConfig?.gameMode || 'quick');
  if (gameMode === 'worm') {
    const serverAnsweredRound = Number(room?.players?.[state.uid]?.answeredRound ?? -1);
    const effectiveAnsweredRound = Math.max(serverAnsweredRound, Number(state.optimisticAnsweredRound ?? -1));
    const myRound = Math.max(0, effectiveAnsweredRound + 1);
    return {
      roundIndex: myRound,
      isReveal: false,
    };
  }
  const rs = getRoundState(room);
  return {
    roundIndex: rs.roundIndex,
    isReveal: rs.isReveal,
  };
}

function renderRace(room) {
  const players = room.players || {};
  const finishDistance = getEffectiveFinishDistance(room?.modeConfig || {});
  const myTeamId = players[state.uid]?.teamId || null;
  const gameMode = String(room?.modeConfig?.gameMode || 'quick');
  const sorted = Object.entries(players).sort((a, b) => Number(b[1]?.distance || 0) - Number(a[1]?.distance || 0));
  el.raceBoard.innerHTML = '';

  sorted.forEach(([uid, p], idx) => {
    const isMe = uid === state.uid;
    const lane = document.createElement('div');
    lane.className = `duel-race-lane${isMe ? ' is-me' : ''}${myTeamId && p?.teamId === myTeamId ? ' is-my-team' : ''}`;
    const distance = Math.max(0, Number(p?.distance || 0));
    const pct = Math.max(0, Math.min(100, (distance / finishDistance) * 100));
    const badges = [];
    if (idx === 0) badges.push('👑 นำ');
    if (Number(p?.correctStreak || 0) >= 2) badges.push(`Combo ${Number(p?.correctStreak || 0)}`);
    if (Number(p?.wrongStreak || 0) >= 2) badges.push('เสี่ยงโดนโทษ');
    if (Number(p?.stunUntilMs || 0) > Date.now()) badges.push('⛔ STUN');
    if (gameMode !== 'worm' && room?.modeConfig?.matchType === 'party') badges.push(`Runner ${Number(p?.relayOrder || 1)}/${Number(room?.modeConfig?.teamSize || 2)}`);

    lane.innerHTML = `
      <div class="duel-race-top"><span class="duel-lane-runner">${isMe ? '🎯 ' : ''}${p?.name || uid}</span><span>${distance}/${finishDistance}</span></div>
      <div class="duel-race-track"><span style="width:${pct}%"></span></div>
      <div class="duel-lobby-meta">${badges.map((x) => `<span class="duel-lobby-chip">${x}</span>`).join('')}</div>
    `;
    el.raceBoard.appendChild(lane);
  });
}

function renderQuestion(room) {
  const rs = getActiveRound(room);
  const question = getQuestionByRound(room, rs.roundIndex);
  const me = room.players?.[state.uid] || {};
  const isStunned = Number(me?.stunUntilMs || 0) > Date.now();
  const answeredRound = Number(me?.answeredRound ?? -1);
  const locked = roomStatus(room) !== 'playing' || rs.isReveal || answeredRound >= rs.roundIndex || isStunned || state.isSubmitting;

  if (!question) {
    el.questionTitle.textContent = 'กำลังรอคำถาม...';
    el.choicesWrap.innerHTML = '';
    return;
  }

  el.questionTitle.textContent = question.question;
  el.stunHint.classList.toggle('hidden', !isStunned);
  if (isStunned) {
    const remain = Math.max(0, Math.ceil((Number(me?.stunUntilMs || 0) - Date.now()) / 1000));
    el.stunHint.textContent = `ติด STUN อีก ${remain} วินาที`;
  }

  el.choicesWrap.innerHTML = '';
  (question.choices || []).forEach((choice, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn duel-answer-btn';
    btn.textContent = choice;
    btn.disabled = locked;
    btn.addEventListener('click', () => {
      state.selectedAnswer = idx;
      void submitAnswer();
    });
    el.choicesWrap.appendChild(btn);
  });
}

async function submitAnswer() {
  const room = state.room;
  if (!room || state.isSubmitting) return;
  const rs = getActiveRound(room);
  if (rs.roundIndex < 0 || rs.isReveal) return;
  const q = getQuestionByRound(room, rs.roundIndex);
  if (!q || !Number.isInteger(state.selectedAnswer)) return;
  const isCorrect = isQuestionCorrect(q, state.selectedAnswer);
  const gameMode = String(room?.modeConfig?.gameMode || 'quick');
  const isWormMode = gameMode === 'worm';

  state.isSubmitting = true;
  try {
    const result = await submitDuelAnswer(state.roomId, { isCorrect });
    if (result?.accepted) {
      state.optimisticAnsweredRound = Math.max(Number(state.optimisticAnsweredRound ?? -1), rs.roundIndex);
      el.resultHint.textContent = isCorrect
        ? '✅ ตอบถูก เดิน +1'
        : (isWormMode ? '❌ ตอบผิด ไปข้อถัดไปทันที' : '❌ ตอบผิด รอข้อถัดไป');
      playAnswerFeedback(isCorrect);
      renderQuestion(room);
    } else if (String(result?.reason || '')) {
      el.resultHint.textContent = '⏳ ยังตอบไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง';
    }
  } finally {
    state.isSubmitting = false;
  }
}

function playAnswerFeedback(isCorrect) {
  const linePool = isCorrect ? PRAISE_LINES : ROAST_LINES;
  const picked = linePool[Math.floor(Math.random() * linePool.length)] || '';
  if (picked && 'speechSynthesis' in window) {
    try {
      const utterance = new SpeechSynthesisUtterance(picked);
      utterance.lang = 'th-TH';
      utterance.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch (_) {}
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = isCorrect ? 880 : 220;
    gain.gain.value = 0.001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch (_) {}
}

function renderLobbyMeta(room) {
  const gameLabel = String(room?.modeConfig?.gameLabel || GAME_DEFINITIONS[String(room?.modeConfig?.gameMode || 'quick')]?.label || 'ตอบไว');
  const matchType = String(room?.modeConfig?.matchType || 'solo');
  const teamSize = Number(room?.modeConfig?.teamSize || 2);
  const items = [
    `เกม: ${gameLabel}`,
    `โหมด: ${matchType === 'party' ? `Team x${teamSize}` : 'Solo'}`,
    `เส้นชัย: ${getEffectiveFinishDistance(room?.modeConfig || {})} ช่อง`,
    `เวลาเกม: ${Math.max(2, Math.round(Number(room.durationSeconds || 120) / 60))} นาที`,
    `สถานะ: ${roomStatus(room) === 'lobby' ? 'รอเริ่ม' : roomStatus(room) === 'playing' ? 'กำลังเล่น' : 'จบเกม'}`,
  ];
  el.lobbyMeta.innerHTML = items.map((item) => `<div class="duel-lobby-chip">${item}</div>`).join('');
}

function ensureTimer(room) {
  if (state.timerId) window.clearInterval(state.timerId);
  const tick = () => {
    if (!room || roomStatus(room) !== 'playing') return;
    const remainSec = Math.ceil((Number(room.startedAtMs || 0) + (Number(room.durationSeconds || 120) * 1000) - Date.now()) / 1000);
    const rs = getActiveRound(room);
    el.timerText.textContent = `${String(Math.max(0, Math.floor(remainSec / 60))).padStart(2, '0')}:${String(Math.max(0, remainSec % 60)).padStart(2, '0')}`;
    el.roundText.textContent = rs.isReveal ? 'เฉลย / เปลี่ยนข้อ' : `ข้อที่ ${Math.max(1, rs.roundIndex + 1)}`;
    if (remainSec <= 0) void finalizeDuelByTimeout(state.roomId);
  };
  tick();
  state.timerId = window.setInterval(tick, 350);
}

function handleRoomUpdate(room) {
  if (!room) return;
  state.room = room;
  state.optimisticAnsweredRound = Number(room?.players?.[state.uid]?.answeredRound ?? state.optimisticAnsweredRound ?? -1);
  void ensureRoomQuestionBank(room);
  const players = Object.values(room.players || {});
  const isHost = String(room.hostUid || '') === state.uid;

  el.lobbyRoomIdText.textContent = room.pin || room.roomId || state.roomId;
  el.battleRoomId.textContent = room.pin || room.roomId || state.roomId;
  el.lobbyPlayers.innerHTML = players.map((p) => `<div class="duel-lobby-chip${p?.isHost ? ' is-host' : ''}">${p?.name || 'ผู้เล่น'}${p?.isHost ? ' • HOST' : ''}</div>`).join('');
  renderLobbyMeta(room);

  const partyRequiredPlayers = Math.max(4, Number(room?.modeConfig?.teamSize || 2) * 2);
  const minPlayers = String(room?.modeConfig?.matchType || 'solo') === 'party' ? partyRequiredPlayers : 2;
  el.startGameBtn.classList.toggle('hidden', !(isHost && roomStatus(room) === 'lobby' && players.length >= minPlayers));
  el.lobbyHint.textContent = players.length < minPlayers ? `ต้องมีผู้เล่นอย่างน้อย ${minPlayers} คน` : 'พร้อมเริ่มเกม';

  const rs = getActiveRound(room);
  const currentQuestion = getQuestionByRound(room, rs.roundIndex);
  const gameLabel = String(room?.modeConfig?.gameLabel || GAME_DEFINITIONS[String(room?.modeConfig?.gameMode || 'quick')]?.label || 'ตอบไว');
  const isWormMode = String(room?.modeConfig?.gameMode || 'quick') === 'worm';
  const matchType = String(room?.modeConfig?.matchType || 'solo');
  el.lobbyModeText.textContent = gameLabel.toUpperCase();
  el.duelModeTitle.textContent = `${gameLabel} • ${String(room?.modeConfig?.matchType || 'solo').toUpperCase()}`;
  if (roomStatus(room) === 'playing' && currentQuestion) {
    el.resultHint.textContent = isWormMode
      ? (matchType === 'party'
        ? 'โหมดหนอนกระดื้บ TEAM: แต่ละทีมตอบของทีมตัวเอง ผู้ถือไม้เท่านั้นที่ตอบได้ พอครบระยะจึงส่งไม้ให้คนถัดไป'
        : 'โหมดหนอนกระดื้บ SOLO: ตอบใครตอบมัน ไปข้อถัดไปทันที ไม่ต้องรอใคร')
      : 'ตอบได้คนละ 1 ครั้งต่อข้อ ระบบจะเปลี่ยนข้อด้วยเวลาเดียวกันทั้งห้อง';
  }

  el.entrySection.classList.add('hidden');
  el.lobbySection.classList.toggle('hidden', roomStatus(room) !== 'lobby');
  el.battleSection.classList.toggle('hidden', roomStatus(room) === 'lobby');

  renderRace(room);
  renderQuestion(room);
  ensureTimer(room);

  if (roomStatus(room) === 'finished') {
    const marker = `${room.roomId}_${room.endedAtMs || 0}`;
    if (state.shownFinishMarker !== marker) {
      state.shownFinishMarker = marker;
      el.finishMessage.textContent = room.winnerUid ? (room.winnerUid === state.uid ? '🎉 คุณชนะ' : 'จบเกม! มีผู้ชนะแล้ว') : 'เสมอ';
      openModal(el.finishModal);
    }
  }
}

async function loadQuestionBank(courseId) {
  const rows = await getQuestionsByCourse(courseId);
  if (!rows.length) throw new Error('ไม่พบคลังโจทย์');
  state.questionBank = rows.map((q) => ({ ...q }));
  state.loadedCourseId = courseId;
  state.personalLoopKey = '';
  state.personalQuestionSequence = [];
}

async function ensureRoomQuestionBank(room) {
  const courseId = String(room?.courseId || '').trim();
  if (!courseId || state.loadedCourseId === courseId || state.loadingCourseId === courseId) return;
  state.loadingCourseId = courseId;
  try {
    await loadQuestionBank(courseId);
    if (state.room) {
      renderRace(state.room);
      renderQuestion(state.room);
    }
  } catch (error) {
    setStatus(error.message || 'โหลดคำถามไม่สำเร็จ');
  } finally {
    state.loadingCourseId = '';
  }
}

function subscribeRoom(roomId) {
  if (state.unsubRoom) state.unsubRoom();
  state.unsubRoom = subscribeDuelRoom(roomId, handleRoomUpdate, () => setStatus('เชื่อมต่อห้องไม่สำเร็จ'));
}

async function handleCreateRoom() {
  try {
    if (!state.authReady) throw new Error('ยังไม่พร้อมใช้งาน');
    const courseId = String(el.courseIdInput.value || '').trim();
    if (!courseId) throw new Error('เลือกบททดสอบก่อน');
    await loadQuestionBank(courseId);
    const questionSequence = buildQuestionLoop(state.questionBank, { loopQuestionCount: LOOP_QUESTION_COUNT, shuffleFn: (ids) => pickRandomQuestions(ids, ids.length) });
    const gameMode = getSelectedGameMode();
    const gameDef = GAME_DEFINITIONS[gameMode] || GAME_DEFINITIONS.quick;
    const modeConfig = gameDef.getConfig();
    const created = await createDuelRoom({
      hostName: String(el.hostNameInput.value || '').trim() || 'Host',
      courseId,
      gameMode,
      gameLabel: gameDef.label,
      durationSeconds: Number(modeConfig.durationSeconds || 120),
      matchType: modeConfig.matchType,
      teamSize: Number(modeConfig.teamSize || 2),
      finishDistance: Number(modeConfig.finishDistance || 10),
      questionSequence,
    });
    state.roomId = created.roomId;
    closeModal(el.hostModal);
    subscribeRoom(created.roomId);
  } catch (error) {
    setStatus(error.message || 'สร้างห้องไม่สำเร็จ');
  }
}

async function handleJoinRoom() {
  try {
    const roomId = normalizeRoomIdInput(el.roomIdInput.value);
    if (roomId.length !== ROOM_ID_LENGTH) throw new Error('PIN ไม่ถูกต้อง');
    const joined = await joinDuelRoom(roomId, String(el.joinNameInput.value || '').trim() || 'ผู้เล่น');
    state.roomId = joined.roomId;
    closeModal(el.joinModal);
    subscribeRoom(roomId);
  } catch (error) {
    setStatus(error.message || 'เข้าห้องไม่สำเร็จ');
  }
}

async function init() {
  setStatus('กำลังเชื่อมต่อระบบ...');
  subscribeAuthStatus((authState) => { if (authState.uid) state.uid = authState.uid; });
  await ensureDuelAuthReady();
  state.authReady = true;
  setStatus('พร้อมเข้าเล่น');
  subscribeCourses((courses) => {
    const current = String(el.courseIdInput.value || '');
    el.courseIdInput.innerHTML = '<option value="">-- เลือกบททดสอบ --</option>';
    (courses || []).forEach((course) => {
      const option = document.createElement('option');
      option.value = String(course.courseId || '');
      option.textContent = course?.title ? `${course.title} (${course.courseId})` : String(course.courseId || '');
      el.courseIdInput.appendChild(option);
    });
    el.courseIdInput.value = current;
  }, () => {});

  el.showHostSetupBtn.addEventListener('click', () => { syncHostModeOptions(); openModal(el.hostModal); });
  el.showJoinSetupBtn.addEventListener('click', () => openModal(el.joinModal));
  el.createRoomBtn.addEventListener('click', () => void handleCreateRoom());
  el.joinRoomBtn.addEventListener('click', () => void handleJoinRoom());
  el.gameModeInput?.addEventListener('change', syncHostModeOptions);
  el.matchTypeInput?.addEventListener('change', syncWormMatchOptions);
  el.startGameBtn.addEventListener('click', () => void startDuelRoom(state.roomId));
  el.roomIdInput.addEventListener('input', () => { el.roomIdInput.value = normalizeRoomIdInput(el.roomIdInput.value); });
  document.querySelectorAll('[data-close-modal]').forEach((btn) => btn.addEventListener('click', () => closeModal(document.getElementById(btn.dataset.closeModal))));
  syncHostModeOptions();
  syncWormMatchOptions();
}

void init();
