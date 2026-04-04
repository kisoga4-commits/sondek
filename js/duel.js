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
  entrySection: document.getElementById('duelEntrySection'),
  courseIdInput: document.getElementById('duelCourseId'),
  hostNameInput: document.getElementById('duelHostName'),
  joinNameInput: document.getElementById('duelJoinName'),
  durationInput: document.getElementById('duelDuration'),
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
  gameMode: document.getElementById('duelGameMode'),
  matchType: document.getElementById('duelMatchType'),
  relayWrap: document.getElementById('duelRelayWrap'),
  relaySize: document.getElementById('duelRelaySize'),
  othersHpWrap: document.getElementById('duelOthersHp'),
  timerText: document.getElementById('duelTimerText'),
  resultHint: document.getElementById('duelResultHint'),
  stunHint: document.getElementById('duelStunHint'),
  soundToggle: document.getElementById('duelSoundToggle'),
  audioHint: document.getElementById('duelAudioHint'),
  questionTitle: document.getElementById('duelQuestionTitle'),
  choicesWrap: document.getElementById('duelChoices'),
  submitBtn: document.getElementById('duelSubmitBtn'),
  skipBtn: document.getElementById('duelSkipBtn'),
  raceBoard: document.getElementById('duelRaceBoard'),
};

const state = {
  uid: '', roomId: '', room: null, unsubRoom: null, timerId: null, questionBank: [], loadedCourseId: '',
  selectedAnswer: null, answeredRoundIndex: -1, currentQuestionId: '', isSubmitting: false, hasRequestedFinalize: false,
  authReady: false,
  soundEnabled: true,
};

const setStatus = (text) => { el.statusText.textContent = text; };
const getGameMode = (room) => String(room?.modeConfig?.gameMode || room?.settings?.mode || 'attack');
const isWorm = (room) => getGameMode(room) === 'worm';
const isTeam = (room) => String(room?.modeConfig?.matchType || room?.settings?.competitionType || 'solo') === 'team';
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
  oscillator.frequency.value = type === 'warn' ? 200 : 560;
  gain.gain.value = 0.05;
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + (type === 'warn' ? 0.08 : 0.06));
}

