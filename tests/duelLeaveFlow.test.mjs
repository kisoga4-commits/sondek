import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const duelHtmlPath = path.resolve('duel.html');
const duelJsPath = path.resolve('js/duel.js');
const duelHtml = fs.readFileSync(duelHtmlPath, 'utf8');
const duelJs = fs.readFileSync(duelJsPath, 'utf8');

test('duel page has explicit leave controls in lobby and battle', () => {
  assert.match(duelHtml, /id="leaveRoomBtn"/);
  assert.match(duelHtml, /id="duelExitRoomBtn"/);
});

test('duel script wires explicit leave handlers', () => {
  assert.match(duelJs, /async function handleLeaveRoom\(\)/);
  assert.match(duelJs, /el\.leaveRoomBtn\?\.\s*addEventListener\('click',\s*\(\)\s*=>\s*void handleLeaveRoom\(\)\)/);
  assert.match(duelJs, /el\.exitRoomBtn\?\.\s*addEventListener\('click',\s*\(\)\s*=>\s*void handleLeaveRoom\(\)\)/);
});

test('duel script avoids pagehide auto-leave to prevent accidental host room deletion on refresh', () => {
  assert.doesNotMatch(duelJs, /addEventListener\(\s*'pagehide'/);
});
