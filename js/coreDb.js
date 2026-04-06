import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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

let authInitPromise = null;
const AUTH_BOOTSTRAP_TIMEOUT_MS = 3500;

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

const CORE_AUTH_HINT = 'ล็อกอินแบบ Anonymous ไม่สำเร็จ — เปิด Firebase Authentication > Sign-in method > Anonymous และเพิ่มโดเมนปัจจุบันใน Authorized domains';

function toCoreAuthConfigError(error) {
  if (!isAnonymousAuthConfigError(error)) return error;
  const nextError = new Error(CORE_AUTH_HINT);
  nextError.code = 'auth/anonymous-not-enabled';
  nextError.cause = error;
  return nextError;
}

async function ensureAuthReady() {
  if (auth.currentUser) return;

  if (!authInitPromise) {
    authInitPromise = new Promise((resolve) => {
      let settled = false;
      let unsubscribe = null;
      let timeoutId = null;

      const finalizeResolve = () => {
        if (settled) return;
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        if (unsubscribe) unsubscribe();
        resolve();
      };

      timeoutId = window.setTimeout(() => {
        console.warn('Auth bootstrap timeout. Continue in guest mode.');
        finalizeResolve();
      }, AUTH_BOOTSTRAP_TIMEOUT_MS);

      unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          finalizeResolve();
          return;
        }

        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.warn('Anonymous auth is unavailable. Continue in guest mode for public Firestore reads/writes allowed by rules.', toCoreAuthConfigError(error));
          finalizeResolve();
        }
      }, (error) => {
        console.warn('Auth state listener failed. Continue in guest mode.', toCoreAuthConfigError(error));
        finalizeResolve();
      });
    });
  }

  await authInitPromise;
}

async function ensureWriteAccess() {
  await ensureAuthReady();
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

export async function getProfile() {
  await ensureAuthReady();
  const snap = await getDoc(doc(db, 'profile', 'tutor_profile'));
  return snap.exists() ? snap.data() : null;
}
