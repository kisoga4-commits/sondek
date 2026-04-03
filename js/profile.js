import { getCourse, getProfile } from './db.js';

const params = new URLSearchParams(window.location.search);
const courseId = params.get('id') || params.get('courseId') || params.get('course') || '';

const DEFAULT_PROFILE_IMAGE = 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=600&q=80';

const closeBtn = document.getElementById('closeBtn');
const statusText = document.getElementById('statusText');
const profileImage = document.getElementById('profileImage');
const profileName = document.getElementById('profileName');
const profileBio = document.getElementById('profileBio');
const teachingGallery = document.getElementById('teachingGallery');
const enrollLink = document.getElementById('enrollLink');

function getBasePathUrl(pathname) {
  const basePath = pathname.includes('/')
    ? pathname.slice(0, pathname.lastIndexOf('/') + 1)
    : '/';
  return `${window.location.origin}${basePath}`;
}

function optimizeTeachingImageUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';

  if (url.includes('images.unsplash.com')) {
    const [base] = url.split('?');
    return `${base}?auto=format&fit=crop&w=720&h=540&q=70`;
  }

  return url;
}

function renderTeachingGallery(images = []) {
  teachingGallery.innerHTML = '';
  const cleanImages = Array.isArray(images)
    ? images.map((url) => String(url || '').trim()).filter(Boolean)
    : [];

  if (!cleanImages.length) {
    const empty = document.createElement('p');
    empty.className = 'rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600';
    empty.textContent = 'ยังไม่มีรูปกิจกรรมการสอนเพิ่มเติม';
    teachingGallery.appendChild(empty);
    return;
  }

  cleanImages.forEach((url, index) => {
    const wrap = document.createElement('figure');
    wrap.className = 'mx-auto w-full max-w-xs overflow-hidden rounded-2xl border border-slate-200 bg-slate-50';

    const img = document.createElement('img');
    img.src = optimizeTeachingImageUrl(url);
    img.alt = `รูปการสอน ${index + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = 'aspect-[4/3] w-full object-cover object-center';

    wrap.appendChild(img);
    teachingGallery.appendChild(wrap);
  });
}

async function init() {
  try {
    const [course, profile] = await Promise.all([
      courseId ? getCourse(courseId) : Promise.resolve(null),
      getProfile(),
    ]);

    profileImage.src = profile?.imageUrl || DEFAULT_PROFILE_IMAGE;
    profileName.textContent = profile?.name || 'ครูผู้สอน';
    profileBio.textContent = profile?.bio || 'ยังไม่มีข้อมูลประวัติครูในระบบ';

    const teachingImages = Array.isArray(profile?.teachingImages) && profile.teachingImages.length
      ? profile.teachingImages
      : (profile?.imageUrl ? [profile.imageUrl] : []);
    renderTeachingGallery(teachingImages);

    const baseUrl = getBasePathUrl(window.location.pathname);
    enrollLink.href = course?.enrollmentUrl || `${baseUrl}adminchamp.html#course-destination`;

    if (!courseId) {
      statusText.textContent = 'เปิดหน้าโปรไฟล์สำเร็จ (ไม่ได้ระบุรหัสคอร์ส)';
      return;
    }

    statusText.textContent = course
      ? `ข้อมูลโปรไฟล์สำหรับคอร์ส: ${course.title || course.courseId || courseId}`
      : `เปิดหน้าโปรไฟล์ (ไม่พบคอร์ส ${courseId})`;
  } catch (error) {
    console.error(error);
    statusText.textContent = 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่';
  }
}

closeBtn?.addEventListener('click', () => {
  if (window.opener) {
    window.close();
    return;
  }

  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  const baseUrl = getBasePathUrl(window.location.pathname);
  window.location.href = `${baseUrl}quiz.html`;
});

init();
