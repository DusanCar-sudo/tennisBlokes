// Shared court metrics, tuning and shot vocabulary.
// World units are metres. The player defends +Z and attacks -Z.

export const COURT = {
  netZ: 0,
  baseline: 11.885,
  singlesHalf: 4.115,
  doublesHalf: 5.485,
  serviceLine: 6.4,
  netPostX: 6.4,
  netHeightCenter: 0.914,
  netHeightPost: 1.07,
  ballRadius: 0.0335,
  runOffX: 10.2,
  runOffZ: 20.2,
};

export const PLAYER_BOUNDS = {
  x: 5.15,
  zMin: 0.55,
  zMax: 13.4,
};

export const RIVAL_BOUNDS = {
  x: 5.25,
  zMin: -13.5,
  zMax: -0.55,
};

export const GRAVITY = 9.81;

export const SHOTS = {
  topspin: {
    key: 'topspin',
    label: 'TOPSPIN',
    short: 'TOP',
    color: '#5be7c7',
    speed: 24.5,
    netClearance: 0.92,
    restitution: 0.8,
    friction: 0.84,
    arc: 1.0,
    trail: 0x9ff8e2,
  },
  drive: {
    key: 'drive',
    label: 'DRIVE',
    short: 'DRV',
    color: '#ffd36e',
    speed: 28.5,
    netClearance: 0.72,
    restitution: 0.73,
    friction: 0.9,
    arc: 0.8,
    trail: 0xffd36e,
  },
  slice: {
    key: 'slice',
    label: 'SLICE',
    short: 'SLC',
    color: '#7fc8ff',
    speed: 18.5,
    netClearance: 0.62,
    restitution: 0.5,
    friction: 0.65,
    arc: 0.72,
    trail: 0x9cd9ff,
  },
  volley: {
    key: 'volley',
    label: 'VOLLEY',
    short: 'VLY',
    color: '#ffb26e',
    speed: 21.5,
    netClearance: 0.62,
    restitution: 0.68,
    friction: 0.8,
    arc: 0.72,
    trail: 0xffc28a,
  },
  smash: {
    key: 'smash',
    label: 'SMASH',
    short: 'SMH',
    color: '#ff6846',
    speed: 33.5,
    netClearance: 0.8,
    restitution: 0.82,
    friction: 0.92,
    arc: 0.52,
    trail: 0xff7d5c,
  },
  lob: {
    key: 'lob',
    label: 'LOB',
    short: 'LOB',
    color: '#b7a7ff',
    speed: 13.5,
    netClearance: 2.2,
    restitution: 0.76,
    friction: 0.8,
    arc: 1.75,
    trail: 0xc7b9ff,
  },
  drop: {
    key: 'drop',
    label: 'DROP SHOT',
    short: 'DRP',
    color: '#8fe8c8',
    speed: 12.5,
    netClearance: 0.85,
    restitution: 0.38,
    friction: 0.55,
    arc: 1.05,
    trail: 0xa8f2d6,
  },
  serve: {
    key: 'serve',
    label: 'SERVE',
    short: 'SRV',
    color: '#ffd36e',
    speed: 31,
    netClearance: 0.72,
    restitution: 0.76,
    friction: 0.88,
    arc: 0.7,
    trail: 0xffdc88,
  },
};

export const SHOT_ORDER = ['forehand', 'backhand'];

export const SCORE_LABELS = ['0', '15', '30', '40'];

export const PALETTE = {
  ink: 0x071523,
  deepWater: 0x061a2a,
  courtTeal: 0x137d8b,
  courtBlue: 0x0c5f76,
  surround: 0x0a4055,
  courtLight: 0x1e96a0,
  line: 0xf6f1df,
  net: 0xf4eedc,
  sand: 0xc79365,
  coral: 0xff6846,
  sun: 0xffd36e,
  mint: 0x5be7c7,
  skyTop: 0x273b66,
  skyMid: 0xd36d68,
  skyHorizon: 0xffc17e,
  sunset: 0xffb36b,
  darkStand: 0x102c36,
  standSeat: 0x17505a,
  stadiumMetal: 0x1b3440,
  white: 0xfff5e6,
};

export const PLAYER_START = { x: 0.65, z: 10.65 };
export const RIVAL_START = { x: -0.45, z: -10.9 };
export const AIM = {
  minYaw: -0.34,
  maxYaw: 0.34,
  minPitch: -0.37,
  maxPitch: -0.055,
  restingYaw: 0,
  restingPitch: -0.105,
  mouseSensitivity: 0.00155,
  pitchSensitivity: 0.00075,
  targetMinZ: -11.35,
  targetMaxZ: -1.8,
  targetMinX: -4.2,
  targetMaxX: 4.2,
};

export const PLAYER_NAME = 'DUKA';
export const RIVAL_NAME = 'LAKI';

export const TUNING = {
  playerSpeed: 7.1,
  playerSprintSpeed: 8.9,
  playerAccel: 28,
  playerFriction: 17,
  rivalSpeed: 7.0,
  rivalAccel: 19,
  playerReach: 2.45,
  rivalReach: 2.35,
  swingCooldown: 0.34,
  serveAutoDelay: 2.35,
  pointBannerTime: 2.35,
  hitstopPerfect: 0.055,
  hitstopNormal: 0.022,
  cameraDistance: 4.15,
  cameraShoulder: 0.9,
  cameraHeight: 2.02,
  cameraFov: 63,
  focusFov: 55,
};

export const SHOT_AUTO_LABELS = {
  top: 'TOPSPIN',
  high: 'SMASH',
  low: 'SLICE',
  net: 'VOLLEY',
  serve: 'AUTO SERVE',
};

export const DEBUG = new URLSearchParams(window.location.search).has('debug');
