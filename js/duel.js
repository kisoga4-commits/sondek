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

const playerNameInput = document.getElementById('duelPlayerName');
const courseIdInput = document.getElementById('duelCourseId');
const durationInput = document.getElementById('duelDuration');
const roomIdInput = document.getElementById('duelRoomId');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const statusText = document.getElementById('duelStatusText');
const lobbySection = document.getElementById('duelLobbySection');
const lobbyRoomIdText = document.getElementById('duelLobbyRoomId');
const lobbyHint = document.getElementById('duelLobbyHint');
const lobbyPlayers = document.getElementById('duelLobbyPlayers');
const battleSection = document.getElementById('duelBattleSection');

const meName = document.getElementById('meName');
const meHpFill = document.getElementById('meHpFill');
const meHpText = document.getElementById('meHpText');
const othersHpWrap = document.getElementById('duelOthersHp');
const timerText = document.getElementById('duelTimerText');
const resultHint = document.getElementById('duelResultHint');
const questionTitle = document.getElementById('duelQuestionTitle');
const choicesWrap = document.getElementById('duelChoices');
const submitBtn = document.getElementById('duelSubmitBtn');
const skipBtn = document.getElementById('duelSkipBtn');

const state = {
  uid: '',
  roomId: '',
  room: null,
  unsubRoom: null,
  timerId: null,
  questionBank: [],
  loadedCourseId: '',
  questionSequence: [],
  currentIndex: 0,
  selectedAnswer: null,
  lastEventId: '',
  hasShownFinalResult: false,
  finalResultTimerId: null,
  isSubmitting: false,
  hasRequestedFinalize: false,
  currentQuestionId: '',
  lastQuestionId: '',
  questionLoadPromise: null,
  questionLoadCourseId: '',
  answeredRoundIndex: -1,
  currentRoundIndex: -1,
};

function setStatus(text) {
  statusText.textContent = text;
}

function toDuelErrorMessage(error, fallbackText) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  const isAuthConfigError = code.includes('auth/anonymous-not-enabled')
    || code.includes('auth/operation-not-allowed')
    || code.includes('auth/admin-restricted-operation')
    || code.includes('auth/unauthorized-domain');
  if (isAuthConfigError) {
    return 'ระบบล็อกอิน Anonymous ยังไม่พร้อม — เปิด Firebase Authentication > Sign-in method > Anonymous และเพิ่มโดเมนเว็บใน Authorized domains';
  }
  const isPermissionDenied = code.includes('permission-denied')
    || message.includes('Missing or insufficient permissions');
  if (!isPermissionDenied) return message || fallbackText;
  return 'ยังไม่มีสิทธิ์ใช้งาน Duel Mode (Missing or insufficient permissions) — เปิด Firebase Auth แบบ Anonymous และตรวจ Realtime Database Rules ให้อนุญาต create/join/update ที่ duel_rooms';
}

