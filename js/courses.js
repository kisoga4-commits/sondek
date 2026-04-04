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

function maskPhoneNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw.length <= 4) return `${raw.slice(0, 2)}xx`;
  return `${raw.slice(0, 3)}xxxx${raw.slice(-2)}`;
}

function toDate(value) {
  if (!value) return null;
  if (value?.toDate instanceof Function) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatThaiEnrollmentDateTime(value) {
  const dateValue = toDate(value);
  if (!dateValue) return '-';

  const dateText = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(dateValue);

  const timeText = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateValue);

  return `${dateText} ${timeText}`;
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

  if (!studentName || !studentPhone) {
    alert('กรุณากรอกชื่อและเบอร์โทรก่อนส่งสมัคร');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  try {
    if (submitBtn) submitBtn.disabled = true;
    await saveCourseEnrollment(courseId, { studentName, studentPhone });
    form.reset();
    alert('ส่งชื่อสมัครเรียบร้อยแล้ว');
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
    .filter((course) => String(course?.status || 'open') === 'open')
    .sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || ''), 'th'));

  if (!openCourses.length) {
    publicCourseList.innerHTML = '<p class="muted">ตอนนี้ยังไม่มีคอร์สที่เปิดรับสมัคร</p>';
    return;
  }

  openCourses.forEach((course) => {
    const enrollments = Array.isArray(course?.enrollments) ? course.enrollments : [];
    const enrollmentRows = enrollments
      .slice(0, 8)
      .map((item, index) => {
        const studentName = escapeHtml(String(item?.studentName || '-').trim() || '-');
        const studentPhone = escapeHtml(maskPhoneNumber(item?.studentPhone));
        const appliedAt = escapeHtml(formatThaiEnrollmentDateTime(item?.createdAt));
        return `<li class="enrollment-item">
          <div>
            <strong>${index + 1}. ${studentName}</strong> · เบอร์ ${studentPhone}
            <p class="enrollment-meta">${appliedAt}</p>
          </div>
        </li>`;
      })
      .join('');

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
        <p class="student-title">ส่งชื่อสมัครคอร์ส</p>
        <div class="form-split">
          <input type="text" name="studentName" placeholder="ชื่อของคุณ" required />
          <input type="tel" name="studentPhone" placeholder="เบอร์โทร" required />
        </div>
        <button class="btn btn-compact" type="submit">ส่งชื่อสมัคร</button>
      </form>
      <div class="enrollment-admin-box">
        <p class="student-title">รายชื่อผู้สมัครล่าสุด (${enrollments.length})</p>
        ${enrollmentRows ? `<ul>${enrollmentRows}</ul>` : '<p class="muted">ยังไม่มีผู้สมัคร</p>'}
      </div>
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
