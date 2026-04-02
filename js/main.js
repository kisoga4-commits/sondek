import { getCourse, getLeaderboard, getProfile, getQuestionsByCourse, saveLead } from './db.js';
import {
  calculateScore,
  DEFAULT_DRAW_COUNT,
  getQuestionType,
  getResultMessage,
  normalizeQuestion,
  pickRandomQuestions,
  shuffleArray,
} from './quiz.js';

const params = new URLSearchParams(window.location.search);
const courseId = params.get('id');

const startBtn = document.getElementById('startBtn');
const entryForm = document.getElementById('entryForm');
const introSection = document.getElementById('introSection');
const quizSection = document.getElementById('quizSection');
const resultSection = document.getElementById('resultSection');
const questionTitle = document.getElementById('questionTitle');
const choicesWrap = document.getElementById('choices');
const nextBtn = document.getElementById('nextBtn');
const progressText = document.getElementById('progressText');
const scoreText = document.getElementById('scoreText');
const progressFill = document.getElementById('progressFill');
const courseInfo = document.getElementById('courseInfo');
const resultScore = document.getElementById('resultScore');
const resultMessage = document.getElementById('resultMessage');
const leaderboardList = document.getElementById('leaderboardList');
const profileCta = document.getElementById('profileCta');
const enrollCta = document.getElementById('enrollCta');
const quizTitle = document.getElementById('quizTitle');
const quizDescription = document.getElementById('quizDescription');
const timerFill = document.getElementById('timerFill');
const timerText = document.getElementById('timerText');
const questionMeta = document.getElementById('questionMeta');
const questionMedia = document.getElementById('questionMedia');
const answerReview = document.getElementById('answerReview');

const state = {
  course: null,
  allQuestions: [],
  quizQuestions: [],
  profile: null,
  currentIndex: 0,
  answers: {},
  orderingView: {},
  startedAt: null,
  studentName: '',
  drawCount: DEFAULT_DRAW_COUNT,
  timeLeft: 30,
  timerId: null,
  isAdvancing: false,
};

function clearTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function currentQuestion() {
  return state.quizQuestions[state.currentIndex];
}

function isCurrentQuestionAnswered() {
  const question = currentQuestion();
  const answer = state.answers[state.currentIndex];
  if (!question) return false;
  if (getQuestionType(question) === 'ordering') {
    return Array.isArray(answer) && answer.length === (question.orderingItems || []).length;
  }
  if (getQuestionType(question) === 'short_text') {
    return String(answer ?? '').trim().length > 0;
  }
  return answer !== undefined;
}

function refreshTimerUi(question) {
  timerText.textContent = `${state.timeLeft}s`;
  const limit = question.timeLimitSeconds || 30;
  const widthPercent = (state.timeLeft / limit) * 100;
  timerFill.style.width = `${Math.max(0, widthPercent)}%`;
}

function jumpNextByTimeout() {
  void goNextQuestion();
}

function startQuestionTimer(question) {
  clearTimer();
  state.timeLeft = question.timeLimitSeconds;
  refreshTimerUi(question);

  state.timerId = window.setInterval(() => {
    state.timeLeft -= 1;
    refreshTimerUi(question);

    if (state.timeLeft <= 0) {
      jumpNextByTimeout();
    }
  }, 1000);
}

async function init() {
  if (!courseId) {
    courseInfo.textContent = 'ไม่พบรหัสแบบทดสอบในลิงก์ ตัวอย่าง: quiz.html?id=quiz_xxx';
    return;
  }

  try {
    const [course, questions, profile] = await Promise.all([
      getCourse(courseId),
      getQuestionsByCourse(courseId),
      getProfile(),
    ]);

    state.course = course;
    state.profile = profile;
    state.allQuestions = (questions || []).map((question) => normalizeQuestion(question));

    if (!course || !questions.length) {
      courseInfo.textContent = `ไม่พบแบบทดสอบ: ${courseId}`;
      return;
    }

    state.drawCount = Math.max(1, Number(course.drawCount || course.questionCount || DEFAULT_DRAW_COUNT));

    quizTitle.textContent = course.title || 'แบบทดสอบ';
    quizDescription.textContent = course.description || 'ตอบคำถามให้ครบ แล้วไปดูอันดับ TOP';
    courseInfo.textContent = `คลังคำถาม ${state.allQuestions.length} ข้อ | สุ่มต่อครั้ง ${Math.min(state.drawCount, state.allQuestions.length)} ข้อ`;

    profileCta.href = profile?.profileUrl || '#';
    enrollCta.href = course.enrollmentUrl || '#';
    startBtn.disabled = false;
  } catch (error) {
    console.error(error);
    courseInfo.textContent = 'โหลดไม่สำเร็จ กรุณารีเฟรชอีกครั้ง';
  }
}

