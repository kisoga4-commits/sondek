import { getCourse, getLeaderboard, getProfile, getQuestionsByCourse, saveLead } from './db.js';
import { calculateScore, getResultMessage, maskPhone, pickRandomQuestions, shuffleArray } from './quiz.js';

const params = new URLSearchParams(window.location.search);
const courseId = params.get('id') || 'course_01';

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
const ringProgress = document.getElementById('ringProgress');
const profileCta = document.getElementById('profileCta');
const enrollCta = document.getElementById('enrollCta');

const state = {
  course: null,
  profile: null,
  allQuestions: [],
  quizQuestions: [],
  currentIndex: 0,
  answers: {},
  startedAt: null,
  score: null,
  leadName: '',
  leadPhone: '',
  orderingView: {},
};

function getQuestionType(question) {
  return question?.type || 'multiple_choice';
}

function getQuestionByIndex(index) {
  return state.quizQuestions[index];
}

function isCurrentQuestionAnswered() {
  const question = getQuestionByIndex(state.currentIndex);
  if (!question) {
    return false;
  }

  const type = getQuestionType(question);
  const answer = state.answers[state.currentIndex];

  if (type === 'ordering') {
    return Array.isArray(answer) && answer.length === (question.orderingItems || []).length;
  }

  return answer !== undefined;
}

async function init() {
  try {
    const [course, questions, profile] = await Promise.all([
      getCourse(courseId),
      getQuestionsByCourse(courseId),
      getProfile(),
    ]);

    state.course = course;
    state.profile = profile;
    state.allQuestions = questions;

    if (!course || questions.length === 0) {
      courseInfo.textContent = `ไม่พบคอร์ส ${courseId} หรือยังไม่มีข้อสอบ`;
      return;
    }

    startBtn.disabled = false;
    courseInfo.textContent = `คอร์ส: ${course.title || course.courseId} | สุ่ม 10 จาก ${questions.length} ข้อ`;

    profileCta.href = profile?.profileUrl || '#';
    enrollCta.href = course.quizLink || `${window.location.origin}/quiz.html?id=${courseId}`;
  } catch (error) {
    console.error(error);
    courseInfo.textContent = 'เกิดข้อผิดพลาดในการโหลดข้อมูล';
  }
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

function renderChoiceQuestion(question, questionIndex) {
  question.choices.forEach((choiceText, idx) => {
    const label = document.createElement('label');
    label.className = 'choice';
    label.innerHTML = `<input type="radio" name="choice" value="${idx}" ${Number(state.answers[questionIndex]) === idx ? 'checked' : ''} /> <span>${choiceText}</span>`;
    label.querySelector('input').addEventListener('change', () => {
      state.answers[questionIndex] = idx;
      nextBtn.disabled = false;
    });
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

  const rowWrap = document.createElement('div');
  rowWrap.className = 'ordering-wrap';

  view.shuffledItems.forEach((item) => {
    const row = document.createElement('label');
    row.className = 'ordering-row';

    const select = document.createElement('select');
    select.innerHTML = `<option value="">ลำดับ?</option>${view.shuffledItems
      .map((_, idx) => `<option value="${idx + 1}">${idx + 1}</option>`)
      .join('')}`;

    const selectedOrder = answer.indexOf(item);
    if (selectedOrder >= 0) {
      select.value = String(selectedOrder + 1);
    }

    select.addEventListener('change', () => {
      const pickedOrder = Number(select.value);
      const currentAnswer = [...(state.answers[questionIndex] || [])];
      const existingOrder = currentAnswer.indexOf(item);

      if (existingOrder >= 0) {
        currentAnswer[existingOrder] = undefined;
      }

      if (pickedOrder > 0) {
        currentAnswer[pickedOrder - 1] = item;
      }

      state.answers[questionIndex] = currentAnswer.filter(Boolean);
      nextBtn.disabled = !isCurrentQuestionAnswered();
      renderQuestion();
    });

    const text = document.createElement('span');
    text.textContent = item;

    row.appendChild(select);
    row.appendChild(text);
    rowWrap.appendChild(row);
  });

  choicesWrap.appendChild(rowWrap);
}

function renderQuestion() {
  const q = state.quizQuestions[state.currentIndex];
  const questionNo = state.currentIndex + 1;
  const questionType = getQuestionType(q);

  questionTitle.textContent = `${questionNo}. ${q.question} (${questionType})`;
  choicesWrap.innerHTML = '';

  if (questionType === 'ordering') {
    renderOrderingQuestion(q, state.currentIndex);
  } else {
    renderChoiceQuestion(q, state.currentIndex);
  }

  nextBtn.disabled = !isCurrentQuestionAnswered();
  nextBtn.textContent = questionNo === state.quizQuestions.length ? 'ดูผลลัพธ์' : 'ข้อต่อไป';
  scoreText.textContent = `ตอบแล้ว ${Object.keys(state.answers).length}/${state.quizQuestions.length}`;
  progressText.textContent = `ข้อ ${questionNo}/${state.quizQuestions.length}`;
  progressFill.style.width = `${(questionNo / state.quizQuestions.length) * 100}%`;
}

function goNext() {
  if (state.currentIndex + 1 >= state.quizQuestions.length) {
    void showResult();
    return;
  }
  state.currentIndex += 1;
  renderQuestion();
}

async function showResult() {
  quizSection.classList.add('hidden');
  resultSection.classList.remove('hidden');

  const score = calculateScore(state.quizQuestions, state.answers);
  state.score = score;
  resultScore.textContent = `${score.correct}/${score.total}`;
  resultMessage.textContent = `${getResultMessage(score.percent)} (${score.percent}%)`;

  const circumference = 2 * Math.PI * 52;
  ringProgress.style.strokeDasharray = `${circumference}`;
  ringProgress.style.strokeDashoffset = `${circumference - (score.percent / 100) * circumference}`;

  const durationSeconds = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));
  await saveLead({
    courseId,
    name: state.leadName,
    phone: state.leadPhone,
    scorePercent: score.percent,
    correct: score.correct,
    total: score.total,
    durationSeconds,
  });

  await renderLeaderboard();
}

async function renderLeaderboard() {
  try {
    const leaders = await getLeaderboard(courseId);
    leaderboardList.innerHTML = '';
    if (!leaders.length) {
      leaderboardList.innerHTML = '<li class="muted">ยังไม่มีผู้ทำแบบทดสอบ</li>';
      return;
    }

    leaders.forEach((lead) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${lead.name || '-'}</strong> — ${lead.scorePercent || 0}% — ${maskPhone(lead.phone)} — ${lead.durationSeconds || '-'} วินาที`;
      leaderboardList.appendChild(li);
    });
  } catch (error) {
    console.error(error);
    leaderboardList.innerHTML = '<li class="muted">โหลด leaderboard ไม่สำเร็จ</li>';
  }
}

entryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.leadName = document.getElementById('leadName').value.trim();
  state.leadPhone = document.getElementById('leadPhone').value.trim();
  startQuiz();
});
nextBtn.addEventListener('click', goNext);

init();
