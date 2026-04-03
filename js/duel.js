import {
  createDuelRoom,
  finalizeDuelByTimeout,
  getQuestionsByCourse,
  joinDuelRoom,
  submitDuelAnswer,
  subscribeAuthStatus,
  subscribeCourses,
  subscribeDuelRoom,
} from './db.js';
import { isQuestionCorrect, normalizeQuestion, shuffleArray } from './quiz.js';

const START_HP = 10;
const LOOP_QUESTION_COUNT = 50;

const playerNameInput = document.getElementById('duelPlayerName');
const courseIdInput = document.getElementById('duelCourseId');
const durationInput = document.getElementById('duelDuration');
const roomIdInput = document.getElementById('duelRoomId');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const statusText = document.getElementById('duelStatusText');
const battleSection = document.getElementById('duelBattleSection');

const meName = document.getElementById('meName');
const oppName = document.getElementById('oppName');
const meHpFill = document.getElementById('meHpFill');
const oppHpFill = document.getElementById('oppHpFill');
const meHpText = document.getElementById('meHpText');
const oppHpText = document.getElementById('oppHpText');
const meStats = document.getElementById('meStats');
const oppStats = document.getElementById('oppStats');
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
  questionSequence: [],
  currentIndex: 0,
  selectedAnswer: null,
  lastEventId: '',
};

function setStatus(text) {
  statusText.textContent = text;
}