function renderHp(el, hp) {
  const value = Math.max(0, Math.min(START_HP, Number(hp || 0)));
  const ratio = (value / START_HP) * 100;
  el.style.width = `${ratio}%`;
  if (value < 3) {
    el.classList.add('is-critical');
  } else {
    el.classList.remove('is-critical');
  }
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function getPlayerEntries(room) {
  const players = room?.players || {};
  const me = players[state.uid] || null;
  const opponents = Object.entries(players)
    .filter(([uid]) => uid !== state.uid)
    .map(([uid, payload]) => ({ uid, ...payload }));
  return { me, opponents };
}

function findQuestionById(questionId) {
  return state.questionBank.find((q) => String(q.id) === String(questionId));
}

function getCurrentQuestion() {
  const questionId = state.currentQuestionId;
  const raw = findQuestionById(questionId);
  if (!raw) return null;
  return normalizeQuestion(raw);
}

function renderQuestion(force = false) {
  const question = getCurrentQuestion();
  const questionId = question ? String(question.id) : '';

  if (!force && questionId && state.currentQuestionId === questionId) {
    return;
  }

  state.currentQuestionId = questionId;
  state.selectedAnswer = null;
  submitBtn.disabled = true;

  if (!question) {
    questionTitle.textContent = 'กำลังรอคำถาม...';
    choicesWrap.innerHTML = '';
    return;
  }

  questionTitle.textContent = `${state.currentIndex + 1}. ${question.question}`;
  const choices = Array.isArray(question.choices) ? question.choices : [];
  choicesWrap.innerHTML = '';

  choices.forEach((choice, idx) => {
    const label = document.createElement('label');
    label.className = 'choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'duelChoice';
    radio.value = String(idx);
    radio.addEventListener('change', () => {
      state.selectedAnswer = Number(radio.value);
      submitBtn.disabled = false;
    });
    const span = document.createElement('span');
    span.textContent = choice;
    label.append(radio, span);
    choicesWrap.appendChild(label);
  });
}

async function ensureQuestionBankLoaded(courseId) {
  const safeCourseId = String(courseId || '').trim();
  if (!safeCourseId) return;
  if (safeCourseId === state.loadedCourseId && state.questionBank.length) return;
  if (state.questionLoadPromise && state.questionLoadCourseId === safeCourseId) {
    await state.questionLoadPromise;
    return;
  }

  state.questionLoadCourseId = safeCourseId;
  state.questionLoadPromise = loadQuestionBank(safeCourseId)
    .finally(() => {
      state.questionLoadPromise = null;
      state.questionLoadCourseId = '';
    });

  await state.questionLoadPromise;
}

function renderBattle(room) {
  const { me, opponents } = getPlayerEntries(room);
  if (!me) return;

  const playerCount = Object.keys(room?.players || {}).length;
  if (lobbySection) lobbySection.classList.toggle('hidden', room.status !== 'waiting');
  if (battleSection) battleSection.classList.toggle('hidden', room.status === 'waiting');

  if (lobbyRoomIdText) lobbyRoomIdText.textContent = String(room.roomId || state.roomId || '----');
  if (lobbyHint) lobbyHint.textContent = `ผู้เล่น ${playerCount}/4 คน (อย่างน้อย 2 คนถึงจะเริ่มได้)`;
  if (lobbyPlayers) {
    lobbyPlayers.innerHTML = '';
    Object.values(room?.players || {}).forEach((player) => {
      const chip = document.createElement('div');
      chip.className = 'duel-lobby-chip';
      chip.textContent = `${player?.name || 'ผู้เล่น'} (HP ${Number(player?.hp || 0)})`;
      lobbyPlayers.appendChild(chip);
    });
  }

  meName.textContent = me.name || 'ฉัน';
  renderHp(meHpFill, me.hp);
  meHpText.textContent = `${Number(me.hp || 0)} / ${START_HP}`;

  if (othersHpWrap) {
    othersHpWrap.innerHTML = '';
    opponents.forEach((opponent) => {
      const row = document.createElement('div');
      row.className = 'duel-mini-opponent';
      row.innerHTML = `
        <div class="duel-mini-opponent-name">${opponent.name || 'ผู้เล่น'}</div>
        <div class="duel-mini-opponent-bar"><span style="width:${Math.max(0, Math.min(100, (Number(opponent.hp || 0) / START_HP) * 100))}%"></span></div>
        <small>${Number(opponent.hp || 0)} / ${START_HP}</small>
      `;
      othersHpWrap.appendChild(row);
    });
  }

  const roundState = getRoundState(room);
  const answeredThisRound = state.answeredRoundIndex === roundState.roundIndex;
  const isActionLocked = state.isSubmitting || room.status !== 'active' || answeredThisRound || roundState.isReveal;
  submitBtn.disabled = isActionLocked;
  skipBtn.disabled = isActionLocked;

  if (room.status === 'waiting') {
    resultHint.textContent = playerCount < 2
      ? 'รอผู้เล่นอย่างน้อย 2 คนเข้าห้อง...'
      : `พร้อมลุยแล้ว (${playerCount}/4 คน) รอ Host กดเริ่ม`;
  }

  if (room.status === 'finished') {
    const winnerUid = String(room.winnerUid || '');
    if (!winnerUid) {
      resultHint.textContent = 'จบเกม: เสมอ';
    } else if (winnerUid === state.uid) {
      resultHint.textContent = '🎉 คุณชนะแล้ว!';
    } else {
      resultHint.textContent = '💀 คุณแพ้แล้ว!';
    }
    submitBtn.disabled = true;
    skipBtn.disabled = true;
  }

  if (room.status === 'active') {
    const myHp = Number(me.hp || 0);
    const oppSummary = opponents.map((opponent) => `${opponent.name || 'คู่ต่อสู้'} ${Number(opponent.hp || 0)}`).join(' | ');
    resultHint.textContent = `พลังเรา ${myHp}${oppSummary ? ` | ${oppSummary}` : ''}`;
  }
}

function ensureTimer(room) {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }

  const tick = () => {
    if (!room || room.status !== 'active') return;
    const startedAtMs = Number(room.startedAtMs || 0);
    const duration = Number(room.durationSeconds || 120);
    const roundState = getRoundState(room);
    if (!startedAtMs) {
      timerText.textContent = `${DEFAULT_QUESTION_SECONDS}s`;
      return;
    }

    const now = Date.now();
    const remainSec = Math.ceil((startedAtMs + (duration * 1000) - now) / 1000);
    timerText.textContent = roundState.isReveal
      ? 'เฉลย...'
      : `${Math.max(0, Math.ceil(roundState.questionRemainMs / 1000))}s`;

    if (!roundState.isReveal && roundState.roundIndex >= 0) {
      const hasAnsweredThisRound = state.answeredRoundIndex === roundState.roundIndex;
      const hasSelection = Number.isInteger(state.selectedAnswer);
      if (!hasAnsweredThisRound && !hasSelection && !state.isSubmitting) {
        void submitCurrentAnswer(true, roundState.roundIndex);
      }
    }

    if (remainSec <= 0) {
      if (state.hasRequestedFinalize) return;
      state.hasRequestedFinalize = true;
      void finalizeDuelByTimeout(state.roomId).catch((error) => {
        setStatus(toDuelErrorMessage(error, 'หมดเวลาแล้ว แต่สรุปผลดวลไม่สำเร็จ'));
      });
      return;
    }

    if (state.hasRequestedFinalize) {
      state.hasRequestedFinalize = false;
    }
  };

  tick();
  state.timerId = window.setInterval(tick, 500);
}

