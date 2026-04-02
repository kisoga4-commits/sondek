import { replaceQuestionsForCourse, saveCourse } from './db.js';
import { defaultMathQuestions } from './questionsSeed.js';

const form = document.getElementById('templateForm');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const courseId = document.getElementById('courseId').value.trim();
  const title = document.getElementById('courseTitle').value.trim();
  const enrollmentUrl = document.getElementById('enrollmentUrl').value.trim();

  if (!courseId || !title) {
    alert('กรอกข้อมูลให้ครบ');
    return;
  }

  await saveCourse({
    courseId,
    title,
    status: 'open',
    enrollmentUrl,
    quizLink: `${window.location.origin}/quiz.html?id=${courseId}`,
  });
  await replaceQuestionsForCourse(courseId, defaultMathQuestions);
  alert(`สร้างคอร์ส ${courseId} พร้อมโจทย์ 20 ข้อแล้ว`);
});
