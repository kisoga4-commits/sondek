import {
  getAllCourses,
  replaceQuestionsForCourse,
  saveCourse,
  saveProfile,
  subscribeProfile,
} from './db.js';
import { DEFAULT_DRAW_COUNT, normalizeQuestion } from './quiz.js';

const quizForm = document.getElementById('quizForm');
const questionType = document.getElementById('questionType');
const questionText = document.getElementById('questionText');
const addQuestionBtn = document.getElementById('addQuestionBtn');
const questionList = document.getElementById('questionList');
const savedResult = document.getElementById('savedResult');
const quizLink = document.getElementById('quizLink');
const qrImage = document.getElementById('qrImage');
const profileForm = document.getElementById('profileForm');
const quizLibrary = document.getElementById('quizLibrary');
const drawCountInput = document.getElementById('drawCount');

const typeBlocks = {
  true_false: document.getElementById('typeTrueFalse'),
  multiple_choice: document.getElementById('typeMultipleChoice'),
  ordering: document.getElementById('typeOrdering'),
};

const draftQuestions = [];

function switchQuestionTemplate(type) {
  Object.entries(typeBlocks).forEach(([key, node]) => {
    node.classList.toggle('hidden', key !== type);
  });
}

function getQuizLink(courseId) {
  return `${window.location.origin}/quiz.html?id=${encodeURIComponent(courseId)}`;
}

async function copyLink(link) {
  try {
    await navigator.clipboard.writeText(link);
    alert('คัดลอกลิงก์บททดสอบแล้ว');
  } catch (error) {
    console.error(error);
    alert('คัดลอกไม่สำเร็จ กรุณาคัดลอกจากช่องลิงก์');
  }
}

async function refreshQuizLibrary() {
  const courses = await getAllCourses();
  quizLibrary.innerHTML = '';

  if (!courses.length) {
    quizLibrary.innerHTML = '<p class="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">ยังไม่มีบททดสอบในระบบ</p>';
    return;
  }

  courses.forEach((course) => {
    const card = document.createElement('article');
    card.className = 'rounded-2xl border-2 border-slate-200 bg-gradient-to-r from-white to-fuchsia-50 p-4';

    const heading = document.createElement('h3');
    heading.className = 'text-lg font-bold text-indigo-700';
    heading.textContent = course.title || course.courseId;

    const sub = document.createElement('p');
    sub.className = 'text-xs text-slate-500';
    sub.textContent = course.courseId;

    const controls = document.createElement('div');
    controls.className = 'mt-3 rounded-xl bg-white p-3';

    const drawCount = Math.max(1, Number(course.drawCount || DEFAULT_DRAW_COUNT));
    controls.innerHTML = `
      <label class="text-sm font-semibold">Questions to draw per attempt
        <input type="number" min="1" value="${drawCount}" class="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 draw-count-input" />
      </label>
    `;

    const drawCountField = controls.querySelector('.draw-count-input');

    const btnRow = document.createElement('div');
    btnRow.className = 'mt-3 grid gap-2 md:grid-cols-3';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white';
    saveBtn.textContent = 'บันทึกการตั้งค่า';
    saveBtn.addEventListener('click', async () => {
      await saveCourse({
        courseId: course.courseId,
        title: course.title,
        description: course.description || '',
        status: course.status || 'open',
        enrollmentUrl: course.enrollmentUrl || '',
        quizLink: getQuizLink(course.courseId),
        drawCount: Math.max(1, Number(drawCountField.value) || DEFAULT_DRAW_COUNT),
      });
      alert('บันทึกการตั้งค่าเรียบร้อย');
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'rounded-xl bg-fuchsia-600 px-4 py-3 text-sm font-bold text-white';
    copyBtn.textContent = 'คัดลอกลิงก์บททดสอบ';
    copyBtn.addEventListener('click', () => copyLink(getQuizLink(course.courseId)));

    const openBtn = document.createElement('a');
    openBtn.className = 'rounded-xl bg-cyan-500 px-4 py-3 text-center text-sm font-bold text-white';
    openBtn.href = getQuizLink(course.courseId);
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    openBtn.textContent = 'เปิดหน้า Quiz';

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(copyBtn);
    btnRow.appendChild(openBtn);

    card.appendChild(heading);
    card.appendChild(sub);
    card.appendChild(controls);
    card.appendChild(btnRow);
    quizLibrary.appendChild(card);
  });
}

function renderQuestions() {
  questionList.innerHTML = '';
  if (!draftQuestions.length) {
    questionList.innerHTML = '<li class="list-none text-slate-500">No questions yet.</li>';
    return;
  }

  draftQuestions.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2';
    li.textContent = `[${item.type}] ${item.question} • ${item.timeLimitSeconds}s • ${item.points} pts`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ml-2 rounded bg-rose-500 px-2 py-1 text-xs text-white';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      draftQuestions.splice(index, 1);
      renderQuestions();
    });

    li.appendChild(removeBtn);
    questionList.appendChild(li);
  });
}

