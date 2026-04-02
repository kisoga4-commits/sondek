import { replaceQuestionsForCourse, saveCourse, saveProfile, subscribeProfile } from './db.js';

const quizForm = document.getElementById('quizForm');
const questionType = document.getElementById('questionType');
const questionText = document.getElementById('questionText');
const addQuestionBtn = document.getElementById('addQuestionBtn');
const questionList = document.getElementById('questionList');
const savedResult = document.getElementById('savedResult');
const quizLink = document.getElementById('quizLink');
const qrImage = document.getElementById('qrImage');
const profileForm = document.getElementById('profileForm');

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

function renderQuestions() {
  questionList.innerHTML = '';
  if (!draftQuestions.length) {
    questionList.innerHTML = '<li class="list-none text-slate-500">No questions yet.</li>';
    return;
  }

  draftQuestions.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2';
    li.textContent = `[${item.type}] ${item.question}`;

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
  const question = questionText.value.trim();
  if (!question) {
    alert('Please enter question text.');
    return null;
  }

  if (type === 'true_false') {
    return {
      type,
      question,
      choices: ['True', 'False'],
      answerIndex: Number(document.getElementById('tfAnswer').value),
    };
  }

  if (type === 'multiple_choice') {
    const choices = ['mcA', 'mcB', 'mcC', 'mcD'].map((id) => document.getElementById(id).value.trim());
    if (choices.some((item) => !item)) {
      alert('Please fill all 4 choices.');
      return null;
    }
    return {
      type,
      question,
      choices,
      answerIndex: Number(document.getElementById('mcAnswer').value),
    };
  }

  const orderingItems = document
    .getElementById('orderingItems')
    .value.split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  if (orderingItems.length < 3) {
    alert('Ordering question needs at least 3 lines.');
    return null;
  }

  return {
    type,
    question,
    orderingItems,
  };
}

function resetQuestionForm() {
  questionText.value = '';
  ['mcA', 'mcB', 'mcC', 'mcD', 'orderingItems'].forEach((id) => {
    document.getElementById(id).value = '';
  });
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
  const link = `${window.location.origin}/quiz.html?id=${courseId}`;

  await saveCourse({
    courseId,
    title,
    description,
    status: 'open',
    enrollmentUrl,
    quizLink: link,
  });

  await replaceQuestionsForCourse(courseId, draftQuestions);

  quizLink.href = link;
  quizLink.textContent = link;
  qrImage.src = buildQrCodeUrl(link);
  savedResult.classList.remove('hidden');

  draftQuestions.splice(0, draftQuestions.length);
  renderQuestions();
  quizForm.reset();
  switchQuestionTemplate('true_false');
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

switchQuestionTemplate('true_false');
renderQuestions();
