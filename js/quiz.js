export function shuffleArray(items) {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

export function pickRandomQuestions(allQuestions, amount = 10) {
  if (!Array.isArray(allQuestions)) {
    return [];
  }

  return shuffleArray(allQuestions).slice(0, Math.min(amount, allQuestions.length));
}

export function calculateScore(quizQuestions, answersMap) {
  let correct = 0;

  quizQuestions.forEach((question, index) => {
    if (Number(question.answerIndex) === Number(answersMap[index])) {
      correct += 1;
    }
  });

  const total = quizQuestions.length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  return { correct, total, percent };
}

export function getResultMessage(percent) {
  if (percent === 100) {
    return 'โคตรเทพ! เต็มสิบไม่หัก มาเป็นผู้ช่วยครูเลยไหม?';
  }

  if (percent >= 70) {
    return 'ฝีมือไม่ธรรมดา! อีกนิดจะท็อปประเทศแล้ว มาเติมส่วนที่พลาดกับครูรับรองกริบ';
  }

  return 'สู้เขาหน่อยลูก! พื้นฐานยังมีรูพรุนนะ มาให้ครูช่วยอุดรูรั่วให้มา';
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
