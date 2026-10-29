import './style.css';
import * as THREE from 'three';
import {
  AIM,
  COURT,
  GRAVITY,
  PLAYER_BOUNDS,
  RIVAL_BOUNDS,
  SCORE_LABELS,
  SHOTS,
  TUNING,
} from './config.js';
import {
  clamp,
  damp,
  formatSpeed,
  horizontalDistance,
  lerp,
  smoothstep,
} from './utils.js';
import { SeededRandom } from './rng.js';
import { buildWorld } from './court.js';
import { TennisCharacter } from './characters.js';
import { Ball, solveTrajectory } from './ball.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { NetClient } from './net.js';

const PLAYER_COLORS = {
  shirt: 0x1fcdb3,
  shirtShade: 0x128f86,
  shorts: 0x0b3044,
  accent: 0xff6b48,
  accentColor: '#ff6b48',
  skin: 0xb98158,
  hair: 0x17120e,
  shoe: 0xf8f0df,
  sock: 0xf8f0df,
  cap: true,
  headband: false,
  number: 7,
  name: 'DUKA',
  scale: 1,
};

const RIVAL_COLORS = {
  shirt: 0xde534d,
  shirtShade: 0x9f3438,
  shorts: 0x102b3d,
  accent: 0xffce6b,
  accentColor: '#ffce6b',
  skin: 0x946343,
  hair: 0x1a1410,
  shoe: 0xeee6d5,
  sock: 0xeee6d5,
  cap: false,
  headband: true,
  number: 11,
  name: 'LAKI',
  scale: 1.02,
};

const PLAYER_TITLE_POS = new THREE.Vector3(1.55, 0, 7.0);
const RIVAL_TITLE_POS = new THREE.Vector3(-1.25, 0, -8.0);
const HOME_PLAYER = new THREE.Vector3(-0.75, 0, 10.7);
const HOME_RIVAL = new THREE.Vector3(0.65, 0, -10.7);

const isCoarsePointer = () =>
  window.matchMedia?.('(pointer: coarse)').matches ||
  (navigator.maxTouchPoints ?? 0) > 0;

const panelDebug = new URLSearchParams(window.location.search).has('debug');

class SunsetSlam {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.world = null;
    this.ui = new UI();
    this.audio = new AudioEngine();
    this.rng = new SeededRandom(20261027);

    this.phase = 'boot';
    this.paused = false;
    this.screenshotPaused = false;
    this.pointerLocked = false;
    this.pointerLockWasActive = false;
    this.hasStarted = false;
    this.mobile = false;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.keys = new Set();
    this.joystick = { x: 0, z: 0, active: false };
    this.focusing = false;
    this.aimYaw = -0.012;
    this.aimPitch = -0.116;
    this.aimPoint = new THREE.Vector3(0, 0.033, -5.5);
    this.effectiveTarget = new THREE.Vector3(0, 0.033, -5.5);
    this.currentFov = TUNING.cameraFov;
    this.titleTime = 0;
    this.lastTime = 0;
    this.elapsed = 0;
    this.frame = 0;
    this.hitstop = 0;
    this.footstepTimer = 0;

    this.score = { player: 0, rival: 0 };
    this.totalPoints = 0;
    this.server = 'player';
    this.matchWinner = null;
    this.matchPoint = false;
    this.rally = 0;
    this.longestRally = 0;
    this.serve = { state: 'idle', timer: 0, tossStarted: false, quickServe: 0 };
    this.introTimer = 0;
    this.pointTimer = 0;
    this.resultsShown = false;
    this.endTimer = 0;
    this.showIntroToast = false;
    this.lastPointReason = '';

    this.stats = {
      pointsWon: 0,
      topSpeed: 0,
      perfects: 0,
      winners: 0,
      autoShots: 0,
      totalPoints: 0,
    };

    this.player = null;
    this.rival = null;
    this.ball = null;
    this.effects = null;
    this.aimMarker = null;
    this.aimMarkerMaterials = [];
    this.bounceMarker = null;
    this.bounceMarkerMaterials = [];
    this.arcPreview = null;
    this.arcPositions = null;

