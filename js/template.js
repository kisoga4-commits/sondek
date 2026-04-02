const DRAW_COUNT = 10;
const MIN_QUESTION_BANK = 10;

const builderView = document.getElementById('builderView');
const questionBankView = document.getElementById('questionBankView');
const studentView = document.getElementById('studentView');
const resultView = document.getElementById('resultView');

const questionAnswerModeEl = document.getElementById('questionAnswerMode');
const questionTypeLabelEl = document.getElementById('questionTypeLabel');
const questionEditor = document.getElementById('questionEditor');
const answerEditor = document.getElementById('answerEditor');
const questionBankList = document.getElementById('questionBankList');
const bankSummary = document.getElementById('bankSummary');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const addOrUpdateBtn = document.getElementById('addOrUpdateBtn');
const buildQuizLinkBtn = document.getElementById('buildQuizLinkBtn');
const lessonDoneBtn = document.getElementById('lessonDoneBtn');
const sharePanel = document.getElementById('sharePanel');
const quizLinkOutput = document.getElementById('quizLinkOutput');
const qrOutput = document.getElementById('qrOutput');
const copyLinkBtn = document.getElementById('copyLinkBtn');

const studentQuizTitle = document.getElementById('studentQuizTitle');
const studentQuizDescription = document.getElementById('studentQuizDescription');
const studentNameForm = document.getElementById('studentNameForm');
const attemptView = document.getElementById('attemptView');
const progressText = document.getElementById('progressText');
const pointText = document.getElementById('pointText');
const progressFill = document.getElementById('progressFill');
const attemptQuestionText = document.getElementById('attemptQuestionText');
const attemptTimerText = document.getElementById('attemptTimerText');
const attemptAnswerArea = document.getElementById('attemptAnswerArea');
const nextBtn = document.getElementById('nextBtn');
const finishBtn = document.getElementById('finishBtn');

const resultHeadline = document.getElementById('resultHeadline');
const resultScore = document.getElementById('resultScore');
const resultPercentage = document.getElementById('resultPercentage');
const resultCorrectCount = document.getElementById('resultCorrectCount');
const reviewList = document.getElementById('reviewList');

let bankQuestions = [];
let editingIndex = null;

