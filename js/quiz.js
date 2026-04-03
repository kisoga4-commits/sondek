export const DEFAULT_DRAW_COUNT = 10;
export const DEFAULT_POINTS = 1000;
export const DEFAULT_TIME_LIMIT_SECONDS = 30;

export function shuffleArray(items) {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

export function pickRandomQuestions(allQuestions, amount = DEFAULT_DRAW_COUNT) {
  if (!Array.isArray(allQuestions)) {
    return [];
  }

  return shuffleArray(allQuestions).slice(0, Math.min(amount, allQuestions.length));
}

export function getQuestionType(question) {
  return question?.type || 'multiple_choice';
}

export function normalizeQuestion(rawQuestion = {}) {
  const type = getQuestionType(rawQuestion);
  const base = {
    type,
    question: String(rawQuestion.question || '').trim(),
    timeLimitSeconds: Math.max(5, Number(rawQuestion.timeLimitSeconds) || DEFAULT_TIME_LIMIT_SECONDS),
    points: Math.max(1, Number(rawQuestion.points) || DEFAULT_POINTS),
    mediaUrl: String(rawQuestion.mediaUrl || '').trim(),
  };

  if (type === 'ordering') {
    return {
      ...base,
      orderingItems: Array.isArray(rawQuestion.orderingItems)
        ? rawQuestion.orderingItems.map((item) => String(item).trim()).filter(Boolean)
        : [],
    };
  }

  if (type === 'true_false') {
    return {
      ...base,
      choices: ['จริง', 'เท็จ'],
      answerIndex: Number(rawQuestion.answerIndex) === 1 ? 1 : 0,
    };
  }

  if (type === 'short_text') {
    const acceptedAnswers = Array.isArray(rawQuestion.acceptedAnswers)
      ? rawQuestion.acceptedAnswers.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    return {
      ...base,
      choices: [],
      acceptedAnswers,
      answerIndex: -1,
    };
  }

  const normalizedChoices = Array.isArray(rawQuestion.choices)
    ? rawQuestion.choices.map((choice) => String(choice || '').trim())
    : [];

  const mcChoices = [0, 1, 2, 3].map((index) => normalizedChoices[index] || '');

  return {
    ...base,
    choices: mcChoices,
    answerIndex: Math.min(3, Math.max(0, Number(rawQuestion.answerIndex) || 0)),
  };
}

function isOrderingAnswerCorrect(question, answer) {
  if (!Array.isArray(question.orderingItems) || !Array.isArray(answer)) {
    return false;
  }

  if (question.orderingItems.length !== answer.length) {
    return false;
  }

  return question.orderingItems.every((item, index) => item === answer[index]);
}

export function isQuestionCorrect(question, answer) {
  if (getQuestionType(question) === 'short_text') {
    const normalizedAnswer = String(answer ?? '').trim().toLowerCase();
    if (!normalizedAnswer) return false;

    return (question.acceptedAnswers || [])
      .map((item) => String(item).trim().toLowerCase())
      .includes(normalizedAnswer);
  }

  if (getQuestionType(question) === 'ordering') {
    return isOrderingAnswerCorrect(question, answer);
  }

  return Number(question.answerIndex) === Number(answer);
}

export function calculateScore(quizQuestions, answersMap) {
  let correct = 0;
  let totalScore = 0;
  let maxScore = 0;
  const review = [];

  quizQuestions.forEach((rawQuestion, index) => {
    const question = normalizeQuestion(rawQuestion);
    const isCorrect = isQuestionCorrect(question, answersMap[index]);
    const earnedPoints = isCorrect ? question.points : 0;

    if (isCorrect) {
      correct += 1;
      totalScore += earnedPoints;
    }

    maxScore += question.points;

    review.push({
      index,
      question,
      userAnswer: answersMap[index],
      isCorrect,
      earnedPoints,
    });
  });

  const total = quizQuestions.length;
  const percent = maxScore === 0 ? 0 : Math.round((totalScore / maxScore) * 100);
  return {
    correct,
    total,
    totalScore,
    maxScore,
    percent,
    review,
  };
}

const RESULT_FEEDBACKS = {
  0: {
    title: '0 คะแนน (0%)',
    lines: [
      'โอเค...กระดาษคำตอบสะอาดมาก ครูเอาไปพับเครื่องบินได้เลย!',
      'เหมือนกดตอบด้วยโหมดสุ่มอัตโนมัติ แต่ยังน่ารักนะเนี่ย!',
      'คำตอบถูกอยู่ไหนไม่รู้ แต่ใจสู้ของเธออยู่ตรงนี้ 👍',
      'รอบนี้เรียกว่า “วอร์มอัปสมอง” ก่อนของจริงรอบหน้า!',
      'ถ้าคะแนนเป็นเกม RPG ตอนนี้ยังอยู่หมู่บ้านเริ่มต้น 😆',
      'ไม่เป็นไร! ศูนย์วันนี้อาจเป็นฮีโร่พรุ่งนี้ได้เสมอ',
      'เหมือนสมองโหลดไม่ทัน เพราะเน็ตใจยังไม่แรงพอ',
      'ครูยังเชื่อว่าเธอแอบเก็บไม้ตายไว้รอบหน้าแน่ๆ',
      'พักจิบน้ำก่อน แล้วกลับมาลุยใหม่แบบเท่ๆ',
      'รอบหน้าเอาใหม่ ให้คะแนนพุ่งแบบจรวดไปเลย!',
    ],
  },
  10: {
    title: '10 คะแนน (10%)',
    lines: [
      'มีแต้มแล้ว! เปิดเกมได้แล้ว เดี๋ยวค่อยไต่แรงก์ต่อ',
      'อย่างน้อยไม่ศูนย์ ถือว่าเครื่องติดแล้ว!',
      'นี่คือจุดเริ่มต้นของตำนานคัมแบ็ก!',
      'รอบนี้เหมือนซ้อมมือ รอบหน้าค่อยเอาจริง',
      'ได้ 10% แบบมีสไตล์ เริ่มดีแล้วน้า',
      'แต้มยังน้อย แต่ไฟในการสู้ดูดีมาก',
      'เก็บประสบการณ์ก่อน เดี๋ยวเลเวลขึ้นแน่นอน',
      'อีกนิดเดียวจะเริ่มจับทางโจทย์ได้แล้ว',
      'ครูให้ผ่านด่าน “ฮึบแรก” ก่อนเลย',
      'ไปต่อ! รอบหน้าขอเห็น 20+ นะ',
    ],
  },
  20: {
    title: '20 คะแนน (20%)',
    lines: [
      'ดีขึ้นแล้ว! อย่างน้อยเข็มคะแนนเริ่มขยับแรงขึ้น',
      'เริ่มจับจังหวะข้อสอบได้ทีละนิดแล้ว',
      'อีกหน่อยเดียวจะเข้าโหมดติดลมบน',
      'ทรงมาดีเลย ฝึกอีกนิดพุ่งแน่',
      'คะแนนยังไม่สูง แต่แววมาแล้ว',
      'เห็นความพยายามชัดมาก รอบหน้ามีลุ้น',
      'ไม่ไกลแล้วจากการหลุดโซนเครียด',
      'อีกนิดเดียวจะเริ่มสนุกกับการทำข้อสอบ',
      'เริ่มเป็นผู้เล่นสายพัฒนาตัวเองแล้วนะ',
      'ขออีกฮึบเดียว เดี๋ยวทะลุ 30',
    ],
  },
  30: {
    title: '30 คะแนน (30%)',
    lines: [
      'มาแล้วสามสิบ! เริ่มเห็นทางสว่างปลายอุโมงค์',
      'ครึ่งแรกของการคัมแบ็กกำลังก่อตัว',
      'จังหวะดีขึ้นเรื่อยๆ แล้วนะ',
      'ความมั่นใจมาแล้ว เหลือเติมความแม่น',
      'อีกนิดเดียวก็ข้ามด่านยากได้',
      'เล่นดีขึ้นแบบเห็นได้ชัด',
      'เริ่มเป็นเวอร์ชันอัปเดตของตัวเองแล้ว',
      'คะแนนนี้บอกเลยว่ามีของ',
      'ลุยต่ออีกหน่อย เดี๋ยวติดลม',
      'รอบหน้าเป้าหมาย 40++ ไปเลย',
    ],
  },
  40: {
    title: '40 คะแนน (40%)',
    lines: [
      'อีกนิดเดียวจะถึงครึ่งแล้ว เก่งมาก',
      'ทรงนี้ดีมาก ขออีกแรงเดียว!',
      'ใกล้โซนผ่านแล้ว สู้ต่อได้เลย',
      'รอบนี้ถือว่าเล่นเกมสูสีมาก',
      'มีทรงนักสู้ปลายเทอมชัดๆ',
      'ความแม่นกำลังกลับมา',
      'อีกหนึ่งก้าวก็เข้าโหมดมั่นใจ',
      'เริ่มเฉียบขึ้นทุกข้อแล้ว',
      'เลเวลอัปแบบต่อเนื่องเลย',
      'รอบหน้า 50 ต้องมา!',
    ],
  },
  50: {
    title: '50 คะแนน (50%)',
    lines: [
      'ครึ่งทางพอดี! สมดุลมาก',
      'ผ่านเส้นกดดันมาได้สวย',
      'คะแนนนี้เรียกว่าเริ่มนิ่งแล้ว',
      'ครึ่งหนึ่งคือฐานที่ดีมาก',
      'เริ่มเป็นตัวจริงสนามสอบแล้ว',
      'จังหวะการตอบดีขึ้นชัดเจน',
      'รอบหน้าขยับอีกนิดก็เด่นแล้ว',
      'เสถียรภาพดีมากสำหรับรอบนี้',
      'เข้าโหมดพร้อมพัฒนาเต็มตัว',
      'ขออีก 10 แต้มจะว้าวมาก',
    ],
  },
  60: {
    title: '60 คะแนน (60%)',
    lines: [
      'ดีมาก! เริ่มห่างจากโซนลุ้นเหนื่อยแล้ว',
      'มีคุณภาพขึ้นเยอะเลย',
      'ทรงนี้เอาไปขิงเพื่อนเบาๆ ได้',
      'พัฒนาการดีแบบจับต้องได้',
      'เริ่มเข้าทางของตัวเองแล้ว',
      'อีกนิดเดียวก็ขึ้นโซนเด่น',
      'อ่านเกมข้อสอบได้เก่งขึ้นมาก',
      'เครื่องเริ่มแรงขึ้นเรื่อยๆ',
      'มีวินัยดีมาก เห็นผลแล้ว',
      'ลุยต่อเป้า 70 ได้เลย',
    ],
  },
  70: {
    title: '70 คะแนน (70%)',
    lines: [
      'เยี่ยม! โซนนี้คือคนเก่งของห้องแล้ว',
      'ทำได้ดีมากแบบน่าภูมิใจ',
      'ความแม่นเริ่มชัดเจนสุดๆ',
      'นี่แหละพลังของการฝึกต่อเนื่อง',
      'อ่านโจทย์ขาดขึ้นเยอะเลย',
      'เป็นคะแนนที่ดูดีมาก',
      'เริ่มมีออร่านักล่าแต้มแล้ว',
      'รอบหน้ามีสิทธิ์แตะ 80',
      'มั่นใจต่อได้เลย ฟอร์มกำลังมา',
      'สุดยอดไปเลยสำหรับรอบนี้',
    ],
  },
  80: {
    title: '80 คะแนน (80%)',
    lines: [
      'โหดมาก! ฟอร์มดีสุดๆ',
      'นี่มันตัวท็อปชัดๆ',
      'แม่นแบบมืออาชีพเลย',
      'ระดับนี้น่าปรบมือดังๆ',
      'อ่านโจทย์ได้คมจริง',
      'เก่งมากจนเพื่อนต้องมาขอเทคนิค',
      'คุมเกมสอบได้อยู่มือ',
      'เหลืออีกนิดเดียวก็เกือบเต็มแล้ว',
      'ทรงนี้ลุ้น 90+ สบาย',
      'สุดยอดมาก ภูมิใจแทนครูเลย',
    ],
  },
  90: {
    title: '90 คะแนน (90%)',
    lines: [
      'โคตรเทพ! ใกล้เต็มแล้ว',
      'ฟอร์มแชมป์มาเต็ม',
      'ความแม่นระดับโปรจริงๆ',
      'เก่งมากจนต้องยกนิ้วให้',
      'นี่คือผลลัพธ์ของการเตรียมตัวดี',
      'สมาธิดีมาก คุมทุกข้ออยู่',
      'เป็นคะแนนที่ใครเห็นก็ว้าว',
      'อีกนิดเดียวแตะเต็มร้อย',
      'ระดับนี้คือหัวกะทิของห้องแล้ว',
      'ยอดเยี่ยมมาก รักษาฟอร์มนี้ไว้!',
    ],
  },
  100: {
    title: '100 คะแนน (100%)',
    lines: [
      'เต็มร้อย! สมบูรณ์แบบมาก',
      'ขอแสดงความยินดีอย่างยิ่ง 🎉',
      'ทำได้ไร้ที่ติจริงๆ',
      'ความแม่นระดับตำนาน!',
      'นี่แหละคำว่า Masterclass',
      'ทั้งเร็วทั้งแม่น สุดยอดมาก',
      'คือเวอร์ชันที่ดีที่สุดของตัวเอง',
      'ปรบมือให้รัวๆ เลย',
      'คะแนนนี้คู่ควรกับมงจริงๆ',
      'เก่งมาก เก่งแบบสุดทาง!',
    ],
  },
};

function normalizeScoreBucket(percent) {
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  if (safePercent === 100) return 100;
  return Math.floor(safePercent / 10) * 10;
}

export function getScoreRangeLabel(percent) {
  const bucket = normalizeScoreBucket(percent);
  if (bucket === 100) {
    return '100';
  }
  return `${bucket}-${bucket + 9}`;
}

export function getResultMessage(percent) {
  const rangeLabel = getScoreRangeLabel(percent);
  return `${rangeLabel} คะแนน (${rangeLabel}%)`;
}

export function getResultFeedback(percent) {
  const bucket = normalizeScoreBucket(percent);
  const feedback = RESULT_FEEDBACKS[bucket] || RESULT_FEEDBACKS[0];
  const rangeLabel = getScoreRangeLabel(percent);

  return {
    ...feedback,
    title: `${rangeLabel} คะแนน (${rangeLabel}%)`,
    lines: shuffleArray(feedback.lines),
  };
}

export function getDefaultFeedbackMap() {
  const map = {};
  Object.entries(RESULT_FEEDBACKS).forEach(([bucket, feedback]) => {
    map[bucket] = [...(feedback.lines || [])];
  });
  return map;
}

export function getResultFeedbackWithConfig(percent, feedbackByBucket) {
  const bucket = normalizeScoreBucket(percent);
  const rangeLabel = getScoreRangeLabel(percent);
  const customLines = Array.isArray(feedbackByBucket?.[bucket])
    ? feedbackByBucket[bucket].map((line) => String(line || '').trim()).filter(Boolean)
    : [];

  if (customLines.length > 0) {
    return {
      title: `${rangeLabel} คะแนน (${rangeLabel}%)`,
      lines: shuffleArray(customLines),
    };
  }

  return getResultFeedback(percent);
}

export function maskPhone(phoneRaw) {
  const phone = String(phoneRaw || '').replace(/\D/g, '');
  if (phone.length < 4) {
    return 'xxx-xxxxxxx';
  }

  const first = phone.slice(0, 3);
  const last = phone.slice(-1);
  return `${first}-xxxxxx${last}`;
}
