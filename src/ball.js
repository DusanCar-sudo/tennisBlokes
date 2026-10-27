import * as THREE from 'three';
import { COURT, GRAVITY, SHOTS } from './config.js';
import { clamp } from './utils.js';
import { netHeightAt } from './court.js';

const TRAIL_LENGTH = 30;
const FIXED_STEP = 1 / 120;

function makeShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.58)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Predictive trajectory used by shots, the AI and the aim preview.
 */
export function solveTrajectory(origin, target, shotType = 'topspin', power = 1) {
  const def = SHOTS[shotType] ?? SHOTS.topspin;
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const dist = Math.hypot(dx, dz);
  const desiredSpeed = def.speed * clamp(power, 0.55, 1.2);
  let flightTime = clamp(dist / Math.max(desiredSpeed, 5), 0.24, 2.6);
  let vx = 0;
  let vz = 0;
  let vy = 0;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    vx = dx / flightTime;
    vz = dz / flightTime;
    vy = (0.033 - origin.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime;
    let clearsNet = true;
    if (Math.abs(vz) > 0.001) {
      const tNet = (COURT.netZ - origin.z) / vz;
      if (tNet > 0.02 && tNet < flightTime) {
        const xNet = origin.x + vx * tNet;
        const yNet = origin.y + vy * tNet - 0.5 * GRAVITY * tNet * tNet;
        const required = netHeightAt(xNet) + COURT.ballRadius + 0.14;
        if (yNet < required) {
          clearsNet = false;
          flightTime *= 1.13;
        }
      }
    }
    if (clearsNet) break;
  }

  return {
    velocity: new THREE.Vector3(vx, vy, vz),
    flightTime,
    speed: Math.hypot(vx, vz),
  };
}

