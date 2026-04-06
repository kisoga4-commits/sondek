import test from 'node:test';
import assert from 'node:assert/strict';

import { getRoomMaxPlayers, getStartPlayerCap } from '../js/duelRoomRules.js';

test('pob mode gets 12 max players while core duel modes stay at 8', () => {
  assert.equal(getRoomMaxPlayers('pob'), 12);
  assert.equal(getRoomMaxPlayers('quick'), 8);
  assert.equal(getRoomMaxPlayers('worm'), 8);
  assert.equal(getRoomMaxPlayers('logic_spy'), 8);
});

test('start player cap is mode-specific and keeps core mode behavior', () => {
  assert.equal(getStartPlayerCap({ gameMode: 'pob' }), 12);
  assert.equal(getStartPlayerCap({ gameMode: 'logic_spy' }), 5);
  assert.equal(getStartPlayerCap({ gameMode: 'quick', matchType: 'solo' }), 4);
  assert.equal(getStartPlayerCap({ gameMode: 'worm', matchType: 'party', teamSize: 3 }), 6);
});
