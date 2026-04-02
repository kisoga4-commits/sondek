import { getAllCourses } from './db.js';

const quizLibrary = document.getElementById('quizLibrary');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

    const card = document.createElement('article');
    card.className = 'library-item';
    card.innerHTML = `
      <div>
        <p class="item-title">${title}</p>
        <p class="muted item-sub">${courseId}</p>
      </div>
      <div class="item-actions">
        <a class="btn" href="${editLink}">เปิดแก้ไข</a>
        <a class="btn btn-secondary" href="index.html?id=${encodeURIComponent(course.courseId)}" target="_blank" rel="noopener noreferrer">เปิดข้อสอบ</a>
      </div>
    `;

    quizLibrary.appendChild(card);
  });
}

async function initQuizLibrary() {
  if (!quizLibrary) return;

  quizLibrary.innerHTML = '<p class="muted">กำลังโหลดบททดสอบ...</p>';

  try {
    const courses = await getAllCourses();
    renderCourses(courses);
  } catch (error) {
    console.error(error);
    quizLibrary.innerHTML = '<p class="muted">โหลดคลังบททดสอบไม่สำเร็จ</p>';
  }
}

void initQuizLibrary();
