import { getAllCourses, getCourse, getLeaderboard } from './db.js';

const params = new URLSearchParams(window.location.search);
const courseId = params.get('id');

const topCourseTitle = document.getElementById('topCourseTitle');
const topList = document.getElementById('topList');
const emptyTop = document.getElementById('emptyTop');
const retryLink = document.getElementById('retryLink');
const openRankModal = document.getElementById('openRankModal');
const closeRankModal = document.getElementById('closeRankModal');
const rankModal = document.getElementById('rankModal');
const allTopSection = document.getElementById('allTopSection');
const courseTopList = document.getElementById('courseTopList');

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

function renderTopList(items = [], options = {}) {
  const { includeCourse = false } = options;
  topList.innerHTML = '';

  if (!items.length) {
    emptyTop.classList.remove('hidden');
    return;
  }

  emptyTop.classList.add('hidden');
  items.forEach((lead, index) => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3';
    li.innerHTML = `
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl">${getRankIcon(index)}</div>
      <div>
        <p class="text-lg font-bold">${lead.name || '-'}</p>
        <p class="text-sm text-slate-700">อันดับ ${index + 1} • ${lead.scorePercent || 0}/100 • ${lead.durationSeconds || 0} วินาที</p>
        ${includeCourse ? `<p class="text-xs text-slate-500">บททดสอบ: ${lead.courseTitle || lead.courseId || '-'}</p>` : ''}
      </div>
    `;
    topList.appendChild(li);
  });
}

async function getGlobalTopLeaders(limit = 10) {
  const courses = await getAllCourses();
  const cards = await Promise.all(courses.map(async (course) => {
    const leaders = await getLeaderboard(course.courseId).catch(() => []);
    return {
      course,
      leaders,
    };
  }));

  return cards
    .flatMap(({ course, leaders }) => leaders.map((lead) => ({
      ...lead,
      courseId: course?.courseId || '',
      courseTitle: course?.title || course?.courseId || '',
    })))
    .sort((a, b) => {
      const scoreDiff = Number(b.scorePercent || 0) - Number(a.scorePercent || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(a.durationSeconds || 0) - Number(b.durationSeconds || 0);
    })
    .slice(0, limit);
}

async function init() {
  const basePath = window.location.pathname.includes('/')
    ? window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1)
    : '/';

  if (!courseId) {
    topCourseTitle.textContent = 'อันดับคะแนนรวม TOP จากทุกบททดสอบ';
    retryLink.classList.add('hidden');

    const [globalLeaders] = await Promise.all([
      getGlobalTopLeaders(10),
      renderAllCourseTopCards(),
    ]);

    renderTopList(globalLeaders, { includeCourse: true });
    if (allTopSection) allTopSection.classList.remove('hidden');
    return;
  }

  retryLink.href = `${window.location.origin}${basePath}quiz.html?id=${encodeURIComponent(courseId)}`;

  const [course, leaders] = await Promise.all([
    getCourse(courseId),
    getLeaderboard(courseId),
  ]);

  topCourseTitle.textContent = course?.title || `แบบทดสอบ ${courseId}`;
  renderTopList(leaders);
}

async function renderAllCourseTopCards() {
  if (!courseTopList) return;
  courseTopList.innerHTML = '<p class="text-slate-500">กำลังโหลดรายการบททดสอบ...</p>';

  try {
    const courses = await getAllCourses();
    if (!courses.length) {
      courseTopList.innerHTML = '<p class="text-slate-500">ยังไม่มีบททดสอบในระบบ</p>';
      return;
    }

    const cards = await Promise.all(courses.map(async (course) => {
      const leaders = await getLeaderboard(course.courseId).catch(() => []);
      return { course, leaders };
    }));

    courseTopList.innerHTML = '';
    cards.forEach(({ course, leaders }) => {
      const link = `top.html?id=${encodeURIComponent(course.courseId)}`;
      const item = document.createElement('article');
      item.className = 'rounded-2xl border border-amber-100 bg-amber-50 p-4';
      item.innerHTML = `
        <h3 class="text-lg font-black text-slate-800">${course.title || course.courseId}</h3>
        <p class="mt-1 text-sm text-slate-600">รหัส: ${course.courseId}</p>
        <p class="mt-2 text-sm font-semibold text-slate-700">
          ${leaders.length ? `อันดับ 1: ${leaders[0]?.name || '-'} (${leaders[0]?.scorePercent || 0}/100)` : 'ยังไม่มีผู้ทำแบบทดสอบ'}
        </p>
        <a href="${link}" class="mt-3 inline-block rounded-xl bg-indigo-600 px-3 py-2 text-sm font-black text-white">ดู TOP 5 ของบทนี้</a>
      `;
      courseTopList.appendChild(item);
    });
  } catch (error) {
    console.error(error);
    courseTopList.innerHTML = '<p class="text-rose-600">โหลดรายการบททดสอบไม่สำเร็จ กรุณารีเฟรช</p>';
  }
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
