import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from './utils.js';
import { makeJerseyBackTexture } from './textures.js';

const shadowTexture = (() => {
  let tex;
  return () => {
    if (tex) return tex;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 63);
    grad.addColorStop(0, 'rgba(0,0,0,0.6)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
})();

const BASE_POSE = Object.freeze({
  torsoX: -0.06,
  torsoY: 0.07,
  torsoZ: 0,
  hipY: 0.923,
  headX: -0.02,
  headY: 0.05,
  headZ: 0,
  rShoulderX: 0.5,
  rShoulderY: -0.06,
  rShoulderZ: 0.26,
  rElbowX: 0.82,
  rElbowY: 0,
  rElbowZ: 0,
  lShoulderX: 0.32,
  lShoulderY: 0.06,
  lShoulderZ: -0.22,
  lElbowX: 0.48,
  lElbowY: 0,
  lElbowZ: 0,
  rWristX: 0,
  rWristZ: 0,
  lWristX: 0,
  lWristZ: 0,
  lHipX: 0.08,
  rHipX: -0.1,
  lKneeX: -0.19,
  rKneeX: -0.22,
  lFootX: 0.12,
  rFootX: 0.14,
});

const pose = (overrides) => ({ ...BASE_POSE, ...overrides });

const SWING_KEYS = {
  forehand: [
    { t: 0, ...BASE_POSE },
    { t: 0.23, ...pose({
      torsoY: -0.58, torsoZ: 0.06, torsoX: -0.1,
      rShoulderX: 0.08, rShoulderY: -0.2, rShoulderZ: 0.62, rElbowX: 0.7,
      lShoulderX: 0.8, lShoulderZ: 0.36, lElbowX: 0.9,
      hipY: 0.905, lHipX: 0.18, rHipX: -0.2, lKneeX: -0.3, rKneeX: -0.3,
    }) },
    { t: 0.46, ...pose({
      torsoY: 0.5, torsoZ: -0.08, torsoX: -0.16,
      rShoulderX: 1.35, rShoulderY: -0.4, rShoulderZ: -0.65, rElbowX: 0.28,
      lShoulderX: 0.22, lShoulderZ: 0.55, lElbowX: 0.5,
      hipY: 0.895, lHipX: 0.3, rHipX: -0.26, lKneeX: -0.35, rKneeX: -0.32,
    }) },
    { t: 0.68, ...pose({
      torsoY: 0.72, torsoZ: -0.05, torsoX: -0.08,
      rShoulderX: 1.1, rShoulderY: -0.3, rShoulderZ: -1.0, rElbowX: 0.65,
      lShoulderX: 0.35, lShoulderZ: 0.42, lElbowX: 0.55,
      hipY: 0.905,
    }) },
    { t: 1, ...BASE_POSE },
  ],
  backhand: [
    { t: 0, ...BASE_POSE },
    { t: 0.23, ...pose({
      torsoY: 0.58, torsoZ: -0.05, torsoX: -0.1,
      rShoulderX: 0.64, rShoulderY: 0.18, rShoulderZ: -0.82, rElbowX: 1.35,
      lShoulderX: 1.05, lShoulderY: -0.3, lShoulderZ: -0.45, lElbowX: 0.55,
      hipY: 0.907, lHipX: 0.1, rHipX: 0.02, lKneeX: -0.27, rKneeX: -0.28,
    }) },
    { t: 0.46, ...pose({
      torsoY: -0.5, torsoZ: 0.06, torsoX: -0.15,
      rShoulderX: 1.25, rShoulderY: 0.32, rShoulderZ: -0.1, rElbowX: 0.4,
      lShoulderX: 1.08, lShoulderY: -0.1, lShoulderZ: 0.25, lElbowX: 0.35,
      hipY: 0.9, lHipX: 0.24, rHipX: 0.04, lKneeX: -0.34, rKneeX: -0.3,
    }) },
    { t: 0.68, ...pose({
      torsoY: -0.68, torsoX: -0.08,
      rShoulderX: 1.0, rShoulderY: 0.3, rShoulderZ: 0.35, rElbowX: 0.7,
      lShoulderX: 1.0, lShoulderZ: 0.1, lElbowX: 0.6,
    }) },
    { t: 1, ...BASE_POSE },
  ],
  volley: [
    { t: 0, ...BASE_POSE },
    { t: 0.16, ...pose({
      torsoY: 0.15, torsoX: -0.1,
      rShoulderX: 0.86, rShoulderZ: -0.36, rElbowX: 1.18,
      lShoulderX: 0.8, lShoulderZ: 0.18, lElbowX: 0.85,
      hipY: 0.9, lHipX: 0.23, rHipX: -0.16, lKneeX: -0.27, rKneeX: -0.26,
    }) },
    { t: 0.35, ...pose({
      torsoY: -0.1, torsoX: -0.18,
      rShoulderX: 1.45, rShoulderZ: -0.25, rElbowX: 0.35,
      lShoulderX: 1.18, lShoulderZ: 0.3, lElbowX: 0.4,
      hipY: 0.885, lHipX: 0.32, rHipX: -0.22, lKneeX: -0.32, rKneeX: -0.28,
    }) },
    { t: 0.58, ...pose({
      torsoY: -0.15, torsoX: -0.12,
      rShoulderX: 1.25, rShoulderZ: -0.4, rElbowX: 0.62,
      lShoulderX: 0.95, lShoulderZ: 0.3, lElbowX: 0.62,
    }) },
    { t: 0.82, ...BASE_POSE },
  ],
  smash: [
    { t: 0, ...BASE_POSE },
    { t: 0.22, ...pose({
      torsoX: 0.14, torsoY: -0.28, torsoZ: 0.02,
      rShoulderX: 2.5, rShoulderY: -0.2, rShoulderZ: 0.22, rElbowX: -0.25,
      lShoulderX: 1.1, lShoulderZ: 0.4, lElbowX: 0.55,
      headX: -0.2, hipY: 0.915,
    }) },
    { t: 0.42, ...pose({
      torsoX: -0.24, torsoY: 0.06, torsoZ: 0,
      rShoulderX: 2.45, rShoulderY: -0.15, rShoulderZ: -0.2, rElbowX: 0.05,
      lShoulderX: 0.35, lShoulderZ: 0.58, lElbowX: 0.4,
      headX: 0.05, hipY: 0.89,
    }) },
    { t: 0.63, ...pose({
      torsoX: -0.28, torsoY: 0.22,
      rShoulderX: 1.25, rShoulderZ: -0.35, rElbowX: 0.35,
      lShoulderX: 0.3, lShoulderZ: 0.45, lElbowX: 0.55,
    }) },
    { t: 0.86, ...BASE_POSE },
  ],
  slice: [
    { t: 0, ...BASE_POSE },
    { t: 0.22, ...pose({
      torsoY: -0.48, torsoX: -0.16,
      rShoulderX: 0.3, rShoulderZ: 0.48, rElbowX: 0.7,
      lShoulderX: 0.55, lShoulderZ: 0.38, lElbowX: 0.8,
      hipY: 0.895, lHipX: 0.28, rHipX: -0.22, lKneeX: -0.36, rKneeX: -0.34,
    }) },
    { t: 0.46, ...pose({
      torsoY: 0.32, torsoX: -0.24,
      rShoulderX: 1.0, rShoulderZ: -0.5, rElbowX: 0.25,
      lShoulderX: 0.38, lShoulderZ: 0.5, lElbowX: 0.6,
      hipY: 0.875, lHipX: 0.34, rHipX: -0.25, lKneeX: -0.4, rKneeX: -0.36,
    }) },
    { t: 0.7, ...pose({
      torsoY: 0.48, torsoX: -0.12,
      rShoulderX: 1.05, rShoulderZ: -0.92, rElbowX: 0.55,
      lShoulderX: 0.35, lShoulderZ: 0.4, lElbowX: 0.55,
    }) },
    { t: 1, ...BASE_POSE },
  ],
  lob: [
    { t: 0, ...BASE_POSE },
    { t: 0.24, ...pose({
      torsoX: 0.02, torsoY: -0.38,
      rShoulderX: 0.1, rShoulderZ: 0.42, rElbowX: 1.1,
      lShoulderX: 0.65, lShoulderZ: 0.36, lElbowX: 0.8,
      hipY: 0.9, lHipX: 0.28, rHipX: -0.24,
    }) },
    { t: 0.48, ...pose({
      torsoX: -0.15, torsoY: 0.2,
      rShoulderX: 1.4, rShoulderZ: -0.3, rElbowX: 0.35,
      lShoulderX: 0.6, lShoulderZ: 0.45, lElbowX: 0.7,
      hipY: 0.88, lHipX: 0.35, rHipX: -0.25, lKneeX: -0.4, rKneeX: -0.36,
    }) },
    { t: 0.72, ...pose({
      torsoX: -0.04, torsoY: 0.35,
      rShoulderX: 1.7, rShoulderZ: -0.55, rElbowX: 0.35,
      lShoulderX: 0.45, lShoulderZ: 0.4, lElbowX: 0.55,
    }) },
    { t: 1, ...BASE_POSE },
  ],
  serve: [
    { t: 0, ...pose({
      torsoX: 0.03, torsoY: -0.15,
      rShoulderX: -0.55, rShoulderZ: 0.45, rElbowX: 1.3,
      lShoulderX: 2.55, lShoulderZ: 0.1, lElbowX: 0.1,
      headX: -0.16,
    }) },
    { t: 0.2, ...pose({
      torsoX: 0.1, torsoY: -0.2,
      rShoulderX: -0.8, rShoulderZ: 0.55, rElbowX: 1.5,
      lShoulderX: 2.8, lShoulderZ: 0.12, lElbowX: 0.05,
      headX: -0.22, hipY: 0.91,
    }) },
    { t: 0.4, ...pose({
      torsoX: -0.16, torsoY: 0.18,
      rShoulderX: 2.72, rShoulderY: -0.12, rShoulderZ: -0.22, rElbowX: 0.08,
      lShoulderX: 0.45, lShoulderZ: 0.55, lElbowX: 0.6,
      headX: 0.04, hipY: 0.89,
    }) },
    { t: 0.64, ...pose({
      torsoX: -0.3, torsoY: 0.28,
      rShoulderX: 1.35, rShoulderZ: -0.5, rElbowX: 0.3,
      lShoulderX: 0.32, lShoulderZ: 0.45, lElbowX: 0.55,
    }) },
    { t: 0.84, ...BASE_POSE },
  ],
};

function sampleKeys(keys, time) {
  if (time <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (time >= last.t) return last;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time >= a.t && time <= b.t) {
      const local = smoothstep(0, 1, (time - a.t) / (b.t - a.t));
      const out = {};
      for (const key of Object.keys(BASE_POSE)) {
        out[key] = lerp(a[key] ?? BASE_POSE[key], b[key] ?? BASE_POSE[key], local);
      }
      return out;
    }
  }
  return last;
}

