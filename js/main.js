import {
  getCourse,
  getLeaderboard,
  getPlayCountByCourse,
  getProfile,
  getQuestionsByCourse,
  getResultFeedbackConfig,
  saveLead,
} from './db.js';
import {
  calculateScore,
  DEFAULT_DRAW_COUNT,
  getQuestionType,
  getResultFeedback,
  getResultFeedbackWithConfig,
  getScoreRangeLabel,
  normalizeQuestion,
  pickRandomQuestions,
  shuffleArray,
} from './quiz.js';

const params = new URLSearchParams(window.location.search);
const courseId = params.get('id') || params.get('courseId') || params.get('course') || '';

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
const playCountInfo = document.getElementById('playCountInfo');
const resultScore = document.getElementById('resultScore');
const resultMessage = document.getElementById('resultMessage');
const leaderboardList = document.getElementById('leaderboardList');
const profileCta = document.getElementById('profileCta');
const enrollCta = document.getElementById('enrollCta');
const homeCourseCta = document.getElementById('homeCourseCta');
const quizTitle = document.getElementById('quizTitle');
const quizDescription = document.getElementById('quizDescription');
const timerFill = document.getElementById('timerFill');
const timerText = document.getElementById('timerText');
const questionMeta = document.getElementById('questionMeta');
const questionMedia = document.getElementById('questionMedia');
const answerReview = document.getElementById('answerReview');
const openTopWindow = document.getElementById('openTopWindow');
const top5Modal = document.getElementById('top5Modal');
const closeTop5Modal = document.getElementById('closeTop5Modal');
const soundToggle = document.getElementById('soundToggle');
const feedbackModal = document.getElementById('feedbackModal');
const feedbackModalLine = document.getElementById('feedbackModalLine');
const feedbackModalNotice = document.getElementById('feedbackModalNotice');
const openHomeHubBtn = document.getElementById('openHomeHubBtn');
const homeHubModal = document.getElementById('homeHubModal');
const closeHomeHubBtn = document.getElementById('closeHomeHubBtn');
const homeHubHomeLink = document.getElementById('homeHubHomeLink');
const homeHubQuizLink = document.getElementById('homeHubQuizLink');
const homeHubTopLink = document.getElementById('homeHubTopLink');
const homeHubProfileLink = document.getElementById('homeHubProfileLink');

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
  audioEnabled: true,
  lowTimeAlertPlayed: false,
  audioContext: null,
  feedbackByBucket: null,
};

const LOW_TIME_ALERT_SECONDS = 5;
const FEEDBACK_MODAL_DURATION_MS = 5000;

function getBasePathUrl(pathname) {
  const basePath = pathname.includes('/')
    ? pathname.slice(0, pathname.lastIndexOf('/') + 1)
    : '/';
  return `${window.location.origin}${basePath}`;
}

function ensureAudioContext() {
  if (state.audioContext) {
    return state.audioContext;
  }

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  state.audioContext = new Ctx();
  return state.audioContext;
}

