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
      choices: ['True', 'False'],
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

export function getResultMessage(percent) {
  if (percent === 100) {
    return 'Perfect run!';
  }

  if (percent >= 70) {
    return 'Great job! You are close to mastery.';
  }

  return 'Nice try—review the answers and try again.';
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
