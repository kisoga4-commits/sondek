import test from 'node:test';
import assert from 'node:assert/strict';

import { checkWinner, resolveNight, resolveVote } from '../games/pob-kintub/js/gameEngine.js';

function baseState() {
  return {
    day: 2,
    players: {
      pob1: { uid: 'pob1', name: 'ปอบ', alive: true },
      monk1: { uid: 'monk1', name: 'หมอธรรม', alive: true },
      police1: { uid: 'police1', name: 'ตำรวจ', alive: true },
      hunter1: { uid: 'hunter1', name: 'นายพราน', alive: true },
      vill1: { uid: 'vill1', name: 'ชาวนา', alive: true },
      sham1: { uid: 'sham1', name: 'หมอดู', alive: true },
    },
    jailedTonight: {},
  };
}

function basePrivate() {
  return {
    pob1: { role: 'pob', nightAction: { targetId: 'vill1', acted: true, at: 100, order: 2 } },
    monk1: { role: 'monk', nightAction: { targetId: null, acted: false, at: 90, order: 1 } },
    police1: { role: 'police', nightAction: { targetId: null, acted: false, at: 80, order: 1 } },
    hunter1: { role: 'hunter', nightAction: { targetId: null, acted: false, at: 110, order: 3 } },
    vill1: { role: 'villager', nightAction: { targetId: 'vill1', acted: true, at: 120, order: 4 } },
    sham1: { role: 'shaman', nightAction: { targetId: 'pob1', acted: true, at: 95, order: 2 } },
  };
}

test('pob kills target when not protected or jailed', () => {
  const pub = baseState();
  const priv = basePrivate();
  const result = resolveNight(pub, priv);
  assert.equal(result.players.vill1.alive, false);
  assert.match(result.logs.join(' | '), /โดนจกตับ/);
});

test('monk protection prevents pob kill', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.monk1.nightAction = { targetId: 'vill1', acted: true, at: 90, order: 1 };
  const result = resolveNight(pub, priv);
  assert.equal(result.players.vill1.alive, true);
  assert.match(result.logs.join(' | '), /ถูกคุ้มครองโดยหมอธรรม/);
});

test('police can block pob action when jailed before pob acts', () => {
  const pub = baseState();
  pub.jailedTonight = { pob1: { by: 'police1', at: 70, order: 1 } };
  const priv = basePrivate();
  priv.pob1.nightAction = { targetId: 'vill1', acted: true, at: 100, order: 3 };
  const result = resolveNight(pub, priv);
  assert.equal(result.players.vill1.alive, true);
  assert.match((result.roleResults?.pob1 || []).join(' | '), /คุณโดนขัง/);
});

test('police action from private state can block pob without public jailedTonight write', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.police1.nightAction = { targetId: 'pob1', acted: true, at: 70, order: 1 };
  priv.pob1.nightAction = { targetId: 'vill1', acted: true, at: 100, order: 2 };
  const result = resolveNight(pub, priv);
  assert.equal(result.players.vill1.alive, true);
  assert.match((result.roleResults?.pob1 || []).join(' | '), /คุณโดนขัง/);
});

test('pob can still act if action happens before being jailed later', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.pob1.nightAction = { targetId: 'vill1', acted: true, at: 60, order: 1 };
  priv.police1.nightAction = { targetId: 'pob1', acted: true, at: 120, order: 3 };
  const result = resolveNight(pub, priv);
  assert.equal(result.players.vill1.alive, false);
  assert.match(result.logs.join(' | '), /โดนจกตับ/);
});

test('hunter can shoot and kill target', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.pob1.nightAction = { targetId: null, acted: false, at: 100, order: 2 };
  priv.hunter1.nightAction = { targetId: 'sham1', acted: true, at: 110, order: 3 };
  const result = resolveNight(pub, priv);
  assert.equal(result.players.sham1.alive, false);
  assert.match(result.logs.join(' | '), /โดนยิง/);
  assert.match((result.roleResults?.hunter1 || []).join(' | '), /ยิง .* สำเร็จ/);
});

test('villager dies from starvation when not working', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.pob1.nightAction = { targetId: null, acted: false, at: 100, order: 2 };
  priv.vill1.nightAction = { targetId: null, acted: false, at: 120, order: 4 };
  const result = resolveNight(pub, priv);
  assert.equal(result.players.vill1.alive, false);
  assert.match(result.logs.join(' | '), /อดตาย/);
  assert.match((result.roleResults?.vill1 || []).join(' | '), /อดตาย/);
});

test('shaman can inspect role and receive role result text', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.pob1.nightAction = { targetId: null, acted: false, at: 100, order: 2 };
  priv.sham1.nightAction = { targetId: 'pob1', acted: true, at: 95, order: 2 };
  const result = resolveNight(pub, priv);
  assert.match((result.roleResults?.sham1 || []).join(' | '), /พบว่าเป็น ปอบ/);
});

