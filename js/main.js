import { getCourse, getLeaderboard, getQuestionsByCourse, saveLead } from './db.js';
import { calculateScore, getResultMessage, maskPhone, pickRandomQuestions } from './quiz.js';

const params = new URLSearchParams(window.location.search);
const courseId = params.get('id') || 'course_01';

const startBtn = document.getElementById('startBtn');
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
const leadForm = document.getElementById('leadForm');
const leaderboardList = document.getElementById('leaderboardList');

const tutorPhoto = document.getElementById('tutorPhoto');
const tutorName = document.getElementById('tutorName');
const tutorBio = document.getElementById('tutorBio');

const state = {
  course: null,
  allQuestions: [],
  quizQuestions: [],
  currentIndex: 0,
  answers: {},
  startedAt: null,
  score: null,
};

async function init() {
  try {
    const [course, questions] = await Promise.all([getCourse(courseId), getQuestionsByCourse(courseId)]);

    state.course = course;
    state.allQuestions = questions;

    if (!course || questions.length === 0) {
      courseInfo.textContent = `ไม่พบคอร์ส ${courseId} หรือยังไม่มีข้อสอบ`;
      return;
    }

    courseInfo.textContent = `คอร์ส: ${course.title} (${course.courseId}) | คลังข้อสอบ ${questions.length} ข้อ`;
    startBtn.disabled = false;
    hydrateTutor(course);
  } catch (error) {
    console.error(error);
    courseInfo.textContent = 'เกิดข้อผิดพลาดในการโหลดข้อมูล';
  }
}

function hydrateTutor(course) {
  tutorPhoto.src = course.tutorPhotoUrl;
  tutorName.textContent = course.tutorName;
  tutorBio.textContent = course.tutorBio;
}

function startQuiz() {
  state.quizQuestions = pickRandomQuestions(state.allQuestions, 10);
  state.currentIndex = 0;
  state.answers = {};
  state.startedAt = Date.now();

  introSection.classList.add('hidden');
  quizSection.classList.remove('hidden');

  renderQuestion();
}

function renderQuestion() {
  const q = state.quizQuestions[state.currentIndex];
  const questionNo = state.currentIndex + 1;

  questionTitle.textContent = `${questionNo}. ${q.question}`;
  choicesWrap.innerHTML = '';

  q.choices.forEach((choiceText, idx) => {
    const label = document.createElement('label');
    label.className = 'choice';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'choice';
    input.value = idx;
    input.checked = Number(state.answers[state.currentIndex]) === idx;

    input.addEventListener('change', () => {
      state.answers[state.currentIndex] = idx;
      nextBtn.disabled = false;
    });

    const span = document.createElement('span');
    span.textContent = choiceText;

    label.appendChild(input);
    label.appendChild(span);
    choicesWrap.appendChild(label);
  });

  nextBtn.disabled = state.answers[state.currentIndex] === undefined;
  nextBtn.textContent = questionNo === state.quizQuestions.length ? 'ดูผลลัพธ์' : 'ข้อต่อไป';

  const answeredCount = Object.keys(state.answers).length;
  scoreText.textContent = `ตอบแล้ว ${answeredCount}/${state.quizQuestions.length}`;
  progressText.textContent = `ข้อ ${questionNo}/${state.quizQuestions.length}`;
  progressFill.style.width = `${(questionNo / state.quizQuestions.length) * 100}%`;
}

function goNext() {
  if (state.currentIndex + 1 >= state.quizQuestions.length) {
    showResult();
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

  resultScore.textContent = `คุณทำได้ ${score.correct}/${score.total} (${score.percent}%)`;
  resultMessage.textContent = getResultMessage(score.percent);
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
      li.innerHTML = `<strong>${lead.name}</strong> — ${lead.scorePercent}% — ${maskPhone(
        lead.phone,
      )} — ${lead.durationSeconds || '-'} วินาที`;
      leaderboardList.appendChild(li);
    });
  } catch (error) {
    console.error(error);
    leaderboardList.innerHTML = '<li class="muted">โหลด leaderboard ไม่สำเร็จ</li>';
  }
}

leadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.score) {
    return;
  }

  const name = document.getElementById('leadName').value.trim();
  const phone = document.getElementById('leadPhone').value.trim();
  const durationSeconds = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));

  try {
    await saveLead({
      courseId,
      name,
      phone,
      scorePercent: state.score.percent,
      correct: state.score.correct,
      total: state.score.total,
      durationSeconds,
    });

    leadForm.reset();
    await renderLeaderboard();
    alert('บันทึกข้อมูลเรียบร้อยแล้ว ทีมงานจะติดต่อกลับเร็วที่สุด');
  } catch (error) {
    console.error(error);
    alert('บันทึกข้อมูลไม่สำเร็จ โปรดลองใหม่');
  }
});

startBtn.addEventListener('click', startQuiz);
nextBtn.addEventListener('click', goNext);

init();
