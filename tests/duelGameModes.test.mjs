import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExternalGameRedirectUrl,
  getDefaultDuelGameLabel,
  getGameModeDefinition,
  getMinimumPlayers,
  getRequiredPlayersToStart,
  isExternalGameMode,
  normalizeDuelGameMode,
  requiresQuestionBank,
} from '../js/duelGameModes.js';

test('identifies external game modes and question bank requirements', () => {
  assert.equal(isExternalGameMode('pob_v2'), true);
  assert.equal(isExternalGameMode('pob'), true);
  assert.equal(isExternalGameMode('logic_spy'), true);
  assert.equal(isExternalGameMode('worm'), false);

  assert.equal(requiresQuestionBank('quick'), true);
  assert.equal(requiresQuestionBank('worm'), true);
  assert.equal(requiresQuestionBank('pob_v2'), false);
  assert.equal(requiresQuestionBank('pob'), false);
});

test('returns min players by mode config', () => {
  assert.equal(getMinimumPlayers({ gameMode: 'quick', matchType: 'solo' }), 2);
  assert.equal(getMinimumPlayers({ gameMode: 'quick', matchType: 'party', teamSize: 3 }), 6);
  assert.equal(getMinimumPlayers({ gameMode: 'worm', matchType: 'party', teamSize: 2 }), 4);
  assert.equal(getMinimumPlayers({ gameMode: 'pob_v2' }), 4);
  assert.equal(getMinimumPlayers({ gameMode: 'pob' }), 4);
  assert.equal(getMinimumPlayers({ gameMode: 'logic_spy' }), 3);
});

test('builds redirect url for external games from shared room payload', () => {
  const room = {
    roomId: '123456',
    pin: '654321',
    modeConfig: { gameMode: 'pob_v2' },
    players: {
      u1: { name: 'Host A' },
    },
  };

  const hostUrl = buildExternalGameRedirectUrl({ room, uid: 'u1', isHost: true });
  assert.equal(hostUrl, 'games/pob-joktab-v2/index.html?roomId=123456&pin=654321&uid=u1&role=host&player=Host+A');

  const hostUrlV1 = buildExternalGameRedirectUrl({
    room: { ...room, modeConfig: { gameMode: 'pob' } },
    uid: 'u1',
    isHost: true,
  });
  assert.equal(hostUrlV1, 'games/pob-kintub/index.html?roomId=123456&pin=654321&uid=u1&role=host&player=Host+A');

  const guestUrl = buildExternalGameRedirectUrl({ room: { ...room, modeConfig: { gameMode: 'logic_spy' } }, uid: 'u1', isHost: false });
  assert.equal(guestUrl, 'games/logic-spy/index.html?roomId=123456&pin=654321');
});

test('falls back to quick mode definition for unknown game mode', () => {
  const mode = getGameModeDefinition('unknown_mode_x');
  assert.equal(mode?.label, 'ตอบไว');
});

test('normalizes duel game mode and keeps existing core modes intact', () => {
  assert.equal(normalizeDuelGameMode('pob_v2'), 'pob_v2');
  assert.equal(normalizeDuelGameMode('quick'), 'quick');
  assert.equal(normalizeDuelGameMode('worm'), 'worm');
  assert.equal(normalizeDuelGameMode('logic_spy'), 'logic_spy');
  assert.equal(normalizeDuelGameMode('something_else'), 'quick');
});

test('resolves default label by mode including pob_v2', () => {
  assert.equal(getDefaultDuelGameLabel('pob_v2'), 'ปอบจกตับ V2');
  assert.equal(getDefaultDuelGameLabel('pob'), 'ปอบกินตับ');
  assert.equal(getDefaultDuelGameLabel('worm'), 'หนอนกระดื้บ');
  assert.equal(getDefaultDuelGameLabel('unknown'), 'ตอบไว');
});

test('required players to start stays compatible and supports pob_v2', () => {
  assert.equal(getRequiredPlayersToStart({ gameMode: 'pob_v2' }), 4);
  assert.equal(getRequiredPlayersToStart({ gameMode: 'pob' }), 4);
  assert.equal(getRequiredPlayersToStart({ gameMode: 'logic_spy' }), 3);
  assert.equal(getRequiredPlayersToStart({ gameMode: 'quick', matchType: 'solo' }), 2);
  assert.equal(getRequiredPlayersToStart({ gameMode: 'quick', matchType: 'party', teamSize: 3 }), 6);
});
