import {
  saveCourseEnrollment,
  subscribeCourseOfferings,
} from './db.js';

const publicCourseList = document.getElementById('publicCourseList');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function onEnrollCourse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const courseId = String(form?.dataset?.courseId || '');
  if (!courseId) return;

  const studentNameInput = form.querySelector('input[name="studentName"]');
  const studentPhoneInput = form.querySelector('input[name="studentPhone"]');

  const studentName = String(studentNameInput?.value || '').trim();
  const studentPhone = String(studentPhoneInput?.value || '').trim();

  if (!studentName) {
    alert('กรุณากรอกชื่อก่อนส่งสมัคร');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  try {
    if (submitBtn) submitBtn.disabled = true;
    await saveCourseEnrollment(courseId, { studentName, studentPhone });
    form.reset();
    alert('ส่งชื่อเรียบร้อย รอผู้สอนอนุมัติได้เลย');
  } catch (error) {
    console.error(error);
    alert('ส่งชื่อไม่สำเร็จ กรุณาลองใหม่');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function renderOpenCourses(courseOffers) {
  if (!publicCourseList) return;
  publicCourseList.innerHTML = '';

  const openCourses = (Array.isArray(courseOffers) ? courseOffers : [])
    .filter((course) => String(course?.status || 'open') === 'open');

  if (!openCourses.length) {
    publicCourseList.innerHTML = '<p class="muted">ตอนนี้ยังไม่มีคอร์สที่เปิดรับสมัคร</p>';
    return;
  }

  openCourses.forEach((course) => {
    const card = document.createElement('article');
    card.className = 'course-card is-open';
    card.innerHTML = `
      <header class="course-card-head">
        <div>
          <h3>${escapeHtml(course?.title || 'ไม่ระบุชื่อคอร์ส')}</h3>
          <p class="muted">วันเรียน: ${escapeHtml(course?.scheduleDetails || course?.day || '-')}</p>
          <p class="muted">ราคา: ${escapeHtml(course?.price || '-')}</p>
        </div>
        <span class="status-pill">เปิดรับสมัคร</span>
      </header>
      <p class="muted">${escapeHtml(course?.content || 'ยังไม่ได้ระบุเนื้อหา')}</p>
      <form class="course-enroll-form" data-course-id="${escapeHtml(course?.courseId || '')}">
        <p class="student-title">ส่งชื่อเพื่อรออนุมัติ</p>
        <div class="form-split">
          <input type="text" name="studentName" placeholder="ชื่อของคุณ" required />
          <input type="tel" name="studentPhone" placeholder="เบอร์โทร (ถ้ามี)" />
        </div>
        <button class="btn btn-compact" type="submit">ส่งชื่อสมัคร</button>
      </form>
    `;

    const enrollForm = card.querySelector('.course-enroll-form');
    if (enrollForm) {
      enrollForm.addEventListener('submit', (event) => {
        void onEnrollCourse(event);
      });
    }

    publicCourseList.appendChild(card);
  });
}

subscribeCourseOfferings((courseOffers) => {
  renderOpenCourses(courseOffers);
}, (error) => {
  console.error(error);
  if (publicCourseList) {
    publicCourseList.innerHTML = '<p class="muted">โหลดคอร์สไม่สำเร็จ กรุณารีเฟรช</p>';
  }
});
