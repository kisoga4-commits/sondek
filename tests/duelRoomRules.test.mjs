import test from 'node:test';
import assert from 'node:assert/strict';

import { getRoomMaxPlayers, getStartPlayerCap } from '../js/duelRoomRules.js';

test('pob modes get max players by version while core duel modes stay at 8', () => {
  assert.equal(getRoomMaxPlayers('pob_v2'), 24);
  assert.equal(getRoomMaxPlayers('pob'), 12);
  assert.equal(getRoomMaxPlayers('sheriff_th'), 24);
  assert.equal(getRoomMaxPlayers('quick'), 8);
  assert.equal(getRoomMaxPlayers('worm'), 8);
  assert.equal(getRoomMaxPlayers('logic_spy'), 8);
});

test('start player cap is mode-specific and keeps core mode behavior', () => {
  assert.equal(getStartPlayerCap({ gameMode: 'pob_v2' }), 24);
  assert.equal(getStartPlayerCap({ gameMode: 'pob' }), 12);
  assert.equal(getStartPlayerCap({ gameMode: 'logic_spy' }), 5);
  assert.equal(getStartPlayerCap({ gameMode: 'sheriff_th' }), 24);
  assert.equal(getStartPlayerCap({ gameMode: 'quick', matchType: 'solo' }), 4);
  assert.equal(getStartPlayerCap({ gameMode: 'worm', matchType: 'party', teamSize: 3 }), 6);
});