function renderChoiceQuestion(question, questionIndex) {
  question.choices.forEach((choiceText, idx) => {
    const label = document.createElement('label');
    label.className = 'flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 py-4 text-lg font-semibold transition hover:border-indigo-300';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `q-${questionIndex}`;
    input.checked = Number(state.answers[questionIndex]) === idx;
    input.addEventListener('change', () => {
      state.answers[questionIndex] = idx;
      nextBtn.disabled = false;
    });

    const span = document.createElement('span');
    span.textContent = choiceText;

    label.appendChild(input);
    label.appendChild(span);
    choicesWrap.appendChild(label);
  });
}

function renderShortTextQuestion(questionIndex) {
  const label = document.createElement('label');
  label.className = 'block text-sm font-semibold text-slate-700';
  label.textContent = 'พิมพ์คำตอบของคุณ';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg';
  input.placeholder = 'กรอกคำตอบ';
  input.value = String(state.answers[questionIndex] || '');
  input.addEventListener('input', () => {
    state.answers[questionIndex] = input.value;
    nextBtn.disabled = !isCurrentQuestionAnswered();
  });

  label.appendChild(input);
  choicesWrap.appendChild(label);
}

function renderOrderingQuestion(question, questionIndex) {
  if (!state.orderingView[questionIndex]) {
    state.orderingView[questionIndex] = {
      shuffledItems: shuffleArray(question.orderingItems || []),
    };
  }

  const view = state.orderingView[questionIndex];
  const answer = state.answers[questionIndex] || [];

  view.shuffledItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2';

    const select = document.createElement('select');
    select.className = 'rounded-lg border border-slate-300 px-2 py-1';
    select.innerHTML = `<option value="">Order</option>${view.shuffledItems
      .map((_, idx) => `<option value="${idx + 1}">${idx + 1}</option>`)
      .join('')}`;

    const selectedOrder = answer.indexOf(item);
    if (selectedOrder >= 0) select.value = String(selectedOrder + 1);

    select.addEventListener('change', () => {
      const currentAnswer = [...(state.answers[questionIndex] || [])];
      const existingOrder = currentAnswer.indexOf(item);
      if (existingOrder >= 0) currentAnswer[existingOrder] = undefined;

      const pickedOrder = Number(select.value);
      if (pickedOrder > 0) currentAnswer[pickedOrder - 1] = item;

      state.answers[questionIndex] = currentAnswer.filter(Boolean);
      nextBtn.disabled = !isCurrentQuestionAnswered();
    });

    const text = document.createElement('p');
    text.className = 'font-medium';
    text.textContent = item;

    row.appendChild(select);
    row.appendChild(text);
    choicesWrap.appendChild(row);
  });
}

function renderQuestion() {
  const question = currentQuestion();
  const questionNo = state.currentIndex + 1;
  questionTitle.textContent = `${questionNo}. ${question.question}`;
  questionMeta.textContent = `${question.points} pts • ${question.timeLimitSeconds}s • ${question.type}`;

  if (question.mediaUrl) {
    questionMedia.src = question.mediaUrl;
    questionMedia.classList.remove('hidden');
  } else {
    questionMedia.classList.add('hidden');
    questionMedia.removeAttribute('src');
  }

  choicesWrap.innerHTML = '';

  if (getQuestionType(question) === 'ordering') {
    renderOrderingQuestion(question, state.currentIndex);
  } else if (getQuestionType(question) === 'short_text') {
    renderShortTextQuestion(state.currentIndex);
  } else {
    renderChoiceQuestion(question, state.currentIndex);
  }

  nextBtn.disabled = !isCurrentQuestionAnswered();
  nextBtn.textContent = questionNo === state.quizQuestions.length ? 'ส่งคำตอบและดูผล' : 'ข้อต่อไป';
  progressText.textContent = `ข้อ ${questionNo}/${state.quizQuestions.length}`;
  scoreText.textContent = `ตอบแล้ว ${Object.keys(state.answers).length}`;
  progressFill.style.width = `${(questionNo / state.quizQuestions.length) * 100}%`;

  startQuestionTimer(question);
}

