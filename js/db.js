import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import {
  addDoc,
  collection,
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
const auth = getAuth(app);
const storage = getStorage(app);

let authInitPromise = null;


function isPermissionDeniedError(error) {
  const errorCode = String(error?.code || '');
  const errorMessage = String(error?.message || '');
  return errorCode.includes('permission-denied')
    || errorMessage.includes('Missing or insufficient permissions');
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
          finalizeReject(error);
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
  const normalizedProfileImageUrl = String(profile?.profile_image_url || profile?.imageUrl || '').trim();
  const normalizedProfileUrl = String(profile?.profileUrl || '').trim();
  const normalizedTeachingImages = Array.isArray(profile?.teachingImages)
    ? profile.teachingImages.map((url) => String(url || '').trim()).filter(Boolean)
    : [];

  await setDoc(doc(db, 'profile', 'tutor_profile'), {
    name: normalizedName,
    bio: normalizedBio,
    profile_image_url: normalizedProfileImageUrl,
    profileUrl: normalizedProfileUrl,
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
