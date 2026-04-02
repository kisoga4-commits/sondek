import {
  getCourse,
  getQuestionsByCourse,
  replaceQuestionsForCourse,
  saveCourse,
} from './db.js';
import { defaultMathQuestions } from './questionsSeed.js';

const MIN_QUESTION_BANK = 10;

const questionAnswerModeEl = document.getElementById('questionAnswerMode');
const questionTypeLabelEl = document.getElementById('questionTypeLabel');
const questionEditor = document.getElementById('questionEditor');
const answerEditor = document.getElementById('answerEditor');
const questionBankList = document.getElementById('questionBankList');
const bankSummary = document.getElementById('bankSummary');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const addOrUpdateBtn = document.getElementById('addOrUpdateBtn');
const sharePanel = document.getElementById('sharePanel');
const quizLinkOutput = document.getElementById('quizLinkOutput');
const qrOutput = document.getElementById('qrOutput');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const seedDefaultBtn = document.getElementById('seedDefaultBtn');
const completeQuizBtn = document.getElementById('completeQuizBtn');
const completionNotice = document.getElementById('completionNotice');

const params = new URLSearchParams(window.location.search);
const editingCourseId = params.get('courseId') || '';

let bankQuestions = [];
let editingIndex = null;

function showAnswerEditor(answerMode, question = null) {
  if (answerMode === 'true_false') {
    const selected = question?.correctAnswer?.value === false ? 'false' : 'true';
    answerEditor.innerHTML = `
      <label>คำตอบที่ถูก
        <select id="tfCorrectAnswer">
          <option value="true" ${selected === 'true' ? 'selected' : ''}>True</option>
          <option value="false" ${selected === 'false' ? 'selected' : ''}>False</option>
        </select>
      </label>
    `;
    return;
  }

  const options = question?.options || ['', '', '', ''];
  const correctKey = question?.correctAnswer?.key || 'A';

  answerEditor.innerHTML = `
    <label>ตัวเลือก A <input id="optionA" type="text" value="${options[0] || ''}" /></label>
    <label>ตัวเลือก B <input id="optionB" type="text" value="${options[1] || ''}" /></label>
    <label>ตัวเลือก C <input id="optionC" type="text" value="${options[2] || ''}" /></label>
    <label>ตัวเลือก D <input id="optionD" type="text" value="${options[3] || ''}" /></label>
    <label>คำตอบที่ถูก
      <select id="mcCorrectAnswer">
        <option value="A" ${correctKey === 'A' ? 'selected' : ''}>A</option>
        <option value="B" ${correctKey === 'B' ? 'selected' : ''}>B</option>
        <option value="C" ${correctKey === 'C' ? 'selected' : ''}>C</option>
        <option value="D" ${correctKey === 'D' ? 'selected' : ''}>D</option>
      </select>
    </label>
  `;
}

function buildQuestionPayloadFromEditor() {
  const questionText = document.getElementById('questionText').value.trim();
  const questionTypeLabel = questionTypeLabelEl.value.trim();
  const answerMode = questionAnswerModeEl.value;
  const timeLimitSeconds = Math.max(5, Number(document.getElementById('questionTimeLimit').value) || 30);
  const points = Math.max(1, Number(document.getElementById('questionPoints').value) || 10);

  if (!questionText || !questionTypeLabel) {
    alert('กรุณากรอกโจทย์และประเภทคำถาม');
    return null;
  }

  const base = { questionText, questionTypeLabel, answerMode, timeLimitSeconds, points };

  if (answerMode === 'true_false') {
    return {
      ...base,
      options: ['True', 'False'],
      correctAnswer: { value: document.getElementById('tfCorrectAnswer').value === 'true' },
    };
  }

  const options = [
    document.getElementById('optionA').value.trim(),
    document.getElementById('optionB').value.trim(),
    document.getElementById('optionC').value.trim(),
    document.getElementById('optionD').value.trim(),
  ];

  if (options.some((item) => !item)) {
    alert('คำถามตัวเลือกต้องมีตัวเลือกครบ A-D');
    return null;
  }

  return {
    ...base,
    options,
    correctAnswer: { key: document.getElementById('mcCorrectAnswer').value },
  };
}