function speak(text) {
  const line = String(text || '').trim();
  if (!line || !('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(line);
  utterance.lang = 'th-TH';
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function getRandomAttackVoice() {
  const lines = ['โดนไปหนึ่งดอก!', 'คะแนนมึงหายแล้ว!', 'รับดาเมจไปเลย!', 'มีหนาวแน่รอบนี้!'];
  return lines[Math.floor(Math.random() * lines.length)];
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
  const opponentEntry = Object.entries(players).find(([id]) => id !== state.uid);
  const oppUid = opponentEntry?.[0] || '';
  const opp = opponentEntry?.[1] || null;
  return { me, opp, oppUid };
}

function findQuestionById(questionId) {
  return state.questionBank.find((q) => String(q.id) === String(questionId));
}

function getCurrentQuestion() {
  const questionId = state.questionSequence[state.currentIndex];
  const raw = findQuestionById(questionId);
  if (!raw) return null;
  return normalizeQuestion(raw);
}

function renderQuestion() {
  const question = getCurrentQuestion();
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

function renderBattle(room) {
  const { me, opp } = getPlayerEntries(room);
  if (!me) return;

  battleSection.classList.remove('hidden');

  meName.textContent = me.name || 'ฉัน';
  oppName.textContent = opp?.name || 'รอคู่ต่อสู้';

  renderHp(meHpFill, me.hp);
  renderHp(oppHpFill, opp?.hp ?? START_HP);

  meHpText.textContent = `${Number(me.hp || 0)} / ${START_HP}`;
  oppHpText.textContent = `${Number(opp?.hp || START_HP)} / ${START_HP}`;

  meStats.textContent = `ถูก: ${Number(me.correctCount || 0)} | ผิด: ${Number(me.wrongCount || 0)} | พลาดติดกัน: ${Number(me.wrongStreak || 0)}`;
  oppStats.textContent = `ถูก: ${Number(opp?.correctCount || 0)} | ผิด: ${Number(opp?.wrongCount || 0)} | พลาดติดกัน: ${Number(opp?.wrongStreak || 0)}`;

  submitBtn.disabled = room.status !== 'active';
  skipBtn.disabled = room.status !== 'active';

  if (room.status === 'waiting') {
    resultHint.textContent = 'รอผู้เล่นคนที่ 2 เข้าห้อง...';
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
    if (!startedAtMs) {
      timerText.textContent = formatTime(duration);
      return;
    }

    const now = Date.now();
    const remainSec = Math.ceil((startedAtMs + (duration * 1000) - now) / 1000);
    timerText.textContent = formatTime(remainSec);

    if (remainSec <= 0) {
      void finalizeDuelByTimeout(state.roomId);
    }
  };

  tick();
  state.timerId = window.setInterval(tick, 500);
}

function applyVoiceEvent(room) {
  const event = room?.lastEvent;
  if (!event || !event.id || event.id === state.lastEventId) return;
  state.lastEventId = event.id;

  if (event.type === 'attack' && event.actorUid === state.uid) {
    speak(getRandomAttackVoice());
    return;
  }

  if (event.type === 'penalty' && event.targetUid === state.uid) {
    speak('โง่ซ้ำซ้อน! โดนหักคะแนนตัวเองเลยเห็นไหม?');
    return;
  }

  if (event.type === 'critical') {
    speak('ระวัง! มึงจะตายแล้ว!');
  }
}

function handleRoomUpdate(room) {
  if (!room) {
    setStatus('ห้องถูกลบหรือไม่พบข้อมูล');
    return;
  }

  state.room = room;
  state.questionSequence = Array.isArray(room.questionSequence) ? room.questionSequence : [];

  renderBattle(room);
  ensureTimer(room);
  applyVoiceEvent(room);

  if (room.status === 'active') {
    renderQuestion();
    resultHint.textContent = 'โจมตีให้ไว! ตอบถูกเพื่อตัดคะแนนฝั่งตรงข้าม';
  }
}

async function loadQuestionBank(courseId) {
  const rows = await getQuestionsByCourse(courseId);
  if (!rows.length) throw new Error('ไม่พบคลังโจทย์ของคอร์สนี้');
  state.questionBank = rows;
}

function buildQuestionLoop(questionBank) {
  const ids = questionBank.map((item) => String(item.id));
  if (!ids.length) return [];

  const loop = [];
  while (loop.length < LOOP_QUESTION_COUNT) {
    loop.push(...shuffleArray(ids));
  }
  return loop.slice(0, LOOP_QUESTION_COUNT);
}

async function startSubscribeRoom(roomId) {
  if (state.unsubRoom) state.unsubRoom();
  state.unsubRoom = subscribeDuelRoom(roomId, handleRoomUpdate, (error) => {
    setStatus(`subscribe error: ${error.message}`);
  });
}

async function handleCreateRoom() {
  try {
    const playerName = String(playerNameInput.value || '').trim();
    const courseId = String(courseIdInput.value || '').trim();
    if (!playerName) throw new Error('กรอกชื่อผู้เล่นก่อน');
    if (!courseId) throw new Error('กรอก Course ID ก่อน');

    setStatus('กำลังโหลดคลังโจทย์...');
    await loadQuestionBank(courseId);

    const questionSequence = buildQuestionLoop(state.questionBank);
    if (!questionSequence.length) throw new Error('ไม่สามารถสร้างชุดโจทย์ดวลได้');

    const durationSeconds = Number(durationInput.value) === 180 ? 180 : 120;
    const created = await createDuelRoom({
      hostName: playerName,
      courseId,
      durationSeconds,
      questionSequence,
    });

    state.roomId = created.roomId;
    roomIdInput.value = created.roomId;
    setStatus(`สร้างห้องสำเร็จ: ${created.roomId} (ส่งรหัสนี้ให้เพื่อน)`);
    await startSubscribeRoom(created.roomId);
  } catch (error) {
    setStatus(error.message || 'สร้างห้องไม่สำเร็จ');
  }
}

async function handleJoinRoom() {
  try {
    const roomId = String(roomIdInput.value || '').trim();
    const playerName = String(playerNameInput.value || '').trim();
    const courseId = String(courseIdInput.value || '').trim();

    if (!roomId) throw new Error('กรอก Room ID ก่อนเข้าห้อง');
    if (!playerName) throw new Error('กรอกชื่อผู้เล่นก่อน');
    if (!courseId) throw new Error('กรอก Course ID เดียวกับ Host');

    setStatus('กำลังโหลดคลังโจทย์...');
    await loadQuestionBank(courseId);

    await joinDuelRoom(roomId, playerName);
    state.roomId = roomId;
    setStatus(`เข้าห้อง ${roomId} สำเร็จ`);
    await startSubscribeRoom(roomId);
  } catch (error) {
    setStatus(error.message || 'เข้าห้องไม่สำเร็จ');
  }
}

async function submitCurrentAnswer(forceWrong = false) {
  const room = state.room;
  if (!room || room.status !== 'active') return;
  const question = getCurrentQuestion();
  if (!question) return;

  let isCorrect = false;
  if (!forceWrong && Number.isInteger(state.selectedAnswer)) {
    isCorrect = isQuestionCorrect(question, state.selectedAnswer);
  }

  await submitDuelAnswer(state.roomId, { isCorrect });
  state.currentIndex = (state.currentIndex + 1) % Math.max(1, state.questionSequence.length);
  renderQuestion();
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

  subscribeAuthStatus((authState) => {
    state.uid = authState.uid || '';
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