let currentQuizPayload = null;
let selectedQuestions = [];
let userAnswers = [];
let currentQuestionIndex = 0;

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

  if (!questionText) {
    alert('กรุณาใส่โจทย์คำถาม');
    return null;
  }

  if (!questionTypeLabel) {
    alert('กรุณาใส่ประเภทคำถาม');
    return null;
  }

  const base = { questionText, questionTypeLabel, answerMode, timeLimitSeconds, points };

  if (answerMode === 'true_false') {
    return {
      ...base,
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
  addOrUpdateBtn.textContent = 'เพิ่มคำถาม';
  cancelEditBtn.classList.add('hidden');
  document.getElementById('questionText').value = '';
  document.getElementById('questionTimeLimit').value = '30';
  document.getElementById('questionPoints').value = '10';
  questionTypeLabelEl.value = '';
  questionAnswerModeEl.value = 'multiple_choice';
  showAnswerEditor('multiple_choice');
}

function renderQuestionBank() {
  questionBankList.innerHTML = '';

  if (!bankQuestions.length) {
    bankSummary.textContent = `ยังไม่มีคำถาม (ขั้นต่ำ ${MIN_QUESTION_BANK} ข้อ)`;
    return;
  }

  bankSummary.textContent = `มีคำถามแล้ว ${bankQuestions.length} ข้อ (ขั้นต่ำ ${MIN_QUESTION_BANK} ข้อก่อนสร้างลิงก์)`;

  bankQuestions.forEach((question, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>ข้อ ${index + 1}</strong> [${question.questionTypeLabel}] ${question.questionText} (${question.points} คะแนน / ${question.timeLimitSeconds} วิ)`;

    const actions = document.createElement('div');
    actions.className = 'admin-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'แก้ไข';
    editBtn.addEventListener('click', () => {
      editingIndex = index;
      addOrUpdateBtn.textContent = 'อัปเดตคำถาม';
      cancelEditBtn.classList.remove('hidden');

      document.getElementById('questionText').value = question.questionText;
      document.getElementById('questionTimeLimit').value = String(question.timeLimitSeconds);
      document.getElementById('questionPoints').value = String(question.points);
      questionTypeLabelEl.value = question.questionTypeLabel || '';
      questionAnswerModeEl.value = question.answerMode || 'multiple_choice';
      showAnswerEditor(question.answerMode || 'multiple_choice', question);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn';
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

function buildSharePayload() {
  const title = document.getElementById('quizTitle').value.trim();
  if (!title) {
    alert('กรุณาใส่ชื่อแบบทดสอบ');
    return null;
  }

  if (bankQuestions.length < MIN_QUESTION_BANK) {
    alert(`ต้องมีคำถามอย่างน้อย ${MIN_QUESTION_BANK} ข้อ เพื่อให้สุ่ม ${DRAW_COUNT} ข้อได้`);
    return null;
  }

  return {
    title,
    description: document.getElementById('quizDescription').value.trim(),
    drawCount: DRAW_COUNT,
    minQuestionBank: MIN_QUESTION_BANK,
    questionBank: bankQuestions,
    version: 2,
  };
}

function encodePayload(payload) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodePayload(encoded) {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const withPadding = normalized + (pad ? '='.repeat(4 - pad) : '');
  return JSON.parse(decodeURIComponent(escape(atob(withPadding))));
}

function shuffle(items) {
  const clone = [...items];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

function drawQuestions(questionBank, amount) {
  return shuffle(questionBank).slice(0, amount);
}

function renderAttemptQuestion() {
  const question = selectedQuestions[currentQuestionIndex];
  progressText.textContent = `ข้อ ${currentQuestionIndex + 1} / ${selectedQuestions.length}`;
  pointText.textContent = `${question.points} คะแนน`;
  progressFill.style.width = `${((currentQuestionIndex + 1) / selectedQuestions.length) * 100}%`;

  attemptQuestionText.textContent = question.questionText;
  attemptTimerText.textContent = `เวลาข้อนี้ ${question.timeLimitSeconds} วินาที | ประเภท: ${question.questionTypeLabel}`;

  attemptAnswerArea.innerHTML = '';

  if (question.answerMode === 'true_false') {
    attemptAnswerArea.innerHTML = `
      <div class="choices">
        <label class="choice"><input type="radio" name="answer" value="true" /> True</label>
        <label class="choice"><input type="radio" name="answer" value="false" /> False</label>
      </div>
    `;
  } else {
    const letters = ['A', 'B', 'C', 'D'];
    const block = document.createElement('div');
    block.className = 'choices';

    question.options.forEach((option, index) => {
      const label = document.createElement('label');
      label.className = 'choice';
      label.innerHTML = `<input type="radio" name="answer" value="${letters[index]}" /> ${letters[index]}. ${option}`;
      block.appendChild(label);
    });

    attemptAnswerArea.appendChild(block);
  }

  const previousAnswer = userAnswers[currentQuestionIndex];
  if (previousAnswer !== undefined) {
    const answerInput = attemptAnswerArea.querySelector(`input[value="${String(previousAnswer)}"]`);
    if (answerInput) answerInput.checked = true;
  }

  nextBtn.classList.toggle('hidden', currentQuestionIndex === selectedQuestions.length - 1);
  finishBtn.classList.toggle('hidden', currentQuestionIndex !== selectedQuestions.length - 1);
}

function collectCurrentAnswer() {
  const selectedInput = attemptAnswerArea.querySelector('input[name="answer"]:checked');
  return selectedInput ? selectedInput.value : null;
}

function isAnswerCorrect(question, answer) {
  if (question.answerMode === 'true_false') {
    return String(question.correctAnswer.value) === String(answer);
  }

  return question.correctAnswer.key === answer;
}

function renderResults(studentName) {
  let totalScore = 0;
  let maxScore = 0;
  let correctCount = 0;

  reviewList.innerHTML = '';

  selectedQuestions.forEach((question, index) => {
    const answer = userAnswers[index];
    const correct = isAnswerCorrect(question, answer);
    const earned = correct ? question.points : 0;
    maxScore += question.points;
    totalScore += earned;
    if (correct) correctCount += 1;

    const reviewItem = document.createElement('li');
    reviewItem.innerHTML = `<strong>ข้อ ${index + 1}</strong> [${question.questionTypeLabel}] ${question.questionText}`;

    const answerText = document.createElement('p');
    answerText.className = 'muted';
    answerText.textContent = `คำตอบของผู้เรียน: ${answer ?? 'ไม่ตอบ'} | สถานะ: ${correct ? 'ถูก' : 'ผิด'} | ได้ ${earned}/${question.points}`;

    reviewItem.appendChild(answerText);
    reviewList.appendChild(reviewItem);
  });

  const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

  resultHeadline.textContent = `${studentName} ส่งคำตอบเรียบร้อย`;
  resultScore.textContent = `คะแนนที่ได้: ${totalScore} / ${maxScore}`;
  resultPercentage.textContent = `เปอร์เซ็นต์: ${percentage.toFixed(2)}%`;
  resultCorrectCount.textContent = `ตอบถูก: ${correctCount} / ${DRAW_COUNT}`;

  resultView.classList.remove('hidden');
  studentView.classList.add('hidden');
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

cancelEditBtn.addEventListener('click', () => {
  resetEditor();
});

lessonDoneBtn.addEventListener('click', () => {
  alert('เสร็จบทนี้แล้ว สามารถกลับมาแก้ไขแต่ละข้อจากคลังคำถามได้ตลอด');
  document.getElementById('questionBankView').scrollIntoView({ behavior: 'smooth' });
});

buildQuizLinkBtn.addEventListener('click', () => {
  const payload = buildSharePayload();
  if (!payload) return;

  const encoded = encodePayload(payload);
  const link = `${window.location.origin}${window.location.pathname}?play=1&data=${encoded}`;
  quizLinkOutput.value = link;
  sharePanel.classList.remove('hidden');
  qrOutput.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`;
  qrOutput.classList.remove('hidden');
});

copyLinkBtn.addEventListener('click', async () => {
  if (!quizLinkOutput.value) return;

  try {
    await navigator.clipboard.writeText(quizLinkOutput.value);
    alert('คัดลอกลิงก์แล้ว');
  } catch (error) {
    alert('คัดลอกอัตโนมัติไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง');
  }
});

studentNameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const studentName = document.getElementById('studentName').value.trim();

  if (!studentName) {
    alert('กรุณากรอกชื่อก่อนเริ่ม');
    return;
  }

  selectedQuestions = drawQuestions(currentQuizPayload.questionBank, DRAW_COUNT);
  userAnswers = new Array(selectedQuestions.length).fill(null);
  currentQuestionIndex = 0;

  attemptView.classList.remove('hidden');
  renderAttemptQuestion();
  studentNameForm.dataset.studentName = studentName;
});