function addMesh(parent, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function createRacket(materials) {
  const group = new THREE.Group();
  group.name = 'racket';

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.016, 0.25, 8),
    materials.grip
  );
  handle.position.y = 0.13;
  handle.castShadow = true;
  group.add(handle);

  for (let i = 0; i < 5; i += 1) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0165, 0.0165, 0.012, 8),
      materials.accent
    );
    band.position.y = 0.035 + i * 0.042;
    group.add(band);
  }

  const frame = new THREE.Mesh(
    new THREE.TorusGeometry(0.163, 0.014, 6, 26),
    materials.racketFrame
  );
  frame.scale.set(1, 1.28, 1);
  frame.position.y = 0.47;
  frame.castShadow = true;
  group.add(frame);

  const throatParts = [
    [0.036, 0.24, 0.34, 0.06, -0.045],
    [-0.036, 0.24, 0.34, -0.06, -0.045],
  ];
  for (const [x, y, length, z, rot] of throatParts) {
    const throat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, length, 6),
      materials.racketFrame
    );
    throat.position.set(x, y, z);
    throat.rotation.z = rot;
    group.add(throat);
  }

  // String bed, drawn as a single line-segment object.
  const points = [];
  const cx = 0;
  const cy = 0.47;
  const rx = 0.158;
  const ry = 0.202;
  for (let i = -5; i <= 5; i += 1) {
    const y = cy + (i / 5) * ry * 0.92;
    const half = rx * Math.sqrt(Math.max(0, 1 - Math.pow((y - cy) / ry, 2)));
    points.push(cx - half, y, 0, cx + half, y, 0);
  }
  for (let i = -4; i <= 4; i += 1) {
    const x = cx + (i / 4) * rx * 0.92;
    const half = ry * Math.sqrt(Math.max(0, 1 - Math.pow((x - cx) / rx, 2)));
    points.push(x, cy - half, 0, x, cy + half, 0);
  }
  const stringGeo = new THREE.BufferGeometry();
  stringGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const strings = new THREE.LineSegments(
    stringGeo,
    new THREE.LineBasicMaterial({ color: 0xf6efd9, transparent: true, opacity: 0.72 })
  );
  group.add(strings);

  group.rotation.set(-1.32, 0, 0.08);
  group.scale.setScalar(0.88);
  return group;
}

