import * as THREE from 'three';

const MAX_PARTICLES = 360;
const MAX_RINGS = 14;

function pseudoNoise(t, seed) {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export class Effects {
  constructor(scene, { reducedMotion = false } = {}) {
    this.scene = scene;
    this.reducedMotion = reducedMotion;
    this.trauma = 0;
    this.time = 0;
    this.baseFov = null;
    this.fovPunch = 0;

    // Particle pool.
    this.particlePositions = new Float32Array(MAX_PARTICLES * 3);
    this.particles = Array.from({ length: MAX_PARTICLES }, () => ({
      life: 0,
      maxLife: 1,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      gravity: 0,
      drag: 0.9,
      size: 0.06,
      color: new THREE.Color(),
    }));
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      this.particlePositions[i * 3 + 1] = -100;
    }
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    const alphas = new Float32Array(MAX_PARTICLES);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.particleGeo = geo;
    this.particleColors = colors;
    this.particleSizes = sizes;
    this.particleAlphas = alphas;
    this.particleMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (340.0 / max(-mv.z, 1.0)), 0.7, 22.0);
          gl_Position = projectionMatrix * mv;
          vColor = aColor;
          vAlpha = aAlpha;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });
    this.particlePoints = new THREE.Points(geo, this.particleMaterial);
    this.particlePoints.frustumCulled = false;
    scene.add(this.particlePoints);
    this.particleCursor = 0;

    // Ground rings.
    const ringGeo = new THREE.RingGeometry(0.72, 0.82, 36);
    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffd36e,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(ringGeo, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 0.55, scale: 1 });
    }
    this.ringCursor = 0;

    // A soft flash sprite at contact points.
    this.flashTexture = (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,220,140,0.6)');
      grad.addColorStop(1, 'rgba(255,160,80,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    this.flashes = [];
    for (let i = 0; i < 8; i += 1) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.flashTexture,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          color: 0xffe6ac,
          opacity: 0,
        })
      );
      sprite.visible = false;
      scene.add(sprite);
      this.flashes.push({ sprite, life: 0, maxLife: 0.2 });
    }
    this.flashCursor = 0;
  }

  setFovBase(base) {
    this.baseFov = base;
  }

  addTrauma(amount) {
    if (this.reducedMotion) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  punchFov(degrees) {
    this.fovPunch = Math.min(11, this.fovPunch + degrees);
  }

  spawnBurst(position, color, count = 18, speed = 3.2, gravity = 5, size = 0.05) {
    const baseColor = new THREE.Color(color);
    for (let i = 0; i < count; i += 1) {
      const index = this.particleCursor;
      this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
      const p = this.particles[index];
      p.pos.copy(position);
      const direction = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 1.2 + 0.1,
        Math.random() * 2 - 1
      ).normalize();
      p.vel.copy(direction).multiplyScalar(speed * (0.35 + Math.random() * 0.8));
      p.gravity = gravity;
      p.drag = 0.82;
      p.life = 0.35 + Math.random() * 0.42;
      p.maxLife = p.life;
      p.size = size * (0.65 + Math.random() * 0.95);
      p.color.copy(baseColor);
      p.color.offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.14);

      const cIndex = index * 3;
      this.particleColors[cIndex] = p.color.r;
      this.particleColors[cIndex + 1] = p.color.g;
      this.particleColors[cIndex + 2] = p.color.b;
      this.particleSizes[index] = p.size;
      this.particleAlphas[index] = 1;
    }
  }

  spawnContact(position, color = 0xffd36e, power = 1) {
    this.spawnBurst(position, color, Math.round(14 + 14 * power), 3 + power * 4, 5.5, 0.055);
    this.spawnFlash(position, color, 0.6 + power * 0.8);
    this.addTrauma(0.18 + power * 0.22);
    this.punchFov(1.7 + power * 1.3);
    if (power > 0.8) this.spawnRing(position, color, 1.7, 0.42);
  }

  spawnBounce(position, color = 0xffc288, power = 1) {
    const p = position.clone();
    p.y = 0.06;
    this.spawnBurst(p, color, 10, 1.4 + power, 1.8, 0.045);
    this.spawnRing(p, color, 1.1 + power * 0.5, 0.42);
    this.addTrauma(0.035);
  }

  spawnNet(position) {
    this.spawnBurst(position, 0xd9e6e0, 12, 2.2, 4.5, 0.035);
  }

  spawnFlash(position, color = 0xffd36e, scale = 1) {
    const entry = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    const sprite = entry.sprite;
    sprite.position.copy(position);
    sprite.material.color.set(color);
    sprite.material.opacity = 0.9;
    sprite.scale.setScalar(0.8 * scale);
    sprite.visible = true;
    entry.life = entry.maxLife;
    entry.baseScale = scale;
  }

  spawnRing(position, color = 0xffd36e, scale = 1, duration = 0.5) {
    const entry = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    const p = position.clone();
    p.y = 0.025;
    entry.mesh.position.copy(p);
    entry.mesh.material.color.set(color);
    entry.mesh.material.opacity = 0.9;
    entry.mesh.scale.setScalar(0.28 * scale);
    entry.mesh.visible = true;
    entry.life = duration;
    entry.maxLife = duration;
    entry.scale = scale;
  }

  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * (this.reducedMotion ? 5 : 1.55));

    let anyParticles = false;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const p = this.particles[i];
      if (p.life <= 0) {
        this.particleAlphas[i] = 0;
        continue;
      }
      anyParticles = true;
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.03) {
        p.pos.y = 0.03;
        p.vel.y *= -0.3;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      const cIndex = i * 3;
      this.particlePositions[cIndex] = p.pos.x;
      this.particlePositions[cIndex + 1] = p.pos.y;
      this.particlePositions[cIndex + 2] = p.pos.z;
      const t = Math.max(0, p.life / p.maxLife);
      this.particleAlphas[i] = t * t;
    }
    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.aAlpha.needsUpdate = true;
    this.particleGeo.attributes.aColor.needsUpdate = true;
    this.particleGeo.attributes.aSize.needsUpdate = true;
    this.particlePoints.visible = anyParticles || true;

    for (const entry of this.rings) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      const t = 1 - Math.max(0, entry.life / entry.maxLife);
      entry.mesh.scale.setScalar((0.28 + t * 3.4) * entry.scale);
      entry.mesh.material.opacity = (1 - t) * 0.9;
      if (entry.life <= 0) entry.mesh.visible = false;
    }

    for (const entry of this.flashes) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      const t = 1 - Math.max(0, entry.life / entry.maxLife);
      entry.sprite.material.opacity = (1 - t) * 0.9;
      entry.sprite.scale.setScalar((0.8 + t * 1.8) * (entry.baseScale || 1));
      if (entry.life <= 0) entry.sprite.visible = false;
    }

    if (this.fovPunch > 0.001) {
      this.fovPunch *= Math.exp(-dt / 0.18);
    } else {
      this.fovPunch = 0;
    }
  }

  applyCameraShake(camera) {
    if (this.reducedMotion || this.trauma <= 0.001) {
      return;
    }
    const shake = this.trauma * this.trauma;
    const t = this.time * 33;
    camera.position.x += 0.22 * shake * pseudoNoise(t, 1);
    camera.position.y += 0.16 * shake * pseudoNoise(t, 2);
    camera.position.z += 0.1 * shake * pseudoNoise(t, 3);
    camera.rotation.z += 0.028 * shake * pseudoNoise(t, 4);
  }

  getFov(baseFov) {
    if (!this.reducedMotion) return baseFov + this.fovPunch;
    return baseFov;
  }
}
