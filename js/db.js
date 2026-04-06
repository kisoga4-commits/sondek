import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import {
  getDatabase,
  onValue,
  ref as rtdbRef,
  runTransaction as runRtdbTransaction,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
  uploadBytesResumable,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js';
import {
  buildProfileImageStoragePath,
  PROFILE_IMAGE_MAX_DIMENSION,
  PROFILE_IMAGE_QUALITY,
  validateProfileImageConstraints,
} from './profileImagePolicy.js';
import { normalizePublicImageUrl } from './imageUrl.js';
import { getEffectiveFinishDistance, getWormWrongPenalty, pickWormComboTargetUid } from './duelRules.js';
import { buildPersonalQuestionLoop, LOOP_QUESTION_COUNT } from './duelCore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC4jOmVcZp0HmmDqZCmHufnq2yyoPcvyVM',
  authDomain: 'pakdu-a26c4.firebaseapp.com',
  databaseURL: 'https://pakdu-a26c4-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'pakdu-a26c4',
  storageBucket: 'pakdu-a26c4.firebasestorage.app',
  messagingSenderId: '414809008203',
  appId: '1:414809008203:web:757dceafa78d91900d85ce',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app);

let authInitPromise = null;


function isPermissionDeniedError(error) {
  const errorCode = String(error?.code || '');
  const errorMessage = String(error?.message || '');
  return errorCode.includes('permission-denied')
    || errorMessage.includes('Missing or insufficient permissions');
}

function isAnonymousAuthConfigError(error) {
  const errorCode = String(error?.code || '');
  return errorCode.includes('auth/operation-not-allowed')
    || errorCode.includes('auth/admin-restricted-operation')
    || errorCode.includes('auth/unauthorized-domain');
}

const DUEL_PERMISSION_HINT = 'ยังไม่มีสิทธิ์ใช้งาน Duel Mode ใน Realtime Database (Missing or insufficient permissions) — เปิด Firebase Auth แบบ Anonymous และ publish RTDB Rules ที่อนุญาต auth != null บน path rooms/{roomId}';
const DUEL_AUTH_HINT = 'ล็อกอินแบบ Anonymous ไม่สำเร็จ — เปิด Firebase Authentication > Sign-in method > Anonymous และเพิ่มโดเมนปัจจุบันใน Authorized domains';
const DUEL_START_HP = 10;
const DUEL_MAX_HP = 10;
const DUEL_ROOM_ID_LENGTH = 6;
const DUEL_QUESTION_SECONDS = 10;
const DUEL_REVEAL_SECONDS = 0.8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAINTENANCE_STORAGE_KEY = 'duel_weekly_maintenance_at';
const DUEL_GAME_PLAY_COUNT_DOC_ID = 'duel_game_play_counts';

function toDuelPermissionDeniedError(error, fallbackMessage) {
  if (!isPermissionDeniedError(error)) return error;
  const nextError = new Error(fallbackMessage || DUEL_PERMISSION_HINT);
  nextError.code = 'permission-denied';
  nextError.cause = error;
  return nextError;
}

function toDuelAuthConfigError(error) {
  if (!isAnonymousAuthConfigError(error)) return error;
  const nextError = new Error(DUEL_AUTH_HINT);
  nextError.code = 'auth/anonymous-not-enabled';
  nextError.cause = error;
  return nextError;
}


async function ensureAuthReady() {
  if (!authInitPromise) {
    authInitPromise = new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = null;

      const finalizeResolve = () => {
        if (settled) return;
        settled = true;
        if (unsubscribe) unsubscribe();
        resolve();
      };

      const finalizeReject = (error) => {
        if (settled) return;
        settled = true;
        if (unsubscribe) unsubscribe();
        reject(error);
      };

      unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          finalizeResolve();
          return;
        }

        try {
          await signInAnonymously(auth);
        } catch (error) {
          finalizeReject(toDuelAuthConfigError(error));
        }
      }, finalizeReject);
    });
  }

  await authInitPromise;
}

export async function ensureDuelAuthReady() {
  await ensureAuthReady();
  void runWeeklyDuelMaintenance();
}

export async function runWeeklyDuelMaintenance(options = {}) {
  await ensureAuthReady();
  const nowMs = Number(options.nowMs || Date.now());
  const force = Boolean(options.force);
  const lastRunMs = Number(window.localStorage.getItem(MAINTENANCE_STORAGE_KEY) || 0);
  if (!force && lastRunMs > 0 && (nowMs - lastRunMs) < WEEK_MS) return { skipped: true };

  const removeOlderThanMs = nowMs - WEEK_MS;
  const cleanupPaths = ['rooms', 'logic_spy_rooms'];
  const summary = {};

  await Promise.all(cleanupPaths.map(async (path) => {
    const pathRef = rtdbRef(rtdb, path);
    try {
      await runRtdbTransaction(pathRef, (data) => {
        if (!data || typeof data !== 'object') return data;
        const next = { ...data };
        let removedCount = 0;
        Object.entries(data).forEach(([roomId, room]) => {
          const updatedAtMs = Number(room?.updatedAtMs || room?.endedAtMs || room?.createdAtMs || 0);
          const isTooOld = updatedAtMs > 0 && updatedAtMs < removeOlderThanMs;
          if (isTooOld) {
            delete next[roomId];
            removedCount += 1;
          }
        });
        summary[path] = removedCount;
        return next;
      });
    } catch (_) {
      summary[path] = -1;
    }
  }));

  window.localStorage.setItem(MAINTENANCE_STORAGE_KEY, String(nowMs));
  return { skipped: false, removed: summary };
}

async function ensureWriteAccess() {
  await ensureAuthReady();

  if (!auth.currentUser) {
    const error = new Error('Anonymous sign-in is not available. Enable Firebase Authentication > Anonymous.');
    error.code = 'auth/not-authenticated';
    throw error;
  }
}


function sanitizeStorageSegment(value, fallback = 'file') {
  const normalized = String(value || '').toLowerCase().trim();
  const cleaned = normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || fallback;
}