export function createCharacter(config) {
  const {
    shirt = 0x27cbb2,
    shirtShade = 0x158e85,
    shorts = 0x0b3347,
    accent = 0xff6e4a,
    accentColor = '#ff6e4a',
    skin = 0xc08a61,
    hair = 0x17120e,
    shoe = 0xf6f0df,
    sock = 0xf8f1de,
    cap = true,
    headband = false,
    number = 7,
    name = 'DUKA',
    scale = 1,
  } = config;

  const materials = {
    shirt: new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.76 }),
    shirtShade: new THREE.MeshStandardMaterial({ color: shirtShade, roughness: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xf8f1de, roughness: 0.7 }),
    shorts: new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.82 }),
    accent: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 }),
    accentColor,
    skin: new THREE.MeshStandardMaterial({ color: skin, roughness: 0.68 }),
    hair: new THREE.MeshStandardMaterial({ color: hair, roughness: 0.84, flatShading: true }),
    shoe: new THREE.MeshStandardMaterial({ color: shoe, roughness: 0.65 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x1b2024, roughness: 0.8 }),
    sock: new THREE.MeshStandardMaterial({ color: sock, roughness: 0.85 }),
    eye: new THREE.MeshBasicMaterial({ color: 0x161a1d }),
    grip: new THREE.MeshStandardMaterial({ color: 0x15242c, roughness: 0.8 }),
    racketFrame: new THREE.MeshStandardMaterial({
      color: 0xffd36e,
      roughness: 0.42,
      metalness: 0.25,
    }),
  };

  const root = new THREE.Group();
  root.name = `character-${name}`;
  root.scale.setScalar(scale);

  const hips = new THREE.Group();
  hips.position.y = BASE_POSE.hipY;
  root.add(hips);

  // Shorts.
  const shortsGeo = new THREE.CylinderGeometry(0.2, 0.235, 0.3, 12);
  shortsGeo.scale(1, 1, 0.78);
  const shortsMesh = addMesh(hips, shortsGeo, materials.shorts, [0, -0.02, 0]);
  shortsMesh.receiveShadow = true;
  const shortsTrim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.236, 0.238, 0.035, 12),
    materials.trim
  );
  shortsTrim.scale.set(1, 1, 0.78);
  shortsTrim.position.y = -0.17;
  hips.add(shortsTrim);
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.27, 0.16),
      materials.accent
    );
    stripe.position.set(side * 0.19, -0.02, 0);
    hips.add(stripe);
  }

  // Torso / shirt, lathed for a tapered athletic silhouette.
  const torso = new THREE.Group();
  torso.position.y = 0.015;
  hips.add(torso);
  const shirtProfile = [
    [0.17, 0.0],
    [0.182, 0.06],
    [0.2, 0.17],
    [0.228, 0.33],
    [0.245, 0.43],
    [0.205, 0.5],
    [0.12, 0.54],
    [0.1, 0.57],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const shirtGeo = new THREE.LatheGeometry(shirtProfile, 14);
  shirtGeo.scale(1, 1, 0.76);
  const shirtMesh = addMesh(torso, shirtGeo, materials.shirt, [0, 0, 0]);
  shirtMesh.receiveShadow = true;

  const chestBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.238, 0.235, 0.035, 14, 1, true),
    materials.accent
  );
  chestBand.scale.set(1, 1, 0.77);
  chestBand.position.y = 0.34;
  torso.add(chestBand);

  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.105, 0.017, 6, 16),
    materials.trim
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.54;
  collar.scale.z = 0.8;
  torso.add(collar);

  // Back number decal.
  const jerseyTexture = makeJerseyBackTexture(number, name, '#f8f1de');
  const numberMaterial = new THREE.MeshBasicMaterial({
    map: jerseyTexture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  const numberPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), numberMaterial);
  numberPlane.position.set(0, 0.31, 0.166);
  numberPlane.rotation.y = 0;
  numberPlane.renderOrder = 1;
  torso.add(numberPlane);

  // Neck and head.
  const neck = addMesh(
    torso,
    new THREE.CylinderGeometry(0.055, 0.065, 0.09, 8),
    materials.skin,
    [0, 0.585, 0]
  );
  neck.castShadow = false;

  const head = new THREE.Group();
  head.position.set(0, 0.665, 0);
  torso.add(head);

  const skull = addMesh(
    head,
    new THREE.SphereGeometry(0.116, 18, 14),
    materials.skin,
    [0, 0, 0]
  );
  skull.scale.set(1, 1.08, 1.02);

  const jaw = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 8),
    materials.skin
  );
  jaw.scale.set(1, 0.62, 0.9);
  jaw.position.set(0, -0.052, -0.015);
  head.add(jaw);

  for (const side of [-1, 1]) {
    const ear = addMesh(
      head,
      new THREE.SphereGeometry(0.026, 8, 6),
      materials.skin,
      [side * 0.112, -0.005, 0.008]
    );
    ear.scale.set(0.6, 1, 0.8);
    ear.castShadow = false;

    const eye = addMesh(
      head,
      new THREE.SphereGeometry(0.014, 8, 6),
      materials.eye,
      [side * 0.044, 0.018, -0.104]
    );
    eye.scale.set(1, 0.72, 0.45);
    eye.castShadow = false;
    const brow = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.008, 0.008),
      materials.hair
    );
    brow.position.set(side * 0.047, 0.05, -0.105);
    brow.rotation.z = -side * 0.12;
    head.add(brow);
  }
  const nose = addMesh(
    head,
    new THREE.SphereGeometry(0.022, 8, 6),
    materials.skin,
    [0, -0.012, -0.108]
  );
  nose.scale.set(0.8, 0.9, 1.1);
  nose.castShadow = false;

  // Hair poking out under the cap / headband.
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.119, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
    materials.hair
  );
  hairCap.position.y = 0.008;
  hairCap.rotation.x = -0.08;
  head.add(hairCap);

  if (cap) {
    const capCrown = new THREE.Mesh(
      new THREE.SphereGeometry(0.126, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.54),
      materials.trim
    );
    capCrown.scale.y = 0.8;
    capCrown.position.y = 0.034;
    capCrown.castShadow = true;
    head.add(capCrown);
    const brimShape = new THREE.Shape();
    brimShape.absarc(0, 0, 0.17, 0, Math.PI, false);
    const brimGeo = new THREE.ExtrudeGeometry(brimShape, {
      depth: 0.018,
      bevelEnabled: false,
      curveSegments: 12,
    });
    brimGeo.rotateX(-Math.PI / 2);
    const brim = new THREE.Mesh(brimGeo, materials.accent);
    brim.position.set(0, 0.04, 0.015);
    brim.castShadow = true;
    head.add(brim);
    const button = new THREE.Mesh(
      new THREE.SphereGeometry(0.017, 8, 6),
      materials.accent
    );
    button.position.y = 0.16;
    head.add(button);
  }

  if (headband) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.117, 0.018, 6, 20),
      materials.accent
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.026;
    head.add(band);
    const knot = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.04, 0.03),
      materials.accent
    );
    knot.position.set(0, 0.03, 0.115);
    head.add(knot);
  }

  // Shoulders and arms.
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.252, 0.43, 0);
    torso.add(shoulder);
    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.054, 0.26, 4, 8),
      materials.skin
    );
    upper.position.y = -0.155;
    upper.castShadow = true;
    shoulder.add(upper);
    const shoulderCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 10, 8),
      materials.shirt
    );
    shoulderCap.position.set(0, -0.015, 0);
    shoulderCap.scale.set(1.05, 0.86, 0.92);
    shoulderCap.castShadow = true;
    shoulder.add(shoulderCap);
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.058, 0.1, 8),
      materials.trim
    );
    sleeve.position.y = -0.08;
    shoulder.add(sleeve);

    const elbow = new THREE.Group();
    elbow.position.y = -0.315;
    shoulder.add(elbow);
    const forearm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.045, 0.25, 4, 8),
      materials.skin
    );
    forearm.position.y = -0.145;
    forearm.castShadow = true;
    elbow.add(forearm);
    const wristband = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.06, 8),
      side > 0 ? materials.accent : materials.trim
    );
    wristband.position.y = -0.26;
    elbow.add(wristband);

    const wrist = new THREE.Group();
    wrist.position.y = -0.305;
    elbow.add(wrist);
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.046, 10, 8),
      materials.skin
    );
    hand.scale.set(0.8, 1, 0.95);
    hand.castShadow = true;
    wrist.add(hand);

    return { shoulder, elbow, wrist, hand };
  };

  const left = makeArm(-1);
  const right = makeArm(1);

  const racket = createRacket(materials);
  racket.position.set(0, -0.02, 0);
  right.wrist.add(racket);

  // Legs.
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.108, 0.005, 0);
    hips.add(hip);
    const thigh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.079, 0.275, 4, 8),
      materials.skin
    );
    thigh.position.y = -0.195;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.4;
    hip.add(knee);
    const shin = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.061, 0.28, 4, 8),
      materials.skin
    );
    shin.position.y = -0.19;
    shin.castShadow = true;
    knee.add(shin);

    const sockMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.066, 0.06, 0.17, 8),
      materials.sock
    );
    sockMesh.position.y = -0.3;
    knee.add(sockMesh);

    const foot = new THREE.Group();
    foot.position.y = -0.4;
    knee.add(foot);

    const sole = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.038, 0.28),
      materials.sole
    );
    sole.position.set(0, -0.122, -0.075);
    sole.castShadow = true;
    foot.add(sole);

    const shoeUpper = new THREE.Mesh(
      new THREE.BoxGeometry(0.122, 0.085, 0.25),
      materials.shoe
    );
    shoeUpper.position.set(0, -0.077, -0.072);
    shoeUpper.castShadow = true;
    foot.add(shoeUpper);

    const toe = new THREE.Mesh(
      new THREE.BoxGeometry(0.118, 0.048, 0.09),
      materials.accent
    );
    toe.position.set(0, -0.1, -0.2);
    foot.add(toe);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.126, 0.018, 0.08),
      materials.accent
    );
    stripe.position.set(0, -0.055, -0.04);
    foot.add(stripe);

    return { hip, knee, foot };
  };

  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  // Optional small towel hanging at the hip.
  const towel = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.24, 0.018),
    materials.trim
  );
  towel.position.set(-0.21, -0.07, -0.02);
  towel.rotation.z = 0.1;
  hips.add(towel);

  // Blob contact shadow. The real shadow does the heavy lifting, this keeps
  // the feet anchored during the brightest part of the sunset.
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 1.25),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
      color: 0x000000,
    })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.011;
  blob.renderOrder = 2;
  root.add(blob);

  root.traverse((obj) => {
    if (obj.isMesh && obj.material !== numberMaterial) {
      obj.castShadow = obj.castShadow ?? true;
    }
  });

  return {
    root,
    materials,
    hips,
    torso,
    head,
    arms: { left, right },
    legs: { left: leftLeg, right: rightLeg },
    racket,
    blob,
    jerseyTexture,
    numberPlane,
  };
}