export class Ball {
  constructor(scene, material) {
    this.radius = COURT.ballRadius;
    this.pos = new THREE.Vector3(0, 1.2, 5);
    this.vel = new THREE.Vector3();
    this.prevPos = this.pos.clone();
    this.mode = 'hidden';
    this.lastHitter = null;
    this.shotType = 'topspin';
    this.bounces = 0;
    this.events = [];
    this.served = false;
    this.hitContactPoint = new THREE.Vector3();
    this.spinAxis = new THREE.Vector3(1, 0, 0);
    this.spinRate = 0;
    this.time = 0;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 28, 20),
      material
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.mesh.scale.setScalar(1.5);
    this.mesh.name = 'tennis-ball';
    scene.add(this.mesh);

    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const glowCtx = glowCanvas.getContext('2d');
    const glowGrad = glowCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    glowGrad.addColorStop(0, 'rgba(245,255,160,0.9)');
    glowGrad.addColorStop(0.24, 'rgba(229,247,70,0.42)');
    glowGrad.addColorStop(0.62, 'rgba(255,233,120,0.09)');
    glowGrad.addColorStop(1, 'rgba(255,233,120,0)');
    glowCtx.fillStyle = glowGrad;
    glowCtx.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    this.glow.scale.set(0.23, 0.23, 1);
    this.glow.visible = false;
    scene.add(this.glow);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.38, 0.38),
      new THREE.MeshBasicMaterial({
        map: makeShadowTexture(),
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        color: 0x000000,
      })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.014;
    this.shadow.renderOrder = 2;
    this.shadow.visible = false;
    scene.add(this.shadow);

    this.rim = new THREE.Mesh(
      new THREE.RingGeometry(this.radius * 1.05, this.radius * 1.32, 24),
      new THREE.MeshBasicMaterial({
        color: 0xfff2a6,
        transparent: true,
        opacity: 0.38,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.rim.visible = false;
    scene.add(this.rim);

    this.trailPositions = new Float32Array(TRAIL_LENGTH * 3);
    this.trailAlphas = new Float32Array(TRAIL_LENGTH);
    for (let i = 0; i < TRAIL_LENGTH; i += 1) {
      this.trailAlphas[i] = 0;
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.trailAlphas, 1));
    this.trailMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(SHOTS.topspin.trail) },
        uSize: { value: 9.0 },
      },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vAlpha;
        uniform float uSize;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(uSize * 30.0 / max(-mv.z, 2.0), 1.0, 14.0);
          gl_Position = projectionMatrix * mv;
          vAlpha = aAlpha;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float glow = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(uColor, glow * vAlpha * 0.6);
        }
      `,
    });
    this.trail = new THREE.Points(trailGeo, this.trailMaterial);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.trail);
    this.trailTimer = 0;
  }

  reset(pos = new THREE.Vector3(0, 1.2, 5)) {
    this.pos.copy(pos);
    this.prevPos.copy(pos);
    this.vel.set(0, 0, 0);
    this.mode = 'hidden';
    this.lastHitter = null;
    this.bounces = 0;
    this.events.length = 0;
    this.served = false;
    this.time = 0;
    this.mesh.visible = false;
    this.shadow.visible = false;
    this.rim.visible = false;
    this.trail.visible = false;
    if (this.glow) this.glow.visible = false;
    this._clearTrail();
  }

  hide() {
    this.mesh.visible = false;
    this.shadow.visible = false;
    this.rim.visible = false;
    this.trail.visible = false;
    if (this.glow) this.glow.visible = false;
    this.mode = 'hidden';
  }

  setHeld(position) {
    this.mode = 'held';
    this.pos.copy(position);
    this.prevPos.copy(position);
    this.vel.set(0, 0, 0);
    this.mesh.position.copy(position);
    this.mesh.visible = true;
    if (this.glow) {
      this.glow.position.copy(position);
      this.glow.visible = true;
    }
    this.shadow.visible = false;
    this.rim.visible = false;
    this.trail.visible = false;
  }

  tossFrom(position, velocity = new THREE.Vector3(0, 5.4, 0)) {
    this.mode = 'toss';
    this.pos.copy(position);
    this.prevPos.copy(position);
    this.vel.copy(velocity);
    this.mesh.visible = true;
    this.shadow.visible = false;
    this.rim.visible = false;
    this.trail.visible = false;
    if (this.glow) {
      this.glow.position.copy(position);
      this.glow.visible = true;
    }
  }

  setShotColor(color) {
    this.trailMaterial.uniforms.uColor.value.set(color);
  }

  launch(origin, target, shotType = 'topspin', power = 1) {
    const def = SHOTS[shotType] ?? SHOTS.topspin;
    this.setShotColor(def.color);
    this.mode = 'flight';
    this.lastHitter = null;
    this.bounces = 0;
    this.served = false;
    this.events.length = 0;
    this.time = 0;
    this.pos.copy(origin);
    this.prevPos.copy(origin);
    this.vel.set(0, 0, 0);
    this.mesh.visible = true;
    this.trail.visible = true;
    if (this.glow) this.glow.visible = true;
    this._clearTrail();

    const trajectory = solveTrajectory(origin, target, shotType, power);
    this.vel.copy(trajectory.velocity);
    this.spinRate = clamp(trajectory.speed * 1.35, 4, 48);
    const horizontal = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize();
    this.spinAxis.set(horizontal.z, 0.2, -horizontal.x).normalize();
    this.shotType = def.key;
  }

  setHitter(hitter) {
    this.lastHitter = hitter;
    this.served = false;
    this.bounces = 0;
  }

  markServe(hitter) {
    this.lastHitter = hitter;
    this.served = true;
    this.bounces = 0;
  }

  predictLanding() {
    if (this.mode !== 'flight' && this.mode !== 'toss') return null;
    const yStart = this.pos.y - this.radius;
    const vy = this.vel.y;
    const g = GRAVITY;
    const disc = vy * vy + 2 * g * yStart;
    if (disc < 0) return null;
    const t = (vy + Math.sqrt(disc)) / g;
    if (t < 0 || !Number.isFinite(t)) return null;
    return {
      x: this.pos.x + this.vel.x * t,
      z: this.pos.z + this.vel.z * t,
      time: t,
      y: this.radius,
    };
  }

  positionAt(time) {
    return new THREE.Vector3(
      this.pos.x + this.vel.x * time,
      this.pos.y + this.vel.y * time - 0.5 * GRAVITY * time * time,
      this.pos.z + this.vel.z * time
    );
  }

  update(dt) {
    this.time += dt;
    if (this.mode === 'held' || this.mode === 'hidden') {
      this.mesh.position.copy(this.pos);
      return;
    }

    if (this.mode === 'toss') {
      this.prevPos.copy(this.pos);
      this.vel.y -= GRAVITY * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y < this.radius * 1.2) {
        this.pos.y = this.radius * 1.2;
        this.vel.y = 0;
      }
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.x += dt * 3;
      this.mesh.rotation.z += dt * 2;
      if (this.glow) {
        this.glow.position.copy(this.pos);
        this.glow.material.opacity = 0.55 + Math.sin(this.time * 8) * 0.12;
      }
      return;
    }

    if (this.mode !== 'flight') return;

    let remaining = Math.min(dt, 0.06);
    let steps = Math.max(1, Math.ceil(remaining / FIXED_STEP));
    steps = Math.min(steps, 9);
    const step = remaining / steps;

    for (let i = 0; i < steps; i += 1) {
      if (this.mode !== 'flight') break;
      this.prevPos.copy(this.pos);
      this.vel.y -= GRAVITY * step;
      this.pos.addScaledVector(this.vel, step);

      // Net cord: test the vertical plane crossing each substep.
      const crossedNet =
        (this.prevPos.z > COURT.netZ && this.pos.z <= COURT.netZ) ||
        (this.prevPos.z < COURT.netZ && this.pos.z >= COURT.netZ);
      if (crossedNet) {
        const denom = this.pos.z - this.prevPos.z;
        const t = denom === 0 ? 0 : (COURT.netZ - this.prevPos.z) / denom;
        const x = this.prevPos.x + (this.pos.x - this.prevPos.x) * t;
        const y = this.prevPos.y + (this.pos.y - this.prevPos.y) * t;
        if (Math.abs(x) < COURT.netPostX && y < netHeightAt(x) + this.radius) {
          this.events.push({
            kind: 'net',
            position: new THREE.Vector3(x, Math.max(y, 0.05), COURT.netZ),
            hitter: this.lastHitter,
          });
          this.vel.multiplyScalar(0.1);
          this.vel.y = 0;
          this.mode = 'dead';
          this.trail.visible = false;
          if (this.glow) this.glow.visible = false;
          break;
        }
      }

      // Floor bounce.
      if (this.pos.y < this.radius && this.vel.y < 0) {
        this.pos.y = this.radius;
        const def = SHOTS[this.shotType] ?? SHOTS.topspin;
        const speed = Math.hypot(this.vel.x, this.vel.z);
        const side = this.pos.z >= 0 ? 'player' : 'rival';
        const index = this.bounces;
        const inBounds =
          Math.abs(this.pos.x) <= COURT.singlesHalf + 0.02 &&
          Math.abs(this.pos.z) <= COURT.baseline + 0.02;
        const expectedSide = this.lastHitter === 'player' ? 'rival' : 'player';
        const serveIn =
          !this.served ||
          (Math.abs(this.pos.z) <= COURT.serviceLine + 0.02 &&
            Math.abs(this.pos.x) <= COURT.singlesHalf + 0.02);
        this.bounces += 1;
        this.events.push({
          kind: 'bounce',
          index,
          side,
          expectedSide,
          inBounds,
          serveIn,
          served: this.served,
          x: this.pos.x,
          z: this.pos.z,
          speed,
          shotType: this.shotType,
          position: this.pos.clone(),
        });

        this.vel.y = -this.vel.y * def.restitution;
        this.vel.x *= def.friction;
        this.vel.z *= def.friction;
        if (Math.abs(this.vel.y) < 0.45) this.vel.y = 0;
      }
    }

    this.mesh.position.copy(this.pos);
    if (this.glow) {
      this.glow.position.copy(this.pos);
      this.glow.material.opacity = 0.46 + Math.sin(this.time * 12) * 0.08;
    }
    this.mesh.rotation.x += this.spinRate * dt * 0.65;
    this.mesh.rotation.y += this.spinRate * dt * 0.22;
    this.mesh.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(this.spinAxis, this.spinRate * dt * 0.35)
    );

    // Ball shadow and rim glow.
    const height = this.pos.y;
    this.shadow.visible = this.pos.y < 5.2;
    this.shadow.position.set(this.pos.x, 0.014, this.pos.z);
    const shadowScale = clamp(1.2 - height * 0.12, 0.45, 1.3);
    this.shadow.scale.setScalar(shadowScale);
    this.shadow.material.opacity = clamp(0.7 - height * 0.07, 0.16, 0.68);

    this.rim.visible = true;
    this.rim.position.copy(this.pos);
    this.rim.lookAt(
      this.pos.x + this.vel.x,
      this.pos.y + this.vel.y,
      this.pos.z + this.vel.z
    );
    this.rim.material.opacity = 0.18 + Math.sin(this.time * 18) * 0.07;

    // Trail.
    this.trail.visible = speedFor(this.vel) > 4;
    this.trailTimer += dt;
    if (this.trailTimer > 0.016 && this.trail.visible) {
      this.trailTimer = 0;
      this._pushTrail();
    }
    this._updateTrailMesh();
  }

  _clearTrail() {
    for (let i = 0; i < TRAIL_LENGTH; i += 1) {
      this.trailPositions[i * 3] = 0;
      this.trailPositions[i * 3 + 1] = -10;
      this.trailPositions[i * 3 + 2] = 0;
      this.trailAlphas[i] = 0;
    }
    if (this.trail) {
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.attributes.aAlpha.needsUpdate = true;
    }
  }

  _pushTrail() {
    for (let i = TRAIL_LENGTH - 1; i > 0; i -= 1) {
      this.trailPositions[i * 3] = this.trailPositions[(i - 1) * 3];
      this.trailPositions[i * 3 + 1] = this.trailPositions[(i - 1) * 3 + 1];
      this.trailPositions[i * 3 + 2] = this.trailPositions[(i - 1) * 3 + 2];
    }
    this.trailPositions[0] = this.pos.x;
    this.trailPositions[1] = this.pos.y;
    this.trailPositions[2] = this.pos.z;
    this.trail.geometry.attributes.position.needsUpdate = true;

    for (let i = 0; i < TRAIL_LENGTH; i += 1) {
      this.trailAlphas[i] = Math.max(0, 1 - i / TRAIL_LENGTH) * 0.95;
    }
    this.trail.geometry.attributes.aAlpha.needsUpdate = true;
  }

  _updateTrailMesh() {
    if (!this.trail.visible) return;
    for (let i = 0; i < TRAIL_LENGTH; i += 1) {
      this.trailAlphas[i] *= 0.985;
    }
    this.trail.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

function speedFor(v) {
  return Math.hypot(v.x, v.y, v.z);
}
