import {
  deleteCourseWithQuestions,
  getProfile,
  getPlayCountByCourse,
  getResultFeedbackConfig,
  saveResultFeedbackConfig,
  saveProfile,
  subscribeAuthStatus,
  subscribeCourses,
} from './db.js';
import { getDefaultFeedbackMap } from './quiz.js';

const quizLibrary = document.getElementById('quizLibrary');
const authStatusNotice = document.getElementById('authStatusNotice');
const feedbackModal = document.getElementById('feedbackModal');
const feedbackGrid = document.getElementById('feedbackGrid');
const openFeedbackEditorBtn = document.getElementById('openFeedbackEditorBtn');
const closeFeedbackModalBtn = document.getElementById('closeFeedbackModalBtn');
const saveFeedbackBtn = document.getElementById('saveFeedbackBtn');
const profileForm = document.getElementById('profileForm');
const profileNameInput = document.getElementById('profileNameInput');
const profileImageInput = document.getElementById('profileImageInput');
const profileImagePreviewStatus = document.getElementById('profileImagePreviewStatus');
const profileBioInput = document.getElementById('profileBioInput');
const profileTeachingImagesInput = document.getElementById('profileTeachingImagesInput');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const profileFormStatus = document.getElementById('profileFormStatus');
const openProfilePageBtn = document.getElementById('openProfilePageBtn');
const openMyProfileBtn = document.getElementById('openMyProfileBtn');
const openCourseDestinationBtn = document.getElementById('openCourseDestinationBtn');

const SCORE_BUCKETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function getBucketRangeLabel(bucket) {
  if (bucket === 100) return '100';
  return `${bucket}-${bucket + 9}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildQuizLink(course) {
  const currentPath = String(window.location.pathname || '/');
  const basePath = currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    : '/';
  return `${window.location.origin}${basePath}quiz.html?id=${encodeURIComponent(course?.courseId || '')}`;
}

function buildTop5Link(course) {
  const currentPath = String(window.location.pathname || '/');
  const basePath = currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    : '/';
  return `${window.location.origin}${basePath}top.html?id=${encodeURIComponent(course?.courseId || '')}`;
}

function buildProfileLink() {
  const currentPath = String(window.location.pathname || '/');
  const basePath = currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    : '/';
  return `${window.location.origin}${basePath}profile.html`;
}

function buildCourseDestinationLink() {
  const currentPath = String(window.location.pathname || '/');
  const basePath = currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    : '/';
  return `${window.location.origin}${basePath}adminchamp.html#course-destination`;
}

function getFriendlyProfileSaveError(error) {
  const errorCode = String(error?.code || '');
  const errorMessage = String(error?.message || '');

  if (errorCode.includes('auth/not-authenticated')) {
    return 'บันทึกไม่สำเร็จ เพราะระบบยังล็อกอินไม่ได้\n\nกรุณาเปิด Firebase Authentication > Sign-in method > Anonymous แล้วลองใหม่';
  }

  if (errorCode.includes('permission-denied') || errorMessage.includes('Missing or insufficient permissions')) {
    return 'บันทึกไม่สำเร็จ เพราะบัญชีนี้ยังไม่มีสิทธิ์เขียนข้อมูลใน Firestore\n\nตรวจสอบ Firebase Rules ให้อนุญาต write เมื่อ request.auth != null แล้วลองใหม่';
  }

  return `บันทึกโปรไฟล์ไม่สำเร็จ${errorMessage ? `: ${errorMessage}` : ''}`;
}

function updateProfileImagePreviewStatus() {
  if (!profileImagePreviewStatus) return;
  const value = String(profileImageInput?.value || '').trim();
  profileImagePreviewStatus.textContent = value
    ? 'ตั้งค่าลิงก์รูปโปรไฟล์แล้ว พร้อมบันทึก'
    : 'ยังไม่ได้ใส่ลิงก์รูปโปรไฟล์';
}

function resolveProfileImageUrl(profile) {
  return String(profile?.profile_image_url || profile?.imageUrl || '').trim();
}

