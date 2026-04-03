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
  await setDoc(doc(db, 'profile', 'tutor_profile'), {
    name: profile.name,
    bio: profile.bio,
    imageUrl: profile.imageUrl,
    profileUrl: profile.profileUrl,
    teachingImages: Array.isArray(profile.teachingImages)
      ? profile.teachingImages.map((url) => String(url || '').trim()).filter(Boolean)
      : [],
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
