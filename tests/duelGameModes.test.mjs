import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExternalGameRedirectUrl,
  getGameModeDefinition,
  getMinimumPlayers,
  isExternalGameMode,
  requiresQuestionBank,
} from '../js/duelGameModes.js';

test('identifies external game modes and question bank requirements', () => {
  assert.equal(isExternalGameMode('pob'), true);
  assert.equal(isExternalGameMode('logic_spy'), true);
  assert.equal(isExternalGameMode('worm'), false);

  assert.equal(requiresQuestionBank('quick'), true);
  assert.equal(requiresQuestionBank('worm'), true);
  assert.equal(requiresQuestionBank('pob'), false);
});

test('returns min players by mode config', () => {
  assert.equal(getMinimumPlayers({ gameMode: 'quick', matchType: 'solo' }), 2);
  assert.equal(getMinimumPlayers({ gameMode: 'quick', matchType: 'party', teamSize: 3 }), 6);
  assert.equal(getMinimumPlayers({ gameMode: 'worm', matchType: 'party', teamSize: 2 }), 4);
  assert.equal(getMinimumPlayers({ gameMode: 'pob' }), 4);
  assert.equal(getMinimumPlayers({ gameMode: 'logic_spy' }), 3);
});

test('builds redirect url for external games from shared room payload', () => {
  const room = {
    roomId: '123456',
    pin: '654321',
    modeConfig: { gameMode: 'pob' },
    players: {
      u1: { name: 'Host A' },
    },
  };

  const hostUrl = buildExternalGameRedirectUrl({ room, uid: 'u1', isHost: true });
  assert.equal(hostUrl, 'games/pob-kintub/index.html?roomId=123456&pin=654321&role=host&player=Host+A');

  const guestUrl = buildExternalGameRedirectUrl({ room: { ...room, modeConfig: { gameMode: 'logic_spy' } }, uid: 'u1', isHost: false });
  assert.equal(guestUrl, 'games/logic-spy/index.html?roomId=123456&pin=654321');
});

test('falls back to quick mode definition for unknown game mode', () => {
  const mode = getGameModeDefinition('unknown_mode_x');
  assert.equal(mode?.label, 'ตอบไว');
});
