import {
  deleteCourseWithQuestions,
  subscribeCourses,
} from './db.js';

const quizLibrary = document.getElementById('quizLibrary');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildQuizLink(course) {
  if (course?.quizLink) return course.quizLink;
  return `${window.location.origin}/quiz.html?id=${encodeURIComponent(course.courseId)}`;
}

async function copyLink(link) {
  try {
    await navigator.clipboard.writeText(link);
    alert('คัดลอกลิงก์แล้ว');
  } catch (error) {
    console.error(error);
    alert('คัดลอกลิงก์ไม่สำเร็จ');
  }
}

async function onDeleteCourse(courseId) {
  if (!window.confirm(`ยืนยันการลบแบบทดสอบ ${courseId} ?`)) {
    return;
  }

  try {
    await deleteCourseWithQuestions(courseId);
    alert('ลบแบบทดสอบสำเร็จ');
  } catch (error) {
    console.error(error);
    alert('ลบไม่สำเร็จ กรุณาลองใหม่');
  }
}

function renderCourses(courses) {
  quizLibrary.innerHTML = '';

  if (!courses.length) {
    quizLibrary.innerHTML = '<p class="muted">ยังไม่มีบททดสอบในระบบ</p>';
    return;
  }

  courses.forEach((course) => {
    const title = course.title ? escapeHtml(course.title) : escapeHtml(course.courseId);
    const courseId = escapeHtml(course.courseId);
    const editLink = `template.html?courseId=${encodeURIComponent(course.courseId)}`;
    const quizLink = buildQuizLink(course);

    const card = document.createElement('article');
    card.className = 'library-item library-item-grid';
    card.innerHTML = `
      <div>
        <p class="item-title">${title}</p>
        <p class="muted item-sub">${courseId}</p>
      </div>
      <div class="share-box">
        <input value="${escapeHtml(quizLink)}" readonly />
        <img alt="QR ${title}" src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(quizLink)}" />
      </div>
      <div class="item-actions">
        <a class="btn" href="${editLink}">แก้ไข</a>
        <a class="btn btn-secondary" href="${quizLink}" target="_blank" rel="noopener noreferrer">เปิดแบบทดสอบ</a>
        <button class="btn btn-secondary" type="button" data-action="copy">คัดลอกลิงก์</button>
        <button class="btn btn-danger" type="button" data-action="delete">ลบ</button>
      </div>
    `;

    card.querySelector('[data-action="copy"]').addEventListener('click', () => {
      void copyLink(quizLink);
    });

    card.querySelector('[data-action="delete"]').addEventListener('click', () => {
      void onDeleteCourse(course.courseId);
    });

    quizLibrary.appendChild(card);
  });
}

function initQuizLibrary() {
  if (!quizLibrary) return;

  quizLibrary.innerHTML = '<p class="muted">กำลังโหลดบททดสอบ...</p>';

  subscribeCourses(renderCourses, (error) => {
    console.error(error);
    quizLibrary.innerHTML = '<p class="muted">โหลดคลังบททดสอบไม่สำเร็จ</p>';
  });
}

initQuizLibrary();