function playBeep({ frequency = 880, duration = 0.12, type = 'sine', gain = 0.08 } = {}) {
  if (!state.audioEnabled) return;
  const context = ensureAudioContext();
  if (!context) return;

  if (context.state === 'suspended') {
    void context.resume();
  }

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gainNode.gain.value = gain;

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  const now = context.currentTime;
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function clearTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function speakFeedbackLine(text) {
  return new Promise((resolve) => {
    if (!state.audioEnabled || !('speechSynthesis' in window)) {
      resolve();
      return;
    }

    const line = String(text || '').trim();
    if (!line) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(line);
    utterance.lang = 'th-TH';
    utterance.volume = 1;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

function pickRandomLine(lines, fallback = '') {
  const cleanLines = Array.isArray(lines)
    ? lines.map((line) => String(line || '').trim()).filter(Boolean)
    : [];
  if (!cleanLines.length) {
    return String(fallback || '').trim();
  }
  const randomIndex = Math.floor(Math.random() * cleanLines.length);
  return cleanLines[randomIndex];
}

function getFeedbackIcon(percent) {
  if (percent >= 80) return '🏆';
  if (percent >= 50) return '👏';
  return '🔥';
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

  if (state.timeLeft > 0 && state.timeLeft <= LOW_TIME_ALERT_SECONDS && !state.lowTimeAlertPlayed) {
    state.lowTimeAlertPlayed = true;
    playBeep({ frequency: 540, duration: 0.3, type: 'square', gain: 0.12 });
    window.setTimeout(() => playBeep({ frequency: 720, duration: 0.22, type: 'square', gain: 0.12 }), 180);
  }
}

function jumpNextByTimeout() {
  clearTimer();
  timerText.textContent = 'หมดเวลา';
  timerFill.style.width = '0%';
  void goNextQuestion();
}

function startQuestionTimer(question) {
  clearTimer();
  state.timeLeft = question.timeLimitSeconds;
  state.lowTimeAlertPlayed = false;
  refreshTimerUi(question);

  state.timerId = window.setInterval(() => {
    state.timeLeft -= 1;
    refreshTimerUi(question);

    if (state.timeLeft <= 0) {
      jumpNextByTimeout();
    }
  }, 1000);
}

function getQuestionTypeLabel(type) {
  if (type === 'multiple_choice') return 'เลือกคำตอบ';
  if (type === 'true_false') return 'จริง/เท็จ';
  if (type === 'short_text') return 'พิมพ์คำตอบ';
  if (type === 'ordering') return 'เรียงลำดับ';
  return 'คำถาม';
}

async function init() {
  const baseUrl = getBasePathUrl(window.location.pathname);
  if (homeHubHomeLink) homeHubHomeLink.href = `${baseUrl}index.html`;
  if (homeHubQuizLink) homeHubQuizLink.href = courseId
    ? `${baseUrl}quiz.html?id=${encodeURIComponent(courseId)}`
    : `${baseUrl}quiz.html`;
  if (homeHubTopLink) homeHubTopLink.href = courseId
    ? `${baseUrl}top.html?id=${encodeURIComponent(courseId)}`
    : `${baseUrl}top.html`;
  if (homeHubProfileLink) homeHubProfileLink.href = `${baseUrl}profile.html`;

  profileCta.href = courseId
    ? `${baseUrl}profile.html?id=${encodeURIComponent(courseId)}`
    : `${baseUrl}profile.html`;
  enrollCta.href = `${baseUrl}courses.html`;
  if (homeCourseCta) homeCourseCta.href = `${baseUrl}courses.html`;

  if (!courseId) {
    courseInfo.textContent = 'ไม่พบรหัสแบบทดสอบในลิงก์ ตัวอย่าง: quiz.html?id=quiz_xxx';
    playCountInfo.textContent = 'ไม่พบข้อมูลจำนวนผู้เล่น';
    return;
  }

  try {
    const [course, questions, playCount] = await Promise.all([
      getCourse(courseId),
      getQuestionsByCourse(courseId),
      getPlayCountByCourse(courseId),
    ]);

    const optionalResults = await Promise.allSettled([
      getProfile(),
      getResultFeedbackConfig(),
    ]);

    const profile = optionalResults[0].status === 'fulfilled' ? optionalResults[0].value : null;
    const feedbackConfig = optionalResults[1].status === 'fulfilled' ? optionalResults[1].value : null;

    if (optionalResults[0].status === 'rejected') {
      console.warn('โหลดโปรไฟล์ไม่สำเร็จ ใช้ค่าเริ่มต้นแทน', optionalResults[0].reason);
    }
    if (optionalResults[1].status === 'rejected') {
      console.warn('โหลด config ข้อความผลคะแนนไม่สำเร็จ ใช้ค่าเริ่มต้นแทน', optionalResults[1].reason);
    }

    state.course = course;
    state.profile = profile;
    state.feedbackByBucket = feedbackConfig?.feedbackByBucket || null;
    state.allQuestions = (questions || []).map((question) => normalizeQuestion(question));

    if (!course || course.status === 'deleted' || !questions.length) {
      courseInfo.textContent = `ไม่พบแบบทดสอบ: ${courseId}`;
      playCountInfo.textContent = 'ไม่พบข้อมูลจำนวนผู้เล่น';
      return;
    }

    state.drawCount = Math.max(1, Number(course.drawCount || course.questionCount || DEFAULT_DRAW_COUNT));

    quizTitle.textContent = course.title || 'แบบทดสอบ';
    quizDescription.textContent = course.description || 'ตอบคำถามให้ครบ แล้วไปดูอันดับ TOP';
    courseInfo.textContent = `คลังคำถาม ${state.allQuestions.length} ข้อ | สุ่มต่อครั้ง ${Math.min(state.drawCount, state.allQuestions.length)} ข้อ`;
    playCountInfo.textContent = `มีผู้เล่นทำแบบทดสอบนี้แล้ว ${Number(playCount || 0).toLocaleString('th-TH')} ครั้ง`;

    profileCta.href = `${baseUrl}profile.html?id=${encodeURIComponent(courseId)}`;
    enrollCta.href = `${baseUrl}courses.html`;
    startBtn.disabled = false;
  } catch (error) {
    console.error(error);
    courseInfo.textContent = 'โหลดไม่สำเร็จ กรุณารีเฟรชอีกครั้ง';
    playCountInfo.textContent = 'ไม่สามารถโหลดจำนวนผู้เล่นได้ในขณะนี้';
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
      playBeep({ frequency: 920, duration: 0.08, gain: 0.05 });
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
      playBeep({ frequency: 860, duration: 0.07, gain: 0.04 });
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
  questionMeta.textContent = `${question.points} คะแนน • ${question.timeLimitSeconds} วินาที • ${getQuestionTypeLabel(question.type)}`;

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

  leaders.forEach((lead, index) => {
    const li = document.createElement('li');
    const rankBadge = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
    li.className = 'flex items-center gap-3 rounded-xl bg-white px-3 py-2';
    li.innerHTML = `
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-xl">${rankBadge}</div>
      <div>
        <p class="font-semibold">${lead.name || '-'}</p>
        <p class="text-sm text-slate-600">${lead.scorePercent || 0}/100 • ${lead.durationSeconds || 0}s</p>
      </div>
    `;
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
  resultSection.classList.add('hidden');

  const score = calculateScore(state.quizQuestions, state.answers);
  const feedback = state.feedbackByBucket
    ? getResultFeedbackWithConfig(score.percent, state.feedbackByBucket)
    : getResultFeedback(score.percent);
  const firstLine = pickRandomLine(feedback.lines, feedback.title);
  const feedbackIcon = getFeedbackIcon(score.percent);
  if (feedbackModal && feedbackModalLine && feedbackModalNotice) {
    feedbackModalLine.textContent = `${feedbackIcon} ${firstLine}`;
    feedbackModalNotice.textContent = '🔊 เช็กเสียงด่า/อวยพรให้ดังพอดี';
    feedbackModal.classList.remove('hidden');
    feedbackModal.classList.add('flex');
  }

  await Promise.all([
    speakFeedbackLine(firstLine),
    wait(FEEDBACK_MODAL_DURATION_MS),
  ]);

  if (feedbackModal) {
    feedbackModal.classList.add('hidden');
    feedbackModal.classList.remove('flex');
  }

  resultSection.classList.remove('hidden');
  resultScore.textContent = `คะแนน ${score.percent}% • ถูก ${score.correct}/${score.total} ข้อ`;
  resultMessage.textContent = `${feedbackIcon} ${firstLine}`;
  renderAnswerReview(score);

  const durationSeconds = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));

  try {
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
  } catch (error) {
    console.error('saveLead failed', error);
    const errorCode = String(error?.code || '');
    const errorMessage = String(error?.message || '');
    const isPermissionIssue = errorCode.includes('permission-denied')
      || errorMessage.includes('Missing or insufficient permissions');
    const isAuthIssue = errorCode.includes('auth/not-authenticated');

    if (isPermissionIssue || isAuthIssue) {
      resultMessage.textContent = `${resultMessage.textContent} (ระบบไม่สามารถบันทึกอันดับได้ในตอนนี้ แต่คะแนนของคุณแสดงครบแล้ว)`;
    }
  }

  try {
    await renderLeaderboard();
  } catch (error) {
    console.error('renderLeaderboard failed', error);
    leaderboardList.innerHTML = '<li class="text-slate-500">ไม่สามารถโหลดอันดับได้ในขณะนี้</li>';
  }

}

async function goNextQuestion() {
  if (state.isAdvancing) return;
  if (state.timeLeft > 0 && !isCurrentQuestionAnswered()) return;
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
  if (nextBtn.disabled) {
    return;
  }
  void goNextQuestion();
}

entryForm.addEventListener('input', () => {
  const value = document.getElementById('studentName').value.trim();
  startBtn.disabled = value.length < 1;
});

entryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('studentName').value.trim();
  if (name.length < 1) {
    return;
  }

  state.studentName = name;
  const context = ensureAudioContext();
  if (context && context.state === 'suspended') {
    void context.resume();
  }
  startQuiz();
});

nextBtn.addEventListener('click', onNext);

if (openTopWindow && top5Modal) {
  openTopWindow.addEventListener('click', () => {
    top5Modal.classList.remove('hidden');
    top5Modal.classList.add('flex');
  });
}

if (closeTop5Modal && top5Modal) {
  closeTop5Modal.addEventListener('click', () => {
    top5Modal.classList.add('hidden');
    top5Modal.classList.remove('flex');
  });
}

if (top5Modal) {
  top5Modal.addEventListener('click', (event) => {
    if (event.target === top5Modal) {
      top5Modal.classList.add('hidden');
      top5Modal.classList.remove('flex');
    }
  });
}

if (soundToggle) {
  soundToggle.addEventListener('change', () => {
    state.audioEnabled = Boolean(soundToggle.checked);
  });
}

if (openHomeHubBtn && homeHubModal) {
  openHomeHubBtn.addEventListener('click', () => {
    homeHubModal.classList.remove('hidden');
    homeHubModal.classList.add('flex');
  });
}

if (closeHomeHubBtn && homeHubModal) {
  closeHomeHubBtn.addEventListener('click', () => {
    homeHubModal.classList.add('hidden');
    homeHubModal.classList.remove('flex');
  });
}

if (homeHubModal) {
  homeHubModal.addEventListener('click', (event) => {
    if (event.target === homeHubModal) {
      homeHubModal.classList.add('hidden');
      homeHubModal.classList.remove('flex');
    }
  });
}

init().catch((error) => {
  console.error(error);
  courseInfo.textContent = 'เริ่มแบบทดสอบไม่สำเร็จ';
});