function applyVoiceEvent(room) {
  const event = room?.lastEvent;
  const { opponents } = getPlayerEntries(room);
  const oppNameText = String(opponents[0]?.name || 'คู่ต่อสู้');
  if (!event || !event.id || event.id === state.lastEventId) return;
  state.lastEventId = event.id;

  if (event.type === 'attack' && event.actorUid === state.uid) {
    setStatus(`⚡ ป้าบบบ! ${oppNameText} โดนดูด HP ไปแล้ว 1`);
    return;
  }

  if (event.type === 'streak_bonus' && event.targetUid === state.uid) {
    setStatus('🔥 โหมดเทพ! ตอบถูก 3 ติด ฟื้น HP +1 ให้ตัวเอง');
    return;
  }

  if (event.type === 'penalty' && event.targetUid === state.uid) {
    setStatus('💥 มึนจัด ตอบผิด 3 ติด! HP ตัวเองหาย 1');
    return;
  }

  if (event.type === 'critical') {
    setStatus('🚨 เลือดแดงทั้งห้อง! ใครพลาดอีกมีนอน');
  }
}

function scheduleReturnToHome() {
  if (state.finalResultTimerId) return;
  state.finalResultTimerId = window.setTimeout(() => {
    window.location.href = 'index.html';
  }, 3500);
}

