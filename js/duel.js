import {
  createDuelRoom,
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
  buildQuestionLoop,
  DEFAULT_QUESTION_SECONDS,
  getRoundState,
  LOOP_QUESTION_COUNT,
  normalizeRoomIdInput,
  ROOM_ID_LENGTH,
  START_HP,
} from './duelCore.js';

const el = {
  showHostSetupBtn: document.getElementById('showHostSetupBtn'),
  showJoinSetupBtn: document.getElementById('showJoinSetupBtn'),
  hostSetup: document.getElementById('duelHostSetup'),
  joinSetup: document.getElementById('duelJoinSetup'),
  courseIdInput: document.getElementById('duelCourseId'),
  durationInput: document.getElementById('duelDuration'),
  roomIdInput: document.getElementById('duelRoomId'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  startGameBtn: document.getElementById('startGameBtn'),
  statusText: document.getElementById('duelStatusText'),
  lobbySection: document.getElementById('duelLobbySection'),
  lobbyRoomIdText: document.getElementById('duelLobbyRoomId'),
  lobbyHint: document.getElementById('duelLobbyHint'),
  lobbyPlayers: document.getElementById('duelLobbyPlayers'),
  battleSection: document.getElementById('duelBattleSection'),
  gameMode: document.getElementById('duelGameMode'),
  matchType: document.getElementById('duelMatchType'),
  relayWrap: document.getElementById('duelRelayWrap'),
  relaySize: document.getElementById('duelRelaySize'),
  meName: document.getElementById('meName'),
  meHpFill: document.getElementById('meHpFill'),
  meHpText: document.getElementById('meHpText'),
  othersHpWrap: document.getElementById('duelOthersHp'),
  timerText: document.getElementById('duelTimerText'),
  resultHint: document.getElementById('duelResultHint'),
  questionTitle: document.getElementById('duelQuestionTitle'),
  choicesWrap: document.getElementById('duelChoices'),
  submitBtn: document.getElementById('duelSubmitBtn'),
  skipBtn: document.getElementById('duelSkipBtn'),
  raceBoard: document.getElementById('duelRaceBoard'),
};

const state = {
  uid: '', roomId: '', room: null, unsubRoom: null, timerId: null, questionBank: [], loadedCourseId: '',
  selectedAnswer: null, answeredRoundIndex: -1, currentQuestionId: '', isSubmitting: false, hasRequestedFinalize: false,
};

const setStatus = (text) => { el.statusText.textContent = text; };
const getGameMode = (room) => String(room?.modeConfig?.gameMode || 'attack');
const isWorm = (room) => getGameMode(room) === 'worm';
const isTeam = (room) => String(room?.modeConfig?.matchType || 'solo') === 'team';

function getCurrentQuestion(room) {
  const sequence = Array.isArray(room?.questionSequence) ? room.questionSequence : [];
  const idx = getRoundState(room).roundIndex;
  if (idx < 0 || !sequence.length) return null;
  const questionId = String(sequence[idx % sequence.length] || '');
  state.currentQuestionId = questionId;
  const row = state.questionBank.find((q) => String(q.id) === questionId);
  return row ? normalizeQuestion(row) : null;
}

function renderQuestion(room) {
  const question = getCurrentQuestion(room);
  el.submitBtn.disabled = true;
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
    radio.name = 'duelChoice';
    radio.value = String(idx);
    radio.addEventListener('change', () => {
      state.selectedAnswer = Number(radio.value);
      el.submitBtn.disabled = false;
    });
    const span = document.createElement('span');
    span.textContent = choice;
    label.append(radio, span);
    el.choicesWrap.appendChild(label);
  });
}

function renderRace(room) {
  el.raceBoard.innerHTML = '';
  if (!isWorm(room)) return;
  const players = room.players || {};
  Object.entries(players).forEach(([uid, p]) => {
    const lane = document.createElement('div');
    lane.className = 'duel-race-lane';
    const score = Number(p?.score || 0);
    const stun = Math.max(0, Math.ceil((Number(p?.stunnedUntilMs || 0) - Date.now()) / 1000));
    const active = isTeam(room)
      ? Number((room.teams?.[p?.teamId] || {}).activeRelayOrder || 0) === Number(p?.relayOrder || 0)
      : true;
    lane.innerHTML = `
      <div class="duel-race-top"><span>${p?.name || uid}${active ? ' 🏃' : ''}</span><span>${score} แต้ม ${stun > 0 ? `| Stun ${stun}s` : ''}</span></div>
      <div class="duel-race-track"><span style="width:${Math.min(100, score * 8)}%"></span></div>
    `;
    el.raceBoard.appendChild(lane);
  });
}

