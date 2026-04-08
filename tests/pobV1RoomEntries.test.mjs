import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const appFilePath = path.resolve('games/pob-kintub/js/app.js');
const appSource = fs.readFileSync(appFilePath, 'utf8');

function loadHelpers() {
  const resolveMatch = appSource.match(/function resolvePlayerName\(player = {}, uid = ''\) {[\s\S]*?\n}\n/);
  const entriesMatch = appSource.match(/function getRoomEntries\(playersMap = state\.duelPlayers\) {[\s\S]*?\n}\n/);

  assert.ok(resolveMatch, 'ไม่พบฟังก์ชัน resolvePlayerName');
  assert.ok(entriesMatch, 'ไม่พบฟังก์ชัน getRoomEntries');

  const script = new vm.Script(`${resolveMatch[0]}\n${entriesMatch[0]}\n({ resolvePlayerName, getRoomEntries });`);
  return script.runInNewContext({ state: { duelPlayers: {} }, Object, String });
}

test('getRoomEntries ใช้ key ของห้องเป็น uid ได้ แม้ object ผู้เล่นไม่มี uid', () => {
  const { getRoomEntries } = loadHelpers();
  const entries = getRoomEntries({
    abc123: { name: 'หนอนกระดิ๊บ' },
    def456: { displayName: 'เพื่อนรัก' },
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].uid, 'abc123');
  assert.equal(entries[0].name, 'หนอนกระดิ๊บ');
  assert.equal(entries[1].uid, 'def456');
  assert.equal(entries[1].name, 'เพื่อนรัก');
});

test('getRoomEntries ใช้ uid จาก key แม้ raw uid จะไม่ตรงกัน', () => {
  const { getRoomEntries } = loadHelpers();
  const entries = getRoomEntries({
    key_uid_1: { uid: 'wrong_uid', name: 'หนอนกระดิ๊บ' },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].uid, 'key_uid_1');
  assert.equal(entries[0].name, 'หนอนกระดิ๊บ');
});

test('resolvePlayerName ดึงชื่อจากฟิลด์สำรอง และไม่ตกเป็น "ผู้เล่น" ถ้ามี uid', () => {
  const { resolvePlayerName } = loadHelpers();
  assert.equal(resolvePlayerName({ studentName: 'Alice' }, 'u-1'), 'Alice');
  assert.equal(resolvePlayerName({ nickname: 'Bob' }, 'u-2'), 'Bob');
  assert.equal(resolvePlayerName({}, 'xyz987654'), 'UID-xyz987');
});
