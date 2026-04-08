import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const appFilePath = path.resolve('games/pob-kintub/js/app.js');
const appSource = fs.readFileSync(appFilePath, 'utf8');

function loadRolePool({ randomSequence = [] } = {}) {
  const match = appSource.match(/function rolePool\(count\) {[\s\S]*?\n}\n\nfunction buildRandomizedGameState/);
  assert.ok(match, 'ไม่พบฟังก์ชัน rolePool ใน app.js');

  const functionSource = match[0].replace(/\n\nfunction buildRandomizedGameState$/, '');

  let cursor = 0;
  const fakeMath = Object.create(Math);
  fakeMath.random = () => {
    if (!randomSequence.length) return 0;
    const idx = Math.min(cursor, randomSequence.length - 1);
    cursor += 1;
    return randomSequence[idx];
  };

  const context = vm.createContext({ Math: fakeMath });
  const script = new vm.Script(`${functionSource}\nrolePool;`);
  return script.runInContext(context);
}

test('rolePool รองรับผู้เล่นสูงสุด 12 คน', () => {
  const rolePool = loadRolePool();
  assert.equal(rolePool(12).length, 12);
  assert.equal(rolePool(99).length, 12);
});

test('เมื่อเกิน 8 คน role ที่สุ่มเพิ่มมาจาก all role pool ครบทุกอาชีพ', () => {
  const allRoles = ['pob', 'madman', 'hunter', 'shaman', 'police', 'monk', 'villager'];
  const emitted = new Set();

  allRoles.forEach((role, roleIndex) => {
    // rolePool สร้าง fixedByCount พร้อมเรียกสุ่ม 2 ครั้งก่อน (สำหรับ 4,5 คน)
    const randomSequence = [0, 0, (roleIndex + 0.01) / allRoles.length];
    const rolePool = loadRolePool({ randomSequence });
    const roles = rolePool(9);

    assert.equal(roles.length, 9);
    emitted.add(roles[8]);
  });

  assert.deepEqual([...emitted].sort(), [...allRoles].sort());
});