function renderBattle(room) {
  const me = (room?.players || {})[state.uid];
  if (!me) return;
  el.lobbySection.classList.toggle('hidden', room.status !== 'waiting');
  el.battleSection.classList.toggle('hidden', room.status === 'waiting');
  el.meName.textContent = me.name || 'ฉัน';

  if (isWorm(room)) {
    el.meHpText.textContent = `${Number(me.score || 0)} แต้ม`;
    el.meHpFill.style.width = `${Math.min(100, Number(me.score || 0) * 8)}%`;
  } else {
    const hp = Number(me.hp || 0);
    el.meHpText.textContent = `${hp} / ${START_HP}`;
    el.meHpFill.style.width = `${Math.max(0, Math.min(100, (hp / START_HP) * 100))}%`;
  }

  el.othersHpWrap.innerHTML = '';
  Object.entries(room.players || {}).filter(([uid]) => uid !== state.uid).forEach(([, p]) => {
    const div = document.createElement('div');
    div.className = 'duel-mini-opponent';
    div.textContent = isWorm(room)
      ? `${p?.name || 'ผู้เล่น'}: ${Number(p?.score || 0)} แต้ม`
      : `${p?.name || 'ผู้เล่น'}: ${Number(p?.hp || 0)} HP`;
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
}

async function handleCreateRoom() {
  try {
    const courseId = String(el.courseIdInput.value || '').trim();
    if (!courseId) throw new Error('เลือกบททดสอบก่อน');
    await loadQuestionBank(courseId);
    const questionSequence = buildQuestionLoop(state.questionBank, {
      loopQuestionCount: LOOP_QUESTION_COUNT,
      shuffleFn: (ids) => pickRandomQuestions(ids, ids.length),
    });
    const gameMode = el.gameMode.value;
    const matchType = el.matchType.value;
    const relaySize = Number(el.relaySize.value || 2);
    const created = await createDuelRoom({
      hostName: 'Host',
      courseId,
      durationSeconds: Number(el.durationInput.value || 120),
      questionSequence,
      gameMode,
      matchType,
      relaySize,
    });
    state.roomId = created.roomId;
    state.uid = created.uid || state.uid;
    el.roomIdInput.value = created.roomId;
    setStatus(`สร้างห้องสำเร็จ: ${created.roomId}`);
    subscribeRoom(created.roomId);
  } catch (error) {
    setStatus(error.message || 'สร้างห้องไม่สำเร็จ');
  }
}

async function handleJoinRoom() {
  try {
    const roomId = normalizeRoomIdInput(el.roomIdInput.value);
    if (roomId.length !== ROOM_ID_LENGTH) throw new Error('กรอกรหัสห้อง 6 หลัก');
    const joined = await joinDuelRoom(roomId, 'ผู้เล่น');
    state.roomId = roomId;
    state.uid = joined.uid || state.uid;
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
  if (!room || room.status !== 'active' || state.isSubmitting) return;
  const roundIndex = getRoundState(room).roundIndex;
  if (state.answeredRoundIndex === roundIndex) return;

  let isCorrect = false;
  const question = getCurrentQuestion(room);
  if (!forceWrong && question && Number.isInteger(state.selectedAnswer)) {
    isCorrect = isQuestionCorrect(question, state.selectedAnswer);
  }

  state.isSubmitting = true;
  try {
    const result = await submitDuelAnswer(state.roomId, { isCorrect });
    if (result?.accepted) {
      state.answeredRoundIndex = roundIndex;
      state.selectedAnswer = null;
    }
  } finally {
    state.isSubmitting = false;
  }
}

function ensureTimer(room) {
  if (state.timerId) window.clearInterval(state.timerId);
  const tick = () => {
    if (!room || room.status !== 'active') return;
    const duration = Number(room.durationSeconds || 120);
    const remainSec = Math.ceil((Number(room.startedAtMs || 0) + duration * 1000 - Date.now()) / 1000);
    const roundState = getRoundState(room);
    el.timerText.textContent = roundState.isReveal ? 'เฉลย...' : `${Math.max(0, Math.ceil(roundState.questionRemainMs / 1000))}s`;
    if (!roundState.isReveal && state.answeredRoundIndex !== roundState.roundIndex && !state.isSubmitting && !Number.isInteger(state.selectedAnswer)) {
      void submitCurrentAnswer(true);
    }
    if (remainSec <= 0 && !state.hasRequestedFinalize) {
      state.hasRequestedFinalize = true;
      void finalizeDuelByTimeout(state.roomId);
    }
  };
  tick();
  state.timerId = window.setInterval(tick, 400);
}

function handleRoomUpdate(room) {
  if (!room) return;
  state.room = room;
  const roomCourseId = String(room.courseId || '');
  if (roomCourseId && roomCourseId !== state.loadedCourseId) {
    void loadQuestionBank(roomCourseId).then(() => renderQuestion(room));
  }

  const players = Object.values(room.players || {});
  el.lobbyRoomIdText.textContent = room.roomId || state.roomId;
  el.lobbyPlayers.innerHTML = '';
  players.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'duel-lobby-chip';
    const suffix = isWorm(room) ? `แต้ม ${Number(p?.score || 0)}` : `HP ${Number(p?.hp || 0)}`;
    chip.textContent = `${p?.name || 'ผู้เล่น'} (${suffix})`;
    el.lobbyPlayers.appendChild(chip);
  });

  const isHost = String(room.hostUid || '') === state.uid;
  el.startGameBtn.classList.toggle('hidden', !isHost || room.status !== 'waiting');
  el.createRoomBtn.disabled = Boolean(state.room && state.room.status !== 'finished');

  if (room.status === 'finished') {
    const winnerUid = String(room.winnerUid || '');
    if (!winnerUid) el.resultHint.textContent = 'เสมอ';
    else if (winnerUid === state.uid || winnerUid === `team:${(room.players?.[state.uid] || {}).teamId}`) el.resultHint.textContent = '🎉 คุณชนะ';
    else el.resultHint.textContent = 'จบเกม';
  }

  renderBattle(room);
  ensureTimer(room);
}

function subscribeRoom(roomId) {
  if (state.unsubRoom) state.unsubRoom();
  state.unsubRoom = subscribeDuelRoom(roomId, handleRoomUpdate, (error) => setStatus(error.message));
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

function init() {
  el.showHostSetupBtn.addEventListener('click', () => {
    el.hostSetup.classList.remove('hidden');
    el.joinSetup.classList.add('hidden');
    setStatus('ตั้งค่าห้องสำหรับ Host แล้วกด "เริ่มสร้างห้อง"');
  });
  el.showJoinSetupBtn.addEventListener('click', () => {
    el.joinSetup.classList.remove('hidden');
    el.hostSetup.classList.add('hidden');
    setStatus('กรอกรหัสห้อง 6 หลักเพื่อ Join');
  });
  el.roomIdInput.addEventListener('input', () => { el.roomIdInput.value = normalizeRoomIdInput(el.roomIdInput.value); });
  el.matchType.addEventListener('change', () => {
    el.relayWrap.classList.toggle('hidden', el.matchType.value !== 'team');
  });
  subscribeAuthStatus((authState) => { if (authState.uid) state.uid = authState.uid; });
  subscribeCourses(renderCourseIdOptions, () => {});
  el.createRoomBtn.addEventListener('click', () => { void handleCreateRoom(); });
  el.joinRoomBtn.addEventListener('click', () => { void handleJoinRoom(); });
  el.startGameBtn.addEventListener('click', () => { void handleStartGame(); });
  el.submitBtn.addEventListener('click', () => { void submitCurrentAnswer(false); });
  el.skipBtn.addEventListener('click', () => { void submitCurrentAnswer(true); });
}

init();
