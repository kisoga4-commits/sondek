import { getCourse, getLeaderboard, getProfile, getQuestionsByCourse, saveLead } from './db.js';
import { calculateScore, getResultMessage, pickRandomQuestions, shuffleArray } from './quiz.js';

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
};

function getQuestionType(question) {
  return question?.type || 'multiple_choice';
}

function isCurrentQuestionAnswered() {
  const question = state.quizQuestions[state.currentIndex];
  const answer = state.answers[state.currentIndex];
  if (!question) return false;
  if (getQuestionType(question) === 'ordering') {
    return Array.isArray(answer) && answer.length === (question.orderingItems || []).length;
  }
  return answer !== undefined;
}

async function init() {
  if (!courseId) {
    courseInfo.textContent = 'Missing quiz id in URL, example: quiz.html?id=quiz_xxx';
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
    state.allQuestions = questions;

    if (!course || !questions.length) {
      courseInfo.textContent = `Quiz not found: ${courseId}`;
      return;
    }

    quizTitle.textContent = course.title || 'Dynamic Quiz';
    quizDescription.textContent = course.description || 'Answer 10 random questions.';
    courseInfo.textContent = `Questions available: ${questions.length} (session uses random 10)`;

    profileCta.href = profile?.profileUrl || '#';
    enrollCta.href = course.enrollmentUrl || '#';
    startBtn.disabled = false;
  } catch (error) {
    console.error(error);
    courseInfo.textContent = 'Load failed. Please refresh.';
  }
}

function renderChoiceQuestion(question, questionIndex) {
  const shuffledChoices = question.choices || [];

  shuffledChoices.forEach((choiceText, idx) => {
    const label = document.createElement('label');
    label.className = 'flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-lg transition hover:border-indigo-300';

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
  const question = state.quizQuestions[state.currentIndex];
  const questionNo = state.currentIndex + 1;
  questionTitle.textContent = `${questionNo}. ${question.question}`;

  choicesWrap.innerHTML = '';

  if (getQuestionType(question) === 'ordering') {
    renderOrderingQuestion(question, state.currentIndex);
  } else {
    renderChoiceQuestion(question, state.currentIndex);
  }

  nextBtn.disabled = !isCurrentQuestionAnswered();
  nextBtn.textContent = questionNo === state.quizQuestions.length ? 'Show Result' : 'Next';
  progressText.textContent = `Question ${questionNo}/${state.quizQuestions.length}`;
  scoreText.textContent = `Answered ${Object.keys(state.answers).length}`;
  progressFill.style.width = `${(questionNo / state.quizQuestions.length) * 100}%`;
}

function startQuiz() {
  state.quizQuestions = pickRandomQuestions(state.allQuestions, 10);
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
    leaderboardList.innerHTML = '<li class="text-slate-500">No attempts yet</li>';
    return;
  }

  leaders.forEach((lead) => {
    const li = document.createElement('li');
    li.textContent = `${lead.name || '-'} — ${lead.scorePercent || 0}% (${lead.durationSeconds || 0}s)`;
    leaderboardList.appendChild(li);
  });
}

async function showResult() {
  quizSection.classList.add('hidden');
  resultSection.classList.remove('hidden');

  const score = calculateScore(state.quizQuestions, state.answers);
  resultScore.textContent = `${score.correct}/${score.total} (${score.percent}%)`;
  resultMessage.textContent = getResultMessage(score.percent);

  const durationSeconds = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));

  await saveLead({
    courseId,
    name: state.studentName,
    scorePercent: score.percent,
    correct: score.correct,
    total: score.total,
    durationSeconds,
  });

  await renderLeaderboard();
}

function onNext() {
  if (state.currentIndex + 1 >= state.quizQuestions.length) {
    void showResult();
    return;
  }
  state.currentIndex += 1;
  renderQuestion();
}

entryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.studentName = document.getElementById('studentName').value.trim();
  startQuiz();
});

nextBtn.addEventListener('click', onNext);

init();
