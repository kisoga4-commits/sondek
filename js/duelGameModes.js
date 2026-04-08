export const EXTERNAL_GAME_MODES = {
  pob: {
    label: 'ปอบกินตับ',
    minPlayers: 4,
    requiresQuestionBank: false,
    redirectPath: 'games/pob-kintub/index.html',
    buildRedirectParams: ({ roomId, pin, uid, isHost, playerName }) => ({
      roomId,
      pin,
      uid,
      role: isHost ? 'host' : 'join',
      player: playerName,
    }),
  },
  logic_spy: {
    label: 'ใครต่างจากเพื่อน',
    minPlayers: 3,
    requiresQuestionBank: false,
    redirectPath: 'games/logic-spy/index.html',
    buildRedirectParams: ({ roomId, pin }) => ({ roomId, pin }),
  },
};

export const DUEL_GAME_MODES = {
  quick: {
    label: 'ตอบไว',
    minPlayers: ({ modeConfig }) => {
      const isParty = String(modeConfig?.matchType || 'solo') === 'party';
      const teamSize = Math.max(2, Number(modeConfig?.teamSize || 2));
      return isParty ? Math.max(4, teamSize * 2) : 2;
    },
    requiresQuestionBank: true,
  },
  worm: {
    label: 'หนอนกระดื้บ',
    minPlayers: ({ modeConfig }) => {
      const isParty = String(modeConfig?.matchType || 'solo') === 'party';
      const teamSize = Math.max(2, Number(modeConfig?.teamSize || 2));
      return isParty ? Math.max(4, teamSize * 2) : 2;
    },
    requiresQuestionBank: true,
  },
  ...EXTERNAL_GAME_MODES,
};

export function getGameModeDefinition(gameMode = 'quick') {
  const key = String(gameMode || 'quick');
  return DUEL_GAME_MODES[key] || DUEL_GAME_MODES.quick;
}

export function isExternalGameMode(gameMode = '') {
  return Object.prototype.hasOwnProperty.call(EXTERNAL_GAME_MODES, String(gameMode || ''));
}

export function requiresQuestionBank(gameMode = '') {
  return Boolean(getGameModeDefinition(gameMode)?.requiresQuestionBank);
}

export function getMinimumPlayers(modeConfig = {}) {
  const gameMode = String(modeConfig?.gameMode || 'quick');
  const definition = getGameModeDefinition(gameMode);
  const minPlayers = typeof definition?.minPlayers === 'function'
    ? definition.minPlayers({ modeConfig })
    : Number(definition?.minPlayers || 2);
  return Math.max(2, Number(minPlayers || 2));
}

export function buildExternalGameRedirectUrl({ room, uid, isHost }) {
  const gameMode = String(room?.modeConfig?.gameMode || '');
  const definition = EXTERNAL_GAME_MODES[gameMode];
  if (!definition?.redirectPath || typeof definition.buildRedirectParams !== 'function') return '';

  const roomId = String(room?.roomId || '');
  const pin = String(room?.pin || roomId);
  const playerName = String(room?.players?.[uid]?.name || '');
  const params = definition.buildRedirectParams({ roomId, pin, uid, isHost, playerName, room });
  const query = new URLSearchParams(
    Object.entries(params || {}).reduce((acc, [key, value]) => {
      if (value !== undefined && value !== null) acc[key] = String(value);
      return acc;
    }, {}),
  );
  return `${definition.redirectPath}?${query.toString()}`;
}
