import { pickRandomQuestions } from '../js/quiz.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runSimulation({ questionBankSize, drawCount, rounds = 20000 }) {
  const bank = Array.from({ length: questionBankSize }, (_, idx) => ({ id: idx + 1 }));
  const hitCounter = new Map(bank.map((q) => [q.id, 0]));

  for (let i = 0; i < rounds; i += 1) {
    const drawn = pickRandomQuestions(bank, drawCount);
    const expectedDrawSize = Math.min(drawCount, questionBankSize);

    assert(drawn.length === expectedDrawSize, `ขนาดการสุ่มไม่ถูกต้อง (drawCount=${drawCount}, round=${i + 1})`);

    const unique = new Set(drawn.map((q) => q.id));
    assert(unique.size === drawn.length, `พบข้อซ้ำในรอบที่ ${i + 1} (drawCount=${drawCount})`);

    drawn.forEach((q) => {
      hitCounter.set(q.id, hitCounter.get(q.id) + 1);
    });
  }

  const expected = rounds * (Math.min(drawCount, questionBankSize) / questionBankSize);
  const values = [...hitCounter.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);

  return {
    questionBankSize,
    drawCount,
    rounds,
    expectedPerQuestion: Number(expected.toFixed(2)),
    minHits: min,
    maxHits: max,
    spreadPercentFromExpected: Number((((max - min) / expected) * 100).toFixed(2)),
  };
}

function main() {
  const scenarios = [
    { questionBankSize: 30, drawCount: 10 },
    { questionBankSize: 30, drawCount: 20 },
  ];

  const reports = scenarios.map((scenario) => runSimulation(scenario));

  console.log('Random draw verification passed for all scenarios.');
  console.log(JSON.stringify(reports, null, 2));
}

main();
