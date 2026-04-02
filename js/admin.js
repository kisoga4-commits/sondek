import { saveCourse, saveQuestionsBatch } from './db.js';

const courseForm = document.getElementById('courseForm');
const questionForm = document.getElementById('questionForm');
const nextQuestionBtn = document.getElementById('nextQuestionBtn');
const finishBtn = document.getElementById('finishBtn');
const previewList = document.getElementById('previewList');
const questionCounter = document.getElementById('questionCounter');

const draftQuestions = [];

function readCoursePayload() {
  const formData = new FormData(courseForm);
  const courseId = String(formData.get('courseId') || document.getElementById('courseId').value).trim();
  const title = String(formData.get('courseTitle') || document.getElementById('courseTitle').value).trim();
  const tutorName = String(formData.get('tutorNameInput') || document.getElementById('tutorNameInput').value).trim();
  const tutorPhotoUrl = String(formData.get('tutorPhotoInput') || document.getElementById('tutorPhotoInput').value).trim();
  const tutorBio = String(formData.get('tutorBioInput') || document.getElementById('tutorBioInput').value).trim();

  return { courseId, title, tutorName, tutorPhotoUrl, tutorBio };
}

function readQuestionPayload() {
  const question = document.getElementById('qText').value.trim();
  const choiceA = document.getElementById('choiceA').value.trim();
  const choiceB = document.getElementById('choiceB').value.trim();
  const choiceC = document.getElementById('choiceC').value.trim();
  const choiceD = document.getElementById('choiceD').value.trim();
  const answerIndex = Number(document.getElementById('answer').value);

  return {
    question,
    choices: [choiceA, choiceB, choiceC, choiceD],
    answerIndex,
  };
}

function renderPreview() {
  previewList.innerHTML = '';

  draftQuestions.forEach((item, index) => {
    const li = document.createElement('li');
    li.textContent = `${index + 1}) ${item.question}`;
    previewList.appendChild(li);
  });

  questionCounter.textContent = `สะสมแล้ว ${draftQuestions.length} ข้อ`;
}

function validateQuestion(questionPayload) {
  if (!questionPayload.question || questionPayload.choices.some((choice) => !choice)) {
    alert('กรอกโจทย์และตัวเลือกให้ครบ');
    return false;
  }

  return true;
}

function validateCourse(coursePayload) {
  const required = [
    coursePayload.courseId,
    coursePayload.title,
    coursePayload.tutorName,
    coursePayload.tutorPhotoUrl,
    coursePayload.tutorBio,
  ];

  if (required.some((value) => !value)) {
    alert('กรอกข้อมูลคอร์สให้ครบก่อนบันทึก');
    return false;
  }

  return true;
}

nextQuestionBtn.addEventListener('click', () => {
  const payload = readQuestionPayload();
  if (!validateQuestion(payload)) {
    return;
  }

  draftQuestions.push(payload);
  questionForm.reset();
  renderPreview();
});

finishBtn.addEventListener('click', async () => {
  const coursePayload = readCoursePayload();

  if (!validateCourse(coursePayload)) {
    return;
  }

  if (draftQuestions.length < 10) {
    alert('ควรมีอย่างน้อย 10 ข้อเพื่อเปิดใช้งานควิซ');
    return;
  }

  try {
    finishBtn.disabled = true;
    await saveCourse(coursePayload);
    await saveQuestionsBatch(coursePayload.courseId, draftQuestions);

    alert(`บันทึกคอร์ส ${coursePayload.courseId} และข้อสอบ ${draftQuestions.length} ข้อเรียบร้อย`);
    draftQuestions.length = 0;
    courseForm.reset();
    questionForm.reset();
    renderPreview();
  } catch (error) {
    console.error(error);
    alert('บันทึกข้อมูลไม่สำเร็จ โปรดตรวจสอบสิทธิ์ Firestore และลองใหม่');
  } finally {
    finishBtn.disabled = false;
  }
});