function parseMultilineUrls(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function loadProfileForm() {
  if (!profileForm) return;

  try {
    const profile = await getProfile();
    if (profileNameInput) profileNameInput.value = profile?.name || '';
    if (profileImageInput) profileImageInput.value = resolveProfileImageUrl(profile);
    updateProfileImagePreviewStatus();
    if (profileBioInput) profileBioInput.value = profile?.bio || '';
    if (profileTeachingImagesInput) {
      profileTeachingImagesInput.value = Array.isArray(profile?.teachingImages)
        ? profile.teachingImages.map((url) => String(url || '').trim()).filter(Boolean).join('\n')
        : '';
    }
    if (profileFormStatus) {
      profileFormStatus.textContent = 'โหลดข้อมูลโปรไฟล์แล้ว พร้อมแก้ไข';
    }
  } catch (error) {
    console.error(error);
    if (profileFormStatus) {
      profileFormStatus.textContent = 'โหลดข้อมูลโปรไฟล์ไม่สำเร็จ แต่ยังสามารถกรอกใหม่และบันทึกได้';
    }
  }
}

async function onSaveProfile(event) {
  event.preventDefault();
  if (!profileForm) return;

  const payload = {
    name: String(profileNameInput?.value || '').trim(),
    profile_image_url: String(profileImageInput?.value || '').trim(),
    bio: String(profileBioInput?.value || '').trim(),
    teachingImages: parseMultilineUrls(profileTeachingImagesInput?.value || ''),
  };

  if (!payload.name || !payload.profile_image_url) {
    alert('กรุณากรอกชื่อครู และลิงก์รูปโปรไฟล์');
    return;
  }

  try {
    if (saveProfileBtn) saveProfileBtn.disabled = true;
    await saveProfile(payload);
    if (profileFormStatus) profileFormStatus.textContent = 'บันทึกโปรไฟล์เรียบร้อยแล้ว กด "เปิดหน้าโปรไฟล์" เพื่อตรวจสอบได้ทันที';
    alert('บันทึกโปรไฟล์สำเร็จ');
  } catch (error) {
    console.error(error);
    if (profileFormStatus) profileFormStatus.textContent = 'บันทึกโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่';
    alert(getFriendlyProfileSaveError(error));
  } finally {
    if (saveProfileBtn) saveProfileBtn.disabled = false;
  }
}

function downloadQrFromImage(qrSrc, courseId) {
  const link = document.createElement('a');
  link.href = qrSrc;
  link.download = `qr-${courseId}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
    const result = await deleteCourseWithQuestions(courseId);
    if (result?.mode === 'soft_delete') {
      alert(`ลบแบบทดสอบแบบถาวรไม่ได้ เพราะสิทธิ์ลบยังไม่เปิดใน Firestore\n\nระบบซ่อนคอร์สนี้ออกจากหน้า Admin ให้แล้ว (soft delete)`);
      return;
    }
    alert('ลบแบบทดสอบสำเร็จ');
  } catch (error) {
    console.error(error);
    const errorCode = String(error?.code || '');
    const errorMessage = String(error?.message || '');
    const isPermissionIssue = errorCode.includes('permission-denied')
      || errorMessage.includes('Missing or insufficient permissions');
    const isAuthIssue = errorCode.includes('auth/not-authenticated');

    if (isAuthIssue) {
      alert('ลบไม่สำเร็จ: ยังไม่สามารถล็อกอินแบบ Anonymous ได้\n\nวิธีแก้:\n1) ไปที่ Firebase Console > Authentication > Sign-in method\n2) เปิด Anonymous ให้ใช้งาน\n3) ไปที่ Firestore Database > Rules แล้วอนุญาต delete ให้ request.auth != null\n4) Publish rules แล้วรีเฟรชหน้าเว็บ');
      return;
    }

    if (isPermissionIssue) {
      alert('ลบไม่สำเร็จ: บัญชีนี้ยังไม่มีสิทธิ์ลบข้อมูลใน Firestore (Missing or insufficient permissions)\n\nวิธีแก้:\n1) เปิด Firebase Console > Firestore Database > Rules\n2) อนุญาตสิทธิ์ delete ให้ผู้ใช้ที่ล็อกอิน (รวม anonymous ถ้าใช้)\n3) ไปที่ Firebase Console > Authentication > Sign-in method แล้วเปิด Anonymous ถ้ายังปิดอยู่\n4) Publish rules แล้วรีเฟรชหน้าเว็บ');
      return;
    }

    alert(`ลบไม่สำเร็จ: ${errorMessage || 'กรุณาลองใหม่'}`);
  }
}

function parseLinesFromTextarea(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cleaned = line.replace(/^-+\s*/, '').trim();
      const quoteMatched = cleaned.match(/^["“](.*)["”]$/);
      return quoteMatched ? quoteMatched[1].trim() : cleaned;
    })
    .filter(Boolean);
}

function formatLineForTextarea(line) {
  const cleanLine = String(line || '').replace(/["“”]/g, '').trim();
  if (!cleanLine) return '';
  return `"${cleanLine}"`;
}

function openFeedbackModal() {
  feedbackModal?.classList.remove('hidden');
}

function closeFeedbackModal() {
  feedbackModal?.classList.add('hidden');
}

function renderFeedbackForm(feedbackByBucket = {}) {
  if (!feedbackGrid) return;

  feedbackGrid.innerHTML = '';
  SCORE_BUCKETS.forEach((bucket) => {
    const wrap = document.createElement('label');
    wrap.className = 'feedback-item';

    const title = document.createElement('span');
    title.className = 'feedback-label';
    const rangeLabel = getBucketRangeLabel(bucket);
    title.textContent = `${rangeLabel} คะแนน (${rangeLabel}%)`;

    const textarea = document.createElement('textarea');
    textarea.dataset.bucket = String(bucket);
    textarea.rows = 4;
    textarea.placeholder = '"ข้อความที่ 1"\n"ข้อความที่ 2"';
    const lines = Array.isArray(feedbackByBucket[bucket]) ? feedbackByBucket[bucket] : [];
    textarea.value = lines.map((line) => formatLineForTextarea(line)).filter(Boolean).join('\n');

    wrap.appendChild(title);
    wrap.appendChild(textarea);
    feedbackGrid.appendChild(wrap);
  });
}

async function loadFeedbackConfig() {
  const defaults = getDefaultFeedbackMap();
  try {
    const config = await getResultFeedbackConfig();
    const fromDb = config?.feedbackByBucket || {};
    const merged = {};
    SCORE_BUCKETS.forEach((bucket) => {
      merged[bucket] = Array.isArray(fromDb[bucket]) && fromDb[bucket].length
        ? fromDb[bucket]
        : (defaults[bucket] || []);
    });
    renderFeedbackForm(merged);
  } catch (error) {
    console.error(error);
    renderFeedbackForm(defaults);
  }
}

async function onSaveFeedbackConfig() {
  if (!feedbackGrid) return;
  const payload = {};
  SCORE_BUCKETS.forEach((bucket) => {
    const textarea = feedbackGrid.querySelector(`textarea[data-bucket="${bucket}"]`);
    payload[bucket] = parseLinesFromTextarea(textarea?.value || '');
  });

  try {
    saveFeedbackBtn.disabled = true;
    await saveResultFeedbackConfig(payload);
    alert('บันทึกข้อความผลคะแนนเรียบร้อย');
    closeFeedbackModal();
  } catch (error) {
    console.error(error);
    alert('บันทึกไม่สำเร็จ กรุณาลองใหม่');
  } finally {
    saveFeedbackBtn.disabled = false;
  }
}

async function renderCourses(courses) {
  quizLibrary.innerHTML = '';

  if (!courses.length) {
    quizLibrary.innerHTML = '<p class="muted">ยังไม่มีบททดสอบในระบบ</p>';
    return;
  }

  const playCountsByCourseId = {};
  const playCounts = await Promise.all(courses.map(async (course) => {
    try {
      return await getPlayCountByCourse(course.courseId);
    } catch (error) {
      console.warn('โหลดจำนวนครั้งที่เล่นไม่สำเร็จ', course.courseId, error);
      return 0;
    }
  }));

  courses.forEach((course, index) => {
    playCountsByCourseId[course.courseId] = playCounts[index];
  });

  courses.forEach((course) => {
    const title = course.title ? escapeHtml(course.title) : escapeHtml(course.courseId);
    const courseId = escapeHtml(course.courseId);
    const editLink = `template.html?courseId=${encodeURIComponent(course.courseId)}`;
    const quizLink = buildQuizLink(course);
    const top5Link = buildTop5Link(course);
    const playCount = Number(playCountsByCourseId[course.courseId] || 0);

    const card = document.createElement('article');
    card.className = 'library-item library-item-grid';
    card.innerHTML = `
      <div class="library-head">
        <div>
          <p class="item-title">${title}</p>
          <p class="muted item-sub">รหัสคอร์ส: ${courseId}</p>
        </div>
        <span class="status-pill status-active">พร้อมใช้งาน</span>
      </div>
      <p class="muted item-sub">มีผู้เล่นแล้ว ${playCount.toLocaleString('th-TH')} ครั้ง</p>
      <div class="share-box">
        <p class="link-label">ลิงก์แบบทดสอบ</p>
        <div class="share-inline">
          <a class="quiz-link-text" href="${quizLink}" target="_blank" rel="noopener noreferrer">${escapeHtml(quizLink)}</a>
          <button class="btn btn-secondary btn-compact" type="button" data-action="copy">คัดลอก</button>
        </div>
        <div class="qr-box hidden" data-role="qr-wrap">
          <img alt="QR ${title}" src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(quizLink)}" />
        </div>
      </div>
      <div class="action-row">
        <div class="item-actions item-actions-main primary-actions">
          <a class="btn" href="${quizLink}" target="_blank" rel="noopener noreferrer">เปิดแบบทดสอบ</a>
          <a class="btn btn-secondary" href="${top5Link}" target="_blank" rel="noopener noreferrer">ดู TOP 5</a>
          <a class="btn btn-success" href="${editLink}">จัดการ</a>
        </div>
        <div class="item-actions item-actions-secondary menu-actions">
          <details class="action-menu">
            <summary class="btn btn-secondary btn-compact">เพิ่มเติม</summary>
            <div class="action-menu-list">
              <button class="btn btn-secondary btn-compact" type="button" data-action="toggle-qr">แสดง QR</button>
              <button class="btn btn-secondary btn-compact" type="button" data-action="download-qr">บันทึก QR</button>
              <button class="btn btn-danger btn-compact" type="button" data-action="delete">ลบแบบทดสอบ</button>
            </div>
          </details>
        </div>
      </div>
    `;

    card.querySelector('[data-action="copy"]').addEventListener('click', () => {
      void copyLink(quizLink);
    });

    card.querySelector('[data-action="toggle-qr"]').addEventListener('click', (event) => {
      const btn = event.currentTarget;
      const qrWrap = card.querySelector('[data-role="qr-wrap"]');
      if (!qrWrap) return;

      const isHidden = qrWrap.classList.contains('hidden');
      qrWrap.classList.toggle('hidden', !isHidden);
      btn.textContent = isHidden ? 'ซ่อน QR' : 'แสดง QR';
    });

    card.querySelector('[data-action="download-qr"]').addEventListener('click', () => {
      const qr = card.querySelector('img');
      if (!qr?.src) {
        alert('ไม่พบรูป QR');
        return;
      }
      downloadQrFromImage(qr.src, course.courseId);
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

  subscribeCourses((courses) => {
    void renderCourses(courses);
  }, (error) => {
    console.error(error);
    quizLibrary.innerHTML = '<p class="muted">โหลดคลังบททดสอบไม่สำเร็จ</p>';
  });
}

function renderAuthStatus(authStatus) {
  if (!authStatusNotice) return;

  if (!authStatus?.isAuthenticated) {
    authStatusNotice.textContent = 'สถานะบัญชี: ยังไม่ได้ล็อกอิน';
    return;
  }

  if (authStatus.isAnonymous) {
    authStatusNotice.innerHTML = `สถานะบัญชี: <strong>Anonymous</strong> (uid: <code>${escapeHtml(authStatus.uid)}</code>)`;
    return;
  }

  authStatusNotice.innerHTML = `สถานะบัญชี: <strong>Authenticated</strong> (uid: <code>${escapeHtml(authStatus.uid)}</code>)`;
}

if (openFeedbackEditorBtn) {
  openFeedbackEditorBtn.addEventListener('click', () => {
    openFeedbackModal();
  });
}

if (closeFeedbackModalBtn) {
  closeFeedbackModalBtn.addEventListener('click', () => {
    closeFeedbackModal();
  });
}

if (feedbackModal) {
  feedbackModal.addEventListener('click', (event) => {
    if (event.target === feedbackModal) {
      closeFeedbackModal();
    }
  });
}

if (saveFeedbackBtn) {
  saveFeedbackBtn.addEventListener('click', () => {
    void onSaveFeedbackConfig();
  });
}

if (profileForm) {
  profileForm.addEventListener('submit', (event) => {
    void onSaveProfile(event);
  });
}

initQuizLibrary();
void loadFeedbackConfig();
void loadProfileForm();
subscribeAuthStatus(renderAuthStatus);
updateProfileImagePreviewStatus();

if (profileImageInput) {
  profileImageInput.addEventListener('input', () => {
    updateProfileImagePreviewStatus();
  });
}

if (openProfilePageBtn) {
  openProfilePageBtn.href = buildProfileLink();
}

if (openMyProfileBtn) {
  openMyProfileBtn.addEventListener('click', () => {
    window.open(buildProfileLink(), '_blank', 'noopener,noreferrer');
  });
}

if (openCourseDestinationBtn) {
  openCourseDestinationBtn.addEventListener('click', () => {
    window.open(buildCourseDestinationLink(), '_blank', 'noopener,noreferrer');
  });
}
