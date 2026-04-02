import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
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

async function ensureAuthReady() {
  if (!authInitPromise) {
    authInitPromise = signInAnonymously(auth).catch((error) => {
      console.warn('Anonymous auth failed, continuing without auth session.', error);
      return null;
    });
  }

  await authInitPromise;
}

export async function saveCourse(course) {
  await ensureAuthReady();
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
  await ensureAuthReady();
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
  await ensureAuthReady();
  await Promise.all(questions.map((question, idx) => addQuestion(courseId, question, idx + 1)));
}

export async function replaceQuestionsForCourse(courseId, questions) {
  await ensureAuthReady();
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
  await ensureAuthReady();
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
  await ensureAuthReady();
  await deleteDoc(doc(db, 'questions', questionId));
}

export async function deleteCourseWithQuestions(courseId) {
  await ensureAuthReady();
  const existingQuestions = await getQuestionsByCourse(courseId);
  const batch = writeBatch(db);

  existingQuestions.forEach((item) => batch.delete(doc(db, 'questions', item.id)));
  batch.delete(doc(db, 'courses', courseId));
  await batch.commit();
}

export async function getAllCourses() {
  const snap = await getDocs(collection(db, 'courses'));
  return snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }))
    .sort((a, b) => String(a.courseId).localeCompare(String(b.courseId)));
}

export function subscribeCourses(callback, onError) {
  const q = query(collection(db, 'courses'), orderBy('courseId', 'asc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function getCourse(courseId) {
  const snap = await getDoc(doc(db, 'courses', courseId));
  return snap.exists() ? snap.data() : null;
}

export async function getQuestionsByCourse(courseId) {
  const q = query(collection(db, 'questions'), where('courseId', '==', courseId), orderBy('order', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
}

export function subscribeQuestionsByCourse(courseId, callback, onError) {
  const q = query(collection(db, 'questions'), where('courseId', '==', courseId), orderBy('order', 'asc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function saveLead(payload) {
  await ensureAuthReady();
  await addDoc(collection(db, 'leads'), {
    ...payload,
    createdAt: serverTimestamp(),
  });
}

export function subscribeLeads(callback, onError) {
  const q = query(collection(db, 'leads'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function deleteLeadById(leadId) {
  await ensureAuthReady();
  await deleteDoc(doc(db, 'leads', leadId));
}

export async function getLeaderboard(courseId) {
  const q = query(
    collection(db, 'leads'),
    where('courseId', '==', courseId),
    orderBy('scorePercent', 'desc'),
    orderBy('durationSeconds', 'asc'),
    limit(5),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function saveProfile(profile) {
  await ensureAuthReady();
  await setDoc(doc(db, 'profile', 'tutor_profile'), {
    name: profile.name,
    bio: profile.bio,
    imageUrl: profile.imageUrl,
    profileUrl: profile.profileUrl,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getProfile() {
  const snap = await getDoc(doc(db, 'profile', 'tutor_profile'));
  return snap.exists() ? snap.data() : null;
}

export function subscribeProfile(callback, onError) {
  return onSnapshot(doc(db, 'profile', 'tutor_profile'), (snap) => callback(snap.exists() ? snap.data() : null), onError);
}
