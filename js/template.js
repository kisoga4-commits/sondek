import { replaceQuestionsForCourse, saveCourse } from './db.js';
import { mixedTemplateQuestions } from './questionsSeed.js';

const questionTypeSelect = document.getElementById('questionType');
const questionTextInput = document.getElementById('questionText');
const addQuestionBtn = document.getElementById('addQuestionBtn');
const saveCourseBtn = document.getElementById('saveCourseBtn');
const seedMixedBtn = document.getElementById('seedMixedBtn');
const questionPreview = document.getElementById('questionPreview');
const questionCounter = document.getElementById('questionCounter');

const templateBlocks = {
  multiple_choice: document.getElementById('templateMultipleChoice'),
  true_false: document.getElementById('templateTrueFalse'),
  ordering: document.getElementById('templateOrdering'),
};

const draftQuestions = [];

function switchTemplate(type) {
  Object.entries(templateBlocks).forEach(([key, element]) => {
    element.classList.toggle('hidden', key !== type);
  });
}

function buildQuestionPayload() {
  const type = questionTypeSelect.value;
  const question = questionTextInput.value.trim();

  if (!question) {
    alert('กรอกโจทย์ก่อนเพิ่มคำถาม');
    return null;
  }

  if (type === 'true_false') {
    return {
      type,
      question,
      choices: ['จริง', 'เท็จ'],
      answerIndex: Number(document.getElementById('tfAnswerIndex').value),
    };
  }

  if (type === 'ordering') {
    const orderingItems = document.getElementById('orderingItems').value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

    if (orderingItems.length < 3) {
      alert('คำถามแบบ ordering ต้องมีอย่างน้อย 3 รายการ');
      return null;
    }

    return {
      type,
      question,
      orderingItems,
    };
  }

  const choices = [
    document.getElementById('mcChoiceA').value.trim(),
    document.getElementById('mcChoiceB').value.trim(),
    document.getElementById('mcChoiceC').value.trim(),
    document.getElementById('mcChoiceD').value.trim(),
  ];

  if (choices.some((choice) => !choice)) {
    alert('multiple_choice ต้องกรอกตัวเลือกให้ครบทั้ง 4 ช่อง');
    return null;
  }

  return {
    type,
    question,
    choices,
    answerIndex: Number(document.getElementById('mcAnswerIndex').value),
  };
}

function renderPreview() {
  questionPreview.innerHTML = '';

  if (!draftQuestions.length) {
    questionCounter.textContent = 'ยังไม่มีข้อสอบ';
    return;
  }

  draftQuestions.forEach((item, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="preview-item-main"><strong>ข้อ ${index + 1}</strong> [${item.type}] ${item.question}</div>`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-danger btn-tiny';
    removeBtn.textContent = 'ลบ';
    removeBtn.addEventListener('click', () => {
      draftQuestions.splice(index, 1);
      renderPreview();
    });

    li.appendChild(removeBtn);
    questionPreview.appendChild(li);
  });

  questionCounter.textContent = `สะสมแล้ว ${draftQuestions.length} ข้อ`;
}

function resetQuestionForm() {
  questionTextInput.value = '';
  document.getElementById('mcChoiceA').value = '';
  document.getElementById('mcChoiceB').value = '';
  document.getElementById('mcChoiceC').value = '';
  document.getElementById('mcChoiceD').value = '';
  document.getElementById('orderingItems').value = '';
  document.getElementById('mcAnswerIndex').value = '0';
  document.getElementById('tfAnswerIndex').value = '0';
}

questionTypeSelect.addEventListener('change', (event) => {
  switchTemplate(event.target.value);
});

addQuestionBtn.addEventListener('click', () => {
  const payload = buildQuestionPayload();
  if (!payload) {
    return;
  }

  draftQuestions.push(payload);
  renderPreview();
  resetQuestionForm();
});

seedMixedBtn.addEventListener('click', () => {
  draftQuestions.splice(0, draftQuestions.length, ...mixedTemplateQuestions.map((item) => ({ ...item })));
  renderPreview();
});

saveCourseBtn.addEventListener('click', async () => {
  const courseId = document.getElementById('courseId').value.trim();
  const title = document.getElementById('courseTitle').value.trim();

  if (!courseId || !title) {
    alert('กรอก Course ID และชื่อคอร์สให้ครบ');
    return;
  }

  if (!draftQuestions.length) {
    alert('เพิ่มคำถามอย่างน้อย 1 ข้อก่อนบันทึก');
    return;
  }

  await saveCourse({
    courseId,
    title,
    status: 'open',
    quizLink: `${window.location.origin}/index.html?id=${courseId}`,
  });

  await replaceQuestionsForCourse(courseId, draftQuestions);
  alert(`บันทึกคอร์ส ${courseId} พร้อมคำถาม ${draftQuestions.length} ข้อแล้ว`);
});

switchTemplate(questionTypeSelect.value);
renderPreview();
