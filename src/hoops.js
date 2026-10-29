// Basketball 1v1 — half-court, one basket, race to 11 (win by 2).
// Reuses the sunset stadium, athletes, camera, HUD, replay, audio and the
// LAN/internet multiplayer transport from the tennis build.

import * as THREE from 'three';
import { clamp, damp } from './utils.js';
import { TUNING } from './config.js';
import { makeBasketballTexture } from './textures.js';

export const HOOPS = {
  rimCenter: new THREE.Vector3(0, 3.05, -12.16),
  rimR: 0.23,
  ballR: 0.1194,  // official size 7: 75cm circumference
  boardZ: -12.44,           // backboard plane (front face)
  boardW: 1.83,
  boardH: 1.07,
  boardBotY: 2.90,
  threeR: 6.75,             // arc radius from the rim center
  target: 11,               // race to 11, win by 2
  gravity: 9.4,
  bounds: { x: 7.2, zMin: -10.6, zMax: 12.4 },
  shotClock: 14,
};

const HOOP_POS = new THREE.Vector3(HOOPS.rimCenter.x, 0, HOOPS.rimCenter.z);

/* ─────────────────────────── court visuals ─────────────────────────── */

export function buildBasketCourt(arena) {
  const group = new THREE.Group();
  group.name = 'basketCourt';
  arena.add(group);

  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6437, roughness: 0.62, metalness: 0.05 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x7c4e28, roughness: 0.7 });
  const paint = new THREE.MeshStandardMaterial({ color: 0x1d5f6e, roughness: 0.66 });
  const line = new THREE.MeshBasicMaterial({ color: 0xf5efdd });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe8722a, roughness: 0.42, metalness: 0.35 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe7ded0, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x22333e, roughness: 0.4, metalness: 0.7 });

  // Wooden floor with plank stripes.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.12, 24.6), wood);
  floor.position.set(0, -0.045, 0.6);
  group.add(floor);
  for (let i = -7; i <= 7; i += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.005, 24.4), woodDark);
    plank.position.set(i * 1.06, 0.017, 0.6);
    group.add(plank);
  }

  // Painted key + arcs near the hoop.
  const key = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 5.8), paint);
  key.rotation.x = -Math.PI / 2;
  key.position.set(0, 0.021, HOOPS.rimCenter.z + 2.9 + 0.35);
  group.add(key);
  const ftCircle = new THREE.Mesh(new THREE.RingGeometry(1.78, 1.83, 40), line);
  ftCircle.rotation.x = -Math.PI / 2;
  ftCircle.position.set(0, 0.022, HOOPS.rimCenter.z + 5.8);
  group.add(ftCircle);

  // Boundary + three-point arc + key lines.
  const addLine = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.006, d), line);
    m.position.set(x, 0.024, z);
    group.add(m);
  };
  addLine(15.2, 0.08, 0, 12.85);            // half-court line
  addLine(0.08, 12.4, -7.55, 6.6);          // sidelines
  addLine(0.08, 12.4, 7.55, 6.6);
  addLine(4.9, 0.08, 0, HOOPS.rimCenter.z + 5.8);   // free-throw line
  addLine(0.08, 5.8, -2.45, HOOPS.rimCenter.z + 2.95);
  addLine(0.08, 5.8, 2.45, HOOPS.rimCenter.z + 2.95);
  // Three-point arc (segments).
  const arcPts = [];
  for (let a = -1.25; a <= 1.25; a += 0.05) {
    const px = Math.sin(a) * HOOPS.threeR;
    const pz = HOOPS.rimCenter.z + Math.cos(a) * HOOPS.threeR;
    if (pz > 12.8) continue;
    arcPts.push(new THREE.Vector3(px, 0.024, pz));
  }
  if (arcPts.length > 2) {
    const curve = new THREE.CatmullRomCurve3(arcPts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.022, 5), line);
    group.add(tube);
    const first = arcPts[0];
    const last = arcPts[arcPts.length - 1];
    for (const p of [first, last]) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 12.85 - p.z), line);
      seg.position.set(p.x, 0.024, p.z + (12.85 - p.z) / 2);
      group.add(seg);
    }
  }

  // Backboard, rim, net, pole.
  const board = new THREE.Mesh(new THREE.BoxGeometry(HOOPS.boardW, HOOPS.boardH, 0.06), white);
  board.position.set(0, HOOPS.boardBotY + HOOPS.boardH / 2, HOOPS.boardZ - 0.03);
  group.add(board);
  const sq = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 0.012), line);
  sq.position.set(0, HOOPS.rimCenter.y + 0.06, HOOPS.boardZ - 0.075);
  group.add(sq);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(HOOPS.rimR, 0.021, 10, 28), orange);
  rim.rotation.x = Math.PI / 2;
  rim.position.copy(HOOPS.rimCenter);
  group.add(rim);
  const connector = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.16), orange);
  connector.position.set(0, HOOPS.rimCenter.y, HOOPS.boardZ + 0.05);
  group.add(connector);
  // Net: 10 tapering strands + 2 rings.
  const netMat = new THREE.MeshBasicMaterial({ color: 0xf3ecdc, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2;
    const topX = Math.cos(a) * HOOPS.rimR;
    const topZ = Math.sin(a) * HOOPS.rimR;
    const botX = Math.cos(a) * HOOPS.rimR * 0.45;
    const botZ = Math.sin(a) * HOOPS.rimR * 0.45;
    const strand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4),
      netMat
    );
    strand.position.set(
      (topX + botX) / 2,
      HOOPS.rimCenter.y - 0.21,
      HOOPS.rimCenter.z + (topZ + botZ) / 2
    );
    strand.rotation.z = (botX - topX) * 1.1;
    strand.rotation.x = -(botZ - topZ) * 1.1;
    group.add(strand);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.4, 10), steel);
  pole.position.set(0, 2.0, HOOPS.boardZ - 0.55);
  group.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.55), steel);
  arm.position.set(0, HOOPS.boardBotY + 0.75, HOOPS.boardZ - 0.3);
  group.add(arm);
  const basePad = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.9), steel);
  basePad.position.set(0, 0.25, HOOPS.boardZ - 0.6);
  group.add(basePad);

  return { group, rim, netStrands: null };
}

