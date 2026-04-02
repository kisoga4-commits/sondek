import {
  addQuestion,
  deleteCourseWithQuestions,
  deleteLeadById,
  deleteQuestionById,
  saveCourse,
  subscribeCourses,
  subscribeLeads,
  subscribeQuestionsByCourse,
  updateQuestion,
} from './db.js';

const SIMPLE_PASSWORD = 'champ2026';

const gateCard = document.getElementById('gateCard');
const dashboardCard = document.getElementById('dashboardCard');
const unlockBtn = document.getElementById('unlockBtn');
const adminPassword = document.getElementById('adminPassword');
const gateMessage = document.getElementById('gateMessage');
const adminNotice = document.getElementById('adminNotice');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

const courseForm = document.getElementById('courseForm');
const questionForm = document.getElementById('questionForm');
const saveCourseBtn = document.getElementById('saveCourseBtn');
const deleteCourseBtn = document.getElementById('deleteCourseBtn');
const saveQuestionBtn = document.getElementById('saveQuestionBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');

const courseLibrary = document.getElementById('courseLibrary');
const previewList = document.getElementById('previewList');
const questionCounter = document.getElementById('questionCounter');
const leadsTableBody = document.getElementById('leadsTableBody');

let currentCourseId = '';
let editingQuestionId = '';
let unsubscribeQuestions = null;
let currentQuestions = [];

function setNotice(text) {
  adminNotice.textContent = text;
}

