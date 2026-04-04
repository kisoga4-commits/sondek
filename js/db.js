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

const DUEL_PERMISSION_HINT = 'ยังไม่มีสิทธิ์ใช้งาน Duel Mode ใน Realtime Database (Missing or insufficient permissions) — เปิด Firebase Auth แบบ Anonymous และ publish RTDB Rules ที่อนุญาต auth != null บน path duel_rooms/{roomId}';
const DUEL_AUTH_HINT = 'ล็อกอินแบบ Anonymous ไม่สำเร็จ — เปิด Firebase Authentication > Sign-in method > Anonymous และเพิ่มโดเมนปัจจุบันใน Authorized domains';
const DUEL_START_HP = 10;
const DUEL_MAX_HP = 10;
const DUEL_ROOM_ID_LENGTH = 6;
const DUEL_QUESTION_SECONDS = 10;
const DUEL_REVEAL_SECONDS = 0.8;
const DUEL_ROUND_MS = Math.round((DUEL_QUESTION_SECONDS + DUEL_REVEAL_SECONDS) * 1000);
const WORM_STUN_MS = 3000;
const WORM_SEGMENT_GOAL = 5;

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
  await setDoc(doc(db, 'course_offerings', courseId), {
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
  });
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
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

export function subscribeQuestionsByCourse(courseId, callback, onError) {
  const q = query(collection(db, 'questions'), where('courseId', '==', courseId));
  let unsubscribe = () => {};

  ensureAuthReady()
    .then(() => {
      unsubscribe = onSnapshot(q, (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
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
  let next = String(Math.floor(100000 + Math.random() * 900000));
  if (next === previous) {
    next = String(((Number(next) + Math.floor(Math.random() * 800000) + 100000) % 900000) + 100000)
      .slice(0, DUEL_ROOM_ID_LENGTH);
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(key, next);
  }
  return next;
}

function buildDuelPlayerPayload(name) {
  return {
    name: sanitizeDuelName(name),
    hp: DUEL_START_HP,
    correctCount: 0,
    wrongCount: 0,
    wrongStreak: 0,
    correctStreak: 0,
    lastAnsweredRound: -1,
    updatedAt: Date.now(),
  };
}

function buildWormPlayerPayload(name) {
  return {
    name: sanitizeDuelName(name),
    score: 0,
    correctCount: 0,
    wrongCount: 0,
    wrongStreak: 0,
    correctStreak: 0,
    stunnedUntilMs: 0,
    lastAnsweredRound: -1,
    teamId: '',
    relayOrder: 0,
    completedRelay: false,
    updatedAt: Date.now(),
  };
}

function ensureWormTeams(roomData) {
  const players = { ...(roomData.players || {}) };
  const modeConfig = roomData.modeConfig || {};
  const isTeam = String(modeConfig.matchType || 'solo') === 'team';
  if (!isTeam) return { players, teams: null };

  const teamSize = Math.max(2, Math.min(3, Number(modeConfig.relaySize || 2)));
  const uids = Object.keys(players);
  const slots = uids.slice(0, teamSize * 2);
  const teamA = slots.filter((_, index) => index % 2 === 0).slice(0, teamSize);
  const teamB = slots.filter((_, index) => index % 2 === 1).slice(0, teamSize);

  teamA.forEach((uid, index) => {
    players[uid] = { ...players[uid], teamId: 'A', relayOrder: index, updatedAt: Date.now() };
  });
  teamB.forEach((uid, index) => {
    players[uid] = { ...players[uid], teamId: 'B', relayOrder: index, updatedAt: Date.now() };
  });

  return {
    players,
    teams: {
      A: { activeRelayOrder: 0, size: teamA.length, finished: false },
      B: { activeRelayOrder: 0, size: teamB.length, finished: false },
    },
  };
}

function pickWormWinner(data) {
  const players = data.players || {};
  const isTeam = String(data?.modeConfig?.matchType || 'solo') === 'team';
  if (!isTeam) {
    const ranked = Object.entries(players).sort((a, b) => Number(b[1]?.score || 0) - Number(a[1]?.score || 0));
    if (!ranked.length) return { winnerUid: '', reason: 'empty' };
    if (Number(ranked[0][1]?.score || 0) === Number(ranked[1]?.[1]?.score || -1)) return { winnerUid: '', reason: 'draw' };
    return { winnerUid: ranked[0][0], reason: 'distance' };
  }

  const totals = { A: 0, B: 0 };
  Object.values(players).forEach((player) => {
    const teamId = player?.teamId;
    if (!totals[teamId] && teamId !== 'A' && teamId !== 'B') return;
    totals[teamId] += Number(player?.score || 0);
  });
  if (totals.A === totals.B) return { winnerUid: '', reason: 'draw_team' };
  return { winnerUid: totals.A > totals.B ? 'team:A' : 'team:B', reason: 'distance_team' };
}

function getCurrentRoundIndex(room, nowMs = Date.now()) {
  const startedAtMs = Number(room?.startedAtMs || 0);
  if (!startedAtMs) return -1;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.floor(elapsedMs / DUEL_ROUND_MS);
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
    const hpDiff = Number(b?.hp || 0) - Number(a?.hp || 0);
    if (hpDiff !== 0) return hpDiff;
    const correctDiff = Number(b?.correctCount || 0) - Number(a?.correctCount || 0);
    if (correctDiff !== 0) return correctDiff;
    return Number(a?.wrongCount || 0) - Number(b?.wrongCount || 0);
  });
  const [winnerUid, winner] = ranked[0];
  const [, runnerUp] = ranked[1] || [];
  const hasClearWinner = !runnerUp
    || Number(winner?.hp || 0) !== Number(runnerUp?.hp || 0)
    || Number(winner?.correctCount || 0) !== Number(runnerUp?.correctCount || 0)
    || Number(winner?.wrongCount || 0) !== Number(runnerUp?.wrongCount || 0);
  return { winnerUid: hasClearWinner ? winnerUid : '', reason: hasClearWinner ? 'hp' : 'draw' };
}

export async function createDuelRoom(payload) {
  await ensureWriteAccess();
  const uid = getDuelActorUid();
  const preferredRoomId = normalizeDuelRoomId(payload?.roomId);
  const maxAttempts = preferredRoomId ? 1 : 8;
  const durationSecondsRaw = Number(payload?.durationSeconds || 120);
  const durationSeconds = [120, 180, 240, 300].includes(durationSecondsRaw) ? durationSecondsRaw : 120;
  const gameMode = String(payload?.gameMode || 'attack') === 'worm' ? 'worm' : 'attack';
  const matchType = String(payload?.matchType || 'solo') === 'team' ? 'team' : 'solo';
  const relaySize = Math.max(2, Math.min(3, Number(payload?.relaySize || 2)));
  const modeConfig = { gameMode, matchType, relaySize };

  const hostPlayer = gameMode === 'worm'
    ? buildWormPlayerPayload(payload?.hostName || 'Host')
    : buildDuelPlayerPayload(payload?.hostName || 'Host');

  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const roomId = preferredRoomId || ensureAvailableDuelRoomId();
    try {
      // Intentionally skip client-side read before create.
      // This avoids failing on projects that allow create but deny read.
      // Expected Realtime Database rules should allow write only when room does not yet exist.
      // eslint-disable-next-line no-await-in-loop
      const roomRef = rtdbRef(rtdb, `duel_rooms/${roomId}`);
      // eslint-disable-next-line no-await-in-loop
      const tx = await runRtdbTransaction(roomRef, (current) => {
        if (current) return;
        return {
          roomId,
          courseId: String(payload?.courseId || '').trim(),
          status: 'waiting',
          hostUid: uid,
          hostName: hostPlayer.name,
          durationSeconds,
          maxPlayers: 4,
          modeConfig,
          questionSequence: Array.isArray(payload?.questionSequence) ? payload.questionSequence : [],
          players: {
            [uid]: hostPlayer,
          },
          winnerUid: '',
          winReason: '',
          eventCounter: 0,
          questionSeconds: DUEL_QUESTION_SECONDS,
          revealSeconds: DUEL_REVEAL_SECONDS,
          updatedAtMs: Date.now(),
          createdAtMs: Date.now(),
          startedAtMs: null,
          endedAtMs: null,
        };
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
  if (safeRoomId.length !== DUEL_ROOM_ID_LENGTH) throw new Error('รหัสห้องต้องเป็นตัวเลข 6 หลัก');

  const roomRef = rtdbRef(rtdb, `duel_rooms/${safeRoomId}`);
  let tx;
  try {
    tx = await runRtdbTransaction(roomRef, (data) => {
      if (!data) throw new Error('ไม่พบห้องดวลนี้');
      const players = data.players || {};
      const existingUids = Object.keys(players);

      if (data.status === 'finished') throw new Error('ห้องนี้จบดวลแล้ว');

      const maxPlayers = Math.max(2, Number(data.maxPlayers || 4));
      if (!players[uid] && existingUids.length >= maxPlayers) {
        throw new Error('ห้องเต็มแล้ว');
      }

      const nextPlayers = {
        ...players,
        [uid]: players[uid] ? {
          ...players[uid],
          name: sanitizeDuelName(playerName, players[uid].name || 'ผู้เล่น'),
          updatedAt: Date.now(),
        } : (String(data?.modeConfig?.gameMode || 'attack') === 'worm'
          ? buildWormPlayerPayload(playerName)
          : buildDuelPlayerPayload(playerName)),
      };

      return {
        ...data,
        players: nextPlayers,
        status: data.status || 'waiting',
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
  if (safeRoomId.length !== DUEL_ROOM_ID_LENGTH) throw new Error('รหัสห้องต้องเป็นตัวเลข 6 หลัก');

  const roomRef = rtdbRef(rtdb, `duel_rooms/${safeRoomId}`);
  let tx;
  try {
    tx = await runRtdbTransaction(roomRef, (data) => {
      if (!data) throw new Error('ไม่พบห้องดวลนี้');
      if (String(data.hostUid || '') !== uid) throw new Error('เฉพาะ Host เท่านั้นที่เริ่มดวลได้');
      if (data.status === 'finished') throw new Error('ห้องนี้จบดวลแล้ว');
      if (data.status === 'active') return data;

      const players = data.players || {};
      if (Object.keys(players).length < 2) {
        throw new Error('ต้องมีผู้เล่นอย่างน้อย 2 คนก่อนเริ่มดวล');
      }

      const modeConfig = data.modeConfig || {};
      const isWormTeam = String(modeConfig.gameMode || 'attack') === 'worm'
        && String(modeConfig.matchType || 'solo') === 'team';
      if (isWormTeam) {
        const expectedPlayers = Math.max(2, Math.min(3, Number(modeConfig.relaySize || 2))) * 2;
        if (Object.keys(players).length < expectedPlayers) {
          throw new Error(`โหมด Team ต้องมีผู้เล่นครบ ${expectedPlayers} คน`);
        }
      }

      const prepared = String(modeConfig.gameMode || 'attack') === 'worm'
        ? ensureWormTeams(data)
        : { players, teams: null };

      return {
        ...data,
        players: prepared.players,
        teams: prepared.teams,
        status: 'active',
        startedAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
    });
  } catch (error) {
    throw toDuelPermissionDeniedError(error);
  }
  if (!tx.committed) throw new Error('เริ่มดวลไม่สำเร็จ กรุณาลองอีกครั้ง');

  return { roomId: safeRoomId, uid };
}

export function subscribeDuelRoom(roomId, callback, onError) {
  let unsubscribe = () => {};
  ensureAuthReady()
    .then(() => {
      const safeRoomId = normalizeDuelRoomId(roomId);
      const roomRef = rtdbRef(rtdb, `duel_rooms/${safeRoomId}`);
      unsubscribe = onValue(roomRef, (snap) => {
        callback(snap.exists() ? { id: safeRoomId, ...snap.val() } : null);
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
  if (safeRoomId.length !== DUEL_ROOM_ID_LENGTH) throw new Error('รหัสห้องต้องเป็นตัวเลข 6 หลัก');

  const roomRef = rtdbRef(rtdb, `duel_rooms/${safeRoomId}`);

  let tx;
  try {
    tx = await runRtdbTransaction(roomRef, (data) => {
      if (!data) throw new Error('ไม่พบห้องดวลนี้');
      if (data.status !== 'active') {
        return data;
      }
      if (String(data?.modeConfig?.gameMode || 'attack') === 'worm') {
        const players = { ...(data.players || {}) };
        const me = { ...(players[uid] || {}) };
        const nowMs = Date.now();
        const roundIndex = getCurrentRoundIndex(data, nowMs);
        if (roundIndex < 0) return data;
        if (Number(me.lastAnsweredRound ?? -1) >= roundIndex) return data;
        if (Number(me.stunnedUntilMs || 0) > nowMs) return data;

        const isTeam = String(data?.modeConfig?.matchType || 'solo') === 'team';
        const teams = { ...(data.teams || {}) };
        if (isTeam) {
          const myTeam = me.teamId || '';
          const teamState = teams[myTeam];
          if (!teamState || Number(teamState.activeRelayOrder) !== Number(me.relayOrder || 0)) return data;
        }

        const isCorrect = Boolean(payload?.isCorrect);
        me.lastAnsweredRound = roundIndex;
        let eventType = '';
        let eventMessage = '';
        let eventTargetUid = '';

        if (isCorrect) {
          me.correctCount = Number(me.correctCount || 0) + 1;
          me.correctStreak = Number(me.correctStreak || 0) + 1;
          me.wrongStreak = 0;
          me.score = Math.max(0, Number(me.score || 0) + 1);
          if (me.correctStreak >= 3) {
            me.correctStreak = 0;
            const candidates = Object.entries(players)
              .filter(([pid, p]) => pid !== uid && (!isTeam || p?.teamId !== me.teamId))
              .filter(([, p]) => (!isTeam || Number((teams[p?.teamId] || {}).activeRelayOrder || 0) === Number(p?.relayOrder || 0)));
            const [targetUid, targetPayload] = candidates[0] || [];
            if (targetUid && targetPayload) {
              const target = { ...targetPayload };
              target.score = Math.max(0, Number(target.score || 0) - 1);
              target.updatedAt = nowMs;
              players[targetUid] = target;
              eventType = 'attack';
              eventMessage = 'ตอบถูกติดกัน 3 ข้อ โจมตีคู่แข่ง -1';
              eventTargetUid = targetUid;
            }
          }
        } else {
          me.wrongCount = Number(me.wrongCount || 0) + 1;
          me.correctStreak = 0;
          me.wrongStreak = Number(me.wrongStreak || 0) + 1;
          if (me.wrongStreak >= 2) {
            me.stunnedUntilMs = nowMs + WORM_STUN_MS;
            eventType = 'stun';
            eventMessage = 'ตอบผิดติดกัน โดน Stun 3 วินาที';
            eventTargetUid = uid;
          }
          if (me.wrongStreak >= 3) {
            me.score = Math.max(0, Number(me.score || 0) - 1);
            eventType = 'stun_penalty';
            eventMessage = 'ตอบผิดติดกัน โดน Stun และ -1';
            eventTargetUid = uid;
          }
        }

        if (isTeam) {
          const teamId = me.teamId;
          const teamState = { ...(teams[teamId] || {}) };
          const relayOrder = Number(me.relayOrder || 0);
          const finishedSegment = Number(me.score || 0) >= WORM_SEGMENT_GOAL;
          if (finishedSegment && Number(teamState.activeRelayOrder || 0) === relayOrder) {
            me.completedRelay = true;
            const nextOrder = relayOrder + 1;
            if (nextOrder >= Number(teamState.size || 0)) {
              teamState.finished = true;
              teamState.activeRelayOrder = relayOrder;
            } else {
              teamState.activeRelayOrder = nextOrder;
            }
            teams[teamId] = teamState;
          }
        }

        me.updatedAt = nowMs;
        players[uid] = me;

        let nextStatus = data.status;
        let winnerUid = data.winnerUid || '';
        let winReason = data.winReason || '';
        if (isTeam && teams.A?.finished && teams.B?.finished) {
          const totalA = Object.values(players).filter((p) => p?.teamId === 'A').reduce((sum, p) => sum + Number(p?.score || 0), 0);
          const totalB = Object.values(players).filter((p) => p?.teamId === 'B').reduce((sum, p) => sum + Number(p?.score || 0), 0);
          nextStatus = 'finished';
          winnerUid = totalA === totalB ? '' : (totalA > totalB ? 'team:A' : 'team:B');
          winReason = 'team_finish';
        }

        const eventCounter = Number(data.eventCounter || 0) + (eventType ? 1 : 0);
        return {
          ...data,
          players,
          teams,
          status: nextStatus,
          winnerUid,
          winReason,
          eventCounter,
          lastEvent: eventType ? {
            id: `${eventCounter}_${nowMs}`,
            type: eventType,
            message: eventMessage,
            actorUid: uid,
            targetUid: eventTargetUid,
            atMs: nowMs,
          } : null,
          endedAtMs: nextStatus === 'finished' ? nowMs : data.endedAtMs || null,
          updatedAtMs: nowMs,
        };
      }

      const players = { ...(data.players || {}) };
      const me = { ...(players[uid] || {}) };
      const opponentUids = Object.keys(players).filter((id) => id !== uid);
      if (!opponentUids.length) throw new Error('กำลังรอคู่ดวลเข้าห้อง');
      if (Number(me.hp || 0) <= 0) return data;

      let eventType = '';
      let eventMessage = '';
      let eventTargetUid = '';

      const isCorrect = Boolean(payload?.isCorrect);
      const nowMs = Date.now();
      const roundIndex = getCurrentRoundIndex(data, nowMs);
      if (roundIndex < 0) return data;
      if (Number(me.lastAnsweredRound ?? -1) >= roundIndex) return data;
      me.lastAnsweredRound = roundIndex;

      if (isCorrect) {
        me.correctCount = Number(me.correctCount || 0) + 1;
        me.correctStreak = Number(me.correctStreak || 0) + 1;
        me.wrongStreak = 0;
        const totalPlayers = Object.keys(players).length;
        const targetCount = totalPlayers <= 3 ? 1 : 2;
        const targetUids = pickTopTargetUids(players, uid, targetCount);
        let damagedCount = 0;
        targetUids.forEach((opponentUid) => {
          const opponent = { ...(players[opponentUid] || {}) };
          opponent.hp = Math.max(0, Number(opponent.hp || 0) - 1);
          damagedCount += 1;
          opponent.updatedAt = nowMs;
          players[opponentUid] = opponent;
        });
        if (me.correctStreak >= 3) {
          me.correctStreak = 0;
          me.hp = Math.min(DUEL_MAX_HP, Number(me.hp || 0) + 1);
          eventType = 'streak_bonus';
          eventMessage = 'ตอบถูกติดกัน 3 ข้อ! ฟื้น HP +1';
          eventTargetUid = uid;
        } else {
          eventType = 'attack';
          eventMessage = damagedCount > 0
            ? `โจมตีโดน ${damagedCount} คน!`
            : 'ไม่มีเป้าหมายให้โจมตี';
          eventTargetUid = targetUids[0] || '';
        }
      } else {
        me.wrongCount = Number(me.wrongCount || 0) + 1;
        me.wrongStreak = Number(me.wrongStreak || 0) + 1;
        me.correctStreak = 0;
        if (me.wrongStreak >= 3) {
          me.wrongStreak = 0;
          me.hp = Math.max(0, Number(me.hp || 0) - 1);
          eventType = 'penalty';
          eventMessage = 'ตอบผิดติดกัน 3 ครั้ง! HP ลดลง 1';
          eventTargetUid = uid;
        }
      }

      me.updatedAt = nowMs;
      players[uid] = me;

      let nextStatus = data.status;
      let winnerUid = data.winnerUid || '';
      let winReason = data.winReason || '';

      const aliveUids = Object.entries(players)
        .filter(([, player]) => Number(player?.hp || 0) > 0)
        .map(([playerUid]) => playerUid);
      if (aliveUids.length <= 1) {
        nextStatus = 'finished';
        winnerUid = aliveUids[0] || '';
        winReason = 'knockout';
        eventType = 'knockout';
        eventMessage = winnerUid === uid ? 'เก็บเรียบ! น็อคทั้งห้อง!' : 'โดนน็อคยับ!';
      } else if (!eventType && Object.values(players).some((player) => Number(player?.hp || 0) < 3)) {
        eventType = 'critical';
        eventMessage = 'ระวัง! มึงจะตายแล้ว!';
        eventTargetUid = Object.keys(players).find((playerUid) => Number(players[playerUid]?.hp || 0) < 3) || uid;
      }

      const eventCounter = Number(data.eventCounter || 0) + (eventType ? 1 : 0);

      return {
        ...data,
        players,
        status: nextStatus,
        winnerUid,
        winReason,
        eventCounter,
        lastEvent: eventType ? {
          id: `${eventCounter}_${nowMs}`,
          type: eventType,
          message: eventMessage,
          actorUid: uid,
          targetUid: eventTargetUid,
          atMs: nowMs,
        } : null,
        endedAtMs: nextStatus === 'finished' ? nowMs : data.endedAtMs || null,
        updatedAtMs: nowMs,
      };
    });
  } catch (error) {
    throw toDuelPermissionDeniedError(error);
  }

  if (!tx.committed) return { accepted: false, reason: 'transaction_not_committed' };
  const nextData = tx.snapshot.val();
  if (!nextData || nextData.status === 'active' || nextData.status === 'finished') {
    return { accepted: true };
  }
  return { accepted: false, reason: 'room_not_active' };
}

export async function finalizeDuelByTimeout(roomId) {
  await ensureWriteAccess();
  const roomRef = rtdbRef(rtdb, `duel_rooms/${normalizeDuelRoomId(roomId)}`);
  let finalizeReason = '';

  let tx;
  try {
    tx = await runRtdbTransaction(roomRef, (data) => {
      if (!data) throw new Error('ไม่พบห้องดวลนี้');

      if (data.status !== 'active') {
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
      const result = String(data?.modeConfig?.gameMode || 'attack') === 'worm'
        ? pickWormWinner(data)
        : pickDuelWinner(players);
      const eventCounter = Number(data.eventCounter || 0) + 1;

      return {
        ...data,
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
