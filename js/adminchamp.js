import {
  deleteCourseWithQuestions,
  deleteLeadById,
  getAllCourses,
  saveCourse,
  saveProfile,
  subscribeCourses,
  subscribeLeads,
  subscribeProfile,
} from './db.js';

const courseTableBody = document.getElementById('courseTableBody');
const activeCoursesWrap = document.getElementById('activeCoursesWrap');
const profileForm = document.getElementById('profileForm');

function maskPhoneForAdmin(phoneRaw) {
  const phone = String(phoneRaw || '').replace(/\D/g, '');
  if (phone.length < 9) return phoneRaw || '-';
  return `${phone.slice(0, 2)}X-XXXXX${phone.slice(-2)}`;
}

function renderCoursesTable(courses) {
  courseTableBody.innerHTML = '';
  if (!courses.length) {
    courseTableBody.innerHTML = '<tr><td colspan="4" class="muted">ยังไม่มีคอร์ส</td></tr>';
    return;
  }

  courses.forEach((course) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${course.courseId}</td>
      <td>${course.title || '-'}</td>
      <td>${course.status === 'closed' ? 'ปิดแล้ว' : 'เปิดอยู่'}</td>
      <td class="table-actions">
        <button class="btn btn-tiny btn-success" data-act="edit" data-id="${course.courseId}">เปิดแก้ไข</button>
        <button class="btn btn-tiny btn-primary" data-act="copy" data-url="${course.quizLink || `${window.location.origin}/index.html?id=${course.courseId}`}">ลิงก์แบบทดสอบ</button>
      </td>`;
    courseTableBody.appendChild(tr);
  });
}

function renderActiveCourses(courses, leads) {
  activeCoursesWrap.innerHTML = '';
  if (!courses.length) {
    activeCoursesWrap.innerHTML = '<p class="muted">ยังไม่มีคอร์สที่เปิดสอน</p>';
    return;
  }

  courses.forEach((course) => {
    const block = document.createElement('section');
    block.className = 'course-block';

    const courseLeads = leads.filter((lead) => lead.courseId === course.courseId);
    const leadRows = courseLeads.length
      ? courseLeads
          .map(
            (lead) => `<li>
              <span><strong>${lead.name || '-'}</strong> (${maskPhoneForAdmin(lead.phone)}) - ${lead.scorePercent || 0}%</span>
              <button class="btn btn-danger btn-tiny" data-act="delLead" data-id="${lead.id}">ลบ</button>
            </li>`,
          )
          .join('')
      : '<li class="muted">ยังไม่มีนักเรียนทำข้อสอบ</li>';

    block.innerHTML = `
      <div class="course-head">
        <h3>${course.title || course.courseId}</h3>
        <div class="course-inline-actions">
          <select data-act="status" data-id="${course.courseId}">
            <option value="open" ${course.status !== 'closed' ? 'selected' : ''}>เปิดอยู่</option>
            <option value="closed" ${course.status === 'closed' ? 'selected' : ''}>ปิดแล้ว</option>
          </select>
          <button class="btn btn-tiny" data-act="saveCourseMeta" data-id="${course.courseId}">บันทึก</button>
          <button class="btn btn-danger btn-tiny" data-act="delCourse" data-id="${course.courseId}">ลบคอร์ส</button>
        </div>
      </div>
      <ul class="lead-list">${leadRows}</ul>`;

    activeCoursesWrap.appendChild(block);
  });
}

let cachedCourses = [];
let cachedLeads = [];

subscribeCourses((courses) => {
  cachedCourses = courses;
  renderCoursesTable(courses);
  renderActiveCourses(cachedCourses, cachedLeads);
});

subscribeLeads((leads) => {
  cachedLeads = leads;
  renderActiveCourses(cachedCourses, cachedLeads);
});

subscribeProfile((profile) => {
  if (!profile) return;
  document.getElementById('profileName').value = profile.name || '';
  document.getElementById('profileBio').value = profile.bio || '';
  document.getElementById('profileImageUrl').value = profile.imageUrl || '';
  document.getElementById('profileUrl').value = profile.profileUrl || '';
});

courseTableBody.addEventListener('click', async (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;

  if (btn.dataset.act === 'copy') {
    await navigator.clipboard.writeText(btn.dataset.url);
    alert('คัดลอกลิงก์แล้ว');
  }

  if (btn.dataset.act === 'edit') {
    window.location.href = `template.html?id=${btn.dataset.id}`;
  }
});

activeCoursesWrap.addEventListener('click', async (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  const courseId = btn.dataset.id;

  if (btn.dataset.act === 'delLead') {
    await deleteLeadById(courseId);
  }

  if (btn.dataset.act === 'delCourse') {
    const ok = window.confirm(`ยืนยันลบคอร์ส ${courseId}?`);
    if (!ok) return;
    await deleteCourseWithQuestions(courseId);
  }

  if (btn.dataset.act === 'saveCourseMeta') {
    const select = activeCoursesWrap.querySelector(`select[data-id="${courseId}"]`);
    const course = cachedCourses.find((c) => c.courseId === courseId);
    if (!course) return;

    await saveCourse({
      ...course,
      status: select.value,
    });
    alert('อัปเดตสถานะคอร์สแล้ว');
  }
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveProfile({
    name: document.getElementById('profileName').value.trim(),
    bio: document.getElementById('profileBio').value.trim(),
    imageUrl: document.getElementById('profileImageUrl').value.trim(),
    profileUrl: document.getElementById('profileUrl').value.trim(),
  });
  alert('บันทึกโปรไฟล์เรียบร้อย');
});

(async function ensureDefaultCourse() {
  const courses = await getAllCourses();
  if (courses.length) return;
  await saveCourse({
    courseId: 'course_01',
    title: 'Course 1',
    status: 'open',
    enrollmentUrl: '',
    quizLink: `${window.location.origin}/index.html?id=course_01`,
  });
})();
