import test from 'node:test';
import assert from 'node:assert/strict';

import { checkWinner, resolveNight, resolveVote } from '../games/pob-joktab-v2/js/gameEngine.js';

function buildState() {
  return {
    day: 2,
    players: {
      pob1: { uid: 'pob1', name: 'ปอบ', alive: true, deathCause: '' },
      mad1: { uid: 'mad1', name: 'คนบ้า', alive: true, deathCause: '' },
      doc1: { uid: 'doc1', name: 'หมอ', alive: true, deathCause: '' },
      stu1: { uid: 'stu1', name: 'นักเรียน', alive: true, deathCause: '' },
      dead1: { uid: 'dead1', name: 'ผู้ตาย', alive: false, deathCause: 'โดนยิง' },
      vil1: { uid: 'vil1', name: 'ชาวนา', alive: true, deathCause: '' },
    },
    jailedTonight: {},
  };
}

test('madman wins immediately when eliminated by daytime vote', () => {
  const pub = buildState();
  const priv = {
    pob1: { role: 'pob', voteTarget: 'mad1' },
    mad1: { role: 'madman', voteTarget: 'pob1' },
    doc1: { role: 'doctor', voteTarget: 'mad1' },
    stu1: { role: 'student', voteTarget: 'mad1' },
    vil1: { role: 'villager', voteTarget: 'mad1' },
  };
  const result = resolveVote(pub, priv);
  assert.equal(result.eliminatedUid, 'mad1');
  assert.equal(result.winner, 'madman');
  assert.equal(result.players.mad1.alive, false);
});

test('doctor can revive one dead player once per game', () => {
  const pub = buildState();
  const priv = {
    pob1: { role: 'pob', nightAction: { targetId: null, acted: false, day: 2 } },
    mad1: { role: 'madman', nightAction: { targetId: null, acted: true, day: 2 } },
    doc1: { role: 'doctor', doctorUsed: false, nightAction: { targetId: 'dead1', acted: true, day: 2 } },
    stu1: { role: 'student', nightAction: { targetId: null, acted: false, day: 2 } },
    vil1: { role: 'villager', nightAction: { targetId: 'vil1', acted: true, day: 2 } },
    dead1: { role: 'villager', nightAction: null },
  };

  const result = resolveNight(pub, priv);
  assert.equal(result.players.dead1.alive, true);
  assert.equal(result.doctorUsedByUid.doc1, true);
  assert.match((result.roleResults.doc1 || []).join(' | '), /ชุบชีวิต/);
});

test('student can copy target role and winner logic uses copied role', () => {
  const pub = buildState();
  const priv = {
    pob1: { role: 'pob', nightAction: { targetId: null, acted: false, day: 2 } },
    mad1: { role: 'madman', nightAction: { targetId: null, acted: true, day: 2 } },
    doc1: { role: 'doctor', doctorUsed: true, nightAction: { targetId: null, acted: false, day: 2 } },
    stu1: { role: 'student', copiedRole: '', nightAction: { targetId: 'pob1', acted: true, day: 2 } },
    vil1: { role: 'villager', nightAction: { targetId: 'vil1', acted: true, day: 2 } },
    dead1: { role: 'villager', nightAction: null },
  };
  pub.players.dead1.alive = true;

  const night = resolveNight(pub, priv);
  assert.equal(night.studentRoleByUid.stu1, 'pob');

  const postCopyPrivate = {
    pob1: { role: 'pob' },
    mad1: { role: 'madman' },
    doc1: { role: 'doctor' },
    stu1: { role: 'student', copiedRole: 'pob' },
    vil1: { role: 'villager' },
    dead1: { role: 'villager' },
  };
  const postCopyState = {
    players: {
      pob1: { alive: true, uid: 'pob1' },
      stu1: { alive: true, uid: 'stu1' },
      vil1: { alive: false, uid: 'vil1' },
      dead1: { alive: false, uid: 'dead1' },
      mad1: { alive: false, uid: 'mad1' },
      doc1: { alive: false, uid: 'doc1' },
    },
  };
  assert.equal(checkWinner(postCopyState, postCopyPrivate), 'pob');
});