test('shaman cannot inspect a jailed target', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.pob1.nightAction = { targetId: null, acted: false, at: 100, order: 2 };
  priv.police1.nightAction = { targetId: 'pob1', acted: true, at: 70, order: 1 };
  priv.sham1.nightAction = { targetId: 'pob1', acted: true, at: 95, order: 2 };
  const result = resolveNight(pub, priv);
  assert.match((result.roleResults?.sham1 || []).join(' | '), /โดนขัง จึงส่องบทบาทไม่ได้/);
});

test('police jailing is exposed as role feedback for jailed target', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.police1.nightAction = { targetId: 'pob1', acted: true, at: 70, order: 1 };
  const result = resolveNight(pub, priv);
  assert.match((result.roleResults?.pob1 || []).join(' | '), /คุณโดนขัง/);
});

test('morning board log does not reveal who was jailed', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.police1.nightAction = { targetId: 'pob1', acted: true, at: 70, order: 1 };
  priv.pob1.nightAction = { targetId: 'vill1', acted: true, at: 100, order: 2 };
  const result = resolveNight(pub, priv);
  assert.match(result.logs.join(' | '), /คืนนี้มีผู้เล่นโดนขัง/);
  assert.doesNotMatch(result.logs.join(' | '), /ปอบ/);
});

test('stale night action from previous day is ignored', () => {
  const pub = baseState();
  pub.day = 3;
  const priv = basePrivate();
  priv.pob1.nightAction = { targetId: 'vill1', acted: true, at: 100, order: 2, day: 2 };
  priv.vill1.nightAction = { targetId: 'vill1', acted: true, at: 120, order: 4, day: 2 };
  const result = resolveNight(pub, priv);
  assert.equal(result.players.vill1.alive, false);
  assert.match(result.logs.join(' | '), /อดตาย/);
});

test('checkWinner follows new rule: ends only when one faction is fully dead', () => {
  const pub = {
    players: {
      pob1: { uid: 'pob1', alive: true },
      h1: { uid: 'h1', alive: true },
    },
  };
  const priv = { pob1: { role: 'pob' }, h1: { role: 'villager' } };
  assert.equal(checkWinner(pub, priv), '');
  pub.players.h1.alive = false;
  assert.equal(checkWinner(pub, priv), 'pob');
  pub.players.h1.alive = true;
  pub.players.pob1.alive = false;
  assert.equal(checkWinner(pub, priv), 'villager');
});

test('checkWinner does not end game when private roles are incomplete (legacy/stale state)', () => {
  const pub = {
    players: {
      pob1: { uid: 'pob1', alive: true },
      h1: { uid: 'h1', alive: true },
    },
  };
  const priv = { pob1: { role: 'pob' } };
  assert.equal(checkWinner(pub, priv), '');
});


test('resolveVote does not eliminate when top vote is not over half of alive players', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.pob1.voteTarget = 'vill1';
  priv.monk1.voteTarget = 'vill1';
  priv.police1.voteTarget = 'vill1';
  priv.hunter1.voteTarget = 'pob1';
  priv.vill1.voteTarget = 'pob1';
  priv.sham1.voteTarget = 'pob1';

  const result = resolveVote(pub, priv);
  assert.equal(result.eliminatedUid, null);
  assert.equal(result.players.vill1.alive, true);
  assert.equal(result.players.pob1.alive, true);
});

test('resolveVote eliminates when unique top vote is greater than half of alive players', () => {
  const pub = {
    players: {
      a: { uid: 'a', name: 'A', alive: true },
      b: { uid: 'b', name: 'B', alive: true },
      c: { uid: 'c', name: 'C', alive: true },
      d: { uid: 'd', name: 'D', alive: true },
    },
  };
  const priv = {
    a: { role: 'villager', voteTarget: 'b' },
    b: { role: 'villager', voteTarget: 'c' },
    c: { role: 'villager', voteTarget: 'b' },
    d: { role: 'pob', voteTarget: 'b' },
  };
  const result = resolveVote(pub, priv);
  assert.equal(result.requiredVotes, 3);
  assert.equal(result.eliminatedUid, 'b');
  assert.equal(result.players.b.alive, false);

  assert.equal(result.players.b.deathCause, 'vote_eliminated');

});

test('resolveVote ignores self-vote and dead-target vote (and still respects majority rule)', () => {
  const pub = baseState();
  pub.players.sham1.alive = false;
  const priv = basePrivate();
  priv.pob1.voteTarget = 'pob1';
  priv.monk1.voteTarget = 'sham1';
  priv.police1.voteTarget = 'vill1';
  priv.hunter1.voteTarget = 'vill1';
  priv.vill1.voteTarget = 'vill1';

  const result = resolveVote(pub, priv);
  assert.equal(result.requiredVotes, 3);
  assert.equal(result.eliminatedUid, null);
  assert.equal(result.players.vill1.alive, true);
  assert.equal(result.voteSummary['ชาวนา'], 2);
});