nextBtn.addEventListener('click', () => {
  userAnswers[currentQuestionIndex] = collectCurrentAnswer();
  currentQuestionIndex += 1;
  renderAttemptQuestion();
});

finishBtn.addEventListener('click', () => {
  userAnswers[currentQuestionIndex] = collectCurrentAnswer();
  renderResults(studentNameForm.dataset.studentName || 'ผู้เรียน');
});

(function init() {
  showAnswerEditor('multiple_choice');
  renderQuestionBank();

  const params = new URLSearchParams(window.location.search);
  const encodedData = params.get('data');
  const isPlayMode = params.get('play') === '1' && encodedData;

  if (!isPlayMode) {
    return;
  }

  try {
    const payload = decodePayload(encodedData);
    if (!payload || !Array.isArray(payload.questionBank) || payload.questionBank.length < MIN_QUESTION_BANK) {
      throw new Error('invalid payload');
    }

    currentQuizPayload = payload;
    builderView.classList.add('hidden');
    questionBankView.classList.add('hidden');
    studentView.classList.remove('hidden');

    studentQuizTitle.textContent = payload.title || 'แบบทดสอบ';
    studentQuizDescription.textContent = payload.description || '';
  } catch (error) {
    alert('ลิงก์แบบทดสอบไม่ถูกต้อง');
  }
})();
