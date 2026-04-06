import {
  deleteCourseWithQuestions,
  getCourse,
  getQuestionsByCourse,
  replaceQuestionsForCourse,
  saveCourse,
} from './db.js';

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
const downloadQrBtn = document.getElementById('downloadQrBtn');
const completeQuizBtn = document.getElementById('completeQuizBtn');
const duplicateQuizBtn = document.getElementById('duplicateQuizBtn');
const deleteQuizBtn = document.getElementById('deleteQuizBtn');
const completionNotice = document.getElementById('completionNotice');
const quizMetaForm = document.getElementById('quizMetaForm');
const drawCountPresetEls = Array.from(document.querySelectorAll('input[name="drawCountPreset"]'));
const drawCountHintEl = document.getElementById('drawCountHint');
const templateHealthEl = document.getElementById('templateHealth');
const importPayloadEl = document.getElementById('importPayload');
const importBtn = document.getElementById('importBtn');
const titleFirstNoticeEl = document.getElementById('titleFirstNotice');
const titlePromptModalEl = document.getElementById('titlePromptModal');
const titlePromptFormEl = document.getElementById('titlePromptForm');
const titlePromptInputEl = document.getElementById('titlePromptInput');
const titlePromptExitBtnEl = document.getElementById('titlePromptExitBtn');
const draftStatusNoticeEl = document.getElementById('draftStatusNotice');
const LOCAL_SNAPSHOT_KEY = 'template_quiz_local_snapshot_v1';

const params = new URLSearchParams(window.location.search);
const editingCourseId = params.get('courseId') || '';
const shouldRestoreSnapshot = params.get('resume') === '1';
const draftCourseId = editingCourseId || `quiz_${Date.now()}`;

let bankQuestions = [];
let editingIndex = null;
let autoSaveTimer = null;
const QUESTION_TYPE_OPTIONS = ['ไทย', 'English', 'คณิต', 'คณิตศาสตร์พื้นฐาน', 'วิทย์', 'สังคม', 'ทั่วไป'];

function normalizeQuestionTypeLabel(value) {
  if (QUESTION_TYPE_OPTIONS.includes(value)) return value;
  if (value === 'คณิตศาสตร์พื้นฐาน') return 'คณิตศาสตร์พื้นฐาน';
  return 'คณิตศาสตร์พื้นฐาน';
}

function isQuizTitleReady() {
  return Boolean(document.getElementById('quizTitle').value.trim());
}


function promptQuizTitleIfMissing() {
  if (editingCourseId) return;
  const titleInput = document.getElementById('quizTitle');
  if (!titleInput || titleInput.value.trim()) return;
  if (!titlePromptModalEl || !titlePromptInputEl) {
    titleInput.focus();
    return;
  }
  titlePromptInputEl.value = '';
  titlePromptModalEl.classList.remove('hidden');
  window.setTimeout(() => titlePromptInputEl.focus(), 0);
}

function closeTitlePromptModal() {
  if (!titlePromptModalEl) return;
  titlePromptModalEl.classList.add('hidden');
}

function submitTitlePrompt() {
  const titleInput = document.getElementById('quizTitle');
  if (!titleInput || !titlePromptInputEl) return;
  const normalizedTitle = titlePromptInputEl.value.trim();
  if (!normalizedTitle) {
    titlePromptInputEl.focus();
    return;
  }
  titleInput.value = normalizedTitle;
  closeTitlePromptModal();
  setBuilderLockedState();
  queueAutoSave();
}
function setBuilderLockedState() {
  const canEdit = isQuizTitleReady();
  const lockTargets = Array.from(questionEditor.querySelectorAll('input, textarea, select, button'));
  lockTargets.forEach((element) => {
    element.disabled = !canEdit;
  });

  if (importPayloadEl) importPayloadEl.disabled = !canEdit;
  if (importBtn) importBtn.disabled = !canEdit;
  if (completeQuizBtn) completeQuizBtn.disabled = !canEdit;
  if (duplicateQuizBtn) duplicateQuizBtn.disabled = !canEdit;

  if (titleFirstNoticeEl) {
    titleFirstNoticeEl.textContent = canEdit
      ? 'ตั้งชื่อบททดสอบแล้ว สามารถเพิ่มคำถามได้'
      : 'กรุณาตั้งชื่อบททดสอบก่อน แล้วจึงเพิ่มคำถาม/Import/กดเสร็จได้';
  }
}