function formatDuration(seconds) {
  const totalSeconds = Number(seconds || 0);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins} นาที ${secs} วินาที`;
}

function switchTab(tabId) {
  tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabId);
  });

  tabPanes.forEach((pane) => {
    pane.classList.toggle('active', pane.id === tabId);
  });
}

function readCoursePayload() {
  const formData = new FormData(courseForm);
  return {
    courseId: String(formData.get('courseId') || '').trim(),
    title: String(formData.get('courseTitle') || '').trim(),
    tutorName: String(formData.get('tutorNameInput') || '').trim(),
    tutorPhotoUrl: String(formData.get('tutorPhotoInput') || '').trim(),
    tutorBio: String(formData.get('tutorBioInput') || '').trim(),
  };
}

function readQuestionPayload() {
  return {
    question: document.getElementById('qText').value.trim(),
    choices: [
      document.getElementById('choiceA').value.trim(),
      document.getElementById('choiceB').value.trim(),
      document.getElementById('choiceC').value.trim(),
      document.getElementById('choiceD').value.trim(),
    ],
    answerIndex: Number(document.getElementById('answer').value),
  };
}

function validateCourse(payload) {
  const required = [payload.courseId, payload.title, payload.tutorName, payload.tutorPhotoUrl, payload.tutorBio];
  if (required.some((value) => !value)) {
    alert('กรอกข้อมูลคอร์สให้ครบก่อนบันทึก');
    return false;
  }
  return true;
}

function validateQuestion(payload) {
  if (!payload.question || payload.choices.some((choice) => !choice)) {
    alert('กรอกโจทย์และตัวเลือกให้ครบ');
    return false;
  }
  return true;
}

function fillCourseForm(course) {
  document.getElementById('courseId').value = course.courseId;
  document.getElementById('courseTitle').value = course.title;
  document.getElementById('tutorNameInput').value = course.tutorName;
  document.getElementById('tutorPhotoInput').value = course.tutorPhotoUrl;
  document.getElementById('tutorBioInput').value = course.tutorBio;
  currentCourseId = course.courseId;

  setNotice(`เลือกคอร์ส ${course.courseId}`);
  subscribeQuestionStream(course.courseId);
}

function fillQuestionForm(question) {
  document.getElementById('qText').value = question.question;
  document.getElementById('choiceA').value = question.choices?.[0] || '';
  document.getElementById('choiceB').value = question.choices?.[1] || '';
  document.getElementById('choiceC').value = question.choices?.[2] || '';
  document.getElementById('choiceD').value = question.choices?.[3] || '';
  document.getElementById('answer').value = String(question.answerIndex || 0);
}

function resetQuestionForm() {
  questionForm.reset();
  editingQuestionId = '';
  saveQuestionBtn.textContent = 'เพิ่มข้อ';
}

function renderCourses(courses) {
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

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn btn-tiny';
    openBtn.textContent = 'เปิดแก้ไข';
    openBtn.addEventListener('click', () => fillCourseForm(course));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-tiny';
    deleteBtn.textContent = 'ลบคอร์ส';
    deleteBtn.addEventListener('click', async () => {
      const accepted = window.confirm(`ยืนยันลบคอร์ส ${course.courseId} และข้อสอบทั้งหมด?`);
      if (!accepted) {
        return;
      }
      await deleteCourseWithQuestions(course.courseId);
      if (currentCourseId === course.courseId) {
        courseForm.reset();
        previewList.innerHTML = '';
        questionCounter.textContent = 'ยังไม่มีข้อสอบ';
        currentCourseId = '';
      }
      setNotice(`ลบคอร์ส ${course.courseId} แล้ว`);
    });

    actions.appendChild(openBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(meta);
    li.appendChild(actions);
    courseLibrary.appendChild(li);
  });
}

function renderQuestions(questions) {
  previewList.innerHTML = '';

  if (!questions.length) {
    previewList.innerHTML = '<li class="muted">ยังไม่มีข้อสอบในคอร์สนี้</li>';
    questionCounter.textContent = 'ยังไม่มีข้อสอบ';
    return;
  }

  questionCounter.textContent = `ทั้งหมด ${questions.length} ข้อ`;

  questions.forEach((question, index) => {
    const li = document.createElement('li');

    const textWrap = document.createElement('div');
    textWrap.className = 'preview-item-main';
    textWrap.textContent = `${index + 1}) ${question.question}`;

    const actions = document.createElement('div');
    actions.className = 'preview-item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-primary btn-tiny';
    editBtn.textContent = 'แก้ไข';
    editBtn.addEventListener('click', () => {
      editingQuestionId = question.id;
      fillQuestionForm(question);
      saveQuestionBtn.textContent = `บันทึกข้อ ${index + 1}`;
      setNotice(`กำลังแก้ไขข้อ ${index + 1}`);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-tiny';
    deleteBtn.textContent = 'ลบ';
    deleteBtn.addEventListener('click', async () => {
      const accepted = window.confirm('ยืนยันลบโจทย์ข้อนี้?');
      if (!accepted) {
        return;
      }
      await deleteQuestionById(question.id);
      resetQuestionForm();
      setNotice('ลบข้อสอบแล้ว');
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(textWrap);
    li.appendChild(actions);
    previewList.appendChild(li);
  });
}

function renderLeads(leads) {
  leadsTableBody.innerHTML = '';

  if (!leads.length) {
    leadsTableBody.innerHTML = '<tr><td colspan="6" class="muted">ยังไม่มีข้อมูลนักเรียน</td></tr>';
    return;
  }

  leads.forEach((lead) => {
    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = lead.fullName || '-';

    const phoneCell = document.createElement('td');
    phoneCell.textContent = lead.phone || '-';

    const scoreCell = document.createElement('td');
    scoreCell.textContent = `${Number(lead.scorePercent || 0)}%`;

    const durationCell = document.createElement('td');
    durationCell.textContent = formatDuration(lead.durationSeconds || 0);

    const courseCell = document.createElement('td');
    courseCell.textContent = lead.courseId || '-';

    const actionCell = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-tiny';
    deleteBtn.textContent = 'ลบ Lead';
    deleteBtn.addEventListener('click', async () => {
      const accepted = window.confirm(`ยืนยันลบข้อมูลของ ${lead.fullName || 'ผู้เรียน'}?`);
      if (!accepted) {
        return;
      }
      await deleteLeadById(lead.id);
      setNotice('ลบข้อมูลนักเรียนแล้ว');
    });

    actionCell.appendChild(deleteBtn);

    tr.appendChild(nameCell);
    tr.appendChild(phoneCell);
    tr.appendChild(scoreCell);
    tr.appendChild(durationCell);
    tr.appendChild(courseCell);
    tr.appendChild(actionCell);

    leadsTableBody.appendChild(tr);
  });
}

function subscribeQuestionStream(courseId) {
  if (unsubscribeQuestions) {
    unsubscribeQuestions();
  }

  unsubscribeQuestions = subscribeQuestionsByCourse(
    courseId,
    (questions) => {
      currentQuestions = questions;
      renderQuestions(questions);
    },
    (error) => {
      console.error(error);
      setNotice('โหลดข้อสอบไม่สำเร็จ');
    },
  );
}

saveCourseBtn.addEventListener('click', async () => {
  const payload = readCoursePayload();
  if (!validateCourse(payload)) {
    return;
  }

  await saveCourse(payload);
  currentCourseId = payload.courseId;
  setNotice(`บันทึกคอร์ส ${payload.courseId} แล้ว`);
  subscribeQuestionStream(payload.courseId);
});

saveQuestionBtn.addEventListener('click', async () => {
  if (!currentCourseId) {
    alert('กรุณาเลือกหรือบันทึกคอร์สก่อนเพิ่มข้อสอบ');
    return;
  }

  const payload = readQuestionPayload();
  if (!validateQuestion(payload)) {
    return;
  }

  if (editingQuestionId) {
    await updateQuestion(editingQuestionId, payload);
    setNotice('แก้ไขข้อสอบเรียบร้อย');
  } else {
    await addQuestion(currentCourseId, payload, currentQuestions.length + 1);
    setNotice('เพิ่มข้อสอบเรียบร้อย');
  }

  resetQuestionForm();
});

cancelEditBtn.addEventListener('click', () => {
  resetQuestionForm();
  setNotice('ยกเลิกโหมดแก้ไข');
});

deleteCourseBtn.addEventListener('click', async () => {
  const payload = readCoursePayload();
  if (!payload.courseId) {
    alert('ยังไม่ได้เลือกคอร์ส');
    return;
  }

  const accepted = window.confirm(`ยืนยันลบคอร์ส ${payload.courseId} และข้อสอบทั้งหมด?`);
  if (!accepted) {
    return;
  }

  await deleteCourseWithQuestions(payload.courseId);
  courseForm.reset();
  resetQuestionForm();
  currentCourseId = '';
  previewList.innerHTML = '<li class="muted">ยังไม่มีข้อสอบในคอร์สนี้</li>';
  questionCounter.textContent = 'ยังไม่มีข้อสอบ';
  setNotice(`ลบคอร์ส ${payload.courseId} แล้ว`);
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

unlockBtn.addEventListener('click', () => {
  if (adminPassword.value !== SIMPLE_PASSWORD) {
    gateMessage.textContent = 'รหัสผ่านไม่ถูกต้อง';
    return;
  }

  gateCard.classList.add('hidden');
  dashboardCard.classList.remove('hidden');
  setNotice('เข้าสู่ระบบสำเร็จ');
});

subscribeCourses(
  (courses) => {
    renderCourses(courses);
  },
  (error) => {
    console.error(error);
    setNotice('โหลดคอร์สไม่สำเร็จ');
  },
);

subscribeLeads(
  (leads) => {
    renderLeads(leads);
  },
  (error) => {
    console.error(error);
    setNotice('โหลด Leads ไม่สำเร็จ');
  },
);
