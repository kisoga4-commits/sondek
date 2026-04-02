import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

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
    tutorName: course.tutorName,
    tutorPhotoUrl: course.tutorPhotoUrl,
    tutorBio: course.tutorBio,
    updatedAt: serverTimestamp(),
  });
}

export async function saveQuestionsBatch(courseId, questions) {
  const writes = questions.map((question, idx) => {
    const payload = {
      courseId,
      question: question.question,
      choices: question.choices,
      answerIndex: Number(question.answerIndex),
      order: idx + 1,
      createdAt: serverTimestamp(),
    };
    return addDoc(collection(db, 'questions'), payload);
  });

  await Promise.all(writes);
}

export async function replaceQuestionsForCourse(courseId, questions) {
  const existingQuestions = await getQuestionsByCourse(courseId);

  await Promise.all(existingQuestions.map((item) => deleteDoc(doc(db, 'questions', item.id))));
  await saveQuestionsBatch(courseId, questions);
}

export async function getAllCourses() {
  const snap = await getDocs(collection(db, 'courses'));
  return snap.docs
    .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
    .sort((a, b) => String(a.courseId).localeCompare(String(b.courseId)));
}

export async function getCourse(courseId) {
  const q = query(collection(db, 'courses'), where('courseId', '==', courseId), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) {
    return null;
  }

  return snap.docs[0].data();
}

export async function getQuestionsByCourse(courseId) {
  const q = query(collection(db, 'questions'), where('courseId', '==', courseId), orderBy('order', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
}

export async function saveLead(payload) {
  await addDoc(collection(db, 'leads'), {
    ...payload,
    createdAt: serverTimestamp(),
  });
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
  return snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
}