function openModal(modal) { modal?.classList.remove('hidden'); }
function closeModal(modal) { modal?.classList.add('hidden'); }

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
  const me = (room?.players || {})[state.uid] || {};
  const stun = Math.max(0, Math.ceil((Number(me?.stunnedUntilMs || 0) - Date.now()) / 1000));
  const isLocked = stun > 0;
  el.submitBtn.disabled = true;
  el.skipBtn.disabled = isLocked;
  el.stunHint.classList.toggle('hidden', !isLocked);
  el.stunHint.textContent = `คุณติด STUN ${stun}s กรุณารอสักครู่`;
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
    radio.disabled = isLocked;
    radio.addEventListener('change', () => {
      if (isLocked) return;
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
  const players = Object.entries(room.players || {}).sort((a, b) => Number(b?.[1]?.score || 0) - Number(a?.[1]?.score || 0));
  const palette = ['#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#14b8a6', '#f97316'];
  players.forEach(([uid, p], idx) => {
    const lane = document.createElement('div');
    lane.className = 'duel-race-lane';
    const score = Number(p?.score || 0);
    const stun = Math.max(0, Math.ceil((Number(p?.stunnedUntilMs || 0) - Date.now()) / 1000));
    const combo = Number(p?.combo || p?.streak || p?.correctStreak || 0);
    const warning = Number(p?.wrongStreak || 0) >= 2 ? ' ⚠️ใกล้โดนโทษ' : '';
    const active = isTeam(room)
      ? Number((room.teams?.[p?.teamId] || {}).activeRelayOrder || 0) === Number(p?.relayOrder || 0)
      : true;
    const relaySize = Number(room?.modeConfig?.relaySize || 1);
    const members = isTeam(room)
      ? Object.values(room?.players || {}).filter((member) => String(member?.teamId || '') === String(p?.teamId || ''))
        .sort((m1, m2) => Number(m1?.relayOrder || 0) - Number(m2?.relayOrder || 0))
      : [];
    const memberHtml = isTeam(room)
      ? `<div class="duel-lane-team">${
        members.map((member) => {
          const memberStun = Math.max(0, Math.ceil((Number(member?.stunnedUntilMs || 0) - Date.now()) / 1000));
          const classes = ['duel-member-pill'];
          if (Number(member?.relayOrder || 0) === Number((room.teams?.[p?.teamId] || {}).activeRelayOrder || 0)) classes.push('is-active');
          if (memberStun > 0) classes.push('is-stunned');
          if (Number(member?.relayOrder || 0) < Number((room.teams?.[p?.teamId] || {}).activeRelayOrder || 0)) classes.push('is-passed');
          return `<span class="${classes.join(' ')}">${member?.name || `P${member?.relayOrder || 1}`}</span>`;
        }).join('')
      }</div>`
      : '';
    const runnerClass = ['duel-lane-runner'];
    if (active) runnerClass.push('is-active');
    if (stun > 0) runnerClass.push('is-stunned');
    const laneTitle = isTeam(room)
      ? `${p?.teamId ? `Team ${p.teamId}` : (p?.name || uid)} ${relaySize > 1 ? `(x${relaySize})` : ''}`
      : `${p?.name || uid}`;
    const badge = combo >= 3 ? ` <span class="duel-lobby-chip">x${combo} Combo</span>` : '';
    lane.innerHTML = `
      <div class="duel-race-top"><span class="${runnerClass.join(' ')}">${idx === 0 ? '👑 ' : ''}${laneTitle}${active ? ' • Active' : ''}${stun > 0 ? ` • STUN ${stun}s` : ''}${badge}</span><span>${score} แต้ม${warning}</span></div>
      ${memberHtml}
      <div class="duel-race-track"><span style="width:${Math.min(100, score * 8)}%;background:${palette[idx % palette.length]}"></span></div>
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
  el.duelModeTitle.textContent = isWorm(room) ? 'Race · หนอนกระดื้บ' : 'Duel ปกติ';

  el.othersHpWrap.innerHTML = '';
  Object.entries(room.players || {}).forEach(([uid, p]) => {
    const div = document.createElement('div');
    div.className = 'duel-mini-opponent';
    const isMe = uid === state.uid;
    const hpLabel = isWorm(room) ? `${Number(p?.score || 0)} แต้ม` : `${Number(p?.hp || 0)} / ${START_HP} HP`;
    const stun = Math.max(0, Math.ceil((Number(p?.stunnedUntilMs || 0) - Date.now()) / 1000));
    const combo = Number(p?.combo || p?.streak || p?.correctStreak || 0);
    const pieces = [`${isMe ? 'ฉัน' : (p?.name || 'ผู้เล่น')}: ${hpLabel}`];
    if (combo >= 3) pieces.push(`x${combo} Combo`);
    if (stun > 0) pieces.push(`STUN ${stun}s`);
    div.textContent = pieces.join(' • ');
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
    if (!state.authReady) throw new Error('ยังเชื่อมต่อระบบไม่สำเร็จ');
    const hostName = String(el.hostNameInput.value || '').trim() || 'Host';
    const courseId = String(el.courseIdInput.value || '').trim();
    if (!courseId) throw new Error('เลือกบททดสอบก่อน');
    await loadQuestionBank(courseId);
    const questionSequence = buildQuestionLoop(state.questionBank, {
      loopQuestionCount: LOOP_QUESTION_COUNT,
      shuffleFn: (ids) => pickRandomQuestions(ids, ids.length),
    });
    const created = await createDuelRoom({
      hostName,
      courseId,
      durationSeconds: Number(el.durationInput.value || 120),
      questionSequence,
      gameMode: el.gameMode.value,
      matchType: el.matchType.value,
      relaySize: Number(el.relaySize.value || 2),
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
  const roundIndex = getRoundState(room).roundIndex;
  if (state.answeredRoundIndex === roundIndex) return;

  let isCorrect = false;
  const question = getCurrentQuestion(room);
  if (!forceWrong && question && Number.isInteger(state.selectedAnswer)) {
    isCorrect = isQuestionCorrect(question, state.selectedAnswer);
  }

  state.isSubmitting = true;
  try {
    playUiTone(forceWrong ? 'warn' : 'ok');
    if (forceWrong) {
      const taunts = ['โอ๊ยพลาดนิดเดียว!', 'เกือบแล้ว ลองใหม่!', 'ใจเย็นแล้วค่อยตอบอีกที'];
      el.audioHint.textContent = taunts[Math.floor(Math.random() * taunts.length)];
    }
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
    if (!room || getRoomStatus(room) !== 'playing') return;
    const duration = Number(room.durationSeconds || 120);
    const remainSec = Math.ceil((Number(room.startedAtMs || 0) + duration * 1000 - Date.now()) / 1000);
    const roundState = getRoundState(room);
    el.timerText.textContent = roundState.isReveal ? 'เฉลย...' : `${Math.max(0, Math.ceil(roundState.questionRemainMs / 1000))}s`;
    el.roundText.textContent = roundState.isReveal ? 'เฉลย' : `ข้อ ${roundState.roundIndex + 1}`;
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

function renderLobbyMeta(room) {
  const modeLabel = isWorm(room) ? 'วิ่งแข่ง / หนอนกระดื้บ' : 'Duel ปกติ';
  const competition = isTeam(room) ? 'Team' : 'Solo';
  const relay = isTeam(room) ? `(${room?.modeConfig?.relaySize === 3 ? 'x3' : 'x2'})` : '';
  const duration = `${Math.max(2, Math.round(Number(room.durationSeconds || 120) / 60))} นาที`;
  const items = [
    `โหมด: ${modeLabel}`,
    `ประเภท: ${competition} ${relay}`.trim(),
    `เวลาเกม: ${duration}`,
    `สถานะ: ${getRoomStatus(room) === 'lobby' ? 'รอเริ่ม' : (getRoomStatus(room) === 'playing' ? 'กำลังเล่น' : 'จบเกม')}`,
  ];
  el.lobbyMeta.innerHTML = items.map((item) => `<div class="duel-lobby-chip">${item}</div>`).join('');
  if (el.lobbyModeText) el.lobbyModeText.textContent = modeLabel;
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
  if (!players.length) {
    const waiting = document.createElement('p');
    waiting.className = 'duel-empty-state';
    waiting.textContent = 'รอผู้เล่นเข้าห้อง';
    el.lobbyPlayers.appendChild(waiting);
  }

  renderLobbyMeta(room);
  const isHost = String(room.hostUid || '') === state.uid;
  const roomStatus = getRoomStatus(room);
  el.startGameBtn.classList.toggle('hidden', !isHost || roomStatus !== 'lobby');
  el.lobbyHint.textContent = players.length < 2 ? 'รอผู้เล่นเข้าห้อง...' : 'พร้อมเริ่มเกม';

  if (roomStatus === 'finished') {
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
  el.matchType.addEventListener('change', () => {
    el.relayWrap.classList.toggle('hidden', el.matchType.value !== 'team');
  });
  el.createRoomBtn.addEventListener('click', () => { void handleCreateRoom(); });
  el.joinRoomBtn.addEventListener('click', () => { void handleJoinRoom(); });
  el.startGameBtn.addEventListener('click', () => { void handleStartGame(); });
  el.submitBtn.addEventListener('click', () => { void submitCurrentAnswer(false); });
  el.skipBtn.addEventListener('click', () => { void submitCurrentAnswer(true); });
  el.soundToggle?.addEventListener('change', () => {
    state.soundEnabled = Boolean(el.soundToggle.checked);
    el.audioHint.textContent = state.soundEnabled ? 'เปิด' : 'ปิด';
  });
}

void init();
