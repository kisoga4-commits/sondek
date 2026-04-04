export const START_HP = 10;
export const LOOP_QUESTION_COUNT = 50;
export const ROOM_ID_LENGTH = 6;
export const DEFAULT_QUESTION_SECONDS = 10;
export const DEFAULT_REVEAL_SECONDS = 0.8;

export function normalizeRoomIdInput(value = '', roomIdLength = ROOM_ID_LENGTH) {
  return String(value || '').replace(/\D+/g, '').slice(0, roomIdLength);
}

export function getRoundState(
  room,
  {
    nowMs = Date.now(),
    defaultQuestionSeconds = DEFAULT_QUESTION_SECONDS,
    defaultRevealSeconds = DEFAULT_REVEAL_SECONDS,
  } = {},
) {
  const startedAtMs = Number(room?.startedAtMs || 0);
  const questionSeconds = Math.max(5, Number(room?.questionSeconds || defaultQuestionSeconds));
  const revealSeconds = Math.max(0.3, Number(room?.revealSeconds || defaultRevealSeconds));
  const roundMs = Math.round((questionSeconds + revealSeconds) * 1000);
  if (!startedAtMs || roundMs <= 0) {
    return {
      questionSeconds,
      revealSeconds,
      roundMs,
      roundIndex: -1,
      elapsedInRoundMs: 0,
      isReveal: false,
      questionRemainMs: questionSeconds * 1000,
    };
  }

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const roundIndex = Math.floor(elapsedMs / roundMs);
  const elapsedInRoundMs = elapsedMs % roundMs;
  const isReveal = elapsedInRoundMs >= questionSeconds * 1000;
  const questionRemainMs = Math.max(0, Math.ceil((questionSeconds * 1000) - elapsedInRoundMs));
  return { questionSeconds, revealSeconds, roundMs, roundIndex, elapsedInRoundMs, isReveal, questionRemainMs };
}

export function buildQuestionLoop(questionBank, {
  loopQuestionCount = LOOP_QUESTION_COUNT,
  shuffleFn = defaultShuffleArray,
} = {}) {
  const ids = Array.isArray(questionBank)
    ? questionBank.map((item) => String(item.id))
    : [];
  if (!ids.length || typeof shuffleFn !== 'function') return [];

  const loop = [];
  while (loop.length < loopQuestionCount) {
    loop.push(...shuffleFn(ids));
  }
  return loop.slice(0, loopQuestionCount);
}

export function buildPersonalQuestionLoop(questionBank, actorKey, {
  loopQuestionCount = LOOP_QUESTION_COUNT,
} = {}) {
  const ids = Array.isArray(questionBank)
    ? questionBank.map((item) => String(item.id))
    : [];
  if (!ids.length) return [];
  const seedKey = String(actorKey || 'duel');
  let seed = 0;
  for (let index = 0; index < seedKey.length; index += 1) {
    seed = (seed * 31 + seedKey.charCodeAt(index)) >>> 0;
  }
  const seededShuffle = (items) => {
    const cloned = [...items];
    for (let i = cloned.length - 1; i > 0; i -= 1) {
      seed = ((seed * 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
    }
    return cloned;
  };
  if (ids.length <= 1) return buildQuestionLoop(ids.map((id) => ({ id })), { loopQuestionCount, shuffleFn: seededShuffle });

  const loop = [];
  while (loop.length < loopQuestionCount) {
    const shuffled = seededShuffle(ids);
    if (loop.length && shuffled.length > 1 && shuffled[0] === loop[loop.length - 1]) {
      const swapped = shuffled[0];
      shuffled[0] = shuffled[1];
      shuffled[1] = swapped;
    }
    loop.push(...shuffled);
  }
  return loop.slice(0, loopQuestionCount);
}

function defaultShuffleArray(items) {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}