export async function uploadImageFile(file, options = {}) {
  await ensureWriteAccess();

  if (!(file instanceof File)) {
    throw new Error('กรุณาเลือกไฟล์รูปภาพก่อนอัปโหลด');
  }

  const uid = auth.currentUser?.uid || 'anonymous';
  const folder = sanitizeStorageSegment(options.folder || 'profile-images', 'profile-images');
  const extension = sanitizeStorageSegment(file.name.split('.').pop() || 'jpg', 'jpg');
  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${folder}/${uid}/${fileId}.${extension}`;
  const storageRef = ref(storage, path);

  const metadata = {
    contentType: file.type || 'image/jpeg',
    cacheControl: 'public,max-age=31536000',
  };

  await uploadBytes(storageRef, file, metadata);
  const downloadUrl = await getDownloadURL(storageRef);

  return {
    path,
    downloadUrl,
  };
}

async function resizeProfileImageFile(file) {
  const imageBitmap = await createImageBitmap(file);
  const ratio = Math.min(
    1,
    PROFILE_IMAGE_MAX_DIMENSION / Math.max(1, imageBitmap.width),
    PROFILE_IMAGE_MAX_DIMENSION / Math.max(1, imageBitmap.height),
  );
  const width = Math.max(1, Math.round(imageBitmap.width * ratio));
  const height = Math.max(1, Math.round(imageBitmap.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('ไม่สามารถเตรียมรูปสำหรับอัปโหลดได้');
  }
  ctx.drawImage(imageBitmap, 0, 0, width, height);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error('แปลงไฟล์รูปไม่สำเร็จ'));
        return;
      }
      resolve(result);
    }, 'image/jpeg', PROFILE_IMAGE_QUALITY);
  });

  const baseName = String(file.name || 'profile').replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}

function isRetryableNetworkError(error) {
  const code = String(error?.code || '');
  return code.includes('storage/retry-limit-exceeded')
    || code.includes('storage/network-request-failed')
    || code.includes('storage/unknown')
    || code.includes('timeout');
}

async function uploadWithTimeout(file, path, metadata, timeoutMs, requestId) {
  const storageRef = ref(storage, path);
  const uploadTask = uploadBytesResumable(storageRef, file, metadata);

  const uploadPromise = new Promise((resolve, reject) => {
    uploadTask.on('state_changed', null, reject, resolve);
  });

  const timeoutPromise = new Promise((_, reject) => {
    const timeoutHandle = window.setTimeout(() => {
      uploadTask.cancel();
      const timeoutError = new Error(`Upload timeout after ${timeoutMs}ms`);
      timeoutError.code = 'upload/timeout';
      reject(timeoutError);
    }, timeoutMs);

    uploadPromise.finally(() => window.clearTimeout(timeoutHandle));
  });

  await Promise.race([uploadPromise, timeoutPromise]);
  const downloadUrl = await getDownloadURL(storageRef);
  console.info(`[requestId:${requestId}] profile image uploaded`, { path });
  return { path, downloadUrl };
}

async function uploadWithRetry(file, path, metadata, timeoutMs, retries, requestId) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await uploadWithTimeout(file, path, metadata, timeoutMs, requestId);
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < retries && isRetryableNetworkError(error);
      console.error(`[requestId:${requestId}] upload attempt ${attempt + 1} failed`, error);
      if (!shouldRetry) break;
    }
  }

  throw lastError || new Error('อัปโหลดรูปไม่สำเร็จ');
}

export async function uploadProfileImageAndSaveUrl(file, options = {}) {
  await ensureWriteAccess();
  validateProfileImageConstraints(file);

  const requestId = String(options.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const timeoutMs = Math.min(60000, Math.max(30000, Number(options.timeoutMs) || 45000));
  const retries = 1;
  const userId = auth.currentUser?.uid || 'anonymous';
  const resizedFile = await resizeProfileImageFile(file);
  const path = buildProfileImageStoragePath(userId, Date.now());
  const metadata = {
    contentType: 'image/jpeg',
    cacheControl: 'public,max-age=31536000',
  };

  const uploadResult = await uploadWithRetry(resizedFile, path, metadata, timeoutMs, retries, requestId);

  await setDoc(doc(db, 'profile', 'tutor_profile'), {
    profile_image_url: uploadResult.downloadUrl,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return {
    requestId,
    profileImageUrl: uploadResult.downloadUrl,
    path: uploadResult.path,
  };
}

export async function saveCourse(course) {
  await ensureWriteAccess();
  const currentPath = String(window.location.pathname || '/');
  const basePath = currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    : '/';
  const defaultQuizLink = `${window.location.origin}${basePath}quiz.html?id=${encodeURIComponent(course.courseId)}`;

  await setDoc(doc(db, 'courses', course.courseId), {
    courseId: course.courseId,
    title: course.title,
    description: course.description || '',
    status: course.status || 'open',
    quizLink: course.quizLink || defaultQuizLink,
    enrollmentUrl: course.enrollmentUrl || '',
    drawCount: Math.max(1, Number(course.drawCount) || 10),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function addQuestion(courseId, question, order) {
  await ensureWriteAccess();
  await addDoc(collection(db, 'questions'), {
    courseId,
    question: question.question,
    type: question.type || 'multiple_choice',
    choices: question.choices || [],
    answerIndex: Number(question.answerIndex ?? 0),
    orderingItems: question.orderingItems || [],
    timeLimitSeconds: Math.max(5, Number(question.timeLimitSeconds) || 30),
    points: Math.max(1, Number(question.points) || 1000),
    mediaUrl: question.mediaUrl || '',
    order,
    createdAt: serverTimestamp(),
  });
}

export async function saveQuestionsBatch(courseId, questions) {
  await ensureWriteAccess();
  await Promise.all(questions.map((question, idx) => addQuestion(courseId, question, idx + 1)));
}

export async function replaceQuestionsForCourse(courseId, questions) {
  await ensureWriteAccess();
  const existingQuestions = await getQuestionsByCourse(courseId);
  const batch = writeBatch(db);

  existingQuestions.forEach((item) => {
    batch.delete(doc(db, 'questions', item.id));
  });

  questions.forEach((question, idx) => {
    const ref = doc(collection(db, 'questions'));
    batch.set(ref, {
      courseId,
      question: question.question,
      type: question.type || 'multiple_choice',
      choices: question.choices || [],
      answerIndex: Number(question.answerIndex ?? 0),
      orderingItems: question.orderingItems || [],
      timeLimitSeconds: Math.max(5, Number(question.timeLimitSeconds) || 30),
      points: Math.max(1, Number(question.points) || 1000),
      mediaUrl: question.mediaUrl || '',
      order: idx + 1,
      createdAt: serverTimestamp(),
    });
  });

  await batch.commit();
}

export async function updateQuestion(questionId, question) {
  await ensureWriteAccess();
  await updateDoc(doc(db, 'questions', questionId), {
    question: question.question,
    type: question.type || 'multiple_choice',
    choices: question.choices || [],
    answerIndex: Number(question.answerIndex ?? 0),
    orderingItems: question.orderingItems || [],
    timeLimitSeconds: Math.max(5, Number(question.timeLimitSeconds) || 30),
    points: Math.max(1, Number(question.points) || 1000),
    mediaUrl: question.mediaUrl || '',
  });
}

export async function deleteQuestionById(questionId) {
  await ensureWriteAccess();
  await deleteDoc(doc(db, 'questions', questionId));
}

export async function deleteCourseWithQuestions(courseId) {
  await ensureWriteAccess();
  const existingQuestions = await getQuestionsByCourse(courseId);

  try {
    const batch = writeBatch(db);
    existingQuestions.forEach((item) => batch.delete(doc(db, 'questions', item.id)));
    batch.delete(doc(db, 'courses', courseId));
    await batch.commit();
    return { mode: 'hard_delete' };
  } catch (error) {
    console.warn('Batch delete failed, fallback to sequential delete.', error);

    try {
      await Promise.all(existingQuestions.map((item) => deleteDoc(doc(db, 'questions', item.id))));
      await deleteDoc(doc(db, 'courses', courseId));
      return { mode: 'hard_delete' };
    } catch (sequentialError) {
      if (!isPermissionDeniedError(sequentialError)) {
        throw sequentialError;
      }

      await setDoc(doc(db, 'courses', courseId), {
        status: 'deleted',
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      return { mode: 'soft_delete' };
    }
  }
}

export async function getAllCourses() {
  await ensureAuthReady();
  const snap = await getDocs(collection(db, 'courses'));
  return snap.docs
    .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
    .filter((course) => course.status !== 'deleted')
    .sort((a, b) => String(a.courseId).localeCompare(String(b.courseId)));
}

export function subscribeCourses(callback, onError) {
  const q = query(collection(db, 'courses'), orderBy('courseId', 'asc'));
  let unsubscribe = () => {};

  ensureAuthReady()
    .then(() => {
      unsubscribe = onSnapshot(q, (snap) => callback(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((course) => course.status !== 'deleted'),
      ), onError);
    })
    .catch((error) => {
      if (onError) onError(error);
    });

  return () => unsubscribe();
}

export async function saveCourseOffering(courseOffer) {
  await ensureWriteAccess();
  const courseId = `offer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const scheduleDetails = String(courseOffer?.scheduleDetails || courseOffer?.day || '').trim();
  const payload = {
    courseId,
    title: String(courseOffer?.title || '').trim(),
    scheduleDetails,
    day: scheduleDetails,
    time: '',
    price: String(courseOffer?.price || '').trim(),
    content: String(courseOffer?.content || '').trim(),
    status: 'open',
    enrollments: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'course_offerings', courseId), payload);
  } catch (error) {
    const code = String(error?.code || '');
    const mayBlockTimestamp = code.includes('permission-denied') || code.includes('failed-precondition');
    if (!mayBlockTimestamp) throw error;

    await setDoc(doc(db, 'course_offerings', courseId), {
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function updateCourseOffering(courseId, payload) {
  await ensureWriteAccess();
  const scheduleDetails = String(payload?.scheduleDetails || payload?.day || '').trim();
  await updateDoc(doc(db, 'course_offerings', courseId), {
    title: String(payload?.title || '').trim(),
    scheduleDetails,
    day: scheduleDetails,
    time: '',
    price: String(payload?.price || '').trim(),
    content: String(payload?.content || '').trim(),
    quizCourseId: deleteField(),
    dueDate: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export function subscribeCourseOfferings(callback, onError) {
  const q = query(collection(db, 'course_offerings'), orderBy('createdAt', 'desc'));
  let unsubscribe = () => {};

  ensureAuthReady()
    .then(() => {
      unsubscribe = onSnapshot(q, (snap) => callback(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() })),
      ), onError);
    })
    .catch((error) => {
      if (onError) onError(error);
    });

  return () => unsubscribe();
}

export async function toggleCourseOfferingStatus(courseId, nextStatus) {
  await ensureWriteAccess();
  await updateDoc(doc(db, 'course_offerings', courseId), {
    status: String(nextStatus || '').trim() === 'closed' ? 'closed' : 'open',
    updatedAt: serverTimestamp(),
  });
}

export async function saveCourseEnrollment(courseId, payload) {
  await ensureWriteAccess();
  const ref = doc(db, 'course_offerings', courseId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('ไม่พบคอร์สที่ต้องการสมัคร');
  }

  const data = snap.data() || {};
  const enrollments = Array.isArray(data.enrollments) ? data.enrollments : [];
  const nextEnrollments = [
    {
      enrollmentId: `enroll_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      studentName: String(payload?.studentName || '').trim(),
      studentPhone: String(payload?.studentPhone || '').trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
    ...enrollments,
  ].slice(0, 80);

  await updateDoc(ref, {
    enrollments: nextEnrollments,
    updatedAt: serverTimestamp(),
  });
}

export async function updateCourseEnrollment(courseId, enrollmentId, payload) {
  await ensureWriteAccess();
  const ref = doc(db, 'course_offerings', courseId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('ไม่พบคอร์สที่เลือก');
  }

  const data = snap.data() || {};
  const enrollments = Array.isArray(data.enrollments) ? data.enrollments : [];
  const nextEnrollments = enrollments.map((item) => {
    const itemId = String(item?.enrollmentId || '');
    if (itemId !== String(enrollmentId || '')) return item;

    return {
      ...item,
      studentName: String(payload?.studentName ?? item.studentName ?? '').trim(),
      studentPhone: String(payload?.studentPhone ?? item.studentPhone ?? '').trim(),
      status: String(payload?.status ?? item.status ?? 'pending').trim() || 'pending',
      updatedAt: new Date().toISOString(),
    };
  });

  await updateDoc(ref, {
    enrollments: nextEnrollments,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCourseEnrollment(courseId, enrollmentId) {
  await ensureWriteAccess();
  const ref = doc(db, 'course_offerings', courseId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('ไม่พบคอร์สที่เลือก');
  }

  const data = snap.data() || {};
  const enrollments = Array.isArray(data.enrollments) ? data.enrollments : [];
  const nextEnrollments = enrollments.filter(
    (item) => String(item?.enrollmentId || '') !== String(enrollmentId || ''),
  );

  await updateDoc(ref, {
    enrollments: nextEnrollments,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCourseOffering(courseId) {
  await ensureWriteAccess();
  await deleteDoc(doc(db, 'course_offerings', courseId));
}

export async function getCourse(courseId) {
  await ensureAuthReady();
  const snap = await getDoc(doc(db, 'courses', courseId));
  return snap.exists() ? snap.data() : null;
}

export async function getQuestionsByCourse(courseId) {
  await ensureAuthReady();
  const q = query(collection(db, 'questions'), where('courseId', '==', courseId));
  const snap = await getDocs(q);
  return snap.docs
    .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
    .sort((a, b) => {
      const orderDiff = Number(a.order || 0) - Number(b.order || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

export function subscribeQuestionsByCourse(courseId, callback, onError) {
  const q = query(collection(db, 'questions'), where('courseId', '==', courseId));
  let unsubscribe = () => {};

  ensureAuthReady()
    .then(() => {
      unsubscribe = onSnapshot(q, (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const orderDiff = Number(a.order || 0) - Number(b.order || 0);
            if (orderDiff !== 0) return orderDiff;
            return String(a.id || '').localeCompare(String(b.id || ''));
          });
        callback(rows);
      }, onError);
    })
    .catch((error) => {
      if (onError) onError(error);
    });

  return () => unsubscribe();
}

export async function saveLead(payload) {
  await ensureWriteAccess();
  await addDoc(collection(db, 'leads'), {
    ...payload,
    createdAt: serverTimestamp(),
  });
}

export function subscribeLeads(callback, onError) {
  const q = query(collection(db, 'leads'), orderBy('createdAt', 'desc'));
  let unsubscribe = () => {};

  ensureAuthReady()
    .then(() => {
      unsubscribe = onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
    })
    .catch((error) => {
      if (onError) onError(error);
    });

  return () => unsubscribe();
}

export async function deleteLeadById(leadId) {
  await ensureWriteAccess();
  await deleteDoc(doc(db, 'leads', leadId));
}

export async function getLeaderboard(courseId) {
  await ensureAuthReady();
  const q = query(collection(db, 'leads'), where('courseId', '==', courseId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const scoreDiff = Number(b.scorePercent || 0) - Number(a.scorePercent || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(a.durationSeconds || 0) - Number(b.durationSeconds || 0);
    })
    .slice(0, 5);
}

export async function getPlayCountByCourse(courseId) {
  await ensureAuthReady();
  const q = query(collection(db, 'leads'), where('courseId', '==', courseId));
  const snap = await getDocs(q);
  return snap.size;
}

export async function saveProfile(profile) {
  await ensureWriteAccess();
  const normalizedName = String(profile?.name || '').trim();
  const normalizedBio = String(profile?.bio || '').trim();
  const normalizedProfileImageUrl = normalizePublicImageUrl(profile?.profile_image_url || profile?.imageUrl || '');
  const normalizedTeachingImages = Array.isArray(profile?.teachingImages)
    ? profile.teachingImages.map((url) => normalizePublicImageUrl(url)).filter(Boolean)
    : [];

  await setDoc(doc(db, 'profile', 'tutor_profile'), {
    name: normalizedName,
    bio: normalizedBio,
    profile_image_url: normalizedProfileImageUrl,
    profileUrl: deleteField(),
    teachingImages: normalizedTeachingImages,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getProfile() {
  await ensureAuthReady();
  const snap = await getDoc(doc(db, 'profile', 'tutor_profile'));
  return snap.exists() ? snap.data() : null;
}

export function subscribeProfile(callback, onError) {
  let unsubscribe = () => {};

  ensureAuthReady()
    .then(() => {
      unsubscribe = onSnapshot(doc(db, 'profile', 'tutor_profile'), (snap) => callback(snap.exists() ? snap.data() : null), onError);
    })
    .catch((error) => {
      if (onError) onError(error);
    });

  return () => unsubscribe();
}

const RESULT_FEEDBACK_DOC_ID = 'result_feedbacks';

export async function getResultFeedbackConfig() {
  await ensureAuthReady();
  const snap = await getDoc(doc(db, 'settings', RESULT_FEEDBACK_DOC_ID));
  return snap.exists() ? snap.data() : null;
}

export async function saveResultFeedbackConfig(feedbackByBucket) {
  await ensureWriteAccess();
  await setDoc(doc(db, 'settings', RESULT_FEEDBACK_DOC_ID), {
    feedbackByBucket,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}



export function subscribeAuthStatus(callback) {
  return onAuthStateChanged(auth, (user) => {
    callback({
      uid: user?.uid || '',
      isAuthenticated: Boolean(user),
      isAnonymous: Boolean(user?.isAnonymous),
    });
  });
}


function sanitizeDuelName(name, fallback = 'ผู้เล่น') {
  const cleaned = String(name || '').trim();
  return cleaned || fallback;
}

function getLocalDuelUid() {
  try {
    const key = 'duel_local_uid';
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = `guest_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(key, next);
    return next;
  } catch (_error) {
    return `guest_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getDuelActorUid() {
  return auth.currentUser?.uid || getLocalDuelUid();
}

function normalizeDuelRoomId(value = '') {
  const digits = String(value || '').replace(/\D+/g, '').slice(0, DUEL_ROOM_ID_LENGTH);
  return digits;
}

function ensureAvailableDuelRoomId(preferredRoomId = '') {
  const preferred = normalizeDuelRoomId(preferredRoomId);
  if (preferred.length === DUEL_ROOM_ID_LENGTH) return preferred;
  const key = 'duel_last_room_id';
  const previous = typeof window !== 'undefined' ? String(window.localStorage.getItem(key) || '') : '';
  const min = 10 ** (DUEL_ROOM_ID_LENGTH - 1);
  const span = 9 * min;
  let next = String(Math.floor(min + Math.random() * span));
  if (next === previous) {
    next = String(((Number(next) + Math.floor(Math.random() * span) + min) % span) + min)
      .slice(0, DUEL_ROOM_ID_LENGTH);
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(key, next);
  }
  return next;
}

function syncDuelRoomShape(room = {}) {
  const status = String(room.status || room?.state?.status || 'lobby');
  const startedAtMs = room.startedAtMs || room?.state?.startedAtMs || null;
  const endedAtMs = room.endedAtMs || room?.state?.endedAtMs || null;
  const normalizedPlayers = Object.fromEntries(
    Object.entries(room.players || {}).map(([uid, player]) => {
      const hp = Number(player?.hp);
      return [uid, {
        ...player,
        hp: Number.isFinite(hp) ? Math.max(0, Math.min(DUEL_MAX_HP, hp)) : DUEL_START_HP,
        correctCount: Number(player?.correctCount || 0),
        wrongCount: Number(player?.wrongCount || 0),
        wrongStreak: Number(player?.wrongStreak || 0),
        correctStreak: Number(player?.correctStreak || 0),
        distance: Math.max(0, Number(player?.distance || 0)),
        answeredRound: Number(player?.answeredRound ?? -1),
        stunUntilMs: Number(player?.stunUntilMs || 0),
        teamId: player?.teamId || null,
        relayOrder: Math.max(1, Number(player?.relayOrder || 1)),
        isActiveRunner: Boolean(player?.isActiveRunner),
        hasFinishedTurn: Boolean(player?.hasFinishedTurn),
      }];
    }),
  );
  const settings = {
    mode: 'duel',
    competitionType: String(room?.modeConfig?.matchType || room?.settings?.competitionType || 'solo'),
    gameMode: String(room?.modeConfig?.gameMode || room?.settings?.gameMode || 'quick'),
    relaySize: Number(room?.modeConfig?.teamSize || 1),
    durationMinutes: Math.max(2, Math.round(Number(room.durationSeconds || 120) / 60)),
    quizId: String(room.courseId || ''),
  };
  return {
    ...room,
    players: normalizedPlayers,
    pin: room.pin || room.roomId || '',
    status,
    state: {
      status,
      startedAtMs,
      endedAtMs,
      updatedAtMs: room.updatedAtMs || Date.now(),
    },
    settings,
  };
}

function buildDuelPlayerPayload(name) {
  return {
    name: sanitizeDuelName(name),
    hp: DUEL_START_HP,
    correctCount: 0,
    wrongCount: 0,
    wrongStreak: 0,
    correctStreak: 0,
    distance: 0,
    answeredRound: -1,
    stunUntilMs: 0,
    teamId: null,
    relayOrder: 1,
    isActiveRunner: true,
    hasFinishedTurn: false,
    updatedAt: Date.now(),
  };
}


function pickTopTargetUids(players, actorUid, targetCount) {
  const aliveOpponents = Object.entries(players)
    .filter(([uid, player]) => uid !== actorUid && Number(player?.hp || 0) > 0)
    .map(([uid, player]) => ({ uid, hp: Number(player?.hp || 0) }));
  if (!aliveOpponents.length || targetCount <= 0) return [];

  const hpBuckets = new Map();
  aliveOpponents.forEach(({ uid, hp }) => {
    const group = hpBuckets.get(hp) || [];
    group.push(uid);
    hpBuckets.set(hp, group);
  });

  const hpSorted = [...hpBuckets.keys()].sort((a, b) => b - a);
  const picked = [];
  hpSorted.forEach((hp) => {
    const group = hpBuckets.get(hp) || [];
    for (let i = group.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    group.forEach((uid) => {
      if (picked.length < targetCount) picked.push(uid);
    });
  });
  return picked;
}

function pickDuelWinner(playersByUid = {}) {
  const entries = Object.entries(playersByUid);
  if (!entries.length) return { winnerUid: '', reason: 'insufficient_players' };
  const ranked = [...entries].sort((aEntry, bEntry) => {
    const [, a] = aEntry;
    const [, b] = bEntry;
    const distanceDiff = Number(b?.distance || 0) - Number(a?.distance || 0);
    if (distanceDiff !== 0) return distanceDiff;
    const correctDiff = Number(b?.correctCount || 0) - Number(a?.correctCount || 0);
    if (correctDiff !== 0) return correctDiff;
    return Number(a?.wrongCount || 0) - Number(b?.wrongCount || 0);
  });
  const [winnerUid, winner] = ranked[0];
  const [, runnerUp] = ranked[1] || [];
  const hasClearWinner = !runnerUp
    || Number(winner?.distance || 0) !== Number(runnerUp?.distance || 0)
    || Number(winner?.correctCount || 0) !== Number(runnerUp?.correctCount || 0)
    || Number(winner?.wrongCount || 0) !== Number(runnerUp?.wrongCount || 0);
  return { winnerUid: hasClearWinner ? winnerUid : '', reason: hasClearWinner ? 'distance' : 'draw' };
}

export async function createDuelRoom(payload) {
  await ensureWriteAccess();
  const uid = getDuelActorUid();
  const preferredRoomId = normalizeDuelRoomId(payload?.roomId);
  const maxAttempts = preferredRoomId ? 1 : 8;
  const durationSecondsRaw = Number(payload?.durationSeconds || 120);
  const durationSeconds = [120, 180, 240, 300].includes(durationSecondsRaw) ? durationSecondsRaw : 120;
  const requestedMatchType = String(payload?.matchType || '').toLowerCase() === 'party' ? 'party' : 'solo';
  const teamSize = [2, 3].includes(Number(payload?.teamSize || 2)) ? Number(payload?.teamSize || 2) : 2;
  const finishDistance = [10, 20].includes(Number(payload?.finishDistance || 10)) ? Number(payload?.finishDistance || 10) : 10;
  const requestedGameMode = String(payload?.gameMode || '').toLowerCase();
  const gameMode = ['quick', 'worm', 'pob', 'logic_spy'].includes(requestedGameMode) ? requestedGameMode : 'quick';
  const matchType = requestedMatchType;
  const gameLabel = String(payload?.gameLabel || '').trim()
    || (gameMode === 'worm'
      ? 'หนอนกระดื้บ'
      : gameMode === 'pob'
        ? 'ปอบกินตับ'
        : gameMode === 'logic_spy'
          ? 'ใครต่างจากเพื่อน'
          : 'ตอบไว');
  const questionPoolIds = Array.isArray(payload?.questionPoolIds)
    ? [...new Set(payload.questionPoolIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];
  const rawAnswerKey = (payload?.questionAnswerKey && typeof payload.questionAnswerKey === 'object')
    ? payload.questionAnswerKey
    : {};
  const questionAnswerKey = questionPoolIds.reduce((acc, qid) => {
    const value = Number(rawAnswerKey[qid]);
    if (Number.isInteger(value) && value >= 0) acc[qid] = value;
    return acc;
  }, {});
  const modeConfig = { gameMode, gameLabel, matchType, teamSize, finishDistance };
  const hostPlayer = buildDuelPlayerPayload(payload?.hostName || 'Host');

  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const roomId = preferredRoomId || ensureAvailableDuelRoomId();
    try {
      // Intentionally skip client-side read before create.
      // This avoids failing on projects that allow create but deny read.
      // Expected Realtime Database rules should allow write only when room does not yet exist.
      // eslint-disable-next-line no-await-in-loop
      const roomRef = rtdbRef(rtdb, `rooms/${roomId}`);
      // eslint-disable-next-line no-await-in-loop
      const tx = await runRtdbTransaction(roomRef, (current) => {
        if (current) return;
        const nowMs = Date.now();
        const hostEntry = {
          ...hostPlayer,
          uid,
          name: hostPlayer.name,
          joinedAt: nowMs,
          online: true,
          team: null,
          isHost: true,
        };
        const initialRoom = {
          roomId,
          pin: roomId,
          courseId: String(payload?.courseId || '').trim(),
          status: 'lobby',
          hostUid: uid,
          hostName: hostPlayer.name,
          durationSeconds,
          maxPlayers: 8,
          modeConfig,
          questionSequence: Array.isArray(payload?.questionSequence) ? payload.questionSequence : [],
          questionPoolIds,
          questionAnswerKey,
          players: {
            [uid]: hostEntry,
          },
          winnerUid: '',
          winReason: '',
          eventCounter: 0,
          questionSeconds: DUEL_QUESTION_SECONDS,
          revealSeconds: DUEL_REVEAL_SECONDS,
          updatedAtMs: nowMs,
          createdAtMs: nowMs,
          startedAtMs: null,
          endedAtMs: null,
        };
        return syncDuelRoomShape(initialRoom);
      });
      if (!tx.committed) {
        const collision = new Error('duel room already exists');
        collision.code = 'already-exists';
        throw collision;
      }
      return { roomId, uid };
    } catch (error) {
      lastError = error;
      const code = String(error?.code || '');
      const message = String(error?.message || '');
      const isLikelyCollision = code.includes('already-exists')
        || message.includes('already exists')
        || message.includes('ALREADY_EXISTS');
      if (!isLikelyCollision || preferredRoomId) break;
    }
  }

  if (isPermissionDeniedError(lastError)) {
    throw toDuelPermissionDeniedError(lastError);
  }

  throw lastError || new Error('สร้างห้องไม่สำเร็จ กรุณาลองอีกครั้ง');
}

export async function joinDuelRoom(roomId, playerName) {
  await ensureWriteAccess();
  const uid = getDuelActorUid();

  const safeRoomId = normalizeDuelRoomId(roomId);
  if (safeRoomId.length !== DUEL_ROOM_ID_LENGTH) throw new Error(`รหัสห้องต้องเป็นตัวเลข ${DUEL_ROOM_ID_LENGTH} หลัก`);

  const roomRef = rtdbRef(rtdb, `rooms/${safeRoomId}`);
  let tx;
  try {
    tx = await runRtdbTransaction(roomRef, (data) => {
      if (!data) throw new Error('ไม่พบห้องดวลนี้');
      const players = data.players || {};
      const existingUids = Object.keys(players);

      if (data.status === 'finished') throw new Error('ห้องนี้ปิดแล้ว');
      if (data.status === 'playing') throw new Error('ห้องนี้เริ่มเกมแล้ว');

      const maxPlayers = Math.max(2, Number(data.maxPlayers || 4));
      if (!players[uid] && existingUids.length >= maxPlayers) {
        throw new Error('ห้องเต็มแล้ว');
      }

      const nextPlayers = {
        ...players,
        [uid]: players[uid] ? {
          ...players[uid],
          name: sanitizeDuelName(playerName, players[uid].name || 'ผู้เล่น'),
          online: true,
          updatedAt: Date.now(),
        } : {
          ...buildDuelPlayerPayload(playerName),
          uid,
          name: sanitizeDuelName(playerName),
          joinedAt: Date.now(),
          online: true,
          team: null,
          isHost: false,
        },
      };

      return {
        ...syncDuelRoomShape(data),
        players: nextPlayers,
        status: data.status || 'lobby',
        startedAtMs: data.startedAtMs || null,
        updatedAtMs: Date.now(),
      };
    });
  } catch (error) {
    throw toDuelPermissionDeniedError(error);
  }
  if (!tx.committed) throw new Error('เข้าห้องดวลไม่สำเร็จ กรุณาลองอีกครั้ง');

  return { roomId: safeRoomId, uid };
}

export async function startDuelRoom(roomId) {
  await ensureWriteAccess();
  const uid = getDuelActorUid();
  const safeRoomId = normalizeDuelRoomId(roomId);
  if (safeRoomId.length !== DUEL_ROOM_ID_LENGTH) throw new Error(`รหัสห้องต้องเป็นตัวเลข ${DUEL_ROOM_ID_LENGTH} หลัก`);

  const roomRef = rtdbRef(rtdb, `rooms/${safeRoomId}`);
  let tx;
  try {
    tx = await runRtdbTransaction(roomRef, (data) => {
      if (!data) throw new Error('ไม่พบห้องดวลนี้');
      if (String(data.hostUid || '') !== uid) throw new Error('เฉพาะ Host เท่านั้นที่เริ่มดวลได้');
      if (data.status === 'finished') throw new Error('ห้องนี้จบดวลแล้ว');
      if (data.status === 'playing') return data;

      const players = data.players || {};
      const gameMode = String(data?.modeConfig?.gameMode || 'quick');
      const matchType = String(data?.modeConfig?.matchType || 'solo');
      const teamSize = Math.max(2, Math.min(3, Number(data?.modeConfig?.teamSize || 2)));
      const requiredPlayers = gameMode === 'pob'
        ? 4
        : (gameMode === 'logic_spy' ? 3 : (matchType === 'party' ? teamSize * 2 : 2));
      if (Object.keys(players).length < requiredPlayers) {
        throw new Error(`ต้องมีผู้เล่นอย่างน้อย ${requiredPlayers} คนก่อนเริ่มดวล`);
      }

      const nowMs = Date.now();
      const playerEntries = Object.entries(players).slice(
        0,
        gameMode === 'pob'
          ? 8
          : (gameMode === 'logic_spy' ? 5 : (matchType === 'party' ? teamSize * 2 : 4)),
      );
      const normalizedPlayers = {};
      let teams = null;
      if (matchType === 'party') {
        teams = { A: { members: [] }, B: { members: [] } };
        playerEntries.forEach(([playerUid, player], index) => {
          const teamId = index % 2 === 0 ? 'A' : 'B';
          const relayOrder = Math.floor(index / 2) + 1;
          const isActiveRunner = gameMode === 'worm' ? true : relayOrder === 1;
          teams[teamId].members.push(playerUid);
          normalizedPlayers[playerUid] = {
            ...player,
            teamId,
            relayOrder,
            isActiveRunner,
            hasFinishedTurn: false,
            distance: 0,
            answeredRound: -1,
            correctStreak: 0,
            wrongStreak: 0,
            stunUntilMs: 0,
            updatedAt: nowMs,
          };
        });
      } else {
        playerEntries.forEach(([playerUid, player]) => {
          normalizedPlayers[playerUid] = {
            ...player,
            teamId: null,
            relayOrder: 1,
            isActiveRunner: true,
            hasFinishedTurn: false,
            distance: 0,
            answeredRound: -1,
            correctStreak: 0,
            wrongStreak: 0,
            stunUntilMs: 0,
            updatedAt: nowMs,
          };
        });
      }

      return {
        ...syncDuelRoomShape(data),
        players: normalizedPlayers,
        teams,
        status: 'playing',
        currentRoundIndex: 0,
        startedAtMs: nowMs,
        updatedAtMs: nowMs,
      };
    });
  } catch (error) {
    throw toDuelPermissionDeniedError(error);
  }
  if (!tx.committed) throw new Error('เริ่มดวลไม่สำเร็จ กรุณาลองอีกครั้ง');

  try {
    const statsDocRef = doc(db, 'settings', DUEL_GAME_PLAY_COUNT_DOC_ID);
    const startedAtMs = Date.now();
    const startedMode = String(tx.snapshot?.val()?.modeConfig?.gameMode || 'quick');
    await setDoc(statsDocRef, {
      totalPlayCount: increment(1),
      [`playCountByMode.${startedMode}`]: increment(1),
      updatedAt: serverTimestamp(),
      lastStartedAtMs: startedAtMs,
      lastStartedMode: startedMode,
      [`lastStartedAtMsByMode.${startedMode}`]: startedAtMs,
    }, { merge: true });
  } catch (_error) {
    // non-blocking: game should proceed even if analytics counter update fails
  }

  return { roomId: safeRoomId, uid };
}

export function subscribeDuelRoom(roomId, callback, onError) {
  let unsubscribe = () => {};
  ensureAuthReady()
    .then(() => {
      const safeRoomId = normalizeDuelRoomId(roomId);
      const roomRef = rtdbRef(rtdb, `rooms/${safeRoomId}`);
      unsubscribe = onValue(roomRef, (snap) => {
        callback(snap.exists() ? { id: safeRoomId, ...syncDuelRoomShape(snap.val()) } : null);
      }, onError);
    })
    .catch((error) => {
      if (onError) onError(error);
    });

  return () => unsubscribe();
}

export async function submitDuelAnswer(roomId, payload) {
  await ensureWriteAccess();
  const uid = getDuelActorUid();
  const safeRoomId = normalizeDuelRoomId(roomId);
  if (safeRoomId.length !== DUEL_ROOM_ID_LENGTH) throw new Error(`รหัสห้องต้องเป็นตัวเลข ${DUEL_ROOM_ID_LENGTH} หลัก`);

  const roomRef = rtdbRef(rtdb, `rooms/${safeRoomId}`);

  let tx;
  try {
    tx = await runRtdbTransaction(roomRef, (data) => {
      if (!data) throw new Error('ไม่พบห้องดวลนี้');
      if (data.status !== 'playing') return data;
      const nowMs = Date.now();
      const gameMode = String(data?.modeConfig?.gameMode || 'quick');
      const isWormMode = gameMode === 'worm';
      const questionSeconds = Math.max(5, Number(data.questionSeconds || DUEL_QUESTION_SECONDS));
      const revealSeconds = Math.max(0.3, Number(data.revealSeconds || DUEL_REVEAL_SECONDS));
      const roundMs = Math.round((questionSeconds + revealSeconds) * 1000);
      const elapsedMs = Math.max(0, nowMs - Number(data.startedAtMs || 0));
      const players = { ...(data.players || {}) };
      const me = { ...(players[uid] || {}) };
      const wormRoundIndex = Math.max(0, Number(me.answeredRound ?? -1) + 1);
      const roundIndex = isWormMode
        ? wormRoundIndex
        : Math.floor(elapsedMs / roundMs);
      const inReveal = !isWormMode && (elapsedMs % roundMs) >= questionSeconds * 1000;
      if (inReveal) return data;

      if (!me?.uid) return data;
      if (Number(me.stunUntilMs || 0) > nowMs) return data;
      if (Number(me.answeredRound ?? -1) >= roundIndex) return data;
      if (!isWormMode && String(data?.modeConfig?.matchType || 'solo') === 'party' && !me.isActiveRunner) return data;

      const submittedAnswerIndex = Number(payload?.answerIndex);
      const submittedQuestionId = String(payload?.questionId || '');
      const expectedQuestionId = (() => {
        if (isWormMode) {
          const poolIds = Array.isArray(data?.questionPoolIds) && data.questionPoolIds.length
            ? data.questionPoolIds
            : [...new Set((Array.isArray(data?.questionSequence) ? data.questionSequence : []).map((id) => String(id || '')).filter(Boolean))];
          if (!poolIds.length) return '';
          const actorKey = `${String(data?.roomId || safeRoomId)}:${uid}`;
          const personalSequence = buildPersonalQuestionLoop(
            poolIds.map((id) => ({ id: String(id) })),
            actorKey,
            { loopQuestionCount: Math.max(LOOP_QUESTION_COUNT, poolIds.length) },
          );
          if (!personalSequence.length) return '';
          return String(personalSequence[roundIndex % personalSequence.length] || '');
        }
        const sharedSequence = Array.isArray(data?.questionSequence) ? data.questionSequence : [];
        return String(sharedSequence[roundIndex % sharedSequence.length] || '');
      })();
      const answerKey = (data?.questionAnswerKey && typeof data.questionAnswerKey === 'object')
        ? data.questionAnswerKey
        : {};
      const expectedAnswerIndex = Number(answerKey[expectedQuestionId]);
      const hasStrictValidationData = Boolean(expectedQuestionId)
        && Boolean(submittedQuestionId)
        && Number.isInteger(submittedAnswerIndex)
        && Number.isInteger(expectedAnswerIndex);
      const canUseStrictValidation = hasStrictValidationData && submittedQuestionId === expectedQuestionId;
      const isCorrect = canUseStrictValidation
        ? submittedAnswerIndex === expectedAnswerIndex
        : Boolean(payload?.isCorrect);
      me.answeredRound = roundIndex;
      let eventType = '';
      let eventMessage = '';
      let eventTargetUid = '';

      if (isCorrect) {
        me.correctCount = Number(me.correctCount || 0) + 1;
        me.correctStreak = Number(me.correctStreak || 0) + 1;
        me.wrongStreak = 0;
        me.distance = Math.max(0, Number(me.distance || 0) + 1);
        if (me.correctStreak >= 3) {
          const isPartyMatch = String(data?.modeConfig?.matchType || 'solo') === 'party';
          const myTeamId = String(me.teamId || '');
          let targetUid = '';
          if (isWormMode) {
            targetUid = pickWormComboTargetUid(players, uid, myTeamId, Math.random());
          } else {
            const candidates = Object.entries(players)
              .filter(([pid, candidate]) => pid !== uid && (!isPartyMatch || Boolean(candidate?.isActiveRunner)))
              .sort((a, b) => Number(b[1]?.distance || 0) - Number(a[1]?.distance || 0));
            targetUid = candidates[0]?.[0] || '';
          }
          if (targetUid) {
            const target = { ...(players[targetUid] || {}) };
            target.distance = Math.max(0, Number(target.distance || 0) - 1);
            players[targetUid] = target;
            eventTargetUid = targetUid;
          }
          me.correctStreak = 0;
          if (targetUid) {
            eventType = 'combo_attack';
            eventMessage = 'คอมโบครบ 3 โจมตีคู่แข่งถอย -1';
          } else {
            eventType = 'correct';
            eventMessage = 'ตอบถูก เดิน +1';
          }
        } else {
          eventType = 'correct';
          eventMessage = 'ตอบถูก เดิน +1';
        }
      } else {
        me.wrongCount = Number(me.wrongCount || 0) + 1;
        me.wrongStreak = Number(me.wrongStreak || 0) + 1;
        me.correctStreak = 0;
        if (isWormMode) {
          const penalty = getWormWrongPenalty(me.wrongStreak);
          if (penalty.stunMs > 0) {
            me.stunUntilMs = nowMs + penalty.stunMs;
          }
          if (penalty.distancePenalty > 0) {
            me.distance = Math.max(0, Number(me.distance || 0) - penalty.distancePenalty);
          }
          eventMessage = penalty.message;
        } else {
          if (me.wrongStreak >= 2) {
            me.stunUntilMs = nowMs + 3000;
          }
          if (me.wrongStreak >= 3) {
            me.distance = Math.max(0, Number(me.distance || 0) - 1);
          }
          eventMessage = me.wrongStreak >= 3 ? 'ผิดสะสม: STUN + ถอย -1' : me.wrongStreak === 2 ? 'ผิดสะสม: STUN 3 วินาที' : 'ตอบผิด';
        }
        eventType = 'wrong';
      }

      players[uid] = { ...me, updatedAt: nowMs };

      if (!isWormMode && String(data?.modeConfig?.matchType || 'solo') === 'party') {
        const teamSize = Math.max(2, Math.min(3, Number(data?.modeConfig?.teamSize || 2)));
        const finishDistance = getEffectiveFinishDistance(data?.modeConfig || {});
        const legDistance = Math.ceil(finishDistance / teamSize);
        const actor = players[uid];
        if (actor.isActiveRunner && actor.distance >= (actor.relayOrder * legDistance) && actor.relayOrder < teamSize) {
          players[uid] = { ...actor, isActiveRunner: false, hasFinishedTurn: true, updatedAt: nowMs };
          const nextUid = Object.keys(players).find((pid) => players[pid]?.teamId === actor.teamId && Number(players[pid]?.relayOrder || 0) === Number(actor.relayOrder || 1) + 1);
          if (nextUid) {
            players[nextUid] = { ...players[nextUid], isActiveRunner: true, updatedAt: nowMs };
          }
        }
      }

      let nextStatus = data.status;
      let winnerUid = data.winnerUid || '';
      let winReason = data.winReason || '';
      const finishDistance = isWormMode
        ? getEffectiveFinishDistance(data?.modeConfig || {})
        : Number(data?.modeConfig?.finishDistance || 10);
      const matchType = String(data?.modeConfig?.matchType || 'solo');
      if (matchType === 'party') {
        const teamDistance = { A: 0, B: 0 };
        Object.values(players).forEach((p) => { if (p?.teamId === 'A' || p?.teamId === 'B') teamDistance[p.teamId] = Math.max(teamDistance[p.teamId], Number(p?.distance || 0)); });
        if (teamDistance.A >= finishDistance || teamDistance.B >= finishDistance) {
          nextStatus = 'finished';
          const winTeam = teamDistance.A >= finishDistance && teamDistance.B >= finishDistance ? '' : (teamDistance.A >= finishDistance ? 'A' : 'B');
          winnerUid = winTeam
            ? Object.entries(players)
              .filter(([, player]) => String(player?.teamId || '') === winTeam)
              .sort((a, b) => {
                const [, pa] = a;
                const [, pb] = b;
                const distanceDiff = Number(pb?.distance || 0) - Number(pa?.distance || 0);
                if (distanceDiff !== 0) return distanceDiff;
                const correctDiff = Number(pb?.correctCount || 0) - Number(pa?.correctCount || 0);
                if (correctDiff !== 0) return correctDiff;
                return Number(pa?.wrongCount || 0) - Number(pb?.wrongCount || 0);
              })[0]?.[0] || ''
            : '';
          winReason = winTeam ? 'finish_line' : 'draw';
        }
      } else {
        const crossed = Object.entries(players).find(([, p]) => Number(p?.distance || 0) >= finishDistance);
        if (crossed) {
          nextStatus = 'finished';
          winnerUid = crossed[0];
          winReason = 'finish_line';
        }
      }

      const eventCounter = Number(data.eventCounter || 0) + 1;
      return {
        ...syncDuelRoomShape(data),
        players,
        status: nextStatus,
        currentRoundIndex: isWormMode
          ? Math.max(Number(data.currentRoundIndex || 0), roundIndex)
          : Number(data.currentRoundIndex || 0),
        winnerUid,
        winReason,
        eventCounter,
        lastEvent: {
          id: `${eventCounter}_${nowMs}`,
          type: eventType,
          message: eventMessage,
          actorUid: uid,
          targetUid: eventTargetUid,
          atMs: nowMs,
        },
        endedAtMs: nextStatus === 'finished' ? nowMs : data.endedAtMs || null,
        updatedAtMs: nowMs,
      };
    });
  } catch (error) {
    throw toDuelPermissionDeniedError(error);
  }

  if (!tx.committed) return { accepted: false, reason: 'transaction_not_committed' };
  const nextData = tx.snapshot.val();
  if (!nextData || nextData.status === 'playing' || nextData.status === 'finished') {
    return { accepted: true };
  }
  return { accepted: false, reason: 'room_not_active' };
}

export async function finalizeDuelByTimeout(roomId) {
  await ensureWriteAccess();
  const roomRef = rtdbRef(rtdb, `rooms/${normalizeDuelRoomId(roomId)}`);
  let finalizeReason = '';

  let tx;
  try {
    tx = await runRtdbTransaction(roomRef, (data) => {
      if (!data) throw new Error('ไม่พบห้องดวลนี้');

      if (data.status !== 'playing') {
        finalizeReason = 'room_not_active';
        return data;
      }

      const startedAtMs = Number(data.startedAtMs || 0);
      const durationSeconds = Number(data.durationSeconds || 120);
      const nowMs = Date.now();
      const deadlineMs = startedAtMs + (durationSeconds * 1000);

      if (!startedAtMs || nowMs < deadlineMs) {
        finalizeReason = 'still_running';
        return data;
      }

      const players = data.players || {};
      let result = pickDuelWinner(players);
      if (String(data?.modeConfig?.matchType || 'solo') === 'party') {
        const teamDistance = { A: 0, B: 0 };
        Object.entries(players).forEach(([pid, p]) => {
          if (p?.teamId === 'A' || p?.teamId === 'B') {
            teamDistance[p.teamId] = Math.max(teamDistance[p.teamId], Number(p?.distance || 0));
          }
        });
        if (teamDistance.A === teamDistance.B) {
          result = { winnerUid: '', reason: 'draw' };
        } else {
          const winTeam = teamDistance.A > teamDistance.B ? 'A' : 'B';
          const winnerUid = Object.keys(players).find((pid) => players[pid]?.teamId === winTeam && Number(players[pid]?.relayOrder || 0) === Number(data?.modeConfig?.teamSize || 2))
            || Object.keys(players).find((pid) => players[pid]?.teamId === winTeam)
            || '';
          result = { winnerUid, reason: 'team_distance' };
        }
      }
      const eventCounter = Number(data.eventCounter || 0) + 1;

      return {
        ...syncDuelRoomShape(data),
        status: 'finished',
        winnerUid: result.winnerUid,
        winReason: `timeout_${result.reason}`,
        eventCounter,
        lastEvent: {
          id: `${eventCounter}_${nowMs}`,
          type: 'timeout',
          message: 'หมดเวลาแล้ว! ระบบกำลังตัดสินผล',
          actorUid: '',
          targetUid: '',
          atMs: nowMs,
        },
        endedAtMs: nowMs,
        updatedAtMs: nowMs,
      };
    });
  } catch (error) {
    throw toDuelPermissionDeniedError(error);
  }

  if (!tx.committed) return { accepted: false, reason: 'transaction_not_committed' };
  if (finalizeReason) return { accepted: false, reason: finalizeReason };
  const nextData = tx.snapshot.val();
  if (!nextData || nextData.status !== 'finished') return { accepted: false, reason: 'room_not_active' };
  return { accepted: true, winnerUid: nextData.winnerUid || '', reason: nextData.winReason || '' };
}