function startQuiz() {
  const drawCount = Math.min(state.drawCount, state.allQuestions.length);
  state.quizQuestions = pickRandomQuestions(state.allQuestions, drawCount);
  state.currentIndex = 0;
  state.answers = {};
  state.orderingView = {};
  state.startedAt = Date.now();

  introSection.classList.add('hidden');
  quizSection.classList.remove('hidden');
  renderQuestion();
}

async function renderLeaderboard() {
  const leaders = await getLeaderboard(courseId);
  leaderboardList.innerHTML = '';

  if (!leaders.length) {
    leaderboardList.innerHTML = '<li class="text-slate-500">ยังไม่มีผู้ทำแบบทดสอบ</li>';
    return;
  }

  leaders.forEach((lead) => {
    const li = document.createElement('li');
    li.textContent = `${lead.name || '-'} — ${lead.scorePercent || 0}% (${lead.durationSeconds || 0}s)`;
    leaderboardList.appendChild(li);
  });
}

function formatCorrectAnswer(reviewItem) {
  const { question } = reviewItem;
  if (question.type === 'ordering') {
    return question.orderingItems.join(' → ');
  }

  if (question.type === 'short_text') {
    return (question.acceptedAnswers || []).join(' / ') || '-';
  }

  return question.choices?.[question.answerIndex] || '-';
}

function formatUserAnswer(reviewItem) {
  const { question, userAnswer } = reviewItem;
  if (question.type === 'ordering') {
    return Array.isArray(userAnswer) && userAnswer.length ? userAnswer.join(' → ') : 'ไม่ได้ตอบ';
  }

  if (question.type === 'short_text') {
    const text = String(userAnswer ?? '').trim();
    return text || 'ไม่ได้ตอบ';
  }

  return question.choices?.[Number(userAnswer)] || 'ไม่ได้ตอบ';
}

function renderAnswerReview(score) {
  answerReview.innerHTML = '';
  score.review.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = `rounded-xl border p-3 ${item.isCorrect ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`;
    card.innerHTML = `
      <p class="font-semibold">Q${index + 1}. ${item.question.question}</p>
      <p class="text-sm">คำตอบของคุณ: ${formatUserAnswer(item)}</p>
      <p class="text-sm">คำตอบที่ถูก: ${formatCorrectAnswer(item)}</p>
      <p class="text-sm font-semibold">${item.isCorrect ? '✅ ถูกต้อง' : '❌ ยังไม่ถูก'} • +${item.earnedPoints}/${item.question.points} คะแนน</p>
    `;
    answerReview.appendChild(card);
  });
}

async function showResult() {
  clearTimer();
  quizSection.classList.add('hidden');
  resultSection.classList.remove('hidden');

  const score = calculateScore(state.quizQuestions, state.answers);
  resultScore.textContent = `คะแนน ${score.totalScore}/${score.maxScore} • ${score.percent}% • ถูก ${score.correct}/${score.total} ข้อ`;
  resultMessage.textContent = getResultMessage(score.percent);
  renderAnswerReview(score);

  const durationSeconds = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));

  await saveLead({
    courseId,
    name: state.studentName,
    scorePercent: score.percent,
    correct: score.correct,
    total: score.total,
    totalScore: score.totalScore,
    maxScore: score.maxScore,
    durationSeconds,
  });

  await renderLeaderboard();

  const basePath = window.location.pathname.includes('/')
    ? window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1)
    : '/';
  const topUrl = `${window.location.origin}${basePath}top.html?id=${encodeURIComponent(courseId || '')}`;
  window.setTimeout(() => {
    window.location.href = topUrl;
  }, 1000);
}

async function goNextQuestion() {
  if (state.isAdvancing) return;
  state.isAdvancing = true;
  clearTimer();

  if (state.currentIndex + 1 >= state.quizQuestions.length) {
    await showResult();
    state.isAdvancing = false;
    return;
  }

  state.currentIndex += 1;
  renderQuestion();
  state.isAdvancing = false;
}

function onNext() {
  void goNextQuestion();
}

entryForm.addEventListener('input', () => {
  const value = document.getElementById('studentName').value.trim();
  startBtn.disabled = value.length < 2;
});

entryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('studentName').value.trim();
  if (name.length < 2) {
    return;
  }

  state.studentName = name;
  startQuiz();
});

nextBtn.addEventListener('click', onNext);

init().catch((error) => {
  console.error(error);
  courseInfo.textContent = 'เริ่มแบบทดสอบไม่สำเร็จ';
});