function buildQuestionPayload() {
  const type = questionType.value;
  const base = {
    type,
    question: questionText.value.trim(),
    timeLimitSeconds: Number(document.getElementById('questionTimeLimit').value),
    points: Number(document.getElementById('questionPoints').value),
    mediaUrl: document.getElementById('questionMediaUrl').value.trim(),
  };

  if (!base.question) {
    alert('Please enter question text.');
    return null;
  }

  if (type === 'true_false') {
    return normalizeQuestion({
      ...base,
      answerIndex: Number(document.getElementById('tfAnswer').value),
    });
  }

  if (type === 'multiple_choice') {
    const choices = ['mcA', 'mcB', 'mcC', 'mcD'].map((id) => document.getElementById(id).value.trim());
    if (choices.some((item) => !item)) {
      alert('Please fill all 4 choices.');
      return null;
    }

    return normalizeQuestion({
      ...base,
      choices,
      answerIndex: Number(document.getElementById('mcAnswer').value),
    });
  }

  const orderingItems = document
    .getElementById('orderingItems')
    .value.split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  if (orderingItems.length < 2) {
    alert('Ordering question needs at least 2 items.');
    return null;
  }

  return normalizeQuestion({
    ...base,
    orderingItems,
  });
}

function resetQuestionForm() {
  questionText.value = '';
  ['mcA', 'mcB', 'mcC', 'mcD', 'orderingItems', 'questionMediaUrl'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('questionTimeLimit').value = '30';
  document.getElementById('questionPoints').value = '1000';
  document.getElementById('mcAnswer').value = '0';
  document.getElementById('tfAnswer').value = '0';
}

function buildQrCodeUrl(link) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`;
}

function createQuizId() {
  return `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

questionType.addEventListener('change', (event) => switchQuestionTemplate(event.target.value));

addQuestionBtn.addEventListener('click', () => {
  const payload = buildQuestionPayload();
  if (!payload) return;
  draftQuestions.push(payload);
  renderQuestions();
  resetQuestionForm();
});

quizForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!draftQuestions.length) {
    alert('Please add at least one question.');
    return;
  }

  const courseId = createQuizId();
  const title = document.getElementById('quizTitle').value.trim();
  const description = document.getElementById('quizDescription').value.trim();
  const enrollmentUrl = document.getElementById('enrollmentUrl').value.trim();
  const link = getQuizLink(courseId);

  await saveCourse({
    courseId,
    title,
    description,
    status: 'open',
    enrollmentUrl,
    quizLink: link,
    drawCount: Math.max(1, Number(drawCountInput.value) || DEFAULT_DRAW_COUNT),
  });

  await replaceQuestionsForCourse(courseId, draftQuestions);

  quizLink.href = link;
  quizLink.textContent = link;
  qrImage.src = buildQrCodeUrl(link);
  savedResult.classList.remove('hidden');

  draftQuestions.splice(0, draftQuestions.length);
  renderQuestions();
  quizForm.reset();
  drawCountInput.value = String(DEFAULT_DRAW_COUNT);
  switchQuestionTemplate('multiple_choice');
  await refreshQuizLibrary();
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  await saveProfile({
    name: document.getElementById('profileName').value.trim(),
    bio: document.getElementById('profileBio').value.trim(),
    imageUrl: document.getElementById('profileImageUrl').value.trim(),
    profileUrl: document.getElementById('profileUrl').value.trim(),
  });

  alert('Profile saved');
});

subscribeProfile((profile) => {
  if (!profile) return;
  document.getElementById('profileName').value = profile.name || '';
  document.getElementById('profileBio').value = profile.bio || '';
  document.getElementById('profileImageUrl').value = profile.imageUrl || '';
  document.getElementById('profileUrl').value = profile.profileUrl || '';
});

switchQuestionTemplate('multiple_choice');
renderQuestions();
refreshQuizLibrary().catch((error) => {
  console.error(error);
  quizLibrary.innerHTML = '<p class="rounded-xl bg-rose-50 p-3 text-sm text-rose-600">โหลดรายการควิซไม่สำเร็จ</p>';
});