function handleFinalResult(room) {
  if (!room || room.status !== 'finished' || state.hasShownFinalResult) return;
  state.hasShownFinalResult = true;

  const winnerUid = String(room.winnerUid || '');
  const isMeWinner = winnerUid && winnerUid === state.uid;
  const title = isMeWinner ? '🎉 ยินดีด้วย! คุณชนะการดวล' : '💪 ไม่เป็นไร สู้ใหม่รอบหน้า!';
  const subtitle = isMeWinner
    ? 'ระบบจะพากลับหน้าแรกอัตโนมัติ'
    : 'ครั้งหน้าเอาใหม่ ระบบจะพากลับหน้าแรกอัตโนมัติ';
  setStatus(`${title} — ${subtitle}`);
  scheduleReturnToHome();
}

function handleRoomUpdate(room) {
  if (!room) {
    setStatus('ห้องถูกลบหรือไม่พบข้อมูล');
    return;
  }

  state.room = room;
  state.questionSequence = Array.isArray(room.questionSequence) ? room.questionSequence : [];
  if (!state.questionSequence.length || state.currentIndex >= state.questionSequence.length) {
    state.currentIndex = 0;
  }

  const roomCourseId = String(room.courseId || '').trim();
  if (roomCourseId && roomCourseId !== state.loadedCourseId) {
    void ensureQuestionBankLoaded(roomCourseId)
      .then(() => {
        if (!courseIdInput.value) courseIdInput.value = roomCourseId;
        if (state.room?.status === 'active') renderQuestion(true);
      })
      .catch((error) => {
        setStatus(error.message || 'โหลดคลังโจทย์ไม่สำเร็จ');
      });
  }

  renderBattle(room);
  ensureTimer(room);
  applyVoiceEvent(room);
  handleFinalResult(room);

  if (room.status === 'active') {
    if (state.questionBank.length) {
      const roundState = getRoundState(room);
      const sequence = Array.isArray(room.questionSequence) ? room.questionSequence : [];
      if (sequence.length && roundState.roundIndex >= 0) {
        state.currentRoundIndex = roundState.roundIndex;
        state.currentIndex = roundState.roundIndex % sequence.length;
        state.currentQuestionId = String(sequence[state.currentIndex] || '');
      }
      renderQuestion(true);
    } else {
      state.currentQuestionId = '';
      questionTitle.textContent = 'กำลังโหลดคำถาม...';
      choicesWrap.innerHTML = '';
    }
  }

  const { me } = getPlayerEntries(room);
  const playerCount = Object.keys(room?.players || {}).length;
  const canStart = room.status === 'waiting'
    && playerCount >= 2
    && String(room.hostUid || '') === state.uid
    && Boolean(me);
  createRoomBtn.textContent = canStart ? 'เริ่มดวล' : 'Host';
}

async function loadQuestionBank(courseId) {
  const rows = await getQuestionsByCourse(courseId);
  if (!rows.length) throw new Error('ไม่พบคลังโจทย์ของคอร์สนี้');
  state.questionBank = rows.map((row) => ({
    ...row,
    choices: Array.isArray(row?.choices) ? [...row.choices] : row?.choices,
    acceptedAnswers: Array.isArray(row?.acceptedAnswers) ? [...row.acceptedAnswers] : row?.acceptedAnswers,
    orderingItems: Array.isArray(row?.orderingItems) ? [...row.orderingItems] : row?.orderingItems,
  }));
  state.loadedCourseId = String(courseId || '').trim();
  state.currentQuestionId = '';
  state.lastQuestionId = '';
}