/* ─────────────────────────── game engine ─────────────────────────── */

export class Hoops {
  constructor(game) {
    this.g = game;
    this.court = buildBasketCourt(game.arena);

    // Hide the tennis court & net, keep stadium/sky/crowd.
    game.world.court.group.visible = false;
    game.world.net.group.visible = false;

    // Proper basketball: orange pebbled leather with black seams.
    const mesh = game.ball.mesh;
    this._savedMap = mesh.material.map;
    this._savedColor = mesh.material.color.clone();
    this._basketTex = makeBasketballTexture();
    mesh.material.map = this._basketTex;
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
    mesh.scale.setScalar(3.62);

    this.possession = 'player';
    game.hoopsRim = HOOPS.rimCenter.clone();     // 'player' | 'rival' | null (loose ball)
    this.shotClock = HOOPS.shotClock;
    this.charge = 0;
    this.charging = false;
    this.shot = null;               // live shot metadata
    this.streak = 0;
    this.cpuInput = { x: 0, z: 0 };
    this.cpuHoldTimer = 0;
    this.stealTimer = 0;
    this.introTimer = 1.4;
    this.prevBallY = 0;
    this.guestLastHit = 0;
    this.rivalVel = new THREE.Vector3();
    this._bindPointer();
  }

  dispose() {
    this._unbindPointer();
    this.g.arena.remove(this.court.group);
    this.court.group.traverse((n) => {
      n.geometry?.dispose?.();
    });
    this.g.world.court.group.visible = true;
    this.g.world.net.group.visible = true;
    this._basketTex?.dispose?.();
    const mesh = this.g.ball.mesh;
    mesh.material.map = this._savedMap;
    mesh.material.color.copy(this._savedColor);
    mesh.material.needsUpdate = true;
    mesh.scale.setScalar(1);
    this.g.hoops = null;
  }

