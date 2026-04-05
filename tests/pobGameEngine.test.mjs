import test from 'node:test';
import assert from 'node:assert/strict';

import { checkWinner, resolveNight } from '../games/pob-kintub/js/gameEngine.js';

function baseState() {
  return {
    day: 2,
    players: {
      pob1: { uid: 'pob1', name: 'ปอบ', alive: true },
      monk1: { uid: 'monk1', name: 'หมอธรรม', alive: true },
      police1: { uid: 'police1', name: 'ตำรวจ', alive: true },
      hunter1: { uid: 'hunter1', name: 'นายพราน', alive: true },
      vill1: { uid: 'vill1', name: 'ชาวนา', alive: true },
      sham1: { uid: 'sham1', name: 'หมอผี', alive: true },
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
  assert.match(result.logs.join(' | '), /ถูกขังก่อนใช้พลัง/);
});

test('hunter can shoot and kill target', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.pob1.nightAction = { targetId: null, acted: false, at: 100, order: 2 };
  priv.hunter1.nightAction = { targetId: 'sham1', acted: true, at: 110, order: 3 };
  const result = resolveNight(pub, priv);
  assert.equal(result.players.sham1.alive, false);
  assert.match(result.logs.join(' | '), /โดนยิง/);
});

test('villager dies from starvation when not working', () => {
  const pub = baseState();
  const priv = basePrivate();
  priv.pob1.nightAction = { targetId: null, acted: false, at: 100, order: 2 };
  priv.vill1.nightAction = { targetId: null, acted: false, at: 120, order: 4 };
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