async function startSubscribeRoom(roomId) {
  if (state.unsubRoom) state.unsubRoom();
  state.hasShownFinalResult = false;
  state.currentIndex = 0;
  state.selectedAnswer = null;
  state.isSubmitting = false;
  state.hasRequestedFinalize = false;
  state.currentQuestionId = '';
  state.lastQuestionId = '';
  state.answeredRoundIndex = -1;
  state.currentRoundIndex = -1;
  if (state.finalResultTimerId) {
    window.clearTimeout(state.finalResultTimerId);
    state.finalResultTimerId = null;
  }
  state.unsubRoom = subscribeDuelRoom(roomId, handleRoomUpdate, (error) => {
    setStatus(`subscribe error: ${error.message}`);
  });
}

async function handleCreateRoom() {
  try {
    const canStartExistingRoom = state.room
      && state.room.status === 'waiting'
      && String(state.room.hostUid || '') === state.uid
      && Object.keys(state.room.players || {}).length >= 2;
    if (canStartExistingRoom) {
      await startDuelRoom(state.roomId);
      setStatus(`เริ่มดวลห้อง ${state.roomId} แล้ว`);
      return;
    }

    if (state.room && state.room.status !== 'finished') {
      const currentRoomId = String(state.room.roomId || state.roomId || '').trim();
      throw new Error(`คุณอยู่ในห้อง ${currentRoomId || '(ไม่ทราบรหัส)'} อยู่แล้ว`);
    }

    const playerName = String(playerNameInput.value || '').trim();
    const courseId = String(courseIdInput.value || '').trim();
    if (!playerName) throw new Error('กรอกชื่อผู้เล่นก่อน');
    if (!courseId) throw new Error('กรอก Course ID ก่อน');

    setStatus('กำลังโหลดคลังโจทย์...');
    await loadQuestionBank(courseId);

    const questionSequence = buildQuestionLoop(state.questionBank, {
      loopQuestionCount: LOOP_QUESTION_COUNT,
      shuffleFn: (ids) => pickRandomQuestions(ids, ids.length),
    });
    if (!questionSequence.length) throw new Error('ไม่สามารถสร้างชุดโจทย์ดวลได้');

    const durationSeconds = Number(durationInput.value) === 180 ? 180 : 120;
    const created = await createDuelRoom({
      hostName: playerName,
      courseId,
      durationSeconds,
      questionSequence,
    });

    state.roomId = created.roomId;
    state.uid = created.uid || state.uid;
    roomIdInput.value = created.roomId;
    setStatus(`สร้างห้องสำเร็จ: ${created.roomId} (ส่งรหัสนี้ให้เพื่อนได้ สูงสุด 4 คน)`);
    await startSubscribeRoom(created.roomId);
  } catch (error) {
    setStatus(toDuelErrorMessage(error, 'สร้างห้องไม่สำเร็จ'));
  }
}

async function handleJoinRoom() {
  try {
    const roomId = normalizeRoomIdInput(roomIdInput.value);
    const playerName = String(playerNameInput.value || '').trim();

    if (roomId.length !== ROOM_ID_LENGTH) throw new Error('กรอกรหัสห้อง 6 หลักก่อนเข้าห้อง');
    if (!playerName) throw new Error('กรอกชื่อผู้เล่นก่อน');
    roomIdInput.value = roomId;

    const joined = await joinDuelRoom(roomId, playerName);
    state.roomId = roomId;
    state.uid = joined.uid || state.uid;
    setStatus(`เข้าห้อง ${roomId} สำเร็จ (รอ Host กดเริ่มดวล)`);
    await startSubscribeRoom(roomId);
  } catch (error) {
    setStatus(toDuelErrorMessage(error, 'เข้าห้องไม่สำเร็จ'));
  }
}