export class TennisCharacter {
  constructor(config) {
    this.rig = createCharacter(config);
    this.root = this.rig.root;
    this.config = config;
    this.time = 0;
    this.walkPhase = 0;
    this.swing = null;
    this.serveToss = null;
    this.reaction = null;
    this.currentPose = { ...BASE_POSE };
    this.lastSwingType = null;
    this.shadow = this.rig.blob;
  }

  startServeToss() {
    this.serveToss = 0;
  }

  stopServeToss() {
    this.serveToss = null;
  }

  triggerSwing(type = 'forehand', hand = 'right') {
    const key = SWING_KEYS[type] ? type : type === 'drop' ? 'slice' : 'forehand';
    this.swing = {
      type: key,
      hand,
      elapsed: 0,
      duration: key === 'volley' ? 0.34 : key === 'smash' ? 0.4 : 0.48,
    };
    this.lastSwingType = type;
  }

  triggerReaction(kind = 'win') {
    this.reaction = { kind, elapsed: 0, duration: kind === 'win' ? 1.35 : 1.1 };
  }

  getRacketWorldPosition(target = new THREE.Vector3()) {
    this.rig.racket.getWorldPosition(target);
    return target;
  }

  update(dt, opts = {}) {
    this.time += dt;
    const speed = opts.speed ?? 0;
    const maxSpeed = opts.maxSpeed ?? 5.8;
    const runAmount = clamp(speed / maxSpeed, 0, 1);
    this.walkPhase += dt * (3.6 + speed * 1.35);

    const idleBreathe = Math.sin(this.time * 1.9) * 0.004;
    const readySway = Math.sin(this.time * 2.7) * 0.008;
    let hipY = BASE_POSE.hipY + idleBreathe - runAmount * 0.012;
    let torsoX = BASE_POSE.torsoX;
    let torsoY = BASE_POSE.torsoY + readySway;
    let torsoZ = 0;
    let headX = BASE_POSE.headX;
    let headY = BASE_POSE.headY;

    let lHipX = 0.08;
    let rHipX = -0.1;
    let lKneeX = -0.19;
    let rKneeX = -0.22;
    let lFootX = 0.12;
    let rFootX = 0.14;

    let rShoulderX = BASE_POSE.rShoulderX;
    let rShoulderY = BASE_POSE.rShoulderY;
    let rShoulderZ = BASE_POSE.rShoulderZ;
    let rElbowX = BASE_POSE.rElbowX;
    let lShoulderX = BASE_POSE.lShoulderX;
    let lShoulderY = BASE_POSE.lShoulderY;
    let lShoulderZ = BASE_POSE.lShoulderZ;
    let lElbowX = BASE_POSE.lElbowX;

    const localX = clamp(opts.localMove?.x ?? 0, -1, 1);
    const localZ = clamp(opts.localMove?.z ?? 0, -1, 1);

    if (runAmount > 0.04) {
      const swing = Math.sin(this.walkPhase);
      const swingAlt = Math.sin(this.walkPhase + Math.PI);
      lHipX += swing * 0.55 * runAmount;
      rHipX += swingAlt * 0.55 * runAmount;
      lKneeX -= Math.max(0, -swing) * 0.72 * runAmount;
      rKneeX -= Math.max(0, -swingAlt) * 0.72 * runAmount;
      lFootX += Math.max(0, swing) * 0.2 * runAmount;
      rFootX += Math.max(0, swingAlt) * 0.2 * runAmount;
      torsoX -= localZ * 0.06 * runAmount;
      torsoZ += localX * 0.09 * runAmount;
      hipY += Math.abs(Math.sin(this.walkPhase)) * 0.025 * runAmount;
      headX += localZ * 0.02;

      if (!this.swing) {
        lShoulderX += swingAlt * 0.25 * runAmount;
        lElbowX += 0.15 * runAmount;
        rShoulderX += Math.abs(swing) * 0.08 * runAmount;
      }
    } else {
      hipY += Math.sin(this.time * 2.1) * 0.003;
    }

    if (this.serveToss !== null) {
      this.serveToss += dt;
      const t = clamp(this.serveToss / 0.85, 0, 1);
      const raise = smoothstep(0, 0.65, t);
      const back = smoothstep(0.15, 0.8, t);
      lShoulderX = lerp(lShoulderX, 2.75, raise);
      lShoulderZ = lerp(lShoulderZ, 0.08, raise);
      lElbowX = lerp(lElbowX, 0.08, raise);
      rShoulderX = lerp(rShoulderX, -0.75, back);
      rShoulderZ = lerp(rShoulderZ, 0.5, back);
      rElbowX = lerp(rElbowX, 1.35, back);
      torsoX = lerp(torsoX, 0.09, raise);
      torsoY = lerp(torsoY, -0.2, raise);
      headX = lerp(headX, -0.2, raise);
      hipY -= 0.01 * raise;
    }

    let poseOverride = null;
    if (this.swing) {
      this.swing.elapsed += dt;
      const t = clamp(this.swing.elapsed / this.swing.duration, 0, 1);
      poseOverride = sampleKeys(SWING_KEYS[this.swing.type], t);
      if (t >= 1) {
        this.swing = null;
      }
    }

    if (poseOverride) {
      hipY = poseOverride.hipY;
      torsoX = poseOverride.torsoX;
      torsoY = poseOverride.torsoY;
      torsoZ = poseOverride.torsoZ;
      headX = poseOverride.headX;
      headY = poseOverride.headY;
      lHipX = lerp(lHipX, poseOverride.lHipX, 0.45);
      rHipX = lerp(rHipX, poseOverride.rHipX, 0.45);
      lKneeX = lerp(lKneeX, poseOverride.lKneeX, 0.6);
      rKneeX = lerp(rKneeX, poseOverride.rKneeX, 0.6);
      lFootX = lerp(lFootX, poseOverride.lFootX, 0.5);
      rFootX = lerp(rFootX, poseOverride.rFootX, 0.5);
      rShoulderX = poseOverride.rShoulderX;
      rShoulderY = poseOverride.rShoulderY;
      rShoulderZ = poseOverride.rShoulderZ;
      rElbowX = poseOverride.rElbowX;
      lShoulderX = poseOverride.lShoulderX;
      lShoulderY = poseOverride.lShoulderY;
      lShoulderZ = poseOverride.lShoulderZ;
      lElbowX = poseOverride.lElbowX;
      this.rig.arms.right.wrist.rotation.x = poseOverride.rWristX;
      this.rig.arms.right.wrist.rotation.z = poseOverride.rWristZ;
      this.rig.arms.left.wrist.rotation.x = poseOverride.lWristX;
      this.rig.arms.left.wrist.rotation.z = poseOverride.lWristZ;
    } else {
      this.rig.arms.right.wrist.rotation.x = lerp(
        this.rig.arms.right.wrist.rotation.x,
        0,
        1 - Math.exp(-8 * dt)
      );
      this.rig.arms.right.wrist.rotation.z = lerp(
        this.rig.arms.right.wrist.rotation.z,
        0,
        1 - Math.exp(-8 * dt)
      );
      this.rig.arms.left.wrist.rotation.x = 0;
      this.rig.arms.left.wrist.rotation.z = 0;
    }

    // Reaction pose blends over the base.
    if (this.reaction) {
      this.reaction.elapsed += dt;
      const t = clamp(this.reaction.elapsed / this.reaction.duration, 0, 1);
      const weight = Math.sin(clamp(t * 1.35, 0, 1) * Math.PI) * 0.9;
      if (this.reaction.kind === 'win') {
        rShoulderX = lerp(rShoulderX, 2.35, weight);
        rShoulderZ = lerp(rShoulderZ, -0.2, weight);
        rElbowX = lerp(rElbowX, 0.25, weight);
        lShoulderX = lerp(lShoulderX, 2.1, weight);
        lElbowX = lerp(lElbowX, 0.4, weight);
        torsoX = lerp(torsoX, -0.12, weight);
        headX = lerp(headX, -0.1, weight);
      } else {
        lShoulderX = lerp(lShoulderX, 0.08, weight);
        rShoulderX = lerp(rShoulderX, 0.08, weight);
        headX = lerp(headX, 0.3, weight);
        torsoX = lerp(torsoX, 0.14, weight);
      }
      if (t >= 1) this.reaction = null;
    }

    this._applyPose({
      hipY,
      torsoX,
      torsoY,
      torsoZ,
      headX,
      headY,
      lHipX,
      rHipX,
      lKneeX,
      rKneeX,
      lFootX,
      rFootX,
      rShoulderX,
      rShoulderY,
      rShoulderZ,
      rElbowX,
      lShoulderX,
      lShoulderY,
      lShoulderZ,
      lElbowX,
    });
  }

  _applyPose(p) {
    const rig = this.rig;
    rig.hips.position.y = p.hipY;
    rig.torso.rotation.set(p.torsoX, p.torsoY, p.torsoZ);
    rig.head.rotation.set(p.headX, p.headY, 0);
    rig.legs.left.hip.rotation.x = p.lHipX;
    rig.legs.right.hip.rotation.x = p.rHipX;
    rig.legs.left.knee.rotation.x = p.lKneeX;
    rig.legs.right.knee.rotation.x = p.rKneeX;
    rig.legs.left.foot.rotation.x = p.lFootX;
    rig.legs.right.foot.rotation.x = p.rFootX;
    rig.arms.right.shoulder.rotation.set(p.rShoulderX, p.rShoulderY, p.rShoulderZ);
    rig.arms.right.elbow.rotation.set(p.rElbowX, 0, 0);
    rig.arms.left.shoulder.rotation.set(p.lShoulderX, p.lShoulderY, p.lShoulderZ);
    rig.arms.left.elbow.rotation.set(p.lElbowX, 0, 0);
  }
}

export { BASE_POSE, SWING_KEYS };