    this.tick = this.tick.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);

    this.audio.onStateChange = (state) => this.ui.updateAudioState(state);

    // ── LAN multiplayer state ──
    this.netMode = 'ai';            // 'ai' | 'host' | 'guest'
    this.myRole = 'player';         // world role of THIS machine's athlete
    this.net = new NetClient();
    this.guestInput = { x: 0, z: 0, sprint: false, hitSeq: 0, lastHitSeq: 0, aim: { x: 0, z: -5.5 } };
    this.remoteEvents = [];         // host → guest queued one-shot events
    this.snapTimer = 0;
    this.inputTimer = 0;
    this.snapSeq = 0;
    this.snapHistory = [];          // recent ball states, keyed by snapshot seq
    this.guestSnapSq = 0;           // newest snapshot seq Laki has seen

    // Point replay / slow motion.
    this.recordBuffer = [];         // rolling rally recording
    this.replay = null;             // active replay state
    this.pendingPoint = null;       // point result waiting for replay
    this.pendingSwing = null;       // buffered click on an approaching ball
    this.lastNetStatus = null;
    this.snapshot = null;
    this.snapshotPrev = null;
    this.guestStartPending = null;
  }

  async init() {
    this.mobile = isCoarsePointer() || window.innerWidth <= 900;
    this.initRenderer();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a2537);
    this.camera = new THREE.PerspectiveCamera(
      this.currentFov,
      window.innerWidth / window.innerHeight,
      0.08,
      420
    );

    try {
      await Promise.all([
        document.fonts.load("900 24px 'Slam Display'"),
        document.fonts.load("700 24px 'Slam Sans'"),
        document.fonts.ready,
      ]);
    } catch {
      // Fonts are optional; system fallbacks are still playable.
    }

    this.world = buildWorld(this.scene, {
      quality: this.mobile ? 'low' : 'high',
      anisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    });
    // Everything gameplay-side lives under one rotatable root: on a LAN
    // guest machine we spin it 180° so all camera/aim/movement code works
    // unchanged while the guest views the court from their own side.
    this.arena = new THREE.Group();
    this.arena.name = 'arena';
    this.scene.add(this.arena);
    this.arena.add(this.world.root);

    this.createCharacters();
    this.ball = new Ball(this.arena, this.world.materials.ball);
    this.effects = new Effects(this.scene, { reducedMotion: this.reducedMotion });
    this.effects.setFovBase(this.currentFov);
    this.createAimVisuals();
    this.bindUI();
    this.bindInput();
    this.resetToTitle();
    this.installTestHooks();
    this.ui.updateAudioState(this.audio.getState());

    // Headless capture safety net: SwiftShader frames can be so slow that a
    // capture lands between state changes. Republish diagnostics on a timer so
    // the snapshot is never stale or zeroed by RAF throttling.
    this.diagTimer = window.setInterval(() => this.updateDiagnostics(), 250);

    if (panelDebug) {
      this.buildDebugPanel();
    }

    await new Promise((resolve) => window.setTimeout(resolve, 250));
    this.ui.hideBoot();
    this.onResize();
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const dprCap = this.mobile ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a2537, 1);
  }

  createCharacters() {
    this.dukaCharacter = new TennisCharacter({ ...PLAYER_COLORS });
    this.lakiCharacter = new TennisCharacter({ ...RIVAL_COLORS });
    this.arena.add(this.dukaCharacter.root, this.lakiCharacter.root);
    this.assignCharacters('player');
  }

  // Bind "my athlete" and "opponent" views to the models. A LAN guest plays
  // LAKI, so their near-court model is the red kit.
  assignCharacters(role) {
    const guest = role === 'guest';
    this.playerCharacter = guest ? this.lakiCharacter : this.dukaCharacter;
    this.rivalCharacter = guest ? this.dukaCharacter : this.lakiCharacter;
    this.playerCharacter.root.position.copy(PLAYER_TITLE_POS);
    this.rivalCharacter.root.position.copy(RIVAL_TITLE_POS);
    this.rivalCharacter.root.rotation.y = Math.PI - 0.08;

    this.player = {
      pos: new THREE.Vector3().copy(PLAYER_TITLE_POS),
      vel: new THREE.Vector3(),
      character: this.playerCharacter,
      swingCooldown: 0,
      runPhase: 0,
    };
    this.rival = {
      pos: new THREE.Vector3().copy(RIVAL_TITLE_POS),
      vel: new THREE.Vector3(),
      character: this.rivalCharacter,
      swingCooldown: 0,
      reactionTimer: 0,
      home: new THREE.Vector3().copy(HOME_RIVAL),
      lastTarget: new THREE.Vector3().copy(HOME_RIVAL),
    };
  }

  createAimVisuals() {
    const marker = new THREE.Group();
    marker.name = 'aim-marker';
    const ringMat = new THREE.MeshBasicMaterial({
      color: SHOTS.topspin.color,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const dotMat = ringMat.clone();
    dotMat.opacity = 0.9;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.032, 6, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.032;
    marker.add(ring);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.25, 24), dotMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.033;
    marker.add(inner);
    const tickGeom = new THREE.BoxGeometry(0.065, 0.014, 0.36);
    for (let i = 0; i < 4; i += 1) {
      const tick = new THREE.Mesh(tickGeom, ringMat);
      const angle = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(angle) * 1.25, 0.034, Math.sin(angle) * 1.25);
      tick.rotation.y = -angle + Math.PI / 2;
      marker.add(tick);
    }
    marker.visible = false;
    marker.renderOrder = 5;
    this.arena.add(marker);
    this.aimMarker = marker;
    this.aimMarkerMaterials = [ringMat, dotMat];

    const bounce = new THREE.Group();
    const bounceMat = new THREE.MeshBasicMaterial({
      color: 0xffb15f,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const bounceRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.66, 36), bounceMat);
    bounceRing.rotation.x = -Math.PI / 2;
    bounceRing.position.y = 0.03;
    bounce.add(bounceRing);
    const bounceInner = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 20), bounceMat.clone());
    bounceInner.rotation.x = -Math.PI / 2;
    bounceInner.position.y = 0.032;
    bounce.add(bounceInner);
    bounce.visible = false;
    bounce.renderOrder = 4;
    this.arena.add(bounce);
    this.bounceMarker = bounce;
    this.bounceMarkerMaterials = [bounceMat, bounceInner.material];

    const arcGeo = new THREE.BufferGeometry();
    this.arcPositions = new Float32Array(34 * 3);
    arcGeo.setAttribute('position', new THREE.BufferAttribute(this.arcPositions, 3));
    const arcMat = new THREE.LineDashedMaterial({
      color: SHOTS.topspin.color,
      transparent: true,
      opacity: 0.42,
      dashSize: 0.24,
      gapSize: 0.18,
      depthWrite: false,
      toneMapped: false,
    });
    this.arcPreview = new THREE.Line(arcGeo, arcMat);
    this.arcPreview.frustumCulled = false;
    this.arcPreview.visible = false;
    this.arcPreview.renderOrder = 4;
    this.arena.add(this.arcPreview);
  }

  bindUI() {
    this.ui.bind({
      onPlay: () => {
        this.audio.unlock();
        this.audio.playUi();
        this.startMatch();
      },
      onHowto: () => {
        this.audio.unlock();
        this.audio.playUi();
        this.ui.showHowTo(true);
      },
      onHowtoClose: () => {
        this.audio.playUi();
        this.ui.showHowTo(false);
      },
      onPause: () => this.pauseGame(),
      onResume: () => this.resumeGame(),
      onRestart: () => {
        this.audio.playUi();
        this.startMatch();
      },
      onQuitToTitle: () => {
        this.audio.playUi();
        this.returnToTitle();
      },
      onSoundToggle: () => {
        this.audio.unlock();
        this.audio.toggleSound();
        this.audio.playUi();
        this.ui.updateAudioState(this.audio.getState());
      },
      onMusicToggle: () => {
        this.audio.unlock();
        this.audio.toggleMusic();
        this.audio.playUi();
        this.ui.updateAudioState(this.audio.getState());
      },
      onRematch: () => {
        this.audio.playUi();
        this.ui.clearConfetti();
        this.startMatch();
      },
      onHit: () => this.attemptHit('touch'),
      onHost: () => {
        this.audio.unlock();
        this.audio.playUi();
        this.openLobby('host');
      },
      onJoin: () => {
        this.audio.unlock();
        this.audio.playUi();
        this.openLobby('join');
      },
      onLobbyCancel: () => {
        this.audio.playUi();
        this.net.dispose();
        this.ui.hideLobby();
        this.ui.showTitle();
      },
      onLobbyGo: () => {
        const code = (this.ui.el.codeInput?.value || '').trim();
        const name = (this.ui.el.nameInput?.value || 'LAKI').trim().toUpperCase() || 'LAKI';
        this.net.dispose();
        this.setupNetHandlers();
        this.ui.showLobby('join', { name });
        this.net.join(name, code || undefined);
      },
      onCopyLink: () => {
        const code = this.net.code || '';
        const url = window.location.origin + window.location.pathname + '?join=1&code=' + code;
        navigator.clipboard?.writeText(url).then(
          () => this.ui.updateLobbyStatus('LINK COPIED — SEND IT TO LAKI'),
          () => this.ui.updateLobbyStatus('COPY FAILED — SHARE THE CODE INSTEAD', { error: true }),
        );
      },
    });
  }

  openLobby(mode) {
    this.net.dispose();
    this.setupNetHandlers();
    const url = new URL(window.location.href);
    const nameInput = this.ui.el.nameInput;
    if (mode === 'host') {
      const name = ((url.searchParams.get('name') || nameInput?.value || 'DUKA') + '').trim().toUpperCase() || 'DUKA';
      if (nameInput) nameInput.value = name;
      this.ui.showLobby('host', { name });
      this.net.host(name);
    } else {
      const name = ((url.searchParams.get('name') || nameInput?.value || 'LAKI') + '').trim().toUpperCase() || 'LAKI';
      const code = (url.searchParams.get('code') || this.ui.el.codeInput?.value || '').trim().toUpperCase();
      if (nameInput) nameInput.value = name;
      if (this.ui.el.codeInput) this.ui.el.codeInput.value = code;
      this.ui.showLobby('join', { name, code: code || null });
      this.net.join(name, code || undefined);
    }
  }

  setupNetHandlers() {
    this.net.onMessage = (msg) => this.handleNetMessage(msg);
    this.net.onState = (status) => {
      if (status === 'closed' && (this.netMode === 'host' || this.netMode === 'guest')) {
        this.ui.showToast('CONNECTION LOST', 'The LAN match ended. Back to the menu.', 4000);
        this.returnToTitle();
      } else if (status === 'closed' && !this.ui.el.lobbyScreen?.hidden) {
        this.ui.updateLobbyStatus('SERVER UNREACHABLE — IS THE GAME RUNNING ON THE HOST PC?', { error: true });
      }
    };
  }

  handleNetMessage(msg) {
    switch (msg.t) {
      case 'hosted': {
        this.net.code = msg.code;
        this.ui.showLobby('host', { code: msg.code, name: msg.name });
        break;
      }
      case 'joined': {
        this.net.opp = msg.opp;
        this.ui.updateLobbyStatus('CONNECTED TO ' + msg.opp + ' — STARTING…', { hideSpinner: true });
        break;
      }
      case 'start': {
        this.net.opp = msg.opp;
        const role = this.net.role || (this.netMode === 'guest' ? 'guest' : 'host');
        this.ui.showLobbyMatched({
          me: role === 'guest' ? (this.net.name || 'LAKI') : 'DUKA',
          opp: msg.opp,
          role,
        });
        if (this.guestStartPending) window.clearTimeout(this.guestStartPending);
        this.guestStartPending = window.setTimeout(() => {
          this.beginNetSession(role);
        }, 1400);
        break;
      }
      case 'snap': {
        this.snapshot = msg;
        break;
      }
      case 'in': {
        if (this.netMode !== 'host') break;
        this.guestInput.x = msg.x;
        this.guestInput.z = msg.z;
        this.guestInput.sprint = Boolean(msg.s);
        this.guestInput.aim = msg.aim || this.guestInput.aim;
        if (typeof msg.h === 'number') this.guestInput.hitSeq = Math.max(this.guestInput.hitSeq, msg.h);
        if (typeof msg.sq === 'number') this.guestSnapSq = Math.max(this.guestSnapSq, msg.sq);
        break;
      }
      case 'left': {
        if (this.netMode === 'host' || this.netMode === 'guest') {
          this.ui.showToast('OPPONENT LEFT', 'The LAN match ended. Back to the menu.', 4000);
          this.returnToTitle();
        }
        break;
      }
      case 'err': {
        this.ui.updateLobbyStatus(msg.msg || 'MATCHMAKING ERROR', { error: true });
        break;
      }
      default:
        break;
    }
  }

  bindInput() {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.clearInputs());
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('scroll', this.onResize);
    window.addEventListener('orientationchange', () => window.setTimeout(this.onResize, 260));
    window.addEventListener('orientationchange', () => {
      window.setTimeout(this.onResize, 220);
    });
    document.addEventListener('pointerlockchange', () => this.handlePointerLockChange());
    document.addEventListener('mousemove', (event) => this.handleMouseMove(event));
    document.addEventListener('mousedown', (event) => this.handleMouseDown(event));
    document.addEventListener('mouseup', (event) => {
      if (event.button === 2) this.focusing = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isActiveMatch() && !this.paused) this.pauseGame();
    });

    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('click', () => {
      if (!this.isActiveMatch() || this.paused || this.mobile) return;
      if (!this.pointerLocked) this.requestPointerLock();
    });
    this.canvas.addEventListener('pointerdown', (event) => {
      if (!this.mobile && event.pointerType === 'touch') {
        // A real touch arrived while we were in desktop mode (e.g. "request
        // desktop site") — switch to touch controls instead of mouse aiming.
        this.mobile = true;
        this.ui._initViewportMode();
      }
    });

    const joystickZone = document.getElementById('joystick-zone');
    const joystickKnob = document.getElementById('joystick-knob');
    let joystickId = null;
    const updateJoystick = (event) => {
      const rect = joystickZone.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = event.clientX - cx;
      let dy = event.clientY - cy;
      const max = rect.width * 0.34;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      if (joystickKnob) {
        joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      this.joystick.x = clamp(dx / max, -1, 1);
      this.joystick.z = clamp(-dy / max, -1, 1);
      this.joystick.active = true;
    };
    const endJoystick = () => {
      joystickId = null;
      this.joystick.x = 0;
      this.joystick.z = 0;
      this.joystick.active = false;
      if (joystickKnob) joystickKnob.style.transform = 'translate(0, 0)';
    };
    if (joystickZone) {
      joystickZone.addEventListener('pointerdown', (event) => {
        if (!this.mobile || this.paused) return;
        event.preventDefault();
        joystickId = event.pointerId;
        joystickZone.setPointerCapture?.(event.pointerId);
        updateJoystick(event);
      });
      joystickZone.addEventListener('pointermove', (event) => {
        if (event.pointerId !== joystickId) return;
        event.preventDefault();
        updateJoystick(event);
      });
      joystickZone.addEventListener('pointerup', endJoystick);
      joystickZone.addEventListener('pointercancel', endJoystick);
      joystickZone.addEventListener('lostpointercapture', endJoystick);
    }

    const aimZone = document.getElementById('aim-touch-zone');
    let aimId = null;
    let aimX = 0;
    let aimY = 0;
    if (aimZone) {
      aimZone.addEventListener('pointerdown', (event) => {
        if (!this.mobile || this.paused) return;
        event.preventDefault();
        aimId = event.pointerId;
        aimX = event.clientX;
        aimY = event.clientY;
        aimZone.setPointerCapture?.(event.pointerId);
        document.getElementById('touch-aim-label')?.style.setProperty('opacity', '0.08');
      });
      aimZone.addEventListener('pointermove', (event) => {
        if (event.pointerId !== aimId) return;
        event.preventDefault();
        const dx = event.clientX - aimX;
        const dy = event.clientY - aimY;
        aimX = event.clientX;
        aimY = event.clientY;
        this.aimYaw = clamp(
          this.aimYaw + dx * 0.0032,
          AIM.minYaw,
          AIM.maxYaw
        );
        this.aimPitch = clamp(
          this.aimPitch - dy * 0.00115,
          AIM.minPitch,
          AIM.maxPitch
        );
      });
      const endAim = () => {
        aimId = null;
        document.getElementById('touch-aim-label')?.style.setProperty('opacity', '');
      };
      aimZone.addEventListener('pointerup', endAim);
      aimZone.addEventListener('pointercancel', endAim);
      aimZone.addEventListener('lostpointercapture', endAim);
    }
  }

  onKeyDown(event) {
    const key = event.key.toLowerCase();
    if (['a', 'd', 'w', 's', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      this.keys.add(key);
      if (key.startsWith('arrow')) event.preventDefault();
    }
    if (event.key === 'Shift') this.keys.add('shift');
    if (event.code === 'Space') {
      event.preventDefault();
      if (this.isActiveMatch() && !this.paused && !this.screenshotPaused) this.attemptHit('keyboard');
      return;
    }
    if (key === 'escape') {
      if (this.paused) {
        this.resumeGame();
      } else if (this.isActiveMatch()) {
        this.pauseGame();
      }
      return;
    }
    if (key === 'm') {
      this.audio.unlock();
      this.audio.toggleSound();
      this.ui.updateAudioState(this.audio.getState());
    }
  }

  onKeyUp(event) {
    const key = event.key.toLowerCase();
    this.keys.delete(key);
    if (event.key === 'Shift') this.keys.delete('shift');
  }

  clearInputs() {
    this.keys.clear();
    this.joystick.x = 0;
    this.joystick.z = 0;
    this.joystick.active = false;
    this.focusing = false;
  }

  // World side of THIS machine's athlete: +1 host/CPU, -1 LAN guest.
  mySide() {
    return this.netMode === 'guest' ? -1 : 1;
  }

  isActiveMatch() {
    return ['intro', 'serve', 'rally', 'point', 'over'].includes(this.phase);
  }

  requestPointerLock() {
    if (this.mobile || !this.canvas?.requestPointerLock) return;
    try {
      const maybePromise = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (maybePromise?.catch) {
        maybePromise.catch(() => {
          try {
            this.canvas.requestPointerLock();
          } catch {
            // Pointer lock can be blocked; the game remains fully playable with
            // keyboard aiming and touch controls.
          }
        });
      }
    } catch {
      try {
        this.canvas.requestPointerLock();
      } catch {
        // see above
      }
    }
  }

  handlePointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    const wasActive = this.pointerLockWasActive;
    this.pointerLockWasActive = this.pointerLocked;
    // Only auto-pause when a real lock was lost (Esc). Failed lock attempts
    // (no gesture, headless) must never freeze the match.
    if (
      !this.pointerLocked &&
      wasActive &&
      ['intro', 'serve', 'rally', 'point'].includes(this.phase) &&
      !this.paused &&
      !this.screenshotPaused
    ) {
      this.pauseGame();
    }
  }

  handleMouseMove(event) {
    if (!this.pointerLocked || this.paused || this.screenshotPaused) return;
    if (!['serve', 'rally', 'intro'].includes(this.phase)) return;
    this.aimYaw = clamp(
      this.aimYaw + event.movementX * AIM.mouseSensitivity,
      AIM.minYaw,
      AIM.maxYaw
    );
    this.aimPitch = clamp(
      this.aimPitch - event.movementY * AIM.pitchSensitivity,
      AIM.minPitch,
      AIM.maxPitch
    );
  }

  handleMouseDown(event) {
    if (this.mobile) return;
    if (event.button === 2) {
      if (this.isActiveMatch() && !this.paused) {
        this.focusing = true;
        event.preventDefault();
      }
      return;
    }
    if (event.button !== 0) return;
    if (event.target !== this.canvas) return;
    if (!this.isActiveMatch() || this.paused || this.screenshotPaused) return;
    if (!this.pointerLocked) {
      this.requestPointerLock();
      return;
    }
    this.attemptHit('mouse');
  }

  // ───────────────────────── match lifecycle ─────────────────────────

  resetToTitle() {
    if (this.netMode !== 'ai') {
      this.net.dispose();
      this.netMode = 'ai';
      this.myRole = 'player';
    }
    this.assignCharacters('player');
    this.phase = 'title';
    this.paused = false;
    this.screenshotPaused = false;
    this.hasStarted = false;
    this.matchWinner = null;
    this.matchPoint = false;
    this.score.player = 0;
    this.score.rival = 0;
    this.totalPoints = 0;
    this.server = 'player';
    this.rally = 0;
    this.longestRally = 0;
    this.stats = { pointsWon: 0, topSpeed: 0, perfects: 0, winners: 0, autoShots: 0, totalPoints: 0 };
    this.resultsShown = false;
    this.endTimer = 0;
    this.serve = { state: 'idle', timer: 0, tossStarted: false, quickServe: 0 };
    this.keys.clear();
    this.joystick.x = 0;
    this.joystick.z = 0;
    this.focusing = false;
    this.aimYaw = -0.05;
    this.aimPitch = -0.115;
    this.titleTime = 0;
    this.ball?.hide();
    this.characterReset();
    this.player.pos.copy(PLAYER_TITLE_POS);
    this.rival.pos.copy(RIVAL_TITLE_POS);
    this.player.vel.set(0, 0, 0);
    this.rival.vel.set(0, 0, 0);
    this.player.character.stopServeToss();
    this.rival.character.stopServeToss();
    this.player.character.root.position.copy(this.player.pos);
    this.player.character.root.rotation.y = -0.08;
    this.rival.character.root.position.copy(this.rival.pos);
    this.rival.character.root.rotation.y = Math.PI - 0.08;
    this.ui.showTitle();
    this.ui.showHud(false);
    this.ui.clearConfetti();
    this.ui.hidePointBanner();
    this.ui.hideCountdown();
    this.ui.hideToast();
    this.ui.setAim({ shot: 'TOPSPIN', hand: 'FOREHAND', ready: false, readiness: 0 });
    this.aimMarker.visible = false;
    this.bounceMarker.visible = false;
    this.arcPreview.visible = false;
    this.audio.setMood('menu');
    this.world.setScoreboard({
      playerPoints: '–',
      rivalPoints: '–',
      label: 'WARM-UP',
      detail: 'NEON PALMS OPEN',
      serving: 'player',
    });
    this.snapCamera(true);
    document.exitPointerLock?.();
  }

  characterReset() {
    this.playerCharacter?.root.position.set(0, 0, 0);
    this.rivalCharacter?.root.position.set(0, 0, 0);
  }

  startMatch() {
    this.audio.unlock();
    this.audio.setMood('match');
    this.ui.showGame();
    this.ui.hideResults();
    this.ui.hideHowTo();
    this.ui.clearConfetti();
    this.ui.hideBanners();
    this.ui.showHud(true);
    this.ui.setPaused(false);
    this.paused = false;
    this.screenshotPaused = false;
    this.hasStarted = true;
    this.matchWinner = null;
    this.matchPoint = false;
    this.resultsShown = false;
    this.endTimer = 0;
    this.score.player = 0;
    this.score.rival = 0;
    this.totalPoints = 0;
    this.server = 'player';
    this.rally = 0;
    this.longestRally = 0;
    this.stats = { pointsWon: 0, topSpeed: 0, perfects: 0, winners: 0, autoShots: 0, totalPoints: 0 };
    this.placeForServe('player');
    this.playerCharacter.root.visible = true;
    this.rivalCharacter.root.visible = true;
    this.phase = 'intro';
    this.introTimer = 1.25;
    this.showIntroToast = true;
    this.ui.setRally(0);
    this.ui.setTopSpeed(0);
    this.updateScoreHud();
    this.ui.showCountdown({ kicker: 'MATCH START', value: 'READY', sub: 'YOUR SERVE' });
    this.ui.setPrompt('YOUR SERVE');
    this.audio.playCountdown(true);
    this.snapCamera(true);
    this.requestPointerLock();
  }

  placeForServe(server) {
    this.server = server;
    this.rally = 0;
    this.serve = { state: 'wait', timer: 0, tossStarted: false, quickServe: 0 };
    this.phase = 'serve';
    this.player.vel.set(0, 0, 0);
    this.rival.vel.set(0, 0, 0);
    this.player.character.stopServeToss();
    this.rival.character.stopServeToss();
    this.ball.hide();

    if (server === 'player') {
      this.player.pos.set(-0.55, 0, 11.2);
      this.rival.pos.set(0.75, 0, -10.65);
      this.player.character.root.rotation.y = -this.aimYaw;
      this.rival.character.root.rotation.y = Math.PI - 0.03;
    } else {
      this.player.pos.set(-0.45, 0, 10.85);
      this.rival.pos.set(0.55, 0, -11.15);
      this.player.character.root.rotation.y = -this.aimYaw;
      this.rival.character.root.rotation.y = Math.PI - 0.03;
    }
    this.player.character.root.position.copy(this.player.pos);
    this.rival.character.root.position.copy(this.rival.pos);
    this.ball.setHeld(this.getServeHoldPosition(server));
    this.ui.hidePointBanner();
    this.ui.hideCountdown();
    this.ui.setRally(0);
    this.updateScoreHud();
    this.ui.setPrompt(server === 'player' ? 'CLICK TO SERVE' : 'LAKI SERVING', 'neutral');
  }

  getServeHoldPosition(server) {
    if (server === 'player') {
      const forward = new THREE.Vector3(Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
      const right = new THREE.Vector3(Math.cos(this.aimYaw), 0, Math.sin(this.aimYaw));
      return new THREE.Vector3()
        .copy(this.player.pos)
        .addScaledVector(forward, 0.24)
        .addScaledVector(right, -0.22)
        .add(new THREE.Vector3(0, 1.16, 0));
    }
    return new THREE.Vector3(this.rival.pos.x + 0.22, 1.16, this.rival.pos.z + 0.24);
  }

  beginServe(server) {
    this.pendingSwing = null;
    this.recordBuffer.length = 0;
    this.pendingPoint = null;
    this.ui.hideReplay();
    this.placeForServe(server);
    if (this.netMode === 'host') {
      this.pushNetEvent({ ev: 'hidebanners' });
    }
    if (this.showIntroToast) {
      this.showIntroToast = false;
      this.ui.showToast(
        'AUTO-SHOT ONLINE',
        'Move, aim, and hit. We choose forehand, slice, volley or smash for you.',
        4800
      );
    }
  }

  startServeToss(server) {
    if (this.serve.state !== 'wait') return;
    this.serve.state = 'toss';
    this.serve.timer = 0;
    this.serve.tossStarted = true;
    const hand = this.getServeHoldPosition(server);
    const character = server === 'player' ? this.player.character : this.rival.character;
    character.startServeToss();
    this.ball.tossFrom(hand, new THREE.Vector3(0, 5.6, 0));
    if (this.netMode === 'host') {
      this.pushNetEvent({ ev: 'toss', who: server === 'player' ? 'p' : 'r' });
    }
    this.audio.playServeToss();
  }

  executeServe(server) {
    if (this.phase !== 'serve' || this.serve.state === 'idle') return;
    this.serve.state = 'idle';
    const character = server === 'player' ? this.player.character : this.rival.character;
    character.stopServeToss();
    if (this.netMode === 'host') {
      this.pushNetEvent({ ev: 'tossstop' });
    }
    const hand = this.getServeHoldPosition(server);
    const origin = this.ball.mode === 'toss' ? this.ball.pos.clone() : hand.clone();
    origin.y = Math.max(origin.y, 2.05);
    origin.y = Math.min(origin.y, 3.15);

    let target;
    if (server === 'player') {
      const x = clamp(this.aimPoint.x * 0.85 + this.rng.gauss(0, 0.1), -3.35, 3.35);
      target = new THREE.Vector3(x, 0.033, -5.15 - this.rng.range(0, 0.55));
      this.audio.playSwing('serve');
      this.effects.spawnContact(origin, SHOTS.serve.color, 1.15);
      this.audio.playHit('serve', 0.9, 0);
    } else {
      const wide = this.player.pos.x > 0.2 ? -1 : 1;
      const x = wide * this.rng.range(1.7, 3.15);
      target = new THREE.Vector3(x, 0.033, 5.0 + this.rng.range(0, 0.6));
      this.effects.spawnContact(origin, SHOTS.serve.color, 0.8);
      this.audio.playHit('serve', 0.8, 0.1);
    }

    this.ball.launch(origin, target, 'serve', server === 'player' ? 1.03 : 0.98);
    if (this.netMode === 'host' && server === 'rival') {
      this.pushNetEvent({ ev: 'swme', ty: 'serve', hd: 'right' });
    }
    this.ball.markServe(server);
    this.ball.events.length = 0;
    this.phase = 'rally';
    this.rally = 1;
    this.hitstop = 0.018;
    character.triggerSwing('serve', 'right');
    this.player.swingCooldown = 0.35;
    this.rival.swingCooldown = 0.35;
    this.ui.setRally(1);
    this.ui.hideCountdown();
    this.updateScoreHud();
    this.world.setScoreboard({
      playerPoints: this.scoreLabels().player,
      rivalPoints: this.scoreLabels().rival,
      label: this.scoreMetaLine(),
      detail: this.score.player + this.score.rival === 0 ? 'TIEBREAK' : 'CENTER COURT',
      serving: server,
    });
  }

  updateIntro(dt) {
    this.introTimer -= dt;
    this.updateCharacters(dt, 0, 0);
    if (this.introTimer <= 0) {
      this.ui.hideCountdown();
      this.beginServe('player');
    }
  }

  updateServe(dt) {
    if (this.phase !== 'serve') return;
    this.serve.timer += dt;
    const server = this.server;
    const character = server === 'player' ? this.player.character : this.rival.character;

    if (this.serve.state === 'wait') {
      const autoStart = server === 'player' ? 0.55 : 0.75;
      if (this.serve.timer > autoStart) {
        // Flips serve.state to 'toss' — the held-ball refresh below must be
        // skipped on this frame or it snaps the ball back and kills the toss.
        this.startServeToss(server);
      } else {
        this.ball.setHeld(this.getServeHoldPosition(server));
      }
    }

    if (this.serve.state === 'toss') {
      if (this.serve.quickServe > 0) {
        this.serve.quickServe -= dt;
        if (this.serve.quickServe <= 0) this.executeServe(server);
      }
      // Only wait indefinitely for a HUMAN guest's press; CPU Laki serves
      // on the same timer as the player.
      const waitingForGuest = this.netMode === 'host' && server === 'rival';
      const autoServeTime = waitingForGuest ? Infinity : TUNING.serveAutoDelay;
      if (this.serve.timer > autoServeTime) {
        this.executeServe(server);
      } else if (this.ball.mode === 'toss' && this.ball.pos.y < 0.4) {
        this.executeServe(server);
      }
    }

    if (this.phase === 'serve') {
      const myServe = server === this.myRole;
      if (myServe) {
        this.ui.setPrompt(
          this.serve.state === 'toss' ? 'CLICK TO SERVE' : 'GET READY TO TOSS',
          this.serve.state === 'toss' ? 'ready' : 'neutral'
        );
      } else {
        this.ui.setPrompt(this.netMode === 'guest' ? 'DUKA SERVING' : 'LAKI SERVING', 'neutral');
      }
    }
  }

  // ───────────────────────── input → actions ─────────────────────────

  // True when a click made now is "early" — the ball is on this athlete's side,
  // closing fast, and will be within racket reach shortly. Such clicks are
  // buffered so the natural rhythm (click as you see the bounce) always lands.
  shouldBufferSwing() {
    const b = this.ball;
    if (!b || b.mode !== 'flight' || this.phase !== 'rally') return false;
    if (b.pos.z <= 0.05) return false;
    const d = horizontalDistance(b.pos, this.player.pos);
    if (d > 8.2) return false;
    const dx = this.player.pos.x - b.pos.x;
    const dz = this.player.pos.z - b.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const closing = (b.vel.x * dx + b.vel.z * dz) / len;
    if (closing < 0.35) return false;
    const gap = Math.max(0, d - TUNING.playerReach);
    return gap / closing <= 0.8;
  }

  bufferSwing() {
    if (this.pendingSwing) return;
    this.pendingSwing = { t: 0.85 };
    this.ui.setPrompt('WAITING FOR IT…', 'ready');
    this.player.swingCooldown = 0;
  }

  // Fires the buffered swing the moment the ball is playable.
  updatePendingSwing(dt) {
    if (!this.pendingSwing) return;
    this.pendingSwing.t -= dt;
    const b = this.ball;
    if (this.phase !== 'rally' || !b || b.mode !== 'flight' || b.pos.z < -0.05) {
      this.pendingSwing = null;
      return;
    }
    const horizontal = horizontalDistance(b.pos, this.player.pos);
    // Same reach window as a direct hit, including the catch-assist lunge:
    // a click at the bounce should convert even for balls just off the racket.
    if (horizontal <= TUNING.playerReach + 0.85 && b.pos.y < 3.45 && b.pos.y > 0.02) {
      this.pendingSwing = null;
      if (horizontal > TUNING.playerReach + 0.08) {
        const dx = b.pos.x - this.player.pos.x;
        const dz = b.pos.z - this.player.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const step = Math.min(0.85, Math.max(0, horizontal - TUNING.playerReach + 0.35));
        this.player.pos.x = clamp(this.player.pos.x + (dx / len) * step, -PLAYER_BOUNDS.x, PLAYER_BOUNDS.x);
        this.player.pos.z = clamp(this.player.pos.z + (dz / len) * step, PLAYER_BOUNDS.zMin, PLAYER_BOUNDS.zMax);
      }
      this.strikeBall(b.pos.clone());
      return;
    }
    if (this.pendingSwing.t <= 0) {
      this.pendingSwing = null;
      this.ui.setPrompt('JUST MISSED IT', 'warning');
    }
  }

  attemptHit(source = 'mouse') {
    if (!this.isActiveMatch() || this.paused || this.screenshotPaused) return;
    if (this.netMode === 'guest') {
      // Host is authoritative. Buffer early clicks locally (LAN latency makes
      // "click at the bounce" even earlier on the far screen) and release the
      // request only once the ball is playable.
      const info = this.getHitInfo();
      if (info.ready || !this.shouldBufferSwing()) {
        this.guestInput.hitSeq += 1;
        this.net.sendInput({ h: this.guestInput.hitSeq });
      } else {
        this.bufferSwing();
      }
      return;
    }
    if (this.phase === 'intro') return;
    if (this.phase === 'serve') {
      if (this.server === 'player') {
        if (this.serve.state === 'toss') {
          this.executeServe('player');
        } else if (this.serve.state === 'wait') {
          this.startServeToss('player');
          this.serve.quickServe = 0.28;
        }
        return;
      }
      // Receiving a serve falls through to the normal return logic once the
      // ball is in flight.
    }
    if (this.phase !== 'rally' || this.ball.mode !== 'flight') return;
    if (this.player.swingCooldown > 0) return;
    const contact = this.ball.pos.clone();
    // Ball must be on my side of the net (arena-local: my half is +Z).
    if (contact.z < -0.05) return;

    let horizontal = horizontalDistance(contact, this.player.pos);
    const canReach = horizontal <= TUNING.playerReach + 0.08 && contact.y < 3.45 && contact.y > 0.02;
    // Catch assist: a small automatic lunge into balls that are just out of
    // reach makes late reaction readable instead of punishing.
    const lungeRange = TUNING.playerReach + 0.85;
    if (!canReach && horizontal <= lungeRange && contact.y < 3.45 && contact.y > 0.02) {
      const dx = contact.x - this.player.pos.x;
      const dz = contact.z - this.player.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const step = Math.min(0.85, Math.max(0, horizontal - TUNING.playerReach + 0.35));
      this.player.pos.x = clamp(this.player.pos.x + (dx / len) * step, -PLAYER_BOUNDS.x, PLAYER_BOUNDS.x);
      this.player.pos.z = clamp(this.player.pos.z + (dz / len) * step, PLAYER_BOUNDS.zMin, PLAYER_BOUNDS.zMax);
      horizontal = horizontalDistance(contact, this.player.pos);
      this.effects.spawnRing(
        new THREE.Vector3(this.player.pos.x, 0.03, this.player.pos.z),
        0x9af4df, 0.9, 0.28
      );
    }
    if (horizontal > TUNING.playerReach + 0.08) {
      // Clicked early on a ball that is still closing in → buffer it instead
      // of a doomed whiff (which also used to eat the next click's cooldown).
      if (this.shouldBufferSwing()) {
        this.bufferSwing();
        return;
      }
      const shot = this.selectShotType(contact);
      this.playerCharacter.triggerSwing(shot.type, shot.hand);
      this.player.swingCooldown = TUNING.swingCooldown * 0.78;
      this.audio.playSwing(shot.type);
      if (horizontal < 4.1) {
        this.ui.setPrompt('STRETCHING — GET CLOSER', 'warning');
      }
      return;
    }

    this.strikeBall(contact);
  }

  selectShotType(contact) {
    let type = 'topspin';
    let hand = contact.x >= this.player.pos.x - 0.08 ? 'forehand' : 'backhand';
    const height = contact.y;
    const nearNet = this.player.pos.z < 5.4;
    const insideService = this.player.pos.z < COURT.serviceLine + 0.4;
    if (height > 2.08 && this.player.pos.z < 7.3) {
      type = 'smash';
      hand = 'forehand';
    } else if (nearNet && height > 0.35) {
      type = this.effectiveTarget.z > -5.1 ? 'drop' : 'volley';
      hand = this.effectiveTarget.z > -5.1 ? 'forehand' : hand;
    } else if (height < 0.38) {
      type = 'slice';
    } else if (contact.z > this.player.pos.z + 0.62 && height < 1.05) {
      type = 'lob';
      hand = 'forehand';
    } else if (this.aimPoint.z < -9.6 && height > 1.3) {
      type = 'drive';
    } else if (insideService && height > 1.65) {
      type = 'volley';
    }
    return { type, hand };
  }

  rateContact(contact, shotType) {
    const forward = new THREE.Vector3(Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
    const idealX = this.player.pos.x + forward.x * 0.55;
    const idealZ = this.player.pos.z + forward.z * 0.55;
    const idealY = shotType === 'smash' ? 2.2 : shotType === 'volley' ? 1.2 : shotType === 'slice' ? 0.55 : 1.0;
    const dx = contact.x - idealX;
    const dz = contact.z - idealZ;
    const dy = contact.y - idealY;
    const distance = Math.sqrt(dx * dx * 0.7 + dz * dz * 0.8 + dy * dy * 0.3);
    const quality = clamp(1 - distance / 2.45, 0.22, 1);
    let rating = 'GOOD';
    if (quality >= 0.82) rating = 'PERFECT';
    else if (quality < 0.5) rating = contact.z > this.player.pos.z + 0.4 ? 'LATE' : 'STRETCH';
    return { quality, rating, distance };
  }

  strikeBall(contact) {
    const shot = this.selectShotType(contact);
    const { quality, rating } = this.rateContact(contact, shot.type);
    const power = 0.8 + quality * 0.24;
    const target = this.applyAutoTarget(shot.type, this.aimPoint.clone());

    const pressure = clamp(this.player.vel.length() / 6, 0, 1);
    // Long rallies wear on timing: a small fatigue term keeps marathon
    // exchanges from becoming literally endless against perfect movement.
    const fatigue = clamp(this.rally / 110, 0, 0.18);
    const errorScale = (1 - quality) * 1.35 + pressure * 0.22 + fatigue;
    let missed = false;
    if (this.rng.chance(clamp(fatigue * 0.35 + (1 - quality) * 0.06, 0, 0.22))) {
      missed = true;
      // Laki's misses go deep/wide on the host half (+Z).
      if (this.rng.chance(0.55)) target.z = this.rng.range(12.15, 13.0);
      else target.x = (target.x >= 0 ? 1 : -1) * this.rng.range(4.4, 5.2);
    }
    target.x += this.rng.gauss(0, errorScale * 0.75);
    target.z += this.rng.gauss(0, errorScale);
    if (!missed) {
      if (shot.type === 'smash') target.z -= this.rng.range(0, 0.4);
    }
    if (shot.type === 'lob') target.z = Math.min(target.z, -9.6);
    if (shot.type === 'drop') {
      target.z = clamp(target.z, -5.8, -2.9);
      target.x = clamp(target.x, -3.7, 3.7);
    }

    const origin = contact.clone();
    origin.y = clamp(origin.y, 0.32, 2.95);
    this.ball.launch(origin, target, shot.type, power);
    this.ball.lastHitter = 'player';
    this.ball.served = false;
    this.ball.events.length = 0;

    this.player.swingCooldown = TUNING.swingCooldown + 0.12;
    this.player.character.triggerSwing(shot.type, shot.hand);
    if (this.netMode === 'host') {
      this.pushNetEvent({ ev: 'sw', ty: shot.type, hd: shot.hand });
    }
    this.audio.playSwing(shot.type);
    const pan = clamp((origin.x - this.player.pos.x) / 4, -0.7, 0.7);
    this.audio.playHit(shot.type, quality, pan);
    this.effects.spawnContact(origin, SHOTS[shot.type]?.color ?? 0xffd36e, quality);

    this.rally += 1;
    this.longestRally = Math.max(this.longestRally, this.rally);
    this.stats.autoShots += 1;
    const speedKmh = Math.round(this.ball.vel.length() * 3.6);
    this.stats.topSpeed = Math.max(this.stats.topSpeed, this.ball.vel.length());
    if (quality >= 0.82) {
      this.stats.perfects += 1;
      this.effects.spawnRing(contact, SHOTS[shot.type].color, 1.8, 0.45);
      this.ui.flashHit();
      this.hitstop = TUNING.hitstopPerfect;
    } else {
      this.hitstop = Math.max(this.hitstop, TUNING.hitstopNormal);
    }

    this.rival.reactionTimer = 0.1 + this.rng.range(0, 0.1);
    this.rival.lastTarget.copy(this.rival.pos);
    this.ui.setRally(this.rally);
    this.ui.setTopSpeed(formatSpeed(this.stats.topSpeed));
    this.ui.showHitFeedback({
      rating,
      detail: `${SHOTS[shot.type].label} · ${speedKmh} KM/H`,
      tone: rating === 'PERFECT' ? 'perfect' : rating === 'GOOD' ? 'good' : 'poor',
    });
    if (this.netMode === 'host') {
      this.pushNetEvent({
        ev: 'hit',
        rating,
        detail: `${SHOTS[shot.type].label} · ${speedKmh} KM/H`,
        tone: rating === 'PERFECT' ? 'perfect' : rating === 'GOOD' ? 'good' : 'poor',
      });
    }
    this.ui.setPrompt('RECOVER TO CENTER');
  }

  applyAutoTarget(shotType, target) {
    switch (shotType) {
      case 'smash':
        target.z = clamp(target.z, -9.3, -4.1);
        break;
      case 'volley':
        target.z = clamp(target.z, -9.2, -3.5);
        break;
      case 'drop':
        target.z = clamp(target.z, -5.8, -3.0);
        target.x = clamp(target.x, -3.6, 3.6);
        break;
      case 'lob':
        target.z = clamp(Math.min(target.z, -10.2), -11.25, -10.0);
        target.x *= 0.62;
        break;
      case 'slice':
        target.z = clamp(target.z, -10.6, -5.2);
        break;
      case 'drive':
        target.z = clamp(target.z, -10.9, -7.2);
        break;
      case 'topspin':
      default:
        target.z = clamp(target.z, -11.2, -4.4);
        break;
    }
    return target;
  }

  // ───────────────────────── rival AI ─────────────────────────

  updateRival(dt) {
    const rival = this.rival;
    const ball = this.ball;
    if (!rival || !ball) return;
    rival.swingCooldown = Math.max(0, rival.swingCooldown - dt);
    rival.reactionTimer = Math.max(0, rival.reactionTimer - dt);

    // LAN match: the rival entity is Laki. His browser streams inputs; we
    // apply them authoritatively here.
    if (this.netMode === 'host') {
      this.updateGuestAthlete(dt);
      return;
    }

    let targetX = rival.home.x;
    let targetZ = rival.home.z;
    let moveSpeed = TUNING.rivalSpeed;
    let shouldChase = false;

    if (this.phase === 'serve') {
      if (this.server === 'rival') {
        targetX = rival.pos.x;
        targetZ = rival.pos.z;
        moveSpeed = 0;
      } else {
        targetX = rival.home.x;
        targetZ = rival.home.z;
        moveSpeed = 2.6;
      }
    } else if (this.phase === 'rally' || this.phase === 'point') {
      if (ball.mode === 'flight' && ball.lastHitter === 'player' && rival.reactionTimer <= 0) {
        const landing = ball.predictLanding();
        if (landing && landing.z < 0.7) {
          shouldChase = true;
          targetX = clamp(landing.x, -4.95, 4.95);
          targetZ = clamp(landing.z - 0.5, -13.15, -1.2);
          // Anticipate the bounce a touch, like a real returner.
          const timeToLand = landing.time;
          if (timeToLand > 0.55) {
            targetZ += 0.35;
          }
        }
      } else if (ball.mode === 'flight' && ball.lastHitter === 'rival') {
        targetX = clamp(rival.home.x * 0.8, -3.2, 3.2);
        targetZ = rival.home.z;
        moveSpeed = 3.3;
      } else if (ball.mode !== 'flight') {
        targetX = rival.home.x;
        targetZ = rival.home.z;
      }
    }

    if (!shouldChase && this.phase === 'rally' && ball.lastHitter === 'rival') {
      // Recover behind the ball after a return.
      targetZ = rival.home.z;
    }

    const dx = targetX - rival.pos.x;
    const dz = targetZ - rival.pos.z;
    const dist = Math.hypot(dx, dz);
    let desiredX = 0;
    let desiredZ = 0;
    if (dist > 0.12 && moveSpeed > 0) {
      desiredX = (dx / dist) * moveSpeed;
      desiredZ = (dz / dist) * moveSpeed;
    }
    rival.vel.x = damp(rival.vel.x, desiredX, TUNING.rivalAccel, dt);
    rival.vel.z = damp(rival.vel.z, desiredZ, TUNING.rivalAccel, dt);
    rival.pos.x += rival.vel.x * dt;
    rival.pos.z += rival.vel.z * dt;
    rival.pos.x = clamp(rival.pos.x, -RIVAL_BOUNDS.x, RIVAL_BOUNDS.x);
    rival.pos.z = clamp(rival.pos.z, RIVAL_BOUNDS.zMin, RIVAL_BOUNDS.zMax);

    if (this.phase === 'rally' && ball.mode === 'flight' && ball.lastHitter === 'player') {
      const reach = horizontalDistance(ball.pos, rival.pos);
      const onSide = ball.pos.z < -0.18;
      if (
        onSide &&
        reach < TUNING.rivalReach &&
        ball.pos.y < 3.35 &&
        rival.swingCooldown <= 0
      ) {
        this.rivalStrike(ball.pos.clone(), reach);
      }
    }

    const facing = Math.PI - 0.02 - clamp((ball.pos.x - rival.pos.x) * 0.018, -0.18, 0.18);
    rival.character.root.rotation.y = facing;
    const speed = Math.hypot(rival.vel.x, rival.vel.z);
    rival.character.root.position.copy(rival.pos);
  }

  rivalStrike(contact, reach) {
    const rival = this.rival;
    const height = contact.y;
    let type = 'topspin';
    if (height > 2.05 && rival.pos.z > -5.4) type = 'smash';
    else if (rival.pos.z > -4.7 && height > 0.35) type = 'volley';
    else if (height < 0.4) type = 'slice';
    else if (this.player.pos.z > 8.5 && height < 1.0 && this.rng.chance(0.15)) type = 'drop';

    const openSide = this.player.pos.x > 0.35 ? -1 : this.player.pos.x < -0.35 ? 1 : this.rng.sign();
    let targetX = openSide * this.rng.range(1.4, 3.35);
    let targetZ = this.rng.range(6.3, 10.8);
    if (type === 'volley') {
      targetZ = this.rng.range(5.3, 8.4);
      targetX = openSide * this.rng.range(1.2, 3.1);
    } else if (type === 'smash') {
      targetZ = this.rng.range(8.4, 10.9);
      targetX = this.rng.range(-2.7, 2.7);
    } else if (type === 'slice') {
      targetZ = this.rng.range(5.8, 9.7);
    } else if (type === 'drop') {
      targetZ = this.rng.range(3.2, 4.9);
      targetX = this.rng.range(-2.4, 2.4);
    }

    const stretch = clamp((reach - 0.9) / 1.7, 0, 1);
    // Unforced-error model: even a clean striker misses under stretch, long
    // rallies and full-extension smashes. Without it, two perfect players
    // produce endless rallies and no point can ever be won or lost.
    const errorChance =
      0.09 +
      stretch * 0.4 +
      clamp(this.rally / 70, 0, 0.22) +
      (type === 'smash' ? 0.06 : 0) +
      (type === 'volley' ? 0.05 : 0);
    if (this.rng.chance(errorChance)) {
      // Miss long or wide so the ball lands out and the point resolves.
      if (this.rng.chance(0.55)) {
        targetZ = this.rng.range(12.15, 13.1);
        targetX = this.rng.range(-3.6, 3.6);
      } else {
        const side = targetX >= 0 ? 1 : -1;
        targetX = side * this.rng.range(4.35, 5.3);
      }
    }
    const error = 0.22 + stretch * 0.52 + (1 - clamp((contact.y + 0.5) / 2, 0, 1)) * 0.25;
    targetX += this.rng.gauss(0, error * 0.85);
    targetZ += this.rng.gauss(0, error);
    const target = new THREE.Vector3(targetX, 0.033, targetZ);

    const quality = clamp(1 - stretch * 0.65, 0.48, 0.98);
    const power = 0.86 + quality * 0.16 + (type === 'smash' ? 0.08 : 0);
    const origin = contact.clone();
    origin.y = clamp(origin.y, 0.3, 2.9);
    this.ball.launch(origin, target, type, power);
    this.ball.lastHitter = 'rival';
    this.ball.served = false;
    this.ball.events.length = 0;
    rival.swingCooldown = 0.5;
    rival.character.triggerSwing(type, 'right');
    this.audio.playSwing(type);
    this.audio.playHit(type, quality, -0.15);
    this.effects.spawnContact(origin, SHOTS[type]?.color ?? 0xffd36e, quality * 0.8);
    this.rally += 1;
    this.longestRally = Math.max(this.longestRally, this.rally);
    const speed = this.ball.vel.length();
    this.stats.topSpeed = Math.max(this.stats.topSpeed, speed);
    this.ui.setRally(this.rally);
    this.ui.setTopSpeed(formatSpeed(this.stats.topSpeed));
    this.ui.showHitFeedback({
      rating: type === 'smash' ? 'LAKI SMASH' : type === 'slice' ? 'LAKI SLICE' : 'LAKI RETURNS',
      detail: `${Math.round(speed * 3.6)} KM/H`,
      tone: 'good',
      duration: 850,
    });
    if (this.netMode === 'host') {
      this.pushNetEvent({
        ev: 'hit',
        rating: type === 'smash' ? 'DUKA SMASH' : 'DUKA RETURNS',
        detail: `${Math.round(speed * 3.6)} KM/H`,
        tone: 'good',
      });
    }
  }

  // ───────────────────────── LAN multiplayer ─────────────────────────

  // Host-side: integrate Laki's streamed inputs into the rival entity.
  updateGuestAthlete(dt) {
    const rival = this.rival;
    const g = this.guestInput;
    const canMove =
      this.phase === 'rally' ||
      (this.phase === 'serve' && this.server === 'player');
    let desiredX = 0;
    let desiredZ = 0;
    if (canMove && (g.x || g.z)) {
      // Guest inputs are arena-local (their view is rotated 180°); map to
      // world by negating.
      const speed = g.sprint ? TUNING.playerSprintSpeed : TUNING.playerSpeed;
      // Guest inputs arrive in their arena-local frame (x mirrored, z passes
      // through) — mapping verified against the 180° arena rotation.
      desiredX = -g.x * speed;
      desiredZ = g.z * speed;
    }
    const lambda = (g.x || g.z) ? TUNING.playerAccel : TUNING.playerFriction;
    rival.vel.x = damp(rival.vel.x, desiredX, lambda, dt);
    rival.vel.z = damp(rival.vel.z, desiredZ, lambda, dt);
    rival.pos.x = clamp(rival.pos.x + rival.vel.x * dt, -RIVAL_BOUNDS.x, RIVAL_BOUNDS.x);
    rival.pos.z = clamp(rival.pos.z + rival.vel.z * dt, RIVAL_BOUNDS.zMin, RIVAL_BOUNDS.zMax);

    // Hit requests from Laki: seq numbers make each press fire exactly once.
    while (g.lastHitSeq < g.hitSeq) {
      g.lastHitSeq += 1;
      this.handleGuestHitRequest();
    }
  }

  // Host-side: Laki pressed hit. Serve or strike, validated authoritatively.
  handleGuestHitRequest() {
    if (this.phase === 'serve') {
      if (this.server === 'rival') {
        if (this.serve.state === 'toss') this.executeServe('rival');
        else if (this.serve.state === 'wait') {
          this.startServeToss('rival');
          this.serve.quickServe = 0.28;
        }
      }
      return;
    }
    if (this.phase !== 'rally' || this.ball.mode !== 'flight') return;
    if (this.rival.swingCooldown > 0) return;
    // Lag compensation: validate against the ball Laki saw on his screen,
    // not against where the ball is on the host right now.
    const contact = this.bufferedBallFor(this.guestSnapSq) ?? this.ball.pos.clone();
    if (contact.z > 0.05) return; // ball must be on Laki's side
    const horizontal = horizontalDistance(contact, this.rival.pos);
    const canReach = horizontal <= TUNING.rivalReach + 0.08 && contact.y < 3.45 && contact.y > 0.02;
    if (!canReach) {
      const shot = this.selectShotTypeFor('rival', contact);
      this.rivalCharacter.triggerSwing(shot.type, shot.hand);
      this.rival.swingCooldown = TUNING.swingCooldown * 0.78;
      this.audio.playSwing(shot.type);
      this.pushNetEvent({ ev: 'swme', ty: shot.type, hd: shot.hand });
      return;
    }
    this.guestStrike(contact, horizontal);
  }

  // Shot picker for either athlete (world-role parameterised).
  selectShotTypeFor(role, contact) {
    if (role === 'player') return this.selectShotType(contact);
    const ath = this.rival;
    const height = contact.y;
    const side = -1; // rival attacks +Z
    let type = 'topspin';
    if (height > 2.05 && ath.pos.z > -5.4) type = 'smash';
    else if (ath.pos.z > -4.7 && height > 0.35) type = this.guestAimShort() ? 'drop' : 'volley';
    else if (height < 0.4) type = 'slice';
    else if (side * contact.z > side * ath.pos.z + 0.62 && height < 1.05) type = 'lob';
    const hand = contact.x >= ath.pos.x - 0.08 ? 'forehand' : 'backhand';
    return { type, hand };
  }

  guestAimShort() {
    return this.guestInput.aim.z < 5.8; // Laki aims short on the host half
  }

  // Host-side: Laki's successful hit. Mirrors strikeBall with his aim.
  guestStrike(contact, reach) {
    const rival = this.rival;
    const shot = this.selectShotTypeFor('rival', contact);
    const idealX = rival.pos.x;
    const idealZ = rival.pos.z - 0.55;
    const idealY = shot.type === 'smash' ? 2.2 : shot.type === 'volley' ? 1.2 : shot.type === 'slice' ? 0.55 : 1.0;
    const distance = Math.sqrt(
      (contact.x - idealX) ** 2 * 0.7 +
      (contact.z - idealZ) ** 2 * 0.8 +
      (contact.y - idealY) ** 2 * 0.3
    );
    const quality = clamp(1 - distance / 2.45, 0.22, 1);
    const power = 0.8 + quality * 0.24;

    const target = new THREE.Vector3(
      clamp(this.guestInput.aim.x, -4.2, 4.2),
      0.033,
      clamp(this.guestInput.aim.z, 4.4, 11.2)
    );
    this.applyAutoTargetFor('rival', shot.type, target);
    const pressure = clamp(rival.vel.length() / 6, 0, 1);
    const fatigue = clamp(this.rally / 110, 0, 0.18);
    const errorScale = (1 - quality) * 1.35 + pressure * 0.22 + fatigue;
    if (this.rng.chance(clamp(fatigue * 0.35 + (1 - quality) * 0.06, 0, 0.22))) {
      // Laki's misses go deep/wide on the host half (+Z).
      if (this.rng.chance(0.55)) target.z = this.rng.range(12.15, 13.0);
      else target.x = (target.x >= 0 ? 1 : -1) * this.rng.range(4.4, 5.2);
    }
    target.x += this.rng.gauss(0, errorScale * 0.75);
    target.z += this.rng.gauss(0, errorScale);

    const origin = contact.clone();
    origin.y = clamp(origin.y, 0.32, 2.95);
    this.ball.launch(origin, target, shot.type, power);
    this.ball.lastHitter = 'rival';
    this.ball.served = false;
    this.ball.events.length = 0;

    rival.swingCooldown = TUNING.swingCooldown + 0.12;
    this.rivalCharacter.triggerSwing(shot.type, shot.hand);
    this.pushNetEvent({ ev: 'swme', ty: shot.type, hd: shot.hand });
    this.audio.playSwing(shot.type);
    this.audio.playHit(shot.type, quality, clamp((-origin.x) / 4, -0.7, 0.7));
    this.effects.spawnContact(origin, SHOTS[shot.type]?.color ?? 0xffd36e, quality);

    this.rally += 1;
    this.longestRally = Math.max(this.longestRally, this.rally);
    this.stats.autoShots += 1;
    const speedKmh = Math.round(this.ball.vel.length() * 3.6);
    this.stats.topSpeed = Math.max(this.stats.topSpeed, this.ball.vel.length());
    if (quality >= 0.82) {
      this.stats.perfects += 1;
      this.hitstop = TUNING.hitstopPerfect;
    } else {
      this.hitstop = Math.max(this.hitstop, TUNING.hitstopNormal);
    }
    this.player.reactionTimer = 0;
    this.ui.setRally(this.rally);
    this.ui.setTopSpeed(formatSpeed(this.stats.topSpeed));
    const rating = quality >= 0.82 ? 'PERFECT' : quality < 0.5 ? 'STRETCH' : 'GOOD';
    this.pushNetEvent({
      ev: 'hit',
      rating,
      detail: `${SHOTS[shot.type].label} · ${speedKmh} KM/H`,
      tone: rating === 'PERFECT' ? 'perfect' : rating === 'GOOD' ? 'good' : 'poor',
    });
    this.pushNetEvent({ ev: 'shot', shot: shot.type, hand: shot.hand });
  }

  applyAutoTargetFor(role, shotType, target) {
    if (role === 'player') return this.applyAutoTarget(shotType, target);
    // Laki attacks +Z: same tuned depth ranges, mirrored sign.
    switch (shotType) {
      case 'smash': target.z = clamp(target.z, 4.1, 9.3); break;
      case 'volley': target.z = clamp(target.z, 3.5, 9.2); break;
      case 'drop':
        target.z = clamp(target.z, 3.0, 5.8);
        target.x = clamp(target.x, -3.6, 3.6);
        break;
      case 'lob':
        target.z = clamp(Math.max(target.z, 10.2), 10.0, 11.25);
        target.x *= 0.62;
        break;
      case 'slice': target.z = clamp(target.z, 5.2, 10.6); break;
      case 'drive': target.z = clamp(target.z, 7.2, 10.9); break;
      default: target.z = clamp(target.z, 4.4, 11.2); break;
    }
    return target;
  }

  pushNetEvent(ev) {
    if (this.netMode !== 'host') return;
    this.remoteEvents.push(ev);
    if (this.remoteEvents.length > 24) this.remoteEvents.shift();
  }

  // Host → guest snapshot, ~20 Hz.
  sendNetSnapshot() {
    if (this.netMode !== 'host' || !this.net.inRoom) return;
    const labels = this.scoreLabels();
    const sq = ++this.snapSeq;
    // Keep recent ball states so Laki's hit requests can be validated against
    // what he actually saw — essential over Vietnam ↔ Serbia latency.
    this.snapHistory.push({
      sq,
      x: this.ball.pos.x,
      y: this.ball.pos.y,
      z: this.ball.pos.z,
      mode: this.ball.mode,
    });
    if (this.snapHistory.length > 40) this.snapHistory.shift();
    this.net.sendSnap({
      ph: this.phase,
      sv: this.server,
      ss: this.serve.state,
      sc: [this.score.player, this.score.rival],
      lb: [labels.player, labels.rival, labels.meta],
      ra: this.rally,
      mp: this.matchPoint,
      mw: this.matchWinner,
      b: {
        x: +this.ball.pos.x.toFixed(3),
        y: +this.ball.pos.y.toFixed(3),
        z: +this.ball.pos.z.toFixed(3),
        m: this.ball.mode,
        c: SHOTS[this.ball.shotType]?.color ?? '#ffd36e',
        l: this.ball.lastHitter,
      },
      p: { x: +this.player.pos.x.toFixed(3), z: +this.player.pos.z.toFixed(3) },
      r: { x: +this.rival.pos.x.toFixed(3), z: +this.rival.pos.z.toFixed(3) },
      sq,
      ev: this.remoteEvents.splice(0, this.remoteEvents.length),
    });
  }

  // Ball state as of the newest snapshot Laki had on screen when he hit.
  bufferedBallFor(sq) {
    let best = null;
    for (const entry of this.snapHistory) {
      if (entry.sq <= sq) best = entry;
    }
    if (!best || this.snapSeq - best.sq > 40) return null;
    return new THREE.Vector3(best.x, best.y, best.z);
  }

  // ───────────────────────── movement & animation ─────────────────────────

  updatePlayerMovement(dt) {
    if (this.netMode === 'guest') {
      // Host simulates Laki's athlete; locally we only track aim so the
      // reticle/camera stay instant.
      this.player.vel.set(0, 0, 0);
      if (this.keys.has('arrowleft')) this.aimYaw -= 1.1 * dt;
      if (this.keys.has('arrowright')) this.aimYaw += 1.1 * dt;
      if (this.keys.has('arrowup')) this.aimPitch += 0.55 * dt;
      if (this.keys.has('arrowdown')) this.aimPitch -= 0.55 * dt;
      this.aimYaw = clamp(this.aimYaw, AIM.minYaw, AIM.maxYaw);
      this.aimPitch = clamp(this.aimPitch, AIM.minPitch, AIM.maxPitch);
      return;
    }
    if (this.phase === 'intro') {
      this.player.vel.multiplyScalar(Math.exp(-8 * dt));
      return;
    }
    const canMove =
      this.phase === 'rally' ||
      (this.phase === 'serve' && this.server === 'rival') ||
      (this.phase === 'point' && false);
    if (!canMove) {
      this.player.vel.x = damp(this.player.vel.x, 0, 14, dt);
      this.player.vel.z = damp(this.player.vel.z, 0, 14, dt);
      this.player.pos.x += this.player.vel.x * dt;
      this.player.pos.z += this.player.vel.z * dt;
      return;
    }

    let ix = 0;
    let iz = 0;
    if (this.keys.has('a')) ix -= 1;
    if (this.keys.has('d')) ix += 1;
    if (this.keys.has('w')) iz += 1;
    if (this.keys.has('s')) iz -= 1;
    if (this.joystick.active) {
      ix += this.joystick.x;
      iz += this.joystick.z;
    }
    if (this.keys.has('arrowleft')) this.aimYaw -= 1.1 * dt;
    if (this.keys.has('arrowright')) this.aimYaw += 1.1 * dt;
    if (this.keys.has('arrowup')) this.aimPitch += 0.55 * dt;
    if (this.keys.has('arrowdown')) this.aimPitch -= 0.55 * dt;
    this.aimYaw = clamp(this.aimYaw, AIM.minYaw, AIM.maxYaw);
    this.aimPitch = clamp(this.aimPitch, AIM.minPitch, AIM.maxPitch);

    const length = Math.hypot(ix, iz);
    if (length > 1) {
      ix /= length;
      iz /= length;
    }
    const forward = new THREE.Vector3(Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
    const right = new THREE.Vector3(Math.cos(this.aimYaw), 0, Math.sin(this.aimYaw));
    const desired = new THREE.Vector3()
      .addScaledVector(right, ix)
      .addScaledVector(forward, iz);
    let speed = this.keys.has('shift') ? TUNING.playerSprintSpeed : TUNING.playerSpeed;
    if (this.focusing) speed *= 0.55;
    desired.multiplyScalar(speed);

    const lambda = length > 0.01 ? TUNING.playerAccel : TUNING.playerFriction;
    this.player.vel.x = damp(this.player.vel.x, desired.x, lambda, dt);
    this.player.vel.z = damp(this.player.vel.z, desired.z, lambda, dt);
    this.player.pos.x += this.player.vel.x * dt;
    this.player.pos.z += this.player.vel.z * dt;
    this.player.pos.x = clamp(this.player.pos.x, -PLAYER_BOUNDS.x, PLAYER_BOUNDS.x);
    this.player.pos.z = clamp(this.player.pos.z, PLAYER_BOUNDS.zMin, PLAYER_BOUNDS.zMax);
    if (Math.abs(this.player.pos.x) >= PLAYER_BOUNDS.x) this.player.vel.x = 0;
    if (this.player.pos.z >= PLAYER_BOUNDS.zMax || this.player.pos.z <= PLAYER_BOUNDS.zMin) {
      this.player.vel.z = 0;
    }

    this.footstepTimer -= dt;
    const speedNow = Math.hypot(this.player.vel.x, this.player.vel.z);
    if (speedNow > 1.2 && this.footstepTimer <= 0) {
      this.audio.playFootstep();
      this.footstepTimer = clamp(0.42 - speedNow * 0.025, 0.2, 0.4);
    }
  }

  // Which side the incoming ball is on — drives the readiness stance and the
  // HUD forehand/backhand cue.
  getIncomingHand() {
    const b = this.ball;
    if (!b || b.mode !== 'flight' || this.phase !== 'rally') return null;
    if (b.pos.z < 0.15 || b.pos.z > 13) return null;
    if (horizontalDistance(b.pos, this.player.pos) > 8) return null;
    return b.pos.x >= this.player.pos.x ? 'forehand' : 'backhand';
  }

  updateCharacters(dt, playerSpeed, rivalSpeed) {
    const incomingHand = this.getIncomingHand();
    const playerFacing = -this.aimYaw;
    const targetYaw = playerFacing;
    this.playerCharacter.root.rotation.y = damp(
      this.playerCharacter.root.rotation.y,
      targetYaw,
      16,
      dt
    );
    this.playerCharacter.root.position.copy(this.player.pos);

    const forwardP = new THREE.Vector3(Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
    const rightP = new THREE.Vector3(Math.cos(this.aimYaw), 0, Math.sin(this.aimYaw));
    const localMoveP = {
      x: this.player.vel.dot(rightP) / Math.max(TUNING.playerSpeed, 0.001),
      z: this.player.vel.dot(forwardP) / Math.max(TUNING.playerSpeed, 0.001),
    };
    this.playerCharacter.update(dt, {
      speed: playerSpeed,
      maxSpeed: TUNING.playerSprintSpeed,
      localMove: localMoveP,
      readyHand: incomingHand,
    });

    const rivalFacing = Math.PI;
    this.rivalCharacter.root.rotation.y = damp(
      this.rivalCharacter.root.rotation.y,
      rivalFacing,
      10,
      dt
    );
    this.rivalCharacter.root.position.copy(this.rival.pos);
    const forwardR = new THREE.Vector3(0, 0, 1);
    const rightR = new THREE.Vector3(-1, 0, 0);
    const localMoveR = {
      x: this.rival.vel.dot(rightR) / Math.max(TUNING.rivalSpeed, 0.001),
      z: this.rival.vel.dot(forwardR) / Math.max(TUNING.rivalSpeed, 0.001),
    };
    const rivalHand = (() => {
      const b = this.ball;
      if (!b || b.mode !== 'flight' || this.phase !== 'rally' || b.pos.z > -0.15) return null;
      if (horizontalDistance(b.pos, this.rival.pos) > 8) return null;
      // mirrored viewpoint: ball on world-left is a forehand for the rival
      return b.pos.x <= this.rival.pos.x ? 'forehand' : 'backhand';
    })();
    this.rivalCharacter.update(dt, {
      speed: rivalSpeed,
      maxSpeed: TUNING.rivalSpeed,
      localMove: localMoveR,
      readyHand: rivalHand,
    });

    // Keep the ball shadow out of weird states during the title screen.
    this.playerCharacter.shadow.visible = this.phase !== 'title';
    this.rivalCharacter.shadow.visible = this.phase !== 'title';
  }

  // ───────────────────────── ball events & scoring ─────────────────────────

  processBallEvents() {
    if (this.phase !== 'rally') {
      this.ball.events.length = 0;
      return;
    }
    const events = this.ball.events.splice(0, this.ball.events.length);
    for (const event of events) {
      if (this.phase !== 'rally') break;
      if (event.kind === 'net') {
        this.effects.spawnNet(event.position);
        this.audio.playNet();
        const hitter = event.hitter ?? this.ball.lastHitter;
        const winner = hitter === 'player' ? 'rival' : 'player';
        this.awardPoint(winner, hitter === 'player' ? 'INTO THE NET' : 'LAKI NETS IT');
        break;
      }
      if (event.kind === 'bounce') {
        const hitter = this.ball.lastHitter;
        const receiver = hitter === 'player' ? 'rival' : 'player';
        if (event.index === 0) {
          if (event.side !== event.expectedSide) {
            this.awardPoint(receiver, hitter === 'player' ? 'OUT OF BOUNDS' : 'LAKI HITS OUT');
            break;
          }
          if (!event.inBounds) {
            this.awardPoint(receiver, hitter === 'player' ? 'OUT OF BOUNDS' : 'LAKI HITS OUT');
            break;
          }
          if (event.served && !event.serveIn) {
            this.awardPoint(receiver, 'SERVE FAULT');
            break;
          }
          this.effects.spawnBounce(
            event.position,
            hitter === 'player' ? SHOTS[this.ball.shotType]?.color ?? 0xffd36e : 0xffb15f,
            clamp(event.speed / 22, 0.35, 1.4)
          );
          this.audio.playBounce(event.speed, clamp(event.x / 8, -0.8, 0.8));
        } else if (event.index >= 1) {
          const winner = hitter;
          this.effects.spawnBounce(event.position, 0xffd36e, 0.7);
          this.audio.playBounce(event.speed, clamp(event.x / 8, -0.8, 0.8));
          this.awardPoint(winner, winner === 'player' ? 'WINNER' : (receiver === 'player' ? 'MISSED RETURN' : 'LAKI WINS THE RALLY'));
          break;
        }
      }
    }
  }

  // ───────────────────────── point replay (slow motion) ─────────────────────────

  recordReplayFrame() {
    if (!['rally', 'serve'].includes(this.phase)) return;
    const t = this.elapsed;
    const last = this.recordBuffer[this.recordBuffer.length - 1];
    if (last && t - last.t < 0.016) return;
    this.recordBuffer.push({
      t,
      bx: this.ball.pos.x, by: this.ball.pos.y, bz: this.ball.pos.z,
      px: this.player.pos.x, pz: this.player.pos.z,
      rx: this.rival.pos.x, rz: this.rival.pos.z,
      mode: this.ball.mode,
    });
    if (this.recordBuffer.length > 260) this.recordBuffer.shift();
  }

  startReplayOrPresent() {
    const window = 1.05; // seconds of footage before the point ended
    const cutoff = this.elapsed - window;
    const frames = this.recordBuffer.filter((f) => f.t >= cutoff);
    if (frames.length >= 14 && !this.screenshotPaused) {
      this.replay = { frames, clock: 0, speed: 0.34 };
      this.ui.hidePointBanner();
      this.ui.hideCountdown();
      this.ui.showReplay();
      this.aimMarker.visible = false;
      this.bounceMarker.visible = false;
      this.arcPreview.visible = false;
      if (this.netMode === 'host') this.pushNetEvent({ ev: 'slowmo' });
      if (this.netMode === 'guest') this.ui.showReplay();
      this.audio.playSwing('smash');
    } else {
      this.presentPoint();
    }
  }

  updateReplay(dt) {
    const r = this.replay;
    this.aimMarker.visible = false;
    this.bounceMarker.visible = false;
    this.arcPreview.visible = false;
    const frames = r.frames;
    r.clock += dt * r.speed;
    const t0 = frames[0].t;
    const target = t0 + r.clock;
    let i = 0;
    while (i < frames.length - 2 && frames[i + 1].t < target) i += 1;
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];
    const span = Math.max(0.0001, b.t - a.t);
    const k = clamp((target - a.t) / span, 0, 1);
    const lerpV = (va, vb) => va + (vb - va) * k;

    this.ball.pos.set(lerpV(a.bx, b.bx), lerpV(a.by, b.by), lerpV(a.bz, b.bz));
    this.ball.mesh.position.copy(this.ball.pos);
    this.ball.mesh.visible = true;
    if (this.ball.glow) {
      this.ball.glow.visible = true;
      this.ball.glow.position.copy(this.ball.pos);
    }
    this.ball.shadow.visible = true;
    this.ball.shadow.position.set(this.ball.pos.x, 0.014, this.ball.pos.z);
    this.ball.rim.visible = true;
    this.ball.rim.position.copy(this.ball.pos);

    this.player.pos.set(lerpV(a.px, b.px), 0, lerpV(a.pz, b.pz));
    this.rival.pos.set(lerpV(a.rx, b.rx), 0, lerpV(a.rz, b.rz));
    this.playerCharacter.root.position.copy(this.player.pos);
    this.rivalCharacter.root.position.copy(this.rival.pos);
    this.playerCharacter.update(dt, { speed: 0, maxSpeed: TUNING.playerSpeed });
    this.rivalCharacter.update(dt, { speed: 0, maxSpeed: TUNING.rivalSpeed });

    if (r.clock >= frames[frames.length - 1].t - t0) {
      this.replay = null;
      this.ui.hideReplay();
      this.presentPoint();
    }
  }

  updateReplayCamera(dt) {
    // Slow broadcast angle: side-on, tracking the ball.
    const focus = new THREE.Vector3(
      this.ball.pos.x * 0.6 + this.player.pos.x * 0.4,
      1.05,
      this.ball.pos.z * 0.6 + this.player.pos.z * 0.4
    );
    const desired = new THREE.Vector3(
      this.player.pos.x + 3.9,
      3.05,
      this.player.pos.z + 4.9
    );
    this.camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
    this.camera.lookAt(focus);
    this.currentFov = damp(this.currentFov, 52, 5, dt);
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
  }

  presentPoint() {
    const info = this.pendingPoint;
    if (!info) return;
    this.pendingPoint = null;
    const { playerWon, reason, winner } = info;
    this.pointTimer = TUNING.pointBannerTime;
    this.ui.showPointBanner({
      kicker: playerWon ? 'POINT · DUKA' : 'POINT · LAKI',
      title: playerWon ? 'DUKA' : 'LAKI',
      reason: String(reason).toUpperCase(),
      tone: playerWon ? 'player' : 'rival',
    });
    if (this.netMode === 'host') {
      this.pushNetEvent({
        ev: 'point',
        kicker: playerWon ? 'POINT · DUKA' : 'POINT · YOU',
        title: playerWon ? 'DUKA' : 'YOU',
        reason: String(reason).toUpperCase(),
        tone: playerWon ? 'player' : 'rival',
        winner,
      });
    }
    this.ui.flashPoint();
    this.audio.playPoint(winner);
    this.world.cheer(playerWon ? 1 : 0.55);
    this.ui.showHitFeedback({
      rating: playerWon ? 'POINT DUKA' : 'POINT LAKI',
      detail: reason,
      tone: playerWon ? 'perfect' : 'poor',
      duration: 1200,
    });
  }

  awardPoint(winner, reason) {
    if (this.phase !== 'rally' && this.phase !== 'serve') return;
    if (winner !== 'player' && winner !== 'rival') return;
    this.lastPointReason = reason;
    if (winner === 'player') {
      this.score.player += 1;
      this.stats.pointsWon += 1;
      if (reason === 'WINNER') this.stats.winners += 1;
    } else {
      this.score.rival += 1;
    }
    this.totalPoints += 1;
    this.stats.totalPoints = this.totalPoints;
    const playerWon = winner === 'player';
    const matchWon = this.isMatchWon();
    this.phase = 'point';
    this.pendingSwing = null;
    this.pointTimer = TUNING.pointBannerTime;
    this.player.vel.set(0, 0, 0);
    this.rival.vel.set(0, 0, 0);
    this.hitstop = 0;
    this.ui.setPrompt(playerWon ? 'NICE POINT' : 'STAY IN THE RALLY', playerWon ? 'ready' : 'warning');
    this.ui.setRally(this.rally);
    this.pendingPoint = { winner, reason, playerWon, matchWon };
    this.startReplayOrPresent();
    this.matchPoint = !matchWon && this.wouldWinNextPoint();
    this.updateScoreHud();
    this.world.setScoreboard({
      playerPoints: this.scoreLabels().player,
      rivalPoints: this.scoreLabels().rival,
      label: this.scoreMetaLine(),
      detail: matchWon ? 'MATCH COMPLETE' : `RALLY ${this.rally}`,
      serving: playerWon ? 'player' : 'rival',
    });
    if (matchWon) {
      this.matchWinner = winner;
    }
  }

  updatePoint(dt) {
    if (this.replay) {
      this.updateReplay(dt);
      return true;
    }
    this.pointTimer -= dt;
    this.rival.reactionTimer = 0;
    this.updateRival(dt);
    this.updateCharacters(dt, 0, 0);
    if (this.pointTimer <= 0) {
      if (this.matchWinner) {
        this.finishMatch(this.matchWinner);
      } else {
        const nextServer = Math.floor(this.totalPoints / 2) % 2 === 0 ? 'player' : 'rival';
        this.beginServe(nextServer);
      }
    }
    return false;
  }

  finishMatch(winner) {
    this.phase = 'over';
    this.matchWinner = winner;
    this.endTimer = 0.85;
    this.resultsShown = false;
    this.audio.playMatch(winner === 'player');
    this.ui.hideBanners();
    this.ui.setPrompt(winner === 'player' ? 'MATCH WON' : 'MATCH LOST');
    this.player.character.triggerReaction(winner === 'player' ? 'win' : 'lose');
    this.rival.character.triggerReaction(winner === 'player' ? 'lose' : 'win');
    document.exitPointerLock?.();
  }

  updateOver(dt) {
    this.endTimer -= dt;
    this.updateCharacters(dt, 0, 0);
    if (!this.resultsShown && this.endTimer <= 0) {
      this.resultsShown = true;
      const win = this.matchWinner === 'player';
      this.ui.showHud(false);
      if (this.netMode === 'host') {
        this.pushNetEvent({
          ev: 'results',
          win,
          line: win
            ? 'You held center court. The sunset belongs to Laki… for Duka.'
            : 'Laki takes the tiebreak. Replay the rally, not the scoreboard.',
          score: `${this.score.player} — ${this.score.rival}`,
          points: this.stats.pointsWon,
          topSpeed: formatSpeed(this.stats.topSpeed),
          longestRally: this.longestRally,
          perfects: this.stats.perfects,
          foot: `AUTO-SHOT SYSTEM · ${this.stats.autoShots} SHOTS CHOSEN · ${this.stats.winners} WINNERS`,
        });
      }
      this.ui.showResults({
        win,
        line: win
          ? 'You held center court. The sunset belongs to Jax.'
          : 'Riko takes the tiebreak. Replay the rally, not the scoreboard.',
        score: `${this.score.player} — ${this.score.rival}`,
        points: this.stats.pointsWon,
        topSpeed: formatSpeed(this.stats.topSpeed),
        longestRally: this.longestRally,
        perfects: this.stats.perfects,
        foot: `AUTO-SHOT SYSTEM · ${this.stats.autoShots} SHOTS CHOSEN · ${this.stats.winners} WINNERS`,
      });
    }
  }

  isMatchWon() {
    const { player, rival } = this.score;
    return (player >= 4 && player - rival >= 2) || (rival >= 4 && rival - player >= 2);
  }

  wouldWinNextPoint() {
    const p = this.score.player;
    const r = this.score.rival;
    return (p + 1 >= 4 && p + 1 - r >= 2) || (r + 1 >= 4 && r + 1 - p >= 2);
  }

  scoreLabels() {
    const p = this.score.player;
    const r = this.score.rival;
    if (p >= 3 && r >= 3) {
      if (p === r) return { player: '40', rival: '40', meta: 'DEUCE' };
      if (p === r + 1) return { player: 'AD', rival: '40', meta: 'ADVANTAGE DUKA' };
      if (r === p + 1) return { player: '40', rival: 'AD', meta: 'ADVANTAGE LAKI' };
      return { player: SCORE_LABELS[Math.min(p, 3)], rival: SCORE_LABELS[Math.min(r, 3)], meta: 'FIRST TO 4' };
    }
    return {
      player: SCORE_LABELS[Math.min(p, 3)],
      rival: SCORE_LABELS[Math.min(r, 3)],
      meta: this.totalPoints === 0 ? 'FIRST TO 4' : 'RACE TO 4',
    };
  }

  scoreMetaLine() {
    const labels = this.scoreLabels();
    if (this.matchWinner) return 'MATCH COMPLETE';
    if (labels.meta === 'DEUCE') return 'DEUCE';
    if (labels.meta.startsWith('ADVANTAGE')) return labels.meta;
    if (this.wouldWinNextPoint() && (this.score.player > 2 || this.score.rival > 2)) return 'MATCH POINT';
    return labels.meta;
  }

  updateScoreHud() {
    const labels = this.scoreLabels();
    const meta = this.scoreMetaLine();
    this.matchPoint = !this.matchWinner && this.wouldWinNextPoint();
    const guest = this.netMode === 'guest';
    // Guest display flips so "me" (LAKI) sits on the left.
    this.ui.setScore({
      player: guest ? labels.rival : labels.player,
      rival: guest ? labels.player : labels.rival,
      names: guest ? ['LAKI', 'DUKA'] : ['DUKA', 'LAKI'],
      meta,
      matchLabel: 'TIEBREAK · FIRST TO 4',
      serving: this.phase === 'serve' || this.phase === 'rally' || this.phase === 'point'
        ? (guest ? (this.server === 'rival' ? 'player' : 'rival') : this.server)
        : null,
      matchPoint: this.matchPoint,
    });
    this.ui.setPlayerPanel(guest ? 'LAKI' : 'DUKA', guest ? 'LA' : 'DU');
  }

  // ───────────────────────── camera & aim ─────────────────────────

  cameraPose() {
    const portrait = this.camera.aspect < 0.95;
    const focus = this.focusing && this.phase === 'rally';
    const dist = TUNING.cameraDistance * (focus ? 0.8 : 1) + (portrait ? 0.8 : 0);
    const height = TUNING.cameraHeight + (portrait ? 0.38 : 0) + (focus ? 0.05 : 0);
    const shoulder = (focus ? 0.74 : TUNING.cameraShoulder) + (portrait ? -0.18 : 0);
    const forward = new THREE.Vector3(Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
    const right = new THREE.Vector3(Math.cos(this.aimYaw), 0, Math.sin(this.aimYaw));
    return new THREE.Vector3()
      .copy(this.player.pos)
      .add(new THREE.Vector3(0, height, 0))
      .addScaledVector(forward, -dist)
      .addScaledVector(right, shoulder);
  }

  aimDirection() {
    const cp = Math.cos(this.aimPitch);
    return new THREE.Vector3(
      Math.sin(this.aimYaw) * cp,
      Math.sin(this.aimPitch),
      -Math.cos(this.aimYaw) * cp
    ).normalize();
  }

  computeAimPoint(cameraPosition = this.camera.position) {
    const direction = this.aimDirection();
    if (direction.y >= -0.018) {
      return new THREE.Vector3(0, 0.033, -5.4);
    }
    const t = (0.033 - cameraPosition.y) / direction.y;
    const x = clamp(cameraPosition.x + direction.x * t, AIM.targetMinX, AIM.targetMaxX);
    const z = clamp(cameraPosition.z + direction.z * t, AIM.targetMinZ, AIM.targetMaxZ);
    return new THREE.Vector3(x, 0.033, z);
  }

  getServeAimTarget() {
    if (this.server === 'player') {
      const x = clamp(this.aimPoint.x * 0.85, -3.35, 3.35);
      return new THREE.Vector3(x, 0.033, -5.35);
    }
    // Rival (LAN guest) serves toward the host half.
    const wide = this.player.pos.x > 0.2 ? -1 : 1;
    return new THREE.Vector3(wide * 2.4, 0.033, 5.3);
  }

  updateCamera(dt, immediate = false) {
    if (this.phase === 'title') {
      this.titleTime += dt;
      const t = this.titleTime;
      const drift = Math.sin(t * 0.07) * 1.15;
      const target = new THREE.Vector3(-1.2, 1.25, -3.4);
      const desired = new THREE.Vector3(
        7.9 + drift,
        4.25 + Math.sin(t * 0.11) * 0.18,
        16.4 + Math.cos(t * 0.05) * 0.45
      );
      if (immediate) this.camera.position.copy(desired);
      else this.camera.position.lerp(desired, 1 - Math.exp(-4.5 * dt));
      this.camera.lookAt(target);
      this.currentFov = immediate ? 52 : damp(this.currentFov, 52, 5, dt);
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
      return;
    }

    if (this.replay) {
      this.updateReplayCamera(dt);
      if (this.effects) this.effects.applyCameraShake(this.camera);
      return;
    }

    // Pose/direction are computed in arena-local space; on a guest machine the
    // arena is rotated 180°, so convert to world for the scene-space camera.
    const localPose = this.cameraPose();
    const localDir = this.aimDirection();
    let desired = localPose;
    let direction = localDir;
    if (this.netMode === 'guest') {
      desired = new THREE.Vector3(-localPose.x, localPose.y, -localPose.z);
      direction = new THREE.Vector3(-localDir.x, localDir.y, -localDir.z);
    }
    if (immediate) this.camera.position.copy(desired);
    else this.camera.position.lerp(desired, 1 - Math.exp(-12 * dt));
    this.camera.position.y = Math.max(this.camera.position.y, 0.7);

    const lookAt = this.camera.position.clone().addScaledVector(direction, 32);
    this.camera.lookAt(lookAt);

    // Aim ray in arena-local space (the coordinate system hits/limits use).
    this.aimPoint.copy(this.computeAimPoint(localPose));

    const focus = this.focusing && this.phase === 'rally';
    const sprinting = this.keys.has('shift') && Math.hypot(this.player.vel.x, this.player.vel.z) > 4;
    const baseFov = (this.camera.aspect < 0.95 ? 76 : TUNING.cameraFov) - (focus ? 10 : 0) + (sprinting ? 1.6 : 0);
    this.currentFov = immediate ? baseFov : damp(this.currentFov, baseFov, 8, dt);
    this.camera.fov = this.currentFov + (this.reducedMotion ? 0 : this.effects?.fovPunch || 0);
    this.camera.updateProjectionMatrix();

    if (this.effects) this.effects.applyCameraShake(this.camera);

    if (this.phase === 'point') {
      this.camera.position.y += Math.sin(this.elapsed * 1.8) * 0.005;
    }
  }

  snapCamera(immediate = false) {
    if (!this.camera) return;
    if (this.phase === 'title') {
      this.updateCamera(0.016, true);
      return;
    }
    this.updateCamera(0.016, true);
  }

  updateAimVisuals(time) {
    if (!this.aimMarker) return;
    const active = this.phase === 'serve' || this.phase === 'rally';
    this.aimMarker.visible = active;
    this.bounceMarker.visible = false;
    this.arcPreview.visible = false;
    if (!active) return;

    let type = 'topspin';
    let markerTarget = this.aimPoint.clone();
    if (this.phase === 'serve' && this.server === 'player') {
      type = 'serve';
      markerTarget.copy(this.getServeAimTarget());
    } else {
      const preview = this.predictShotType();
      type = preview.type;
      markerTarget = this.applyAutoTarget(type, this.aimPoint.clone());
    }
    this.effectiveTarget.copy(markerTarget);

    const color = SHOTS[type]?.color ?? '#ffd36e';
    for (const material of this.aimMarkerMaterials) {
      material.color.set(color);
      material.opacity = type === 'serve' ? 0.72 : 0.78 + Math.sin(time * 3.4) * 0.12;
    }
    this.aimMarker.position.set(markerTarget.x, 0, markerTarget.z);
    const pulse = 1 + Math.sin(time * 3.2) * 0.035;
    this.aimMarker.scale.setScalar(pulse);
    this.aimMarker.rotation.y = time * 0.45;

    // Predicted first bounce for an incoming opponent shot.
    if (
      this.phase === 'rally' &&
      this.ball.mode === 'flight' &&
      this.ball.lastHitter === 'rival' &&
      this.ball.bounces === 0
    ) {
      const landing = this.ball.predictLanding();
      if (landing && landing.z > 0.25 && landing.z < COURT.baseline + 3.2) {
        this.bounceMarker.visible = true;
        this.bounceMarker.position.set(landing.x, 0, landing.z);
        const inCourt = Math.abs(landing.x) <= COURT.singlesHalf && landing.z <= COURT.baseline;
        for (const material of this.bounceMarkerMaterials) {
          material.color.set(inCourt ? 0xffb15f : 0xff5e4d);
          material.opacity = 0.55 + Math.sin(time * 6) * 0.15;
        }
        this.bounceMarker.rotation.y = -time * 1.4;
        const scale = 1 + Math.sin(time * 5.2) * 0.04;
        this.bounceMarker.scale.setScalar(scale);
      }
    }

    // Trajectory preview: only once the incoming ball is near the player.
    if (
      this.phase === 'rally' &&
      this.ball.mode === 'flight' &&
      this.ball.lastHitter === 'rival' &&
      this.ball.pos.z > 1.2 &&
      horizontalDistance(this.ball.pos, this.player.pos) < 10.5 &&
      this.arcPreview.material.opacity > 0
    ) {
      this.updateArcPreview(type, markerTarget);
    }
  }

  updateArcPreview(type, target) {
    const origin = new THREE.Vector3(
      this.player.pos.x,
      1.02,
      this.player.pos.z
    );
    const trajectory = solveTrajectory(origin, target, type, 1);
    const count = 34;
    let total = 0;
    let prev = null;
    for (let i = 0; i < count; i += 1) {
      const t = (i / (count - 1)) * trajectory.flightTime;
      const x = origin.x + trajectory.velocity.x * t;
      const y = origin.y + trajectory.velocity.y * t - 0.5 * GRAVITY * t * t;
      const z = origin.z + trajectory.velocity.z * t;
      this.arcPositions[i * 3] = x;
      this.arcPositions[i * 3 + 1] = Math.max(0.035, y);
      this.arcPositions[i * 3 + 2] = z;
      const current = new THREE.Vector3(x, y, z);
      if (prev) total += current.distanceTo(prev);
      prev = current;
    }
    this.arcPreview.geometry.attributes.position.needsUpdate = true;
    this.arcPreview.geometry.setDrawRange(0, count);
    this.arcPreview.computeLineDistances();
    this.arcPreview.material.color.set(SHOTS[type]?.color ?? '#ffd36e');
    this.arcPreview.material.opacity = 0.48;
    this.arcPreview.visible = true;
  }

  predictShotType(contact = this.ball.pos) {
    if (this.phase === 'serve') {
      return { type: 'serve', hand: 'forehand' };
    }
    const height = contact.y;
    let type = 'topspin';
    if (height > 2.08 && this.player.pos.z < 7.3) type = 'smash';
    else if (this.player.pos.z < 5.4 && height > 0.35) type = 'drop';
    else if (height < 0.38) type = 'slice';
    else if (contact.z > this.player.pos.z + 0.62 && height < 1.05) type = 'lob';
    else if (this.aimPoint.z < -9.6 && height > 1.3) type = 'drive';
    const hand = contact.x >= this.player.pos.x - 0.08 ? 'forehand' : 'backhand';
    return { type, hand };
  }

  updateHud(dt) {
    if (this.phase === 'title' || this.phase === 'over') {
      this.ui.setOffscreenMarker(false);
      return;
    }
    if (this.replay) {
      this.ui.setOffscreenMarker(false);
      this.ui.setPrompt('SLOW MOTION', 'neutral');
      return;
    }
    const prediction = this.predictShotType();
    const hitInfo = this.getHitInfo();
    this.ui.setAim({
      shot: SHOTS[prediction.type]?.label ?? 'TOPSPIN',
      hand: prediction.type === 'serve' ? '' : prediction.hand === 'backhand' ? 'BACKHAND' : 'FOREHAND',
      ready: hitInfo.ready,
      danger: false,
      readiness: hitInfo.readiness,
    });

    let prompt = '';
    let tone = 'neutral';
    if (this.phase === 'intro') {
      prompt = 'MATCH STARTING';
    } else if (this.phase === 'serve') {
      const myServe = this.server === this.myRole;
      if (myServe) {
        prompt = this.serve.state === 'toss'
          ? (this.mobile ? 'TAP TO SERVE' : 'CLICK TO SERVE')
          : 'YOUR SERVE';
        tone = this.serve.state === 'toss' ? 'ready' : 'neutral';
      } else {
        prompt = this.netMode === 'guest' ? 'DUKA SERVING' : 'LAKI SERVING';
      }
    } else if (this.phase === 'rally') {
      if (this.ball.lastHitter !== this.myRole && this.ball.mode === 'flight') {
        if (hitInfo.ready) {
          prompt = this.mobile ? 'TAP TO HIT' : 'CLICK TO HIT';
          tone = 'ready';
        } else if (this.ball.pos.z > 0) {
          prompt = 'MOVE TO THE BALL';
        } else {
          prompt = 'TRACK THE BALL';
        }
      } else if (this.ball.lastHitter === this.myRole) {
        prompt = 'RECOVER TO CENTER';
      } else {
        prompt = 'GET READY';
      }
    } else if (this.phase === 'point') {
      prompt = this.matchWinner ? 'MATCH COMPLETE' : 'NEXT POINT';
    }
    this.ui.setPrompt(prompt, tone);

    const offscreen = this.isBallOffscreen();
    this.ui.setOffscreenMarker(offscreen && ['rally', 'serve'].includes(this.phase));

    if (this.phase === 'rally' || this.phase === 'serve') {
      this.updateAimVisuals(this.elapsed);
    } else {
      this.aimMarker.visible = false;
      this.bounceMarker.visible = false;
      this.arcPreview.visible = false;
    }
  }

  getHitInfo() {
    if (this.phase !== 'rally' || !this.ball || this.ball.mode !== 'flight') {
      return { ready: false, readiness: 0, distance: 999 };
    }
    if (this.player.swingCooldown > 0) {
      return { ready: false, readiness: 0.3, distance: 999 };
    }
    if (this.ball.pos.z < -0.05 || this.ball.pos.y > 3.45 || this.ball.pos.y < 0.015) {
      return { ready: false, readiness: 0, distance: 999 };
    }
    const distance = horizontalDistance(this.ball.pos, this.player.pos);
    const ready = distance <= TUNING.playerReach;
    const readiness = clamp(1 - Math.max(0, distance - 0.55) / 3.0, 0.04, 1);
    return { ready, readiness, distance };
  }

  isBallOffscreen() {
    if (!this.ball || !this.ball.mesh.visible) return false;
    const point = this.ball.pos.clone();
    const local = point.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if (local.z > -0.1) return true;
    const projected = point.clone().project(this.camera);
    return Math.abs(projected.x) > 1.06 || Math.abs(projected.y) > 1.06 || projected.z > 1;
  }

  // ───────────────────────── main loop ─────────────────────────

  tick(now) {
    requestAnimationFrame(this.tick);
    const rawDt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += rawDt;
    this.frame += 1;

    if (this.paused || this.screenshotPaused) {
      this.renderFrame(rawDt);
      return;
    }

    let dt = rawDt;
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - rawDt);
      dt = rawDt * 0.08;
    }

    this.update(dt, rawDt);
    this.renderFrame(rawDt);

    // Host: stream state to Laki. Guest: stream inputs to the host.
    this.snapTimer += rawDt;
    this.inputTimer += rawDt;
    if (this.netMode === 'host' && this.snapTimer >= 0.05) {
      this.snapTimer = 0;
      this.sendNetSnapshot();
    } else if (this.netMode === 'guest' && this.inputTimer >= 0.033) {
      this.inputTimer = 0;
      this.sendGuestInput();
    }
  }

  sendGuestInput() {
    if (this.netMode !== 'guest' || !this.net.inRoom) return;
    let ix = 0;
    let iz = 0;
    if (this.keys.has('a')) ix -= 1;
    if (this.keys.has('d')) ix += 1;
    if (this.keys.has('w')) iz += 1;
    if (this.keys.has('s')) iz -= 1;
    if (this.joystick.active) {
      ix += this.joystick.x;
      iz += this.joystick.z;
    }
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    this.guestInput.x = ix;
    this.guestInput.z = iz;
    this.guestInput.sprint = this.keys.has('shift');
    // Aim point is arena-local on this machine; world coords are the negation.
    this.guestInput.aim = {
      x: -this.aimPoint.x,
      z: -this.aimPoint.z,
    };
    this.net.sendInput({
      x: +ix.toFixed(3),
      z: +iz.toFixed(3),
      s: this.guestInput.sprint,
      aim: this.guestInput.aim,
      sq: this.guestSnapSq,
    });
  }

  // ── Guest machine: render the host's authoritative world ──
  guestUpdate(dt, realDt) {
    const snap = this.snapshot;
    if (!snap) return;

    // Snapshot world coords → arena-local (180° rotation): negate x/z.
    const authoritative = new THREE.Vector3(-snap.r.x, 0, -snap.r.z);
    this.rival.pos.set(-snap.p.x, 0, -snap.p.z);
    // Client-side prediction for Laki's own movement: apply his inputs
    // instantly, then ease toward the host's authoritative position. Keeps
    // the far-side player responsive over intercontinental latency.
    if (!this.guestPredicted) this.guestPredicted = authoritative.clone();
    // Mirror the host's movement rules exactly (predict only what the host
    // would simulate) so the reconciliation never fights the placement.
    const canPredict =
      this.phase === 'rally' || (this.phase === 'serve' && this.server === 'player');
    let vx = 0;
    let vz = 0;
    if (canPredict) {
      const speed = this.keys.has('shift') || this.guestInput.sprint
        ? TUNING.playerSprintSpeed
        : TUNING.playerSpeed;
      vx = this.guestInput.x * speed;
      vz = -this.guestInput.z * speed;
    }
    this.guestPredicted.x = clamp(this.guestPredicted.x + vx * dt, -PLAYER_BOUNDS.x, PLAYER_BOUNDS.x);
    this.guestPredicted.z = clamp(this.guestPredicted.z + vz * dt, PLAYER_BOUNDS.zMin, PLAYER_BOUNDS.zMax);
    // Gentle reconciliation toward the host's view (inputs keep it responsive;
    // the pull corrects any drift).
    this.guestPredicted.x = damp(this.guestPredicted.x, authoritative.x, 4, dt);
    this.guestPredicted.z = damp(this.guestPredicted.z, authoritative.z, 4, dt);
    this.player.pos.copy(this.guestPredicted);
    this.ball.pos.set(-snap.b.x, snap.b.y, -snap.b.z);
    this.ball.prevPos.copy(this.ball.pos);
    this.ball.mode = snap.b.m;
    this.ball.lastHitter = snap.b.l;
    this.ball.mesh.position.copy(this.ball.pos);
    this.ball.mesh.visible = snap.b.m !== 'hidden';
    if (this.ball.glow) {
      this.ball.glow.visible = snap.b.m === 'flight';
      this.ball.glow.position.copy(this.ball.pos);
    }
    this.ball.shadow.visible = snap.b.m !== 'hidden' && this.ball.pos.y < 5.2;
    this.ball.shadow.position.set(this.ball.pos.x, 0.014, this.ball.pos.z);
    this.ball.rim.visible = snap.b.m === 'flight';
    this.ball.rim.position.copy(this.ball.pos);
    this.ball.setShotColor(snap.b.c);
    this.ball.trail.visible = false;

    // Release a locally buffered click once this snapshot shows the ball
    // playable (the host still validates the hit against what we saw).
    if (this.pendingSwing) {
      this.pendingSwing.t -= dt;
      const info = this.getHitInfo();
      if (this.phase === 'rally' && info.ready) {
        this.pendingSwing = null;
        this.guestInput.hitSeq += 1;
        this.net.sendInput({ h: this.guestInput.hitSeq });
      } else if (this.pendingSwing.t <= 0 || this.phase !== 'rally') {
        this.pendingSwing = null;
        this.ui.setPrompt('JUST MISSED IT', 'warning');
      }
    }

    this.guestSnapSq = snap.sq ?? this.guestSnapSq;
    this.phase = snap.ph;
    this.server = snap.sv;
    this.serve.state = snap.ss;
    this.rally = snap.ra;
    this.matchPoint = snap.mp;
    this.matchWinner = snap.mw;
    this.score.player = snap.sc[0];
    this.score.rival = snap.sc[1];
    const scoreKey = snap.sc.join('-') + '|' + snap.ra + '|' + snap.sv + '|' + snap.ph;
    if (scoreKey !== this.guestScoreKey) {
      this.guestScoreKey = scoreKey;
      this.updateScoreHud();
    }

    // One-shot events from the host.
    for (const ev of snap.ev) this.applyNetEvent(ev);

    // Animate both athletes from their apparent speed.
    const prevPos = this.guestPrevPos ?? this.player.pos.clone();
    this.player.vel.copy(this.player.pos).sub(prevPos).multiplyScalar(1 / Math.max(dt, 0.001));
    const mySpeed = Math.min(this.player.vel.length(), TUNING.playerSprintSpeed * 1.5);
    this.playerCharacter.root.position.copy(this.player.pos);
    this.playerCharacter.root.rotation.y = damp(
      this.playerCharacter.root.rotation.y,
      -this.aimYaw,
      16,
      dt
    );
    this.playerCharacter.update(dt, { speed: mySpeed, maxSpeed: TUNING.playerSprintSpeed, localMove: { x: 0, z: 0 } });
    const oppSpeed = this.rival.vel.length();
    this.rivalCharacter.root.position.copy(this.rival.pos);
    this.rivalCharacter.root.rotation.y = damp(
      this.rivalCharacter.root.rotation.y,
      Math.PI - 0.04,
      10,
      dt
    );
    this.rivalCharacter.update(dt, { speed: oppSpeed, maxSpeed: TUNING.rivalSpeed, localMove: { x: 0, z: 0 } });
    this.guestPrevPos = this.guestPrevPos ?? this.player.pos.clone();
    this.guestPrevPos.copy(this.player.pos);

    this.player.swingCooldown = Math.max(0, this.player.swingCooldown - dt);
    this.world.update(realDt, this.elapsed);
    this.updateCamera(realDt);
    this.updateHud(realDt);
  }

  applyNetEvent(ev) {
    switch (ev.ev) {
      case 'sw': {
        // Opponent (DUKA) swung.
        this.rivalCharacter.triggerSwing(ev.ty, ev.hd || 'right');
        break;
      }
      case 'swme': {
        this.playerCharacter.triggerSwing(ev.ty, ev.hd || 'right');
        break;
      }
      case 'toss': {
        (ev.who === 'r' ? this.playerCharacter : this.rivalCharacter).startServeToss();
        break;
      }
      case 'tossstop': {
        this.playerCharacter.stopServeToss();
        this.rivalCharacter.stopServeToss();
        break;
      }
      case 'hit': {
        this.ui.showHitFeedback({ rating: ev.rating, detail: ev.detail, tone: ev.tone });
        if (ev.tone === 'perfect') this.ui.flashHit();
        break;
      }
      case 'slowmo': {
        this.ui.showReplay();
        break;
      }
      case 'point': {
        this.ui.hideReplay();
        this.ui.showPointBanner({ kicker: ev.kicker, title: ev.title, reason: ev.reason, tone: ev.tone });
        this.ui.flashPoint();
        this.audio.playPoint(ev.winner);
        break;
      }
      case 'countdown': {
        this.ui.showCountdown({ kicker: ev.kicker, value: ev.value, sub: ev.sub });
        if (ev.sound) this.audio.playCountdown(true);
        break;
      }
      case 'hidebanners': {
        this.ui.hideBanners();
        break;
      }
      case 'toast': {
        this.ui.showToast(ev.title, ev.detail, ev.duration || 4500);
        break;
      }
      case 'results': {
        this.ui.showHud(false);
        this.ui.showResults(ev);
        break;
      }
      case 'serveaim': {
        // Host already mirrored our aim; nothing to do locally.
        break;
      }
      default:
        break;
    }
  }

  // ── Host/guest session lifecycle ──
  beginNetSession(role) {
    this.netMode = role;
    this.myRole = role === 'host' ? 'player' : 'rival';
    this.remoteEvents.length = 0;
    this.snapshot = null;
    this.guestPrevPos = null;
    this.audio.unlock();
    this.audio.setMood('match');
    this.ui.showGame();
    this.ui.hideLobby();
    this.ui.hideResults();
    this.ui.hideHowTo();
    this.ui.clearConfetti();
    this.ui.hideBanners();
    this.ui.showHud(true);
    this.ui.setPaused(false);
    this.paused = false;
    this.screenshotPaused = false;
    this.hasStarted = true;
    this.matchWinner = null;
    this.matchPoint = false;
    this.resultsShown = false;
    this.endTimer = 0;
    this.score.player = 0;
    this.score.rival = 0;
    this.totalPoints = 0;
    this.server = 'player';
    this.rally = 0;
    this.longestRally = 0;
    this.stats = { pointsWon: 0, topSpeed: 0, perfects: 0, winners: 0, autoShots: 0, totalPoints: 0 };
    this.playerCharacter.root.visible = true;
    this.rivalCharacter.root.visible = true;
    this.ball.hide();
    this.ui.setRally(0);
    this.ui.setTopSpeed(0);
    this.updateScoreHud();
    this.ui.setPlayerPanel(role === 'guest' ? 'LAKI' : 'DUKA', role === 'guest' ? 'LA' : 'DU');
    this.ui.showToast(
      role === 'host' ? `VS ${this.net.opp || 'LAKI'} · LAN` : `VS ${this.net.opp || 'DUKA'} · LAN`,
      role === 'host' ? 'You are DUKA, serving first. Laki plays the far side.' : 'You are LAKI. DUKA serves first — take the far side.',
      5000
    );
    if (role === 'host') {
      this.placeForServe('player');
      this.phase = 'intro';
      this.introTimer = 1.25;
      this.showIntroToast = false;
      this.ui.showCountdown({ kicker: 'MATCH START', value: 'READY', sub: 'YOUR SERVE' });
      this.audio.playCountdown(true);
      this.snapCamera(true);
    } else {
      this.phase = 'intro';
      this.introTimer = 1.25;
      this.aimYaw = -0.05;
      this.aimPitch = -0.11;
      this.ui.showCountdown({ kicker: 'MATCH START', value: 'READY', sub: 'DUKA SERVES' });
      this.ui.setPrompt('WAITING FOR DUKA');
    }
  }

  update(dt, realDt) {
    if (this.netMode === 'guest' && this.phase !== 'title' && this.phase !== 'howto') {
      this.guestUpdate(dt, realDt);
      return;
    }
    if (this.phase === 'title') {
      this.titleTime += realDt;
      this.playerCharacter.update(dt, { speed: 0, maxSpeed: TUNING.playerSpeed });
      this.rivalCharacter.update(dt, { speed: 0, maxSpeed: TUNING.playerSpeed });
      this.world.update(realDt, this.elapsed);
      this.updateCamera(realDt);
      return;
    }

    if (this.phase === 'intro') {
      this.updatePlayerMovement(dt);
      this.updateRival(dt);
      this.updateCharacters(dt, this.player.vel.length(), this.rival.vel.length());
      this.updateIntro(dt);
      this.world.update(realDt, this.elapsed);
      this.updateCamera(realDt);
      this.updateHud(realDt);
      return;
    }

    if (this.phase === 'serve') {
      this.updatePlayerMovement(dt);
      this.updateRival(dt);
      this.updateServe(dt);
      this.ball.update(dt);
      this.updatePendingSwing(dt);
      this.recordReplayFrame();
      this.processBallEvents();
      this.updateCharacters(dt, this.player.vel.length(), this.rival.vel.length());
      this.world.update(realDt, this.elapsed);
      this.updateCamera(realDt);
      this.updateHud(realDt);
      return;
    }

    if (this.phase === 'rally') {
      this.player.swingCooldown = Math.max(0, this.player.swingCooldown - dt);
      this.updatePlayerMovement(dt);
      this.updateRival(dt);
      this.ball.update(dt);
      this.updatePendingSwing(dt);
      this.recordReplayFrame();
      this.processBallEvents();
      if (this.phase === 'rally' && this.ball.mode === 'dead') {
        // Safety net for weird trajectories: resolve a dead ball at the net.
        if (this.ball.events.length) this.processBallEvents();
      }
      this.updateCharacters(dt, this.player.vel.length(), this.rival.vel.length());
      this.world.update(realDt, this.elapsed);
      this.updateCamera(realDt);
      this.updateHud(realDt);
      return;
    }

    if (this.phase === 'point') {
      const replaying = this.updatePoint(dt);
      if (!replaying) this.ball.update(dt);
      this.ball.events.length = 0;
      this.world.update(realDt, this.elapsed);
      this.updateCamera(realDt);
      this.updateHud(realDt);
      return;
    }

    if (this.phase === 'over') {
      this.updateOver(dt);
      this.ball.update(dt);
      this.ball.events.length = 0;
      this.world.update(realDt, this.elapsed);
      this.updateCamera(realDt);
      this.updateHud(realDt);
    }
  }

  renderFrame(rawDt) {
    if (!this.renderer || !this.scene || !this.camera) return;
    if (!this.paused && !this.screenshotPaused) this.effects.update(rawDt);
    this.renderer.render(this.scene, this.camera);
    this.updateDiagnostics();
  }

  updateDiagnostics() {
    if (!this.renderer) return;
    const info = this.renderer.info;
    // An all-zero reading means the info block was reset between frames (a
    // capture raced a render), not that the scene stopped drawing. Keep the
    // last real frame's counts so evidence snapshots stay truthful.
    if (info.render.calls === 0 && info.render.triangles === 0 && this._lastRenderStats) {
      info.render.calls = this._lastRenderStats.calls;
      info.render.triangles = this._lastRenderStats.triangles;
      info.render.points = this._lastRenderStats.points;
      info.render.lines = this._lastRenderStats.lines;
      info.memory.geometries = this._lastRenderStats.geometries;
      info.memory.textures = this._lastRenderStats.textures;
    } else {
      this._lastRenderStats = {
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      };
    }
    const labels = this.scoreLabels();
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      phase: this.phase,
      paused: this.paused,
      screenshotPaused: this.screenshotPaused,
      mobile: this.mobile,
      score: {
        player: this.score.player,
        rival: this.score.rival,
        playerLabel: labels.player,
        rivalLabel: labels.rival,
        meta: labels.meta,
      },
      rally: this.rally,
      longestRally: this.longestRally,
      matchWinner: this.matchWinner,
      matchPoint: this.matchPoint,
      ball: this.ball
        ? {
            mode: this.ball.mode,
            position: this.ball.pos.toArray().map((n) => Math.round(n * 100) / 100),
            speed: Math.round(this.ball.vel.length() * 10) / 10,
          }
        : null,
      player: {
        position: this.player ? this.player.pos.toArray().map((n) => Math.round(n * 100) / 100) : null,
      },
      rival: {
        position: this.rival ? this.rival.pos.toArray().map((n) => Math.round(n * 100) / 100) : null,
      },
      camera: {
        position: this.camera.position.toArray().map((n) => Math.round(n * 100) / 100),
        fov: Math.round(this.camera.fov * 10) / 10,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      autoShotEnabled: true,
    };
  }

  onResize() {
    if (!this.renderer || !this.camera) return;
    // Measure the *visible* viewport (visualViewport excludes phone browser
    // toolbars) and expose it as --app-h; CSS falls back to 100dvh/100vh.
    const vv = window.visualViewport;
    const visibleH = Math.round(vv?.height ?? window.innerHeight);
    const visibleW = Math.round(vv?.width ?? window.innerWidth);
    document.documentElement.style.setProperty('--app-h', `${visibleH}px`);
    const width = this.canvas?.clientWidth || visibleW;
    const height = this.canvas?.clientHeight || visibleH;
    this.mobile = isCoarsePointer() || width <= 900 || window.innerWidth <= 900;
    const dprCap = this.mobile ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
    this.ui._initViewportMode();
  }

  // ───────────────────────── pause / quit ─────────────────────────

  pauseGame() {
    if (!this.isActiveMatch() || this.paused) return;
    this.paused = true;
    this.clearInputs();
    if (this.netMode === 'guest') {
      this.guestInput.x = 0;
      this.guestInput.z = 0;
      this.guestInput.sprint = false;
      this.net.sendInput({ x: 0, z: 0, s: false });
    }
    this.ui.setPaused(true);
    this.ui.hideBanners();
    this.ui.updateAudioState(this.audio.getState());
    document.exitPointerLock?.();
  }

  resumeGame() {
    if (!this.paused) return;
    this.paused = false;
    this.ui.setPaused(false);
    this.lastTime = performance.now();
    this.audio.unlock();
    this.requestPointerLock();
  }

  returnToTitle() {
    this.paused = false;
    this.ui.hideResults();
    this.ui.hideHowTo();
    this.resetToTitle();
    this.lastTime = performance.now();
  }

  // ───────────────────────── debug & test support ─────────────────────────

  earlyTestHooks() {
    const wait = () => this.readyPromise ?? Promise.resolve();
    return {
      seed: async (seed) => {
        await wait();
        return this.testHooks.seed(seed);
      },
      setState: async (state) => {
        await wait();
        return this.testHooks.setState(state);
      },
      getState: () => (this.testHooks ? this.testHooks.getState() : { phase: 'boot' }),
      setPausedForScreenshot: (paused) => {
        if (this.testHooks) this.testHooks.setPausedForScreenshot(paused);
        else {
          this.screenshotPaused = Boolean(paused);
          document.body.classList.toggle('is-screenshot', Boolean(paused));
        }
      },
      setReducedMotion: (reduced) => {
        if (this.testHooks) this.testHooks.setReducedMotion(reduced);
        else {
          this.reducedMotion = Boolean(reduced);
          document.body.classList.toggle('is-reduced-motion', Boolean(reduced));
        }
      },
      hideDebugUi: () => {
        if (this.testHooks) this.testHooks.hideDebugUi();
      },
    };
  }

  buildDebugPanel() {
    const panel = document.createElement('pre');
    panel.id = 'debug-panel';
    panel.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:90;padding:8px 10px;background:rgba(0,0,0,.65);color:#9ff;font:10px/1.4 monospace;pointer-events:none;max-width:420px;white-space:pre-wrap;border:1px solid rgba(255,255,255,.2)';
    document.body.appendChild(panel);
    this.debugPanel = panel;
    window.setInterval(() => {
      if (!this.debugPanel) return;
      const d = window.__THREE_GAME_DIAGNOSTICS__;
      if (!d) return;
      this.debugPanel.textContent = `${d.phase} · ${d.score.playerLabel}-${d.score.rivalLabel}\nball ${d.ball?.mode ?? '-'} ${d.ball?.position?.join(',')}\nplayer ${d.player.position?.join(',')}\ncalls ${d.renderer.calls} tris ${d.renderer.triangles}`;
    }, 400);
  }

  installTestHooks() {
    const hooks = {
      seed: (seed) => {
        this.rng.reseed(seed);
        return { seed };
      },
      // Read-only snapshot for automated playtests; works in prod builds too.
      getState: () => ({
        phase: this.phase,
        paused: this.paused,
        serve: this.serve.state,
        server: this.server,
        score: { ...this.score },
        rally: this.rally,
        matchWinner: this.matchWinner,
        ready: this.getHitInfo().ready,
        ball: {
          x: this.ball.pos.x,
          z: this.ball.pos.z,
          last: this.ball.lastHitter,
          mode: this.ball.mode,
        },
        player: { x: this.player.pos.x },
        rival: { x: this.rival.pos.x },
      }),
      setState: async (state) => {
        const valid = new Set([
          'title',
          'active-play',
          'serve',
          'paused',
          'match-point',
          'match-won',
          'match-lost',
          'howto',
        ]);
        if (!valid.has(state)) throw new Error(`Unknown test state: ${state}`);
        await this.prepareTestState(state);
        this.screenshotPaused = true;
        document.body.classList.add('is-screenshot');
        return { state };
      },
      setPausedForScreenshot: (paused) => {
        this.screenshotPaused = Boolean(paused);
        document.body.classList.toggle('is-screenshot', Boolean(paused));
        if (!paused) this.lastTime = performance.now();
      },
      setReducedMotion: (reduced) => {
        this.reducedMotion = Boolean(reduced);
        this.effects.reducedMotion = Boolean(reduced);
        document.body.classList.toggle('is-reduced-motion', Boolean(reduced));
      },
      hideDebugUi: () => {
        if (this.debugPanel) this.debugPanel.style.display = 'none';
      },
    };
    this.testHooks = hooks;
    window.__THREE_GAME_TEST_HOOKS__ = hooks;
  }

  async prepareTestState(state) {
    this.screenshotPaused = false;
    document.body.classList.remove('is-screenshot');
    this.ui.hideHowTo();
    this.ui.hideResults();
    this.ui.hideToast();
    if (state === 'title') {
      this.resetToTitle();
      this.snapCamera(true);
      return;
    }
    if (state === 'howto') {
      this.resetToTitle();
      this.ui.showHowTo(true);
      this.snapCamera(true);
      return;
    }
    this.prepareActivePlayScene();
    if (state === 'paused') {
      this.ui.setPaused(true);
      this.paused = true;
      this.ui.updateAudioState(this.audio.getState());
    } else if (state === 'match-point') {
      this.score.player = 3;
      this.score.rival = 2;
      this.totalPoints = 5;
      this.server = 'player';
      this.matchPoint = true;
      this.updateScoreHud();
      this.ui.setPrompt('MATCH POINT', 'ready');
    } else if (state === 'match-won' || state === 'match-lost') {
      const win = state === 'match-won';
      this.score.player = win ? 4 : 2;
      this.score.rival = win ? 2 : 4;
      this.totalPoints = 6;
      this.matchWinner = win ? 'player' : 'rival';
      this.phase = 'over';
      this.stats.topSpeed = 38.2;
      this.stats.pointsWon = win ? 4 : 2;
      this.stats.perfects = 7;
      this.longestRally = 11;
      this.stats.autoShots = 16;
      this.stats.winners = 4;
      this.ui.showHud(false);
      this.ui.showResults({
        win,
        line: win
          ? 'You held center court. The sunset belongs to Jax.'
          : 'Riko takes the tiebreak. Replay the rally, not the scoreboard.',
        score: `${this.score.player} — ${this.score.rival}`,
        points: this.stats.pointsWon,
        topSpeed: formatSpeed(this.stats.topSpeed),
        longestRally: this.longestRally,
        perfects: this.stats.perfects,
        foot: `AUTO-SHOT SYSTEM · ${this.stats.autoShots} SHOTS CHOSEN · ${this.stats.winners} WINNERS`,
      });
    }
    if (state === 'serve') {
      this.placeForServe('player');
      this.serve.state = 'toss';
      this.serve.timer = 0.6;
      this.ball.tossFrom(this.getServeHoldPosition('player'), new THREE.Vector3(0, 5.6, 0));
      this.player.character.startServeToss();
      this.ui.hidePointBanner();
      this.ui.hideCountdown();
    }
    if (state === 'match-won') {
      this.screenshotPaused = true;
      document.body.classList.add('is-screenshot');
      return;
    }
    this.snapCamera(true);
    this.updateAimVisuals(this.elapsed);
    this.updateHud(0.016);
    this.updateDiagnostics();
    this.screenshotPaused = true;
    document.body.classList.add('is-screenshot');
  }

  prepareActivePlayScene() {
    this.phase = 'rally';
    this.paused = false;
    this.screenshotPaused = false;
    this.hasStarted = true;
    this.matchWinner = null;
    this.matchPoint = false;
    this.resultsShown = false;
    this.score.player = 2;
    this.score.rival = 1;
    this.totalPoints = 3;
    this.server = 'player';
    this.rally = 5;
    this.longestRally = 8;
    this.stats = {
      pointsWon: 2,
      topSpeed: 38.2,
      perfects: 4,
      winners: 2,
      autoShots: 7,
      totalPoints: 3,
    };
    this.ui.showGame();
    this.ui.hideResults();
    this.ui.hideHowTo();
    this.ui.hideToast();
    this.ui.hideBanners();
    this.ui.setRally(this.rally);
    this.ui.setTopSpeed(formatSpeed(this.stats.topSpeed));
    this.updateScoreHud();

    this.player.pos.set(-0.55, 0, 10.15);
    this.player.vel.set(0, 0, 0);
    this.player.swingCooldown = 0;
    this.rival.pos.set(1.25, 0, -9.6);
    this.rival.vel.set(0, 0, 0);
    this.rival.character.stopServeToss();
    this.player.character.stopServeToss();
    this.aimYaw = 0.145;
    this.aimPitch = -0.118;
    this.playerCharacter.root.rotation.y = -this.aimYaw;
    this.rivalCharacter.root.rotation.y = Math.PI - 0.04;

    this.ball.reset();
    this.ball.launch(
      new THREE.Vector3(1.4, 1.15, -8.2),
      new THREE.Vector3(-0.75, 0.033, 6.55),
      'topspin',
      0.96
    );
    this.ball.lastHitter = 'rival';
    this.ball.served = false;
    this.ball.events.length = 0;
    for (let i = 0; i < 360; i += 1) {
      this.ball.update(1 / 120);
      if (this.ball.bounces >= 1 && this.ball.pos.z > 8.35 && this.ball.pos.y > 0.65) break;
    }
    this.ball.events.length = 0;
    // Compose the freeze-frame rally deliberately: a ball arriving in front of
    // the player, clearly in the hit window, with a visible flight trail.
    this.ball.mode = 'flight';
    this.ball.pos.set(-1.55, 1.35, 8.38);
    this.ball.prevPos.copy(this.ball.pos);
    this.ball.vel.set(-0.5, 1.1, 6.1);
    this.ball.lastHitter = 'rival';
    this.ball.bounces = 1;
    this.ball.served = false;
    this.ball.mesh.position.copy(this.ball.pos);
    this.ball.mesh.visible = true;
    this.ball.shadow.visible = true;
    this.ball.shadow.position.set(this.ball.pos.x, 0.014, this.ball.pos.z);
    this.ball.rim.visible = true;
    this.ball.rim.position.copy(this.ball.pos);
    if (this.ball.glow) {
      this.ball.glow.visible = true;
      this.ball.glow.position.copy(this.ball.pos);
    }
    this.ball.trail.visible = true;
    for (let i = 0; i < 30; i += 1) {
      const t = i / 29;
      this.ball.trailPositions[i * 3] = -1.55 + t * 1.45;
      this.ball.trailPositions[i * 3 + 1] = 1.35 + t * 0.3;
      this.ball.trailPositions[i * 3 + 2] = 8.38 - t * 3.4;
      this.ball.trailAlphas[i] = Math.max(0, 1 - i / 30) * 0.9;
    }
    this.ball.trail.geometry.attributes.position.needsUpdate = true;
    this.ball.trail.geometry.attributes.aAlpha.needsUpdate = true;

    this.updateCharacters(0.016, 0, 0);
    this.ui.setScore({
      player: '30',
      rival: '15',
      meta: 'RACE TO 4',
      matchLabel: 'TIEBREAK · FIRST TO 4',
      serving: 'player',
      matchPoint: false,
    });
    this.world.setScoreboard({
      playerPoints: '30',
      rivalPoints: '15',
      label: 'RACE TO 4',
      detail: 'RALLY 5',
      serving: 'player',
    });
    this.world.update(0.016, this.elapsed);
    this.ui.setPrompt('CLICK TO HIT', 'ready');
    this.snapCamera(true);
    this.updateAimVisuals(this.elapsed);
    this.updateHud(0.016);
    this.updateDiagnostics();
  }
}

const game = new SunsetSlam();
// Dev introspection; also available in prod builds behind ?debug for QA bots.
if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')) {
  window.__SUNSET_SLAM_DEV__ = game;
}
window.__THREE_GAME_TEST_HOOKS__ = game.earlyTestHooks();
game.readyPromise = game.init();
game.readyPromise.catch((error) => {
  console.error('[SUNSET SLAM] initialization failed', error);
  const boot = document.getElementById('boot-screen');
  if (boot) {
    boot.innerHTML = `<div style="max-width:560px;padding:24px;color:#fff5e6;font-family:sans-serif;text-align:center"><h1 style="font-family:sans-serif">SUNSET SLAM</h1><p>The court could not be rendered in this browser.</p><pre style="white-space:pre-wrap;color:#ff9b80;font-size:12px">${String(error?.message ?? error)}</pre></div>`;
  }
});

window.addEventListener('beforeunload', () => {
  // Contexts are cleaned up by the browser; this exists so test automation can
  // dispose timers without leaving dangling intervals.
  if (game.audio?.musicTimer) clearInterval(game.audio.musicTimer);
  if (game.diagTimer) clearInterval(game.diagTimer);
});
