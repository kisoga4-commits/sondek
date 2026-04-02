import {
  getAllCourses,
  getCourse,
  getQuestionsByCourse,
  replaceQuestionsForCourse,
  saveCourse,
} from './db.js';

const courseForm = document.getElementById('courseForm');
const questionForm = document.getElementById('questionForm');
const nextQuestionBtn = document.getElementById('nextQuestionBtn');
const finishBtn = document.getElementById('finishBtn');
const previewList = document.getElementById('previewList');
const questionCounter = document.getElementById('questionCounter');
const adminNotice = document.getElementById('adminNotice');
const courseLibrary = document.getElementById('courseLibrary');
const shareLinkInput = document.getElementById('shareLinkInput');
const copyLinkBtn = document.getElementById('copyLinkBtn');

const draftQuestions = [];
let editingQuestionIndex = -1;

function readCoursePayload() {
  const formData = new FormData(courseForm);
  const courseId = String(formData.get('courseId') || '').trim();
  const title = String(formData.get('courseTitle') || '').trim();
  const tutorName = String(formData.get('tutorNameInput') || '').trim();
  const tutorPhotoUrl = String(formData.get('tutorPhotoInput') || '').trim();
  const tutorBio = String(formData.get('tutorBioInput') || '').trim();

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

function setNotice(text) {
  adminNotice.textContent = text;
}

function getQuizLink(courseId) {
  const currentPath = String(window.location.pathname || '/');
  const basePath = currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    : '/';
  return `${window.location.origin}${basePath}quiz.html?id=${encodeURIComponent(courseId)}`;
}

function setShareLink(courseId) {
  if (!courseId) {
    shareLinkInput.value = '';
    return;
  }

  shareLinkInput.value = getQuizLink(courseId);
}

function fillQuestionForm(question) {
  document.getElementById('qText').value = question.question || '';
  document.getElementById('choiceA').value = question.choices?.[0] || '';
  document.getElementById('choiceB').value = question.choices?.[1] || '';
  document.getElementById('choiceC').value = question.choices?.[2] || '';
  document.getElementById('choiceD').value = question.choices?.[3] || '';
  document.getElementById('answer').value = String(question.answerIndex || 0);
}

function resetQuestionForm() {
  questionForm.reset();
  editingQuestionIndex = -1;
  nextQuestionBtn.textContent = 'เพิ่มข้อนี้';
}

function renderPreview() {
  previewList.innerHTML = '';

  draftQuestions.forEach((item, index) => {
    const li = document.createElement('li');

    const textWrap = document.createElement('div');
    textWrap.className = 'preview-item-main';
    textWrap.textContent = `${index + 1}) ${item.question}`;

    const controls = document.createElement('div');
    controls.className = 'preview-item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-tiny';
    editBtn.textContent = 'แก้ไข';
    editBtn.addEventListener('click', () => {
      editingQuestionIndex = index;
      fillQuestionForm(item);
      nextQuestionBtn.textContent = `บันทึกข้อ ${index + 1}`;
      setNotice(`กำลังแก้ไขข้อ ${index + 1}`);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-secondary btn-tiny';
    deleteBtn.textContent = 'ลบ';
    deleteBtn.addEventListener('click', () => {
      draftQuestions.splice(index, 1);
      if (editingQuestionIndex === index) {
        resetQuestionForm();
      }
      renderPreview();
    });

    controls.appendChild(editBtn);
    controls.appendChild(deleteBtn);
    li.appendChild(textWrap);
    li.appendChild(controls);
    previewList.appendChild(li);
  });

  questionCounter.textContent = draftQuestions.length
    ? `สะสมแล้ว ${draftQuestions.length} ข้อ`
    : 'ยังไม่มีข้อสอบ';
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

function renderCourseLibrary(courses) {
  courseLibrary.innerHTML = '';

  if (!courses.length) {
    courseLibrary.innerHTML = '<li class="muted">ยังไม่มีคอร์สในระบบ</li>';
    return;
  }

  courses.forEach((course) => {
    const li = document.createElement('li');
    li.className = 'library-item';

    const meta = document.createElement('div');
    meta.innerHTML = `<strong>${course.title}</strong><br><span class="muted">${course.courseId}</span>`;

    const actions = document.createElement('div');
    actions.className = 'library-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-tiny';
    editBtn.textContent = 'เปิดแก้ไข';
    editBtn.addEventListener('click', () => loadCourseToEditor(course.courseId));

    const link = document.createElement('a');
    link.className = 'btn btn-tiny';
    link.href = getQuizLink(course.courseId);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'ลิงก์แบบทดสอบ';

    actions.appendChild(editBtn);
    actions.appendChild(link);
    li.appendChild(meta);
    li.appendChild(actions);
    courseLibrary.appendChild(li);
  });
}

async function refreshCourseLibrary() {
  const courses = await getAllCourses();
  renderCourseLibrary(courses);
}

async function loadCourseToEditor(courseId) {
  try {
    const [course, questions] = await Promise.all([getCourse(courseId), getQuestionsByCourse(courseId)]);

    if (!course) {
      alert('ไม่พบคอร์สที่เลือก');
      return;
    }

    document.getElementById('courseId').value = course.courseId;
    document.getElementById('courseTitle').value = course.title;
    document.getElementById('tutorNameInput').value = course.tutorName;
    document.getElementById('tutorPhotoInput').value = course.tutorPhotoUrl;
    document.getElementById('tutorBioInput').value = course.tutorBio;

    draftQuestions.length = 0;
    questions.forEach((item) => {
      draftQuestions.push({
        question: item.question,
        choices: item.choices,
        answerIndex: Number(item.answerIndex),
      });
    });

    resetQuestionForm();
    renderPreview();
    setShareLink(course.courseId);
    setNotice(`โหลดคอร์ส ${course.courseId} สำเร็จ (${questions.length} ข้อ)`);
  } catch (error) {
    console.error(error);
    alert('โหลดคอร์สไม่สำเร็จ โปรดลองใหม่');
  }
}

nextQuestionBtn.addEventListener('click', () => {
  const payload = readQuestionPayload();
  if (!validateQuestion(payload)) {
    return;
  }

  if (editingQuestionIndex >= 0) {
    draftQuestions[editingQuestionIndex] = payload;
    setNotice(`บันทึกการแก้ไขข้อ ${editingQuestionIndex + 1} แล้ว`);
  } else {
    draftQuestions.push(payload);
  }

  resetQuestionForm();
  renderPreview();
});

finishBtn.addEventListener('click', async () => {
  const coursePayload = readCoursePayload();

  if (!validateCourse(coursePayload)) {
    return;
  }

  if (draftQuestions.length < 1) {
    alert('เพิ่มข้อสอบอย่างน้อย 1 ข้อก่อนบันทึก');
    return;
  }

  try {
    finishBtn.disabled = true;
    await saveCourse(coursePayload);
    await replaceQuestionsForCourse(coursePayload.courseId, draftQuestions);

    await refreshCourseLibrary();
    setShareLink(coursePayload.courseId);
    setNotice(`บันทึกคอร์ส ${coursePayload.courseId} และข้อสอบ ${draftQuestions.length} ข้อเรียบร้อย`);
    alert(`บันทึกสำเร็จ! แชร์ลิงก์ได้เลย: ${getQuizLink(coursePayload.courseId)}`);
  } catch (error) {
    console.error(error);
    alert('บันทึกข้อมูลไม่สำเร็จ โปรดตรวจสอบสิทธิ์ Firestore และลองใหม่');
  } finally {
    finishBtn.disabled = false;
  }
});

copyLinkBtn.addEventListener('click', async () => {
  if (!shareLinkInput.value) {
    alert('ยังไม่มีลิงก์ให้คัดลอก ให้บันทึกคอร์สก่อน');
    return;
  }

  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    setNotice('คัดลอกลิงก์แบบทดสอบแล้ว');
  } catch (error) {
    console.error(error);
    setNotice('คัดลอกไม่สำเร็จ ให้คัดลอกจากช่องลิงก์ด้วยตนเอง');
  }
});

refreshCourseLibrary().catch((error) => {
  console.error(error);
  setNotice('โหลดคลังคอร์สไม่สำเร็จ');
});