function getCorrectDisplay(question) {
  if (question.answerMode === 'true_false') {
    return question.correctAnswer.value ? 'จริง' : 'เท็จ';
  }

  if (question.answerMode === 'short_text') {
    return (question.acceptedAnswers || []).join(' / ');
  }

  const key = question.correctAnswer?.key || 'A';
  const index = ['A', 'B', 'C', 'D'].indexOf(key);
  const answerText = Array.isArray(question.options) ? (question.options[index] || '') : '';
  return answerText ? `${key} (${answerText})` : key;
}

function saveLocalSnapshot() {
  const snapshot = {
    savedAt: Date.now(),
    courseId: document.getElementById('quizCourseId').value.trim() || draftCourseId,
    title: document.getElementById('quizTitle').value.trim(),
    description: document.getElementById('quizDescription').value.trim(),
    enrollmentUrl: document.getElementById('enrollmentUrl').value.trim(),
    drawCount: document.getElementById('drawCount').value,
    drawPreset: drawCountPresetEls.find((item) => item.checked)?.value || null,
    questionText: document.getElementById('questionText').value,
    questionTypeLabel: questionTypeLabelEl.value,
    answerMode: questionAnswerModeEl.value,
    questionTimeLimit: document.getElementById('questionTimeLimit').value,
    questionPoints: document.getElementById('questionPoints').value,
    bankQuestions,
  };
  localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

function restoreLocalSnapshot() {
  if (editingCourseId || !shouldRestoreSnapshot) return;
  const raw = localStorage.getItem(LOCAL_SNAPSHOT_KEY);
  if (!raw) return;

  try {
    const snapshot = JSON.parse(raw);
    if (!snapshot || !Array.isArray(snapshot.bankQuestions)) return;

    bankQuestions = snapshot.bankQuestions;
    document.getElementById('quizCourseId').value = snapshot.courseId || draftCourseId;
    document.getElementById('quizTitle').value = snapshot.title || '';
    document.getElementById('quizDescription').value = snapshot.description || '';
    document.getElementById('enrollmentUrl').value = snapshot.enrollmentUrl || '';
    document.getElementById('drawCount').value = String(Math.max(1, Number(snapshot.drawCount) || 10));

    const matchedPreset = drawCountPresetEls.find((item) => item.value === String(snapshot.drawPreset || ''));
    if (matchedPreset) matchedPreset.checked = true;

    questionTypeLabelEl.value = normalizeQuestionTypeLabel(snapshot.questionTypeLabel);
    questionAnswerModeEl.value = snapshot.answerMode || 'multiple_choice';
    document.getElementById('questionText').value = snapshot.questionText || '';
    document.getElementById('questionTimeLimit').value = String(Math.max(5, Number(snapshot.questionTimeLimit) || 30));
    document.getElementById('questionPoints').value = String(Math.max(1, Number(snapshot.questionPoints) || 10));
    showAnswerEditor(questionAnswerModeEl.value || 'multiple_choice');
  } catch (error) {
    console.warn('restore local snapshot failed', error);
  }
}

function updateDrawCountHint() {
  const drawPreset = drawCountPresetEls.find((item) => item.checked)?.value;
  const drawCount = Math.max(1, Number(drawPreset || document.getElementById('drawCount').value) || 10);
  document.getElementById('drawCount').value = String(drawCount);

  if (!drawCountHintEl) return;

  const enoughQuestionInBank = bankQuestions.length >= drawCount;
  drawCountHintEl.textContent = enoughQuestionInBank
    ? `ตอนนี้ตั้งไว้ ${drawCount} ข้อ • คลังมี ${bankQuestions.length} ข้อ พร้อมใช้งาน`
    : `ตอนนี้ตั้งไว้ ${drawCount} ข้อ • คลังมี ${bankQuestions.length} ข้อ (ระบบจะสุ่มเท่าที่มี)`;
}

function renderTemplateHealth() {
  if (!templateHealthEl) return;
  templateHealthEl.textContent = 'Template status: พร้อมใช้งาน (Autosave + บันทึก Firebase)';
}

function updateDraftStatusNotice(statusText, tone = 'normal') {
  if (!draftStatusNoticeEl) return;
  draftStatusNoticeEl.textContent = `สถานะ: ${statusText}`;
  draftStatusNoticeEl.style.color = tone === 'success'
    ? '#166534'
    : (tone === 'error' ? '#b91c1c' : '');
}

function formatThaiDraftTime(timestampMs) {
  return new Date(timestampMs).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function showAnswerEditor(answerMode, question = null) {
  if (answerMode === 'short_text') {
    const acceptedAnswers = Array.isArray(question?.acceptedAnswers)
      ? question.acceptedAnswers.join(', ')
      : '';
    answerEditor.innerHTML = `
      <label>คำตอบที่ถูก (พิมพ์ได้หลายค่า คั่นด้วย ,)
        <input id="textCorrectAnswer" type="text" value="${acceptedAnswers}" placeholder="เช่น 42, สี่สิบสอง" />
      </label>
      <p class="muted">ระบบจะเช็คแบบไม่สนตัวพิมพ์ใหญ่/เล็ก และตัดช่องว่างหัวท้ายให้อัตโนมัติ</p>
    `;
    return;
  }

  if (answerMode === 'true_false') {
    const selected = question?.correctAnswer?.value === false ? 'false' : 'true';
    answerEditor.innerHTML = `
      <label>คำตอบที่ถูก
        <select id="tfCorrectAnswer">
          <option value="true" ${selected === 'true' ? 'selected' : ''}>จริง</option>
          <option value="false" ${selected === 'false' ? 'selected' : ''}>เท็จ</option>
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

  if (answerMode === 'short_text') {
    const raw = document.getElementById('textCorrectAnswer').value;
    const acceptedAnswers = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (!acceptedAnswers.length) {
      alert('กรุณาใส่คำตอบที่ถูกอย่างน้อย 1 ค่า');
      return null;
    }

    return {
      ...base,
      acceptedAnswers,
      options: [],
      correctAnswer: { text: acceptedAnswers[0] },
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
  const selectedMode = questionAnswerModeEl.value || 'multiple_choice';
  const selectedTime = document.getElementById('questionTimeLimit').value || '30';
  editingIndex = null;
  addOrUpdateBtn.textContent = 'ถัดไป (Next)';
  cancelEditBtn.classList.add('hidden');
  questionEditor.reset();
  questionTypeLabelEl.value = 'คณิตศาสตร์พื้นฐาน';
  document.getElementById('questionTimeLimit').value = selectedTime;
  document.getElementById('questionPoints').value = '10';
  questionAnswerModeEl.value = selectedMode;
  showAnswerEditor(selectedMode);
}

function renderQuestionBank() {
  questionBankList.innerHTML = '';

  if (!bankQuestions.length) {
    bankSummary.textContent = `ยังไม่มีคำถาม (ขั้นต่ำ ${MIN_QUESTION_BANK} ข้อ)`;
    updateDrawCountHint();
    return;
  }

  if (bankQuestions.length >= MIN_QUESTION_BANK) {
    bankSummary.textContent = `มีคำถามแล้ว ${bankQuestions.length} ข้อ (ขั้นต่ำ ${MIN_QUESTION_BANK} ข้อก่อนบันทึก)`;
  } else {
    bankSummary.textContent = `มีคำถามแล้ว ${bankQuestions.length} ข้อ (ต้องมีขั้นต่ำ ${MIN_QUESTION_BANK} ข้อก่อนบันทึก)`;
  }

  bankQuestions.forEach((question, index) => {
    const li = document.createElement('li');
    const correctDisplay = getCorrectDisplay(question);

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
      questionTypeLabelEl.value = normalizeQuestionTypeLabel(question.questionTypeLabel);
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
      queueAutoSave();
    });

    actions.append(editBtn, deleteBtn);
    li.appendChild(actions);
    questionBankList.appendChild(li);
  });

  updateDrawCountHint();
}

function parseImportLine(line) {
  const raw = line.trim();
  if (!raw) return null;

  const parts = raw.split('|').map((item) => item.trim());
  if (parts.length !== 10) {
    throw new Error('ข้อมูลไม่ครบ 10 ส่วน');
  }

  const answerMode = Number(parts[1]);
  const questionText = parts[2];
  const choiceA = parts[3];
  const choiceB = parts[4];
  const choiceC = parts[5];
  const choiceD = parts[6];
  const answerRaw = parts[7];
  const timeLimitSeconds = Math.max(5, Number(parts[8]) || 30);
  const points = Math.max(1, Number(parts[9]) || 10);

  if (!questionText) {
    throw new Error('ไม่พบโจทย์คำถาม');
  }

  if (answerMode === 1) {
    const options = [choiceA, choiceB, choiceC, choiceD];
    if (options.some((item) => !item)) {
      throw new Error('ประเภท 1 ต้องมีตัวเลือก ก-ง ครบ');
    }
    const answerIndex = Number(answerRaw);
    const safeIndex = Number.isFinite(answerIndex) ? Math.min(3, Math.max(0, answerIndex - 1)) : 0;
    return {
      questionText,
      questionTypeLabel: 'คณิตศาสตร์พื้นฐาน',
      answerMode: 'multiple_choice',
      options,
      correctAnswer: { key: ['A', 'B', 'C', 'D'][safeIndex] },
      points,
      timeLimitSeconds,
    };
  }

  if (answerMode === 2) {
    const answerIndex = Number(answerRaw);
    const tfPatternOk = [choiceA, choiceB, choiceC, choiceD]
      .map((item) => item.toLowerCase())
      .join('|') === 'จริง|เท็จ|-|-';
    if (!tfPatternOk) {
      throw new Error('ประเภท 2 ต้องเป็น จริง|เท็จ|-|-');
    }
    return {
      questionText,
      questionTypeLabel: 'คณิตศาสตร์พื้นฐาน',
      answerMode: 'true_false',
      options: ['จริง', 'เท็จ'],
      correctAnswer: { value: answerIndex === 1 },
      points,
      timeLimitSeconds,
    };
  }

  if (answerMode === 3) {
    const choices = [choiceA, choiceB, choiceC, choiceD].filter((item) => item && item !== '-');
    const acceptedAnswers = [answerRaw].filter(Boolean);
    if (!acceptedAnswers.length) {
      throw new Error('ประเภท 3 ต้องระบุเฉลย');
    }
    return {
      questionText,
      questionTypeLabel: 'คณิตศาสตร์พื้นฐาน',
      answerMode: 'short_text',
      acceptedAnswers,
      options: choices,
      correctAnswer: { text: acceptedAnswers[0] },
      points,
      timeLimitSeconds,
    };
  }

  throw new Error(`ไม่รู้จักรูปแบบคำตอบ: ${line}`);
}

function importQuestionsFromText() {
  const raw = importPayloadEl?.value || '';
  if (!raw.trim()) {
    alert('กรุณาวางข้อมูลก่อน import');
    return;
  }

  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const imported = [];
  const invalidLines = [];

  lines.forEach((line, index) => {
    try {
      const question = parseImportLine(line);
      if (question) imported.push(question);
    } catch (error) {
      invalidLines.push(`บรรทัดที่ ${index + 1} ข้อมูลไม่ถูกต้อง`);
      console.warn('import line invalid', { line: index + 1, raw: line, error });
    }
  });

  if (!imported.length) {
    const errorMessage = invalidLines.length
      ? invalidLines.join('\n')
      : 'ไม่พบข้อมูลที่ import ได้';
    alert(errorMessage);
    return;
  }

  bankQuestions.push(...imported);
  renderQuestionBank();
  queueAutoSave();

  if (invalidLines.length) {
    alert(`Import สำเร็จ ${imported.length} ข้อ\n${invalidLines.join('\n')}`);
    return;
  }

  alert(`Import สำเร็จ ${imported.length} ข้อ`);
}

async function duplicateCurrentQuiz() {
  const meta = getMetaPayload();
  if (!meta) return;

  const newCourseId = `quiz_${Date.now()}`;
  const newTitle = `${meta.title} (สำเนา)`;
  const quizLink = buildQuizLink(newCourseId);

  duplicateQuizBtn.disabled = true;
  duplicateQuizBtn.textContent = 'กำลังสำเนา...';

  try {
    await saveCourse({
      ...meta,
      courseId: newCourseId,
      title: newTitle,
      status: 'draft',
      quizLink,
    });
    await replaceQuestionsForCourse(newCourseId, buildNormalizedQuestions());
    alert('สร้างสำเนาเรียบร้อย กำลังเปิดบททดสอบสำเนา');
    window.location.href = `template.html?courseId=${encodeURIComponent(newCourseId)}`;
  } catch (error) {
    console.error(error);
    alert(`สำเนาไม่สำเร็จ: ${error?.message || 'กรุณาลองใหม่'}`);
  } finally {
    duplicateQuizBtn.disabled = false;
    duplicateQuizBtn.textContent = 'สำเนาบททดสอบ';
  }
}

function buildQuizLink(courseId) {
  const currentPath = String(window.location.pathname || '/');
  const basePath = currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    : '/';
  return `${window.location.origin}${basePath}quiz.html?id=${encodeURIComponent(courseId)}`;
}

function downloadQrImage() {
  if (!qrOutput?.src) {
    alert('ยังไม่มี QR ให้บันทึก');
    return;
  }
  const courseId = document.getElementById('quizCourseId').value.trim() || 'quiz';
  const link = document.createElement('a');
  link.href = qrOutput.src;
  link.download = `qr-${courseId}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function getMetaPayload() {
  const rawCourseId = document.getElementById('quizCourseId').value.trim();
  const courseId = rawCourseId || draftCourseId;
  const title = document.getElementById('quizTitle').value.trim();

  if (!courseId || !title) {
    alert('กรุณากรอกชื่อแบบทดสอบ');
    return null;
  }

  if (bankQuestions.length < MIN_QUESTION_BANK) {
    alert(`ต้องมีคำถามอย่างน้อย ${MIN_QUESTION_BANK} ข้อ`);
    return null;
  }

  const drawPreset = drawCountPresetEls.find((item) => item.checked)?.value;
  const drawCount = Math.max(1, Number(drawPreset || document.getElementById('drawCount').value) || 10);

  return {
    courseId,
    title,
    description: document.getElementById('quizDescription').value.trim(),
    enrollmentUrl: document.getElementById('enrollmentUrl').value.trim(),
    drawCount,
  };
}


async function deleteCurrentQuiz() {
  const courseId = document.getElementById('quizCourseId').value.trim();
  if (!courseId) {
    alert('ไม่พบรหัสบททดสอบที่จะลบ');
    return;
  }

  if (!window.confirm(`ยืนยันลบบททดสอบ ${courseId} และคำถามทั้งหมด?`)) {
    return;
  }

  try {
    deleteQuizBtn.disabled = true;
    await deleteCourseWithQuestions(courseId);
    localStorage.removeItem(LOCAL_SNAPSHOT_KEY);
    alert('ลบบททดสอบเรียบร้อยแล้ว');
    window.location.href = 'adminchamp.html';
  } catch (error) {
    console.error(error);
    alert(`ลบบททดสอบไม่สำเร็จ: ${error?.message || 'กรุณาลองใหม่'}`);
  } finally {
    deleteQuizBtn.disabled = false;
  }
}

function buildNormalizedQuestions() {
  return bankQuestions.map((question) => ({
    question: question.questionText,
    type: question.answerMode,
    choices: question.answerMode === 'true_false' ? ['จริง', 'เท็จ'] : (question.options || []),
    acceptedAnswers: question.answerMode === 'short_text' ? (question.acceptedAnswers || []) : [],
    answerIndex: question.answerMode === 'true_false'
      ? (question.correctAnswer.value ? 0 : 1)
      : (question.answerMode === 'short_text' ? -1 : ['A', 'B', 'C', 'D'].indexOf(question.correctAnswer.key)),
    points: question.points,
    timeLimitSeconds: question.timeLimitSeconds,
  }));
}

async function autoSaveDraft() {
  const title = document.getElementById('quizTitle').value.trim();
  if (!bankQuestions.length) return;

  const courseId = document.getElementById('quizCourseId').value.trim() || draftCourseId;
  document.getElementById('quizCourseId').value = courseId;

  const drawPreset = drawCountPresetEls.find((item) => item.checked)?.value;

  await saveCourse({
    courseId,
    title: title || 'แบบทดสอบยังไม่ตั้งชื่อ',
    description: document.getElementById('quizDescription').value.trim(),
    enrollmentUrl: document.getElementById('enrollmentUrl').value.trim(),
    drawCount: Math.max(1, Number(drawPreset || document.getElementById('drawCount').value) || 10),
    status: 'draft',
    quizLink: buildQuizLink(courseId),
  });

  await replaceQuestionsForCourse(courseId, buildNormalizedQuestions());
  saveLocalSnapshot();
  updateDraftStatusNotice(`บันทึกแบบร่างล่าสุด ${formatThaiDraftTime(Date.now())}`, 'success');
}

function queueAutoSave(immediate = false) {
  saveLocalSnapshot();
  if (autoSaveTimer) {
    window.clearTimeout(autoSaveTimer);
  }

  if (immediate) {
    void autoSaveDraft().catch((error) => {
      console.error('autosave failed', error);
      updateDraftStatusNotice('บันทึกแบบร่างไม่สำเร็จ กรุณาลองใหม่', 'error');
    });
    return;
  }

  autoSaveTimer = window.setTimeout(() => {
    void autoSaveDraft().catch((error) => {
      console.error('autosave failed', error);
      updateDraftStatusNotice('บันทึกแบบร่างไม่สำเร็จ กรุณาลองใหม่', 'error');
    });
  }, 600);
}

async function saveToFirebase() {
  if (!isQuizTitleReady()) {
    alert('กรุณากรอกชื่อบททดสอบก่อนบันทึก');
    return;
  }

  const meta = getMetaPayload();
  if (!meta) return;

  completeQuizBtn.disabled = true;
  completeQuizBtn.textContent = 'กำลังบันทึก...';

  try {
    document.getElementById('quizCourseId').value = meta.courseId;
    const quizLink = buildQuizLink(meta.courseId);

    await saveCourse({
      ...meta,
      status: 'open',
      quizLink,
    });

    await replaceQuestionsForCourse(meta.courseId, buildNormalizedQuestions());

    quizLinkOutput.value = quizLink;
    qrOutput.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(quizLink)}`;
    qrOutput.classList.remove('hidden');
    sharePanel.classList.remove('hidden');
    completionNotice.classList.remove('hidden');
    localStorage.removeItem(LOCAL_SNAPSHOT_KEY);
    updateDraftStatusNotice('เผยแพร่เรียบร้อยแล้ว (ไม่ใช่แบบร่าง)', 'success');

    alert('ระบบอนุญาตให้นายทำควิซให้แล้ว และบันทึกขึ้น Firebase เรียบร้อย');
  } catch (error) {
    console.error(error);
    alert(`บันทึกไม่สำเร็จ: ${error?.message || 'กรุณาลองใหม่'}`);
  } finally {
    completeQuizBtn.disabled = false;
    completeQuizBtn.textContent = 'เสร็จ';
  }
}

async function loadCourseForEditing() {
  if (!editingCourseId) {
    document.getElementById('quizCourseId').value = draftCourseId;
    renderQuestionBank();
    setBuilderLockedState();
    updateDraftStatusNotice('ยังไม่ได้บันทึกแบบร่าง');
    return;
  }

  document.getElementById('quizCourseId').value = editingCourseId;
  document.getElementById('quizCourseId').readOnly = true;
  deleteQuizBtn?.classList.remove('hidden');

  try {
    const [course, questions] = await Promise.all([
      getCourse(editingCourseId),
      getQuestionsByCourse(editingCourseId),
    ]);

    if (!course) {
      renderQuestionBank();
      return;
    }

    document.getElementById('quizTitle').value = course.title || '';
    document.getElementById('quizDescription').value = course.description || '';
    document.getElementById('enrollmentUrl').value = course.enrollmentUrl || '';
    document.getElementById('drawCount').value = String(Math.max(1, Number(course.drawCount) || 10));
    const courseDrawCount = String(Math.max(1, Number(course.drawCount) || 10));
    const matchedPreset = drawCountPresetEls.find((item) => item.value === courseDrawCount);
    if (matchedPreset) {
      matchedPreset.checked = true;
    }

    bankQuestions = questions.map((q) => ({
      questionText: q.question || '',
      questionTypeLabel: 'คณิตศาสตร์พื้นฐาน',
      answerMode: q.type === 'short_text'
        ? 'short_text'
        : (q.type === 'true_false' ? 'true_false' : 'multiple_choice'),
      acceptedAnswers: Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers : [],
      options: q.choices || ['', '', '', ''],
      correctAnswer: q.type === 'true_false'
        ? { value: Number(q.answerIndex) === 0 }
        : (q.type === 'short_text'
          ? { text: (Array.isArray(q.acceptedAnswers) && q.acceptedAnswers[0]) || '' }
          : { key: ['A', 'B', 'C', 'D'][Number(q.answerIndex)] || 'A' }),
      points: Number(q.points) || 10,
      timeLimitSeconds: Number(q.timeLimitSeconds) || 30,
    }));

    renderQuestionBank();
    setBuilderLockedState();
    if (course.status === 'open') {
      updateDraftStatusNotice('บททดสอบนี้ถูกเผยแพร่แล้ว (กด Next จะแก้ไขแบบร่างล่าสุด)');
    } else {
      updateDraftStatusNotice('บททดสอบนี้อยู่ในสถานะแบบร่าง');
    }
  } catch (error) {
    console.error(error);
    alert('โหลดคอร์สเดิมไม่สำเร็จ');
    renderQuestionBank();
    setBuilderLockedState();
  }
}

questionAnswerModeEl.addEventListener('change', () => {
  showAnswerEditor(questionAnswerModeEl.value);
});

questionEditor.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!isQuizTitleReady()) {
    alert('กรุณากรอกชื่อบททดสอบก่อนเพิ่มคำถาม');
    document.getElementById('quizTitle').focus();
    return;
  }
  const payload = buildQuestionPayloadFromEditor();
  if (!payload) return;

  if (editingIndex === null) {
    bankQuestions.push(payload);
  } else {
    bankQuestions[editingIndex] = payload;
  }

  renderQuestionBank();
  resetEditor();
  queueAutoSave(true);
});

cancelEditBtn.addEventListener('click', () => resetEditor());
completeQuizBtn.addEventListener('click', () => {
  void saveToFirebase();
});

duplicateQuizBtn?.addEventListener('click', () => {
  void duplicateCurrentQuiz();
});

importBtn?.addEventListener('click', () => {
  try {
    importQuestionsFromText();
  } catch (error) {
    console.error(error);
    alert(`Import ไม่สำเร็จ: ${error?.message || 'ตรวจรูปแบบข้อมูลอีกครั้ง'}`);
  }
});

deleteQuizBtn?.addEventListener('click', () => {
  void deleteCurrentQuiz();
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
downloadQrBtn.addEventListener('click', () => {
  downloadQrImage();
});

quizMetaForm.addEventListener('input', () => {
  setBuilderLockedState();
  queueAutoSave();
});
titlePromptFormEl?.addEventListener('submit', (event) => {
  event.preventDefault();
  submitTitlePrompt();
});
titlePromptExitBtnEl?.addEventListener('click', () => {
  window.location.href = 'adminchamp.html';
});

drawCountPresetEls.forEach((item) => {
  item.addEventListener('change', () => {
    document.getElementById('drawCount').value = item.value;
    updateDrawCountHint();
    queueAutoSave();
  });
});

showAnswerEditor('multiple_choice');
renderTemplateHealth();
if (!editingCourseId && !shouldRestoreSnapshot) {
  localStorage.removeItem(LOCAL_SNAPSHOT_KEY);
}
restoreLocalSnapshot();
renderQuestionBank();
updateDrawCountHint();
setBuilderLockedState();
void loadCourseForEditing().then(() => {
  promptQuizTitleIfMissing();
});
