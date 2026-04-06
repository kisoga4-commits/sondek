import { getCourse, getLeaderboard } from './db.js';

const params = new URLSearchParams(window.location.search);
const courseId = params.get('id');

const topCourseTitle = document.getElementById('topCourseTitle');
const topList = document.getElementById('topList');
const emptyTop = document.getElementById('emptyTop');
const retryLink = document.getElementById('retryLink');
const openRankModal = document.getElementById('openRankModal');
const closeRankModal = document.getElementById('closeRankModal');
const rankModal = document.getElementById('rankModal');

function getRankIcon(rank) {
  if (rank === 0) return '👑';
  if (rank === 1) return '🥈';
  if (rank === 2) return '🥉';
  return '🎖️';
}

function showModal() {
  rankModal.classList.remove('hidden');
  rankModal.classList.add('flex');
}

function hideModal() {
  rankModal.classList.add('hidden');
  rankModal.classList.remove('flex');
}

async function init() {
  if (!courseId) {
    topCourseTitle.textContent = 'ไม่พบรหัสแบบทดสอบ';
    retryLink.classList.add('hidden');
    openRankModal.classList.add('hidden');
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
    li.className = 'flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3';
    li.innerHTML = `
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl">${getRankIcon(index)}</div>
      <div>
        <p class="text-lg font-bold">${lead.name || '-'}</p>
        <p class="text-sm text-slate-700">อันดับ ${index + 1} • ${lead.scorePercent || 0}/100 • ${lead.durationSeconds || 0} วินาที</p>
      </div>
    `;
    topList.appendChild(li);
  });
}

if (openRankModal) {
  openRankModal.addEventListener('click', showModal);
}
if (closeRankModal) {
  closeRankModal.addEventListener('click', hideModal);
}
if (rankModal) {
  rankModal.addEventListener('click', (event) => {
    if (event.target === rankModal) hideModal();
  });
}

init().catch((error) => {
  console.error(error);
  topCourseTitle.textContent = 'โหลดอันดับไม่สำเร็จ กรุณาลองใหม่';
});
