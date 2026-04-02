import { getCourse, getLeaderboard } from './db.js';

const params = new URLSearchParams(window.location.search);
const courseId = params.get('id');

const topCourseTitle = document.getElementById('topCourseTitle');
const topList = document.getElementById('topList');
const emptyTop = document.getElementById('emptyTop');
const retryLink = document.getElementById('retryLink');

async function init() {
  if (!courseId) {
    topCourseTitle.textContent = 'ไม่พบรหัสแบบทดสอบ';
    retryLink.classList.add('hidden');
    return;
  }

  const basePath = window.location.pathname.includes('/')
    ? window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1)
    : '/';
  retryLink.href = `${window.location.origin}${basePath}quiz.html?id=${encodeURIComponent(courseId)}`;

  const [course, leaders] = await Promise.all([
    getCourse(courseId),
    getLeaderboard(courseId),
  ]);

  topCourseTitle.textContent = course?.title || `แบบทดสอบ ${courseId}`;
  topList.innerHTML = '';

  if (!leaders.length) {
    emptyTop.classList.remove('hidden');
    return;
  }

  leaders.forEach((lead, index) => {
    const li = document.createElement('li');
    li.className = 'rounded-xl border border-amber-200 bg-amber-50 p-3';
    li.innerHTML = `
      <p class="text-lg font-bold">${index + 1}. ${lead.name || '-'}</p>
      <p class="text-sm text-slate-700">คะแนน ${lead.scorePercent || 0}% • เวลา ${lead.durationSeconds || 0} วินาที</p>
    `;
    topList.appendChild(li);
  });
}

init().catch((error) => {
  console.error(error);
  topCourseTitle.textContent = 'โหลดอันดับไม่สำเร็จ กรุณาลองใหม่';
});
