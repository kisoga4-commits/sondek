import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const appFilePath = path.resolve('games/pob-joktab-v2/js/app.js');
const appSource = fs.readFileSync(appFilePath, 'utf8');

function loadRolePool({ randomSequence = [] } = {}) {
  const pobCountMatch = appSource.match(/function pobCountForPlayers\(count\) {[\s\S]*?\n}\n/);
  const rolePoolMatch = appSource.match(/function rolePool\(count\) {[\s\S]*?\n}\n\nfunction buildRandomizedGameState/);
  assert.ok(pobCountMatch, 'ไม่พบฟังก์ชัน pobCountForPlayers ใน app.js');
  assert.ok(rolePoolMatch, 'ไม่พบฟังก์ชัน rolePool ใน app.js');

  const rolePoolSource = rolePoolMatch[0].replace(/\n\nfunction buildRandomizedGameState$/, '');
  let cursor = 0;
  const fakeMath = Object.create(Math);
  fakeMath.random = () => {
    if (!randomSequence.length) return 0;
    const idx = Math.min(cursor, randomSequence.length - 1);
    cursor += 1;
    return randomSequence[idx];
  };

  const script = new vm.Script(`${pobCountMatch[0]}\n${rolePoolSource}\nrolePool;`);
  return script.runInContext(vm.createContext({ Math: fakeMath, Number }));
}

function countRole(roles, role) {
  return roles.filter((item) => item === role).length;
}

test('rolePool ของ V2 รองรับ 4-24 คน และ clamp ค่าสูงสุดไว้ที่ 24', () => {
  const rolePool = loadRolePool();
  assert.equal(rolePool(4).length, 4);
  assert.equal(rolePool(24).length, 24);
  assert.equal(rolePool(99).length, 24);
});

test('จำนวนปอบใช้สูตร floor(players/4)', () => {
  const rolePool = loadRolePool();
  assert.equal(countRole(rolePool(4), 'pob'), 1);
  assert.equal(countRole(rolePool(8), 'pob'), 2);
  assert.equal(countRole(rolePool(12), 'pob'), 3);
  assert.equal(countRole(rolePool(16), 'pob'), 4);
  assert.equal(countRole(rolePool(20), 'pob'), 5);
  assert.equal(countRole(rolePool(24), 'pob'), 6);
});

test('แกนหลักและ role unique สำคัญยังถูกบังคับตามช่วงผู้เล่น', () => {
  const rolePool = loadRolePool();

  const roles4 = rolePool(4);
  assert.ok(roles4.includes('madman'));
  assert.ok(roles4.includes('hunter'));

  const roles8 = rolePool(8);
  assert.ok(roles8.includes('shaman'));

  const roles12 = rolePool(12);
  assert.ok(roles12.includes('police'));

  const roles16 = rolePool(16);
  assert.ok(roles16.includes('monk'));

  const roles20 = rolePool(20);
  assert.ok(roles20.includes('doctor'));
  assert.equal(countRole(roles20, 'madman'), 1);
  assert.equal(countRole(roles20, 'hunter'), 1);
  assert.equal(countRole(roles20, 'shaman'), 1);
  assert.equal(countRole(roles20, 'police'), 1);
  assert.equal(countRole(roles20, 'monk'), 1);
  assert.equal(countRole(roles20, 'doctor'), 1);
});
