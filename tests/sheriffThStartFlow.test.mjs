import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sheriffAppPath = path.resolve('games/sheriff-th/js/app.js');
const sheriffAppJs = fs.readFileSync(sheriffAppPath, 'utf8');

test('sheriff-th resolves host mode from duel room hostUid fallback and role', () => {
  assert.match(sheriffAppJs, /function resolveHostModeFromDuelRoom\(room = null\)/);
  assert.match(sheriffAppJs, /safeRoom\?\.hostUid \|\| state\.duelHostUid/);
  assert.match(sheriffAppJs, /if \(role\) return role === 'host';/);
});

test('sheriff-th start button is blocked when room is not in setup state', () => {
  assert.match(sheriffAppJs, /status !== 'setup'/);
  assert.match(sheriffAppJs, /เกมถูกเริ่มแล้ว \(หรืออยู่ในสถานะที่ไม่ใช่ setup\)/);
  assert.match(sheriffAppJs, /const roomStatus = String\(state\.room\?\.status \|\| 'setup'\);/);
});

test('sheriff-th mutation path rejects non-committed transactions', () => {
  assert.match(sheriffAppJs, /const tx = await runTransaction\(roomRef,/);
  assert.match(sheriffAppJs, /if \(!tx\?\.committed\)/);
  assert.match(sheriffAppJs, /transaction not committed/);
});
