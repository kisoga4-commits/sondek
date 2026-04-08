export const DEFAULT_LOGIC_SPY_QUESTION_SETS = [
  {
    options: [
      { value: 'แมว', hint: 'คล่องตัวในที่แคบและชอบพักบ่อย' },
      { value: 'เสือ', hint: 'ล่าแบบลำพังและอาศัยจังหวะ' },
      { value: 'สิงโต', hint: 'อยู่รวมกันเป็นฝูงและล่าเป็นทีม' },
      { value: 'หมี', hint: 'มีพลังเยอะและยืนสองขาได้' },
    ],
    answer: 'แมว',
    explanation: 'ต่างจากเพื่อนเพราะเป็นสัตว์เลี้ยงในบ้าน',
  },
];

function sanitizeUniqueStrings(input = []) {
  const unique = [];
  (Array.isArray(input) ? input : []).forEach((value) => {
    const normalized = String(value || '').trim();
    if (normalized && !unique.includes(normalized)) unique.push(normalized);
  });
  return unique;
}

function pickRandomIndex(length, randomFn = Math.random) {
  return Math.min(length - 1, Math.floor(randomFn() * length));
}

function normalizeOption(entry = {}) {
  const value = String(entry?.value || entry?.word || '').trim();
  const hint = String(entry?.hint || '').trim();
  return value ? { value, hint } : null;
}

function normalizeLegacyWordSet(rawSet = []) {
  const words = sanitizeUniqueStrings(rawSet);
  if (words.length !== 4) return null;
  return {
    options: words.map((value) => ({ value, hint: '' })),
    answer: words[3],
    explanation: `${words[3]} ต่างจากเพื่อน`,
  };
}

export function normalizeQuestionSets(rawSets = []) {
  return (Array.isArray(rawSets) ? rawSets : [])
    .map((rawSet) => {
      if (Array.isArray(rawSet)) return normalizeLegacyWordSet(rawSet);

      const options = (Array.isArray(rawSet?.options) ? rawSet.options : [])
        .map(normalizeOption)
        .filter(Boolean);

      const uniqueOptionValues = sanitizeUniqueStrings(options.map((option) => option.value));
      if (options.length !== 4 || uniqueOptionValues.length !== 4) return null;

      const answer = String(rawSet?.answer || '').trim();
      if (!answer || !uniqueOptionValues.includes(answer)) return null;

      return {
        options: options.map((option) => ({ value: option.value, hint: option.hint })),
        answer,
        explanation: String(rawSet?.explanation || '').trim(),
      };
    })
    .filter(Boolean);
}

export function pickQuestionSet(questionSets = DEFAULT_LOGIC_SPY_QUESTION_SETS, randomFn = Math.random) {
  const normalized = normalizeQuestionSets(questionSets);
  const source = normalized.length ? normalized : DEFAULT_LOGIC_SPY_QUESTION_SETS;
  return JSON.parse(JSON.stringify(source[pickRandomIndex(source.length, randomFn)]));
}

export function buildRoundAssignments(playerIds = [], questionSet = {}, randomFn = Math.random) {
  const ids = sanitizeUniqueStrings(playerIds);
  if (ids.length < 3 || ids.length > 5) throw new Error('โหมดนี้รองรับผู้เล่น 3-5 คน');

  const question = normalizeQuestionSets([questionSet])[0];
  if (!question) throw new Error('รูปแบบคำถามไม่ถูกต้อง (ต้องมี 4 ตัวเลือก + คำตอบ + คำอธิบาย)');

  const shuffledOptions = [...question.options];
  for (let i = shuffledOptions.length - 1; i > 0; i -= 1) {
    const j = pickRandomIndex(i + 1, randomFn);
    [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
  }

  const optionCount = Math.max(3, Math.min(4, ids.length));
  const optionsForRound = shuffledOptions.slice(0, optionCount);
  if (!optionsForRound.some((option) => option.value === question.answer)) {
    optionsForRound[optionCount - 1] = question.options.find((option) => option.value === question.answer);
  }

  return {
    question,
    optionsForRound,
    correctAnswer: question.answer,
    explanation: question.explanation,
  };
}

export function calculateRoundScore({ correctAnswer = '', votesByUid = {}, playerIds = [] } = {}) {
  const ids = sanitizeUniqueStrings(playerIds);
  const answer = String(correctAnswer || '').trim();
  const voteMap = votesByUid && typeof votesByUid === 'object' ? votesByUid : {};

  return Object.fromEntries(ids.map((uid) => {
    const votedOption = String(voteMap?.[uid] || '').trim();
    return [uid, votedOption && votedOption === answer ? 1 : 0];
  }));
}
