import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
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

export async function saveCourse(course) {
  await setDoc(doc(db, 'courses', course.courseId), {
    courseId: course.courseId,
    title: course.title,
    description: course.description || '',
    status: course.status || 'open',
    quizLink: course.quizLink || `${window.location.origin}/quiz.html?id=${course.courseId}`,
    enrollmentUrl: course.enrollmentUrl || '',
    questionCount: Number(course.questionCount) === 20 ? 20 : 10,
    timedMode: Boolean(course.timedMode),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function addQuestion(courseId, question, order) {
  await addDoc(collection(db, 'questions'), {
    courseId,
    question: question.question,
    type: question.type || 'multiple_choice',
    choices: question.choices || [],
    answerIndex: Number(question.answerIndex ?? 0),
    orderingItems: question.orderingItems || [],
    order,
    createdAt: serverTimestamp(),
  });
}

export async function saveQuestionsBatch(courseId, questions) {
  await Promise.all(questions.map((question, idx) => addQuestion(courseId, question, idx + 1)));
}

export async function replaceQuestionsForCourse(courseId, questions) {
  const existingQuestions = await getQuestionsByCourse(courseId);
  await Promise.all(existingQuestions.map((item) => deleteDoc(doc(db, 'questions', item.id))));
  await saveQuestionsBatch(courseId, questions);
}

export async function updateQuestion(questionId, question) {
  await updateDoc(doc(db, 'questions', questionId), {
    question: question.question,
    type: question.type || 'multiple_choice',
    choices: question.choices || [],
    answerIndex: Number(question.answerIndex ?? 0),
    orderingItems: question.orderingItems || [],
  });
}

export async function deleteQuestionById(questionId) {
  await deleteDoc(doc(db, 'questions', questionId));
}

export async function deleteCourseWithQuestions(courseId) {
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