  _bindPointer() {
    const c = this.g.canvas;
    this._onDown = (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== undefined && e.pointerType !== '') return;
      if (!this.g.isActiveMatch() || this.g.paused || this.g.screenshotPaused) return;
      if (this.g.phase !== 'rally') return;
      if (this.g.mobile) { this.beginCharge(); return; }
      // Desktop: a click without pointer lock is AIM-ACQUIRE, not a shot.
      if (!this.g.pointerLocked) {
        this.g.requestPointerLock();
        return;
      }
      this.beginCharge();
    };
    this._onUp = () => {
      if (this.charging) this.releaseCharge();
    };
    c.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointerup', this._onUp);
  }

  _unbindPointer() {
    this.g.canvas.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointerup', this._onUp);
  }

  /* ── match flow ── */

  begin() {
    const g = this.g;
    g.score.player = 0;
    g.score.rival = 0;
    g.rally = 0;
    g.longestRally = 0;
    g.stats = { pointsWon: 0, topSpeed: 0, perfects: 0, winners: 0, autoShots: 0, totalPoints: 0 };
    g.matchWinner = null;
    g.matchPoint = false;
    this.resetPositions('player');
    g.phase = 'intro';
    this.introTimer = 1.4;
    g.ui.hideCountdown();
    g.ui.setPrompt('FIRST TO 11 · WIN BY 2');
    g.updateScoreHud();
  }

  resetPositions(offense) {
    const g = this.g;
    g.player.pos.set(-2.4, 0, 9.6);
    g.player.vel.set(0, 0, 0);
    g.rival.pos.set(2.4, 0, 9.2);
    g.rival.vel.set(0, 0, 0);
    this.possession = offense;
    this.shotClock = HOOPS.shotClock;
    this.shot = null;
    this.charge = 0;
    this.charging = false;
    this.stealTimer = 0;
    const b = g.ball;
    b.mode = 'held';
    b.bounces = 0;
    b.lastHitter = offense;
    b.vel.set(0, 0, 0);
    b.pos.copy(this.holdPos(offense));
  }

  carrierPos() {
    return this.possession === 'rival' ? this.g.rival.pos : this.g.player.pos;
  }

  // The power window that lands the ball on the rim from the carrier's
  // current distance. Farther = green zone further up the gauge.
  greenZone() {
    const a = this.carrierPos();
    const dist = Math.hypot(a.x - HOOPS.rimCenter.x, a.z - HOOPS.rimCenter.z);
    const center = clamp(dist / 13.5, 0.3, 0.92);
    return { center, width: 0.13 };
  }

  holdPos(who) {
    const a = who === 'player' ? this.g.player.pos : this.g.rival.pos;
    return new THREE.Vector3(a.x + 0.34, 1.02, a.z + 0.1);
  }

  afterPoint() {
    // Possession alternates after a make: the other side takes the ball.
    const next = this.lastScorer === 'player' ? 'rival' : 'player';
    const g = this.g;
    g.phase = 'rally';
    this.resetPositions(next);
    g.ui.setPrompt(next === 'player' ? 'YOUR BALL' : 'LAKI BALL');
    g.ui.hideCountdown();
  }

  /* ── input ── */

  iHaveBall() {
    const g = this.g;
    if (g.netMode === 'guest') {
      // Guest: the ball is mine when the host's snapshot says the rival holds it.
      return g.ball.mode === 'held' && g.ball.lastHitter === 'rival';
    }
    return this.possession === 'player' && g.ball.mode === 'held';
  }

  beginCharge() {
    if (!this.iHaveBall() || this.shot || this.charging) return;
    this.charging = true;
    this.charge = 0;
  }

  releaseCharge() {
    if (!this.charging) return;
    this.charging = false;
    const g = this.g;
    const power = this.charge;
    if (g.netMode === 'guest') {
      g.guestInput.hitSeq += 1;
      g.net.sendInput({ h: g.guestInput.hitSeq, pw: +power.toFixed(3) });
      return;
    }
    this.shoot('player', power);
  }

  guestShootRequest() {
    const g = this.g;
    if (g.netMode !== 'guest') return;
    g.guestInput.hitSeq += 1;
    g.net.sendInput({ h: g.guestInput.hitSeq });
  }

  onAction(source) {
    // Touch HIT button / keyboard: quick-release shot at a fixed good charge.
    if (this.g.phase !== 'rally' || this.possession !== 'player') return;
    if (this.g.ball.mode !== 'held' || this.shot) return;
    this.shoot('player', 0.7);
  }

  guestShoot(power) {
    // Host received a shot request from the guest.
    if (this.g.phase !== 'rally' || this.possession !== 'rival') return;
    if (this.g.ball.mode !== 'held' || this.shot) return;
    this.shoot('rival', power != null ? power : this.greenZone().center);
  }

  /* ── shooting ── */

  shotTypeFor(dist) {
    if (dist < 2.1) return 'DUNK';
    if (dist < 4.4) return 'LAYUP';
    if (dist < HOOPS.threeR) return 'JUMPER';
    return 'THREE';
  }

  shoot(who, power) {
    const g = this.g;
    const a = who === 'player' ? g.player.pos : g.rival.pos;
    const distHoop = Math.hypot(a.x - HOOPS.rimCenter.x, a.z - HOOPS.rimCenter.z);
    const points = distHoop >= HOOPS.threeR ? 3 : 2;
    const type = this.shotTypeFor(distHoop);

    // AIM-BASED shooting, TPBC-style. Crosshair = direction; power gauge =
    // how far the ball carries. Green release + crosshair on the rim = swish.
    let aimYaw, aimPitch;
    if (who === 'player' && g.netMode !== 'guest') {
      aimYaw = g.aimYaw;
      aimPitch = g.aimPitch;
    } else {
      aimYaw = Math.atan2(HOOPS.rimCenter.x - a.x, -(HOOPS.rimCenter.z - a.z));
      aimPitch = -0.11;
    }
    const aimHoriz = new THREE.Vector3(Math.sin(aimYaw), 0, -Math.cos(aimYaw));

    // Green release targets the rim centre exactly; off-power stretches or
    // shortens the target along the aim ray (long / short shots).
    const gz = this.greenZone();
    const mult = clamp(power / gz.center, 0.3, 1.6);
    const overshoot = distHoop * (mult - 1) * 1.7;
    const target = new THREE.Vector3(
      HOOPS.rimCenter.x + aimHoriz.x * overshoot,
      HOOPS.rimCenter.y,
      HOOPS.rimCenter.z + aimHoriz.z * overshoot
    );

    const origin = this.holdPos(who);
    origin.y = 1.42; // release above the head

    const toT = new THREE.Vector3(target.x - origin.x, 0, target.z - origin.z);
    const flat = toT.length();
    toT.divideScalar(flat || 1);
    // Distance-tuned launch angle: steep touch shots up close, flarser
    // threes from deep — so the solver stays stable at every range.
    const baseAngle = clamp(62 - distHoop * 2.2, 38, 58);
    const angle = (baseAngle * Math.PI) / 180 - clamp(aimPitch, -0.25, 0.25) * 0.5;
    const dy = HOOPS.rimCenter.y - origin.y;
    const denom = flat * Math.tan(angle) - dy;
    let speed = denom > 0.3
      ? Math.sqrt((HOOPS.gravity * flat * flat) / (2 * Math.pow(Math.cos(angle), 2) * denom))
      : 13;
    speed *= 1.012;

    const vel = new THREE.Vector3(
      toT.x * Math.cos(angle),
      Math.sin(angle),
      toT.z * Math.cos(angle)
    ).multiplyScalar(speed);

    const defender = who === 'player' ? g.rival.pos : g.player.pos;
    const dDef = Math.hypot(defender.x - a.x, defender.z - a.z);
    const quality = clamp(1 - (Math.abs(power - gz.center) / gz.width) * 0.5 - (dDef < 1.5 ? 0.28 : 0), 0.1, 1);

    const b = g.ball;
    b.pos.copy(origin);
    b.vel.copy(vel);
    b.mode = 'flight';
    b.bounces = 0;
    b.lastHitter = who;
    b.shotType = 'drive';
    this.shot = { who, points, type, quality, scored: false, contested: dDef < 1.5 };
    this.possession = null;
    this.shotClock = HOOPS.shotClock;

    const charA = who === 'player' ? g.playerCharacter : g.rivalCharacter;
    charA.triggerSwing(type === 'DUNK' ? 'smash' : 'drive', 'forehand');
    g.audio.playSwing(type === 'DUNK' ? 'smash' : 'drive');
    g.ui.setAim({ shot: type, hand: '', ready: false, readiness: 0 });
    const inGreen = Math.abs(power - gz.center) <= gz.width / 2;
    g.ui.setPrompt(inGreen ? 'GREEN RELEASE!' : mult > 1 ? 'TOO STRONG' : 'SHORT…');
    if (g.netMode === 'host') {
      g.pushNetEvent({ ev: 'sw', ty: type, hd: '' });
    }
  }



  /* ── scoring & possession ── */

  scoreBasket(who) {
    const g = this.g;
    const shot = this.shot;
    const pts = shot.points;
    this.lastScorer = who;
    this.streak += 1;
    g.rally = this.streak;
    g.longestRally = Math.max(g.longestRally, this.streak);
    g.score[who] += pts;
    g.stats.totalPoints += 1;
    if (who === 'player') {
      g.stats.pointsWon += pts;
      if (shot.quality > 0.82) g.stats.perfects += 1;
      g.stats.winners += 1;
    }
    g.stats.autoShots += 1;

    const swish = !shot.contested && shot.quality > 0.85;
    const reason = (swish ? 'SWISH · +' : '+') + pts + (shot.type === 'THREE' ? ' FROM DOWNTOWN' : '');
    const playerWon = who === 'player';
    const win = this.matchWon();
    g.phase = 'point';
    g.pointTimer = 2.2;
    g.pendingPoint = { winner: who, reason, playerWon, matchWon: win };
    g.player.vel.set(0, 0, 0);
    g.rival.vel.set(0, 0, 0);
    g.matchPoint = !win && this.wouldWinNext();
    g.ui.setPrompt(playerWon ? 'BUCKET!' : 'LAKI SCORES');
    g.updateScoreHud();
    g.world.setScoreboard({
      playerPoints: String(g.score.player),
      rivalPoints: String(g.score.rival),
      label: g.scoreMetaLine(),
      detail: win ? 'GAME' : `RACE TO ${HOOPS.target}`,
      serving: who,
    });
    g.startReplayOrPresent();
    g.world.cheer(playerWon ? 1 : 0.6);
    if (win) {
      g.matchWinner = who;
      g.pendingPoint.matchWon = true;
    }
    this.shot = null;
  }

  matchWon() {
    const g = this.g;
    const { player, rival } = g.score;
    return (player >= HOOPS.target || rival >= HOOPS.target) && Math.abs(player - rival) >= 2;
  }

  wouldWinNext() {
    const g = this.g;
    return g.score.player >= HOOPS.target - 1 || g.score.rival >= HOOPS.target - 1;
  }

  turnover(toWho, reason) {
    const g = this.g;
    this.streak = 0;
    g.rally = 0;
    this.resetPositions(toWho);
    g.ui.setPrompt(reason);
    g.ui.showToast(reason, toWho === 'player' ? 'YOUR BALL' : 'LAKI BALL', 1600);
  }

  /* ── movement ── */

  moveAthlete(who, ix, iz, sprint, dt) {
    const g = this.g;
    const a = who === 'player' ? g.player : g.rival;
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }
    // Aim-relative basis like tennis, but the default look is at the hoop.
    const forward = new THREE.Vector3(Math.sin(g.aimYaw), 0, -Math.cos(g.aimYaw));
    const right = new THREE.Vector3(Math.cos(g.aimYaw), 0, Math.sin(g.aimYaw));
    let speed = sprint ? TUNING.playerSprintSpeed : TUNING.playerSpeed;
    if (this.possession === who) speed *= 0.94;      // ball handling slows a touch
    if (this.possession !== null && this.possession !== who) speed *= 1.04; // defense recovers
    const desired = new THREE.Vector3()
      .addScaledVector(right, ix)
      .addScaledVector(forward, iz)
      .multiplyScalar(speed);
    const lambda = len > 0.01 ? TUNING.playerAccel : TUNING.playerFriction;
    a.vel.x = damp(a.vel.x, desired.x, lambda, dt);
    a.vel.z = damp(a.vel.z, desired.z, lambda, dt);
    a.pos.x = clamp(a.pos.x + a.vel.x * dt, -HOOPS.bounds.x, HOOPS.bounds.x);
    a.pos.z = clamp(a.pos.z + a.vel.z * dt, HOOPS.bounds.zMin, HOOPS.bounds.zMax);
  }

  /* ── CPU ── */

  cpuThink(dt) {
    const g = this.g;
    const me = g.rival.pos;
    const foe = g.player.pos;
    const hoop = HOOP_POS;
    this.cpuHoldTimer += dt;

    if (this.possession === 'rival' && g.ball.mode === 'held' && !this.shot) {
      // Offense: drive to a shooting spot, then shoot when open or clock low.
      const distHoop = Math.hypot(me.x - hoop.x, me.z - hoop.z);
      const targetX = clamp(Math.sin(this.cpuHoldTimer * 0.9) * 3.4, -5, 5);
      const wantZ = hoop.z + (distHoop > 5.2 ? 4.6 : 1.6);
      const dx = targetX - me.x;
      const dz = wantZ - me.z;
      const len = Math.hypot(dx, dz) || 1;
      this.cpuInput.x = clamp(dx / len, -1, 1) * (Math.abs(dx) > 0.5 ? 1 : 0.2);
      this.cpuInput.z = clamp(dz / len, -1, 1) * (Math.abs(dz) > 0.5 ? 1 : 0.2);
      const dDef = Math.hypot(foe.x - me.x, foe.z - me.z);
      const open = dDef > 1.9;
      const goodSpot = distHoop < 6.9;
      if ((goodSpot && open && this.cpuHoldTimer > 0.85) || this.shotClock < 2.4 || distHoop < 2.2) {
        const quality = clamp(0.62 + (open ? 0.2 : 0) - (goodSpot ? 0 : 0.18) + g.rng.range(-0.08, 0.1), 0.2, 0.95);
        this.cpuHoldTimer = 0;
        this.shoot('rival', quality);
        this.cpuInput.x = 0;
        this.cpuInput.z = 0;
      }
    } else if (this.possession === 'player') {
      // Defense: sit on the line between the ball-handler and the hoop.
      const dx = hoop.x - foe.x;
      const dz = hoop.z - foe.z;
      const len = Math.hypot(dx, dz) || 1;
      const guardX = foe.x + (dx / len) * 1.35;
      const guardZ = foe.z + (dz / len) * 1.35;
      const mx = guardX - me.x;
      const mz = guardZ - me.z;
      const mlen = Math.hypot(mx, mz) || 1;
      this.cpuInput.x = clamp(mx / mlen, -1, 1) * (mlen > 0.3 ? 1 : 0);
      this.cpuInput.z = clamp(mz / mlen, -1, 1) * (mlen > 0.3 ? 1 : 0);

      // Steal: breathing on the handler for a while pokes it loose sometimes.
      const dDef = Math.hypot(foe.x - me.x, foe.z - me.z);
      if (dDef < 1.15 && g.ball.mode === 'held') {
        this.stealTimer += dt;
        if (this.stealTimer > 0.7) {
          this.stealTimer = 0;
          if (g.rng.chance(0.4)) {
            this.turnover('rival', 'LAKI POKED IT FREE');
            this.cpuInput.x = 0;
            this.cpuInput.z = 0;
          }
        }
      } else {
        this.stealTimer = Math.max(0, this.stealTimer - dt);
      }
    } else {
      // Loose ball / shot in the air: chase the landing spot.
      const b = g.ball;
      const tx = b.mode === 'held' ? me.x : clamp(b.pos.x + b.vel.x * 0.35, -HOOPS.bounds.x, HOOPS.bounds.x);
      const tz = b.mode === 'held' ? me.z : clamp(b.pos.z + b.vel.z * 0.35, HOOPS.bounds.zMin, HOOPS.bounds.zMax);
      const dx = tx - me.x;
      const dz = tz - me.z;
      const len = Math.hypot(dx, dz) || 1;
      this.cpuInput.x = clamp(dx / len, -1, 1);
      this.cpuInput.z = clamp(dz / len, -1, 1);
    }
  }

  /* ── ball physics ── */

  ballPhysics(dt) {
    const g = this.g;
    const b = g.ball;

    if (b.mode === 'held' && this.possession) {
      const p = this.holdPos(this.possession);
      const dribble = 0.32 + Math.abs(Math.sin(g.elapsed * 7.5)) * 0.55;
      const carrier = this.possession;
      const moving = carrier === 'player'
        ? g.player.vel.length() > 1.4
        : g.rival.vel.length() > 1.4;
      b.pos.set(p.x, moving ? dribble : 1.02, p.z);
      b.mesh.position.copy(b.pos);
      return;
    }

    if (b.mode !== 'flight') return;
    this.prevBallY = b.pos.y;
    // Substepped fall integration keeps Euler drift well under a centimetre
    // so aimed shots land where the solver says they should.
    const steps = 4;
    for (let i = 0; i < steps; i += 1) {
      b.vel.y -= (HOOPS.gravity * dt) / steps;
      b.pos.addScaledVector(b.vel, dt / steps);
    }

    // Backboard.
    if (
      b.pos.z < HOOPS.boardZ + HOOPS.ballR &&
      b.pos.z > HOOPS.boardZ - 0.35 &&
      b.vel.z < 0 &&
      b.pos.y > HOOPS.boardBotY - 0.1 &&
      b.pos.y < HOOPS.boardBotY + HOOPS.boardH + 0.1 &&
      Math.abs(b.pos.x) < HOOPS.boardW / 2 + HOOPS.ballR * 0.5
    ) {
      b.pos.z = HOOPS.boardZ + HOOPS.ballR;
      b.vel.z = Math.abs(b.vel.z) * 0.52;
      b.vel.x *= 0.85;
      g.audio.playUi();
      if (this.shot && !this.shot.scored) this.shot.offBoard = true;
    }

    // Rim ring collision — true 3D tube contact (sphere vs torus).
    const rim = HOOPS.rimCenter;
    const dxR = b.pos.x - rim.x;
    const dzR = b.pos.z - rim.z;
    const dyR = b.pos.y - rim.y;
    const dFlat = Math.hypot(dxR, dzR);
    const contact = HOOPS.ballR + 0.02;      // ball + tube radius
    const skipTube = (this.shot && this.shot.dunk && !this.shot.scored)
      // Descending inside the ring: the net takes it — no front-rim clank.
      || (dFlat < HOOPS.rimR * 0.8 && b.vel.y < -1);
    if (dFlat > 0.01 && !skipTube) {
      const hOff = dFlat - HOOPS.rimR;        // horizontal offset from tube centre
      const dist3 = Math.hypot(hOff, dyR);    // 3D distance to the tube centre-line
      if (dist3 < contact) {
        const hx = dxR / dFlat;
        const hz = dzR / dFlat;
        const safe = dist3 > 1e-4 ? dist3 : 1e-4;
        const nx = (hx * hOff) / safe;
        const ny = dyR / safe;
        const nz = (hz * hOff) / safe;
        const vDot = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
        if (vDot < 0) {
          const j = -1.45 * vDot;
          b.vel.x += j * nx;
          b.vel.y += j * ny;
          b.vel.z += j * nz;
        }
        b.vel.multiplyScalar(0.74);
        // Reset to just outside contact along the normal.
        const tubeCx = rim.x + hx * HOOPS.rimR;
        const tubeCz = rim.z + hz * HOOPS.rimR;
        b.pos.x = tubeCx + nx * contact;
        b.pos.y = rim.y + ny * contact;
        b.pos.z = tubeCz + nz * contact;
        g.audio.playUi();
      }
    }

    // Score: downward crossing of the rim plane inside the ring.
    if (
      this.shot && !this.shot.scored &&
      this.prevBallY > HOOPS.rimCenter.y && b.pos.y <= HOOPS.rimCenter.y &&
      b.vel.y < 0 && dFlat < HOOPS.rimR * (this.shot.dunk ? 0.95 : 0.6)
    ) {
      this.shot.scored = true;
      this.scoreBasket(this.shot.who);
      return;
    }

    // Floor.
    if (b.pos.y < HOOPS.ballR) {
      b.pos.y = HOOPS.ballR;
      if (b.vel.y < -0.4) {
        // Size-7 ball at 8 psi: drops from 1.83 m rebound ~1.3 m (e ≈ 0.84)
        b.vel.y = -b.vel.y * (Math.abs(b.vel.y) > 3 ? 0.84 : 0.7);
        b.vel.x *= 0.88;
        b.vel.z *= 0.88;
        b.bounces += 1;
        g.audio.playUi();
      } else {
        b.vel.y = 0;
        b.vel.x *= 0.985;
        b.vel.z *= 0.985;
      }
    }

    // Rebound: a loose ball near an athlete is picked up (defense recovers too).
    if (b.pos.y < 1.75 && (!this.shot || this.shot.scored || b.bounces > 0 || b.vel.y < 0.5)) {
      for (const who of ['player', 'rival']) {
        const a = who === 'player' ? g.player.pos : g.rival.pos;
        const d = Math.hypot(a.x - b.pos.x, a.z - b.pos.z);
        if (d < 1.3 && b.pos.y < 1.75) {
          if (this.shot && !this.shot.scored) {
            // Missed shot recovered — possession to the rebounder.
            this.streak = 0;
            g.rally = 0;
            this.shot = null;
            this.resetPositions(who);
            g.ui.setPrompt(who === 'player' ? 'REBOUND DUKA' : 'REBOUND LAKI');
            return;
          }
          this.shot = null;
          this.resetPositions(who);
          return;
        }
      }
    }

    // Ball flying far away: safety reset (rare).
    if (b.pos.y < -3 || Math.abs(b.pos.x) > 30 || Math.abs(b.pos.z) > 40) {
      this.turnover('player', 'BALL RESET');
      return;
    }

    // Out of bounds: nearest athlete inbounds it (their possession).
    if (b.pos.y < 1.2 && (Math.abs(b.pos.x) > 8.4 || b.pos.z < HOOPS.bounds.zMin - 0.6 || b.pos.z > HOOPS.bounds.zMax + 0.6)) {
      const toPlayer = g.player.pos.distanceTo(b.pos) <= g.rival.pos.distanceTo(b.pos);
      this.turnover(toPlayer ? 'player' : 'rival', 'OUT OF BOUNDS');
      return;
    }

    // Dead-ball watchdog: a rolling/stranded ball (behind the hoop, or nobody
    // chasing) hands possession to the nearest athlete instead of stalling.
    if (b.bounces >= 2 && b.vel.length() < 1.1 && b.pos.y < 0.6) {
      this.deadBallTimer = (this.deadBallTimer || 0) + dt;
      if (this.deadBallTimer > 1.2) {
        this.deadBallTimer = 0;
        const toPlayer = g.player.pos.distanceTo(b.pos) < g.rival.pos.distanceTo(b.pos);
        this.turnover(toPlayer ? 'player' : 'rival', 'LOOSE BALL');
        return;
      }
    } else {
      this.deadBallTimer = 0;
    }
  }

  /* ── main update (host / vs CPU) ── */

  update(dt, realDt) {
    const g = this.g;
    if (g.phase === 'title') return;

    if (g.phase === 'intro') {
      this.introTimer -= dt;
      g.playerCharacter.update(dt, { speed: 0, maxSpeed: TUNING.playerSpeed });
      g.rivalCharacter.update(dt, { speed: 0, maxSpeed: TUNING.rivalSpeed });
      g.updateCharacters(dt, 0, 0);
      g.ball.mesh.position.copy(g.ball.pos);
      if (this.introTimer <= 0) {
        g.ui.hideCountdown();
        g.phase = 'rally';
        g.ui.setPrompt('YOUR BALL — DRIVE TO THE HOOP');
      }
    } else if (g.phase === 'rally') {
      this.shotClock -= dt;
      if (this.shotClock < 0) {
        this.turnover(this.possession === 'player' ? 'rival' : 'player', 'SHOT CLOCK');
      }

      // Player movement.
      let ix = 0; let iz = 0;
      if (g.keys.has('a')) ix -= 1;
      if (g.keys.has('d')) ix += 1;
      if (g.keys.has('w')) iz += 1;
      if (g.keys.has('s')) iz -= 1;
      if (g.joystick.active) { ix += g.joystick.x; iz += g.joystick.z; }
      this.moveAthlete('player', ix, iz, g.keys.has('shift'), dt);

      // Opponent: guest inputs (host) or CPU (ai).
      if (g.netMode === 'host') {
        this.moveAthlete('rival', g.guestInput.x || 0, g.guestInput.z || 0, Boolean(g.guestInput.sprint), dt);
      } else {
        this.cpuThink(dt);
        this.moveAthlete('rival', this.cpuInput.x, this.cpuInput.z, false, dt);
      }

      // Guest hit requests.
      if (g.netMode === 'host' && g.guestInput.hitSeq > this.guestLastHit) {
        this.guestLastHit = g.guestInput.hitSeq;
        this.guestShoot();
      }

      // Charging: gauge fills; green zone marks the ideal release.
      if (this.charging) {
        this.charge = clamp(this.charge + dt / 0.95, 0, 1);
        const gz = this.greenZone();
        g.ui.setPowerGauge(this.charge, gz.center, gz.width);
      } else {
        g.ui.setPowerGauge(-1);
      }

      this.ballPhysics(dt);
      g.ball.mesh.position.copy(g.ball.pos);
      g.recordReplayFrame();

      const speedP = g.player.vel.length();
      g.updateCharacters(dt, speedP, g.rival.vel.length());

      // HUD: shot preview + charge meter on the readiness ring.
      const a = g.player.pos;
      const dist = Math.hypot(a.x - HOOPS.rimCenter.x, a.z - HOOPS.rimCenter.z);
      const type = this.shotTypeFor(dist);
      const hasBall = this.possession === 'player' && g.ball.mode === 'held';
      const gz = this.greenZone();
      const inGreen = this.charging && Math.abs(this.charge - gz.center) <= gz.width / 2;
      g.ui.setAim({
        shot: hasBall ? type : 'DEFEND',
        hand: hasBall ? (dist >= HOOPS.threeR ? '· 3 PTS' : '· 2 PTS') : '',
        ready: inGreen,
        readiness: this.charging ? this.charge : (hasBall ? 0.35 : 0),
      });
      if (!g.ui.el.prompt.textContent || g.ui.el.prompt.textContent === 'GET READY') {
        g.ui.setPrompt(hasBall ? 'HOLD CLICK TO CHARGE · RELEASE TO SHOOT' : 'DEFEND YOUR BASKET');
      }
      if (this.charging) {
        const gz2 = this.greenZone();
        const inG = Math.abs(this.charge - gz2.center) <= gz2.width / 2;
        g.ui.setPrompt(
          this.charge > 0.97 ? 'MAX POWER — RELEASE!' : inG ? 'GREEN — RELEASE NOW!' : 'CHARGING…',
          inG ? 'ready' : 'neutral'
        );
      }
    } else if (g.phase === 'point') {
      g.updatePoint(dt);
    } else if (g.phase === 'over') {
      g.updateOver(dt);
    }

    // Shared world/camera/audio upkeep (same as the tennis loop).
    g.world.update(realDt, g.elapsed);
    g.updateCamera(realDt);
    if (g.netMode === 'host' && g.net.inRoom) {
      g.snapTimer = (g.snapTimer || 0) + realDt;
      if (g.snapTimer >= 0.05) {
        g.snapTimer = 0;
        this.sendSnap();
      }
    }
  }

  // Ball keeps falling (visually) while the point banner / replay shows.
  pointBallFall(dt) {
    const b = this.g.ball;
    if (b.mode !== 'flight') return;
    b.vel.y -= HOOPS.gravity * dt;
    b.pos.addScaledVector(b.vel, dt);
    if (b.pos.y < HOOPS.ballR) {
      b.pos.y = HOOPS.ballR;
      b.vel.y = b.vel.y < -0.4 ? -b.vel.y * 0.5 : 0;
      b.vel.x *= 0.9;
      b.vel.z *= 0.9;
    }
    b.mesh.position.copy(b.pos);
  }

  sendSnap() {
    const g = this.g;
    if (!g.net.inRoom) return;
    g.net.sendSnap({
      ph: g.phase,
      sv: 'player',
      ss: 'idle',
      sc: [g.score.player, g.score.rival],
      lb: [String(g.score.player), String(g.score.rival), `RACE TO ${HOOPS.target}`],
      ra: g.rally,
      mp: g.matchPoint,
      mw: g.matchWinner,
      b: {
        x: +g.ball.pos.x.toFixed(3),
        y: +g.ball.pos.y.toFixed(3),
        z: +g.ball.pos.z.toFixed(3),
        m: g.ball.mode,
        c: '#e07b34',
        l: g.ball.lastHitter,
      },
      p: { x: +g.player.pos.x.toFixed(2), z: +g.player.pos.z.toFixed(2) },
      r: { x: +g.rival.pos.x.toFixed(2), z: +g.rival.pos.z.toFixed(2) },
      ev: g.remoteEvents.splice(0, g.remoteEvents.length),
      sq: ++g.snapSeq,
    });
  }

  /* ── guest rendering ── */

  guestUpdate(dt, realDt) {
    const g = this.g;
    const snap = g.snapshot;
    if (!snap) return;

    // Own movement predicted locally, eased toward the host's word.
    const auth = new THREE.Vector3(-snap.r.x, 0, -snap.r.z);
    if (!this.guestPredicted) this.guestPredicted = auth.clone();
    let ix = 0; let iz = 0;
    if (g.keys.has('a')) ix -= 1;
    if (g.keys.has('d')) ix += 1;
    if (g.keys.has('w')) iz += 1;
    if (g.keys.has('s')) iz -= 1;
    if (g.joystick.active) { ix += g.joystick.x; iz += g.joystick.z; }
    const speed = g.keys.has('shift') ? TUNING.playerSprintSpeed : TUNING.playerSpeed;
    this.guestPredicted.x = clamp(this.guestPredicted.x + ix * speed * dt, -HOOPS.bounds.x, HOOPS.bounds.x);
    this.guestPredicted.z = clamp(this.guestPredicted.z + iz * speed * dt, HOOPS.bounds.zMin, HOOPS.bounds.zMax);
    this.guestPredicted.x = damp(this.guestPredicted.x, auth.x, 4, dt);
    this.guestPredicted.z = damp(this.guestPredicted.z, auth.z, 4, dt);
    g.player.pos.copy(this.guestPredicted);
    g.rival.pos.set(-snap.p.x, 0, -snap.p.z);

    // Ball (mirror to arena-local).
    g.ball.pos.set(-snap.b.x, snap.b.y, -snap.b.z);
    g.ball.mode = snap.b.m;
    g.ball.lastHitter = snap.b.l;
    g.ball.mesh.visible = true;
    g.ball.mesh.position.copy(g.ball.pos);
    if (g.ball.glow) { g.ball.glow.visible = snap.b.m === 'flight'; g.ball.glow.position.copy(g.ball.pos); }
    g.ball.shadow.visible = true;
    g.ball.shadow.position.set(g.ball.pos.x, 0.014, g.ball.pos.z);

    g.phase = snap.ph;
    g.rally = snap.ra;
    g.matchPoint = snap.mp;
    g.matchWinner = snap.mw;
    g.score.player = snap.sc[1];
    g.score.rival = snap.sc[0];
    const key = snap.sc.join('-') + '|' + snap.ph;
    if (key !== this._lastKey) {
      this._lastKey = key;
      g.updateScoreHud();
    }
    if (this.charging) {
      this.charge = clamp(this.charge + dt / 0.95, 0, 1);
      const gz = this.greenZone();
      g.ui.setPowerGauge(this.charge, gz.center, gz.width);
    }
    if (this.charging && !this.iHaveBall()) this.charging = false;
    const iHaveBall = snap.b.l === 'rival' && snap.b.m === 'held';
    const dist = Math.hypot(g.player.pos.x - HOOPS.rimCenter.x, g.player.pos.z - HOOPS.rimCenter.z);
    const type = this.shotTypeFor(dist);
    g.ui.setAim({
      shot: iHaveBall ? type : 'DEFEND',
      hand: iHaveBall ? (dist >= HOOPS.threeR ? '· 3 PTS' : '· 2 PTS') : '',
      ready: this.charging && Math.abs(this.charge - this.greenZone().center) <= this.greenZone().width / 2,
      readiness: this.charging ? this.charge : (iHaveBall ? 0.35 : 0),
    });

    const speedP = g.player.vel.length();
    g.updateCharacters(dt, speedP, 0);
    g.world.update(realDt, g.elapsed);
    g.updateCamera(realDt);
  }
}
