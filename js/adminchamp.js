import {
  deleteCourseWithQuestions,
  getResultFeedbackConfig,
  saveResultFeedbackConfig,
  subscribeCourses,
} from './db.js';
import { getDefaultFeedbackMap } from './quiz.js';

const quizLibrary = document.getElementById('quizLibrary');
const feedbackModal = document.getElementById('feedbackModal');
const feedbackGrid = document.getElementById('feedbackGrid');
const openFeedbackEditorBtn = document.getElementById('openFeedbackEditorBtn');
const closeFeedbackModalBtn = document.getElementById('closeFeedbackModalBtn');
const saveFeedbackBtn = document.getElementById('saveFeedbackBtn');

const SCORE_BUCKETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

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
    await deleteCourseWithQuestions(courseId);
    alert('ลบแบบทดสอบสำเร็จ');
  } catch (error) {
    console.error(error);
    const errorCode = String(error?.code || '');
    const errorMessage = String(error?.message || '');
    const isPermissionIssue = errorCode.includes('permission-denied')
      || errorMessage.includes('Missing or insufficient permissions');

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
    title.textContent = `${bucket} คะแนน (${bucket}%)`;

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
        <div class="share-inline">
          <input value="${escapeHtml(quizLink)}" readonly />
          <a class="btn btn-success" href="${editLink}">แก้ไข</a>
        </div>
        <div class="qr-box hidden" data-role="qr-wrap">
          <img alt="QR ${title}" src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(quizLink)}" />
        </div>
      </div>
      <div class="item-actions">
        <a class="btn btn-secondary" href="${quizLink}" target="_blank" rel="noopener noreferrer">เปิดแบบทดสอบ</a>
        <button class="btn btn-secondary" type="button" data-action="copy">คัดลอกลิงก์</button>
        <button class="btn btn-secondary" type="button" data-action="toggle-qr">แสดง QR</button>
        <button class="btn btn-secondary" type="button" data-action="download-qr">บันทึก QR</button>
        <button class="btn btn-danger" type="button" data-action="delete">ลบ</button>
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

  subscribeCourses(renderCourses, (error) => {
    console.error(error);
    quizLibrary.innerHTML = '<p class="muted">โหลดคลังบททดสอบไม่สำเร็จ</p>';
  });
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

initQuizLibrary();
void loadFeedbackConfig();