async function submitCurrentAnswer(forceWrong = false, expectedRoundIndex = null) {
  const room = state.room;
  if (!room || room.status !== 'active' || state.isSubmitting) return;
  const question = getCurrentQuestion();
  if (!question) return;

  let isCorrect = false;
  if (!forceWrong && Number.isInteger(state.selectedAnswer)) {
    isCorrect = isQuestionCorrect(question, state.selectedAnswer);
  }

  const roundState = getRoundState(room);
  if (roundState.roundIndex < 0) return;
  if (expectedRoundIndex !== null && expectedRoundIndex !== roundState.roundIndex) return;
  if (state.answeredRoundIndex === roundState.roundIndex) return;

  state.isSubmitting = true;
  submitBtn.disabled = true;
  skipBtn.disabled = true;

  try {
    const timeoutMs = 8000;
    const submitResult = await Promise.race([
      submitDuelAnswer(state.roomId, { isCorrect }),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('ส่งคำตอบช้าเกินไป กรุณาลองใหม่')), timeoutMs);
      }),
    ]);

    if (submitResult?.accepted) {
      state.answeredRoundIndex = roundState.roundIndex;
      state.selectedAnswer = null;
      submitBtn.disabled = true;
      setStatus(forceWrong ? '⏱️ หมดเวลา! ระบบส่งผิดให้อัตโนมัติ' : 'ส่งคำตอบแล้ว รอข้อถัดไป...');
      return;
    }

    const reason = String(submitResult?.reason || '');
    if (reason && reason !== 'room_not_active') {
      setStatus(`ส่งคำตอบไม่สำเร็จ (${reason})`);
    }
  } catch (error) {
    setStatus(toDuelErrorMessage(error, 'ส่งคำตอบไม่สำเร็จ'));
  } finally {
    state.isSubmitting = false;
    if (state.room?.status === 'active') {
      const currentRound = getRoundState(state.room);
      const answeredThisRound = state.answeredRoundIndex === currentRound.roundIndex;
      const lockActions = answeredThisRound || currentRound.isReveal;
      submitBtn.disabled = lockActions || !Number.isInteger(state.selectedAnswer);
      skipBtn.disabled = lockActions;
    }
  }
}

function initFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const courseId = params.get('id') || params.get('courseId') || '';
  const roomId = params.get('roomId') || '';
  if (courseId) courseIdInput.value = courseId;
  if (roomId) roomIdInput.value = roomId;
}

function renderCourseIdOptions(courses) {
  if (!courseIdInput) return;

  const options = Array.from(new Map(
    (Array.isArray(courses) ? courses : [])
      .map((course) => {
        const courseId = String(course?.courseId || '').trim();
        const title = String(course?.title || '').trim();
        return [courseId, { courseId, title }];
      })
      .filter(([courseId]) => Boolean(courseId)),
  ).values()).sort((a, b) => a.courseId.localeCompare(b.courseId));

  const currentValue = String(courseIdInput.value || '').trim();
  courseIdInput.innerHTML = '<option value="">-- เลือกบททดสอบ --</option>';

  options.forEach(({ courseId, title }) => {
    const option = document.createElement('option');
    option.value = courseId;
    option.textContent = title ? `${title} (${courseId})` : courseId;
    courseIdInput.appendChild(option);
  });

  if (currentValue) {
    courseIdInput.value = currentValue;
  }
}

function init() {
  initFromQuery();
  roomIdInput.addEventListener('input', () => {
    roomIdInput.value = normalizeRoomIdInput(roomIdInput.value);
  });

  subscribeAuthStatus((authState) => {
    if (authState.uid) {
      state.uid = authState.uid;
    }
  });

  subscribeCourses(renderCourseIdOptions, (error) => {
    console.error('load course ids failed', error);
  });

  createRoomBtn.addEventListener('click', () => {
    void handleCreateRoom();
  });

  joinRoomBtn.addEventListener('click', () => {
    void handleJoinRoom();
  });

  submitBtn.addEventListener('click', () => {
    void submitCurrentAnswer(false);
  });

  skipBtn.addEventListener('click', () => {
    void submitCurrentAnswer(true);
  });
}

init();