function resetEditor() {
  editingIndex = null;
  addOrUpdateBtn.textContent = 'ถัดไป (Next)';
  cancelEditBtn.classList.add('hidden');
  questionEditor.reset();
  questionTypeLabelEl.value = 'คณิตศาสตร์พื้นฐาน';
  document.getElementById('questionTimeLimit').value = '30';
  document.getElementById('questionPoints').value = '10';
  questionAnswerModeEl.value = 'multiple_choice';
  showAnswerEditor('multiple_choice');
}

function renderQuestionBank() {
  questionBankList.innerHTML = '';

  if (!bankQuestions.length) {
    bankSummary.textContent = `ยังไม่มีคำถาม (ขั้นต่ำ ${MIN_QUESTION_BANK} ข้อ)`;
    return;
  }

  bankSummary.textContent = `มีคำถามแล้ว ${bankQuestions.length} ข้อ (ขั้นต่ำ ${MIN_QUESTION_BANK} ข้อก่อนบันทึก)`;

  bankQuestions.forEach((question, index) => {
    const li = document.createElement('li');
    const correctDisplay = question.answerMode === 'true_false'
      ? String(question.correctAnswer.value)
      : question.correctAnswer.key;

    li.innerHTML = `<div class="preview-item-main"><strong>ข้อ ${index + 1}</strong> [${question.questionTypeLabel}] ${question.questionText}<div class="muted">เฉลย: ${correctDisplay} | ${question.points} คะแนน / ${question.timeLimitSeconds} วินาที</div></div>`;

    const actions = document.createElement('div');
    actions.className = 'preview-item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary btn-tiny';
    editBtn.textContent = 'แก้ไข';
    editBtn.addEventListener('click', () => {
      editingIndex = index;
      addOrUpdateBtn.textContent = 'อัปเดตคำถาม';
      cancelEditBtn.classList.remove('hidden');
      document.getElementById('questionText').value = question.questionText;
      document.getElementById('questionTimeLimit').value = String(question.timeLimitSeconds);
      document.getElementById('questionPoints').value = String(question.points);
      questionTypeLabelEl.value = question.questionTypeLabel || 'คณิตศาสตร์พื้นฐาน';
      questionAnswerModeEl.value = question.answerMode || 'multiple_choice';
      showAnswerEditor(question.answerMode || 'multiple_choice', question);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-tiny';
    deleteBtn.textContent = 'ลบ';
    deleteBtn.addEventListener('click', () => {
      bankQuestions.splice(index, 1);
      renderQuestionBank();
    });

    actions.append(editBtn, deleteBtn);
    li.appendChild(actions);
    questionBankList.appendChild(li);
  });
}

function buildQuizLink(courseId) {
  return `${window.location.origin}/index.html?id=${encodeURIComponent(courseId)}`;
}

function fillDefault20() {
  bankQuestions = defaultMathQuestions.map((item) => ({
    questionText: item.question,
    questionTypeLabel: 'คณิตศาสตร์พื้นฐาน',
    answerMode: 'multiple_choice',
    options: [...item.choices],
    correctAnswer: { key: ['A', 'B', 'C', 'D'][item.answerIndex] || 'A' },
    points: 10,
    timeLimitSeconds: 30,
  }));
  renderQuestionBank();
}

function getMetaPayload() {
  const rawCourseId = document.getElementById('quizCourseId').value.trim();
  const courseId = rawCourseId || `quiz_${Date.now()}`;
  const title = document.getElementById('quizTitle').value.trim();

  if (!courseId || !title) {
    alert('กรุณากรอกชื่อแบบทดสอบ');
    return null;
  }

  if (bankQuestions.length < MIN_QUESTION_BANK) {
    alert(`ต้องมีคำถามอย่างน้อย ${MIN_QUESTION_BANK} ข้อ`);
    return null;
  }

  return {
    courseId,
    title,
    description: document.getElementById('quizDescription').value.trim(),
    enrollmentUrl: document.getElementById('enrollmentUrl').value.trim(),
    drawCount: Math.max(1, Number(document.getElementById('drawCount').value) || 10),
    status: document.getElementById('courseStatus').value,
  };
}

async function saveToFirebase() {
  const meta = getMetaPayload();
  if (!meta) return;

  completeQuizBtn.disabled = true;
  completeQuizBtn.textContent = 'กำลังบันทึก...';

  try {
    document.getElementById('quizCourseId').value = meta.courseId;
    const quizLink = buildQuizLink(meta.courseId);

    await saveCourse({
      ...meta,
      quizLink,
    });

    const normalized = bankQuestions.map((question) => ({
      question: question.questionText,
      type: question.answerMode,
      choices: question.answerMode === 'true_false' ? ['True', 'False'] : question.options,
      answerIndex: question.answerMode === 'true_false'
        ? (question.correctAnswer.value ? 0 : 1)
        : ['A', 'B', 'C', 'D'].indexOf(question.correctAnswer.key),
      points: question.points,
      timeLimitSeconds: question.timeLimitSeconds,
    }));

    await replaceQuestionsForCourse(meta.courseId, normalized);

    quizLinkOutput.value = quizLink;
    qrOutput.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(quizLink)}`;
    qrOutput.classList.remove('hidden');
    sharePanel.classList.remove('hidden');
    completionNotice.classList.remove('hidden');

    alert('ระบบอนุญาตให้นายทำควิซให้แล้ว และบันทึกขึ้น Firebase เรียบร้อย');
  } catch (error) {
    console.error(error);
    alert('บันทึกไม่สำเร็จ กรุณาลองใหม่');
  } finally {
    completeQuizBtn.disabled = false;
    completeQuizBtn.textContent = 'เสร็จ';
  }
}

async function loadCourseForEditing() {
  if (!editingCourseId) {
    fillDefault20();
    return;
  }

  document.getElementById('quizCourseId').value = editingCourseId;
  document.getElementById('quizCourseId').readOnly = true;

  try {
    const [course, questions] = await Promise.all([
      getCourse(editingCourseId),
      getQuestionsByCourse(editingCourseId),
    ]);

    if (!course) {
      fillDefault20();
      return;
    }

    document.getElementById('quizTitle').value = course.title || '';
    document.getElementById('quizDescription').value = course.description || '';
    document.getElementById('enrollmentUrl').value = course.enrollmentUrl || '';
    document.getElementById('drawCount').value = String(Math.max(1, Number(course.drawCount) || 10));
    document.getElementById('courseStatus').value = course.status || 'open';

    bankQuestions = questions.map((q) => ({
      questionText: q.question || '',
      questionTypeLabel: 'คณิตศาสตร์พื้นฐาน',
      answerMode: q.type === 'true_false' ? 'true_false' : 'multiple_choice',
      options: q.choices || ['', '', '', ''],
      correctAnswer: q.type === 'true_false'
        ? { value: Number(q.answerIndex) === 0 }
        : { key: ['A', 'B', 'C', 'D'][Number(q.answerIndex)] || 'A' },
      points: Number(q.points) || 10,
      timeLimitSeconds: Number(q.timeLimitSeconds) || 30,
    }));

    if (!bankQuestions.length) fillDefault20();
    renderQuestionBank();
  } catch (error) {
    console.error(error);
    alert('โหลดคอร์สเดิมไม่สำเร็จ จะแสดงชุดคำถามมาตรฐานแทน');
    fillDefault20();
  }
}

questionAnswerModeEl.addEventListener('change', () => {
  showAnswerEditor(questionAnswerModeEl.value);
});

questionEditor.addEventListener('submit', (event) => {
  event.preventDefault();
  const payload = buildQuestionPayloadFromEditor();
  if (!payload) return;

  if (editingIndex === null) {
    bankQuestions.push(payload);
  } else {
    bankQuestions[editingIndex] = payload;
  }

  renderQuestionBank();
  resetEditor();
});

cancelEditBtn.addEventListener('click', () => resetEditor());
seedDefaultBtn.addEventListener('click', () => {
  fillDefault20();
  alert('เติมโจทย์มาตรฐาน 20 ข้อแล้ว');
});
completeQuizBtn.addEventListener('click', () => {
  void saveToFirebase();
});
copyLinkBtn.addEventListener('click', async () => {
  if (!quizLinkOutput.value) return;
  try {
    await navigator.clipboard.writeText(quizLinkOutput.value);
    alert('คัดลอกลิงก์แล้ว');
  } catch (error) {
    console.error(error);
    alert('คัดลอกไม่สำเร็จ');
  }
});

showAnswerEditor('multiple_choice');
void loadCourseForEditing();
