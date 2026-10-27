import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COURT, PALETTE } from './config.js';
import { clamp } from './utils.js';
import { SeededRandom } from './rng.js';
import {
  makeBallTexture,
  makeBannerTexture,
  makeBigScreenTexture,
  makeChainlinkTexture,
  makeCourtLogoTexture,
  makeCourtSurfaceTexture,
  makeNetTexture,
  makePalmLeafTexture,
  makeUmpireTexture,
} from './textures.js';

const { netZ } = COURT;

export function netHeightAt(x) {
  const t = clamp(Math.abs(x) / COURT.netPostX, 0, 1);
  return COURT.netHeightCenter + (COURT.netHeightPost - COURT.netHeightCenter) * t * t;
}

function boxGeometry(width, height, depth, x, y, z, rotY = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    new THREE.Vector3(1, 1, 1)
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

function mergeAll(geometries, material, { castShadow = false, receiveShadow = true } = {}) {
  if (!geometries.length) return null;
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/* ────────────────────────────── Sky ────────────────────────────── */
function buildSky(scene, sunDirection) {
  const geo = new THREE.SphereGeometry(320, 48, 28);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: sunDirection.clone().normalize() },
      uTime: { value: 0 },
      uTop: { value: new THREE.Color(0x172c55) },
      uMid: { value: new THREE.Color(0x7b4b61) },
      uHorizon: { value: new THREE.Color(0xffa56d) },
      uHaze: { value: new THREE.Color(0xffd39a) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uTime;
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uHaze;
      varying vec3 vWorldPosition;

      float bandNoise(vec2 p) {
        return 0.5 + 0.5 * sin(p.x * 8.0 + sin(p.y * 5.0) * 2.0 + uTime * 0.004);
      }

      void main() {
        vec3 dir = normalize(vWorldPosition);
        float h = clamp(dir.y, -0.25, 0.85);

        vec3 color = mix(uHorizon, uMid, smoothstep(-0.01, 0.24, h));
        color = mix(color, uTop, smoothstep(0.18, 0.72, h));

        // Warm haze gathering at the horizon.
        float haze = 1.0 - smoothstep(-0.015, 0.15, h);
        color = mix(color, uHaze, haze * 0.34);

        // Layered sunset clouds.
        float az = atan(dir.x, -dir.z);
        float cloudMask = smoothstep(0.015, 0.07, h) * (1.0 - smoothstep(0.2, 0.39, h));
        float streaks = bandNoise(vec2(az * 2.0, h * 9.0)) * 0.55
                      + bandNoise(vec2(az * 4.6 + 3.0, h * 15.0)) * 0.3;
        streaks = smoothstep(0.55, 0.94, streaks);
        vec3 cloudColor = mix(vec3(0.85, 0.35, 0.33), vec3(1.0, 0.65, 0.46), smoothstep(0.0, 0.18, h));
        color = mix(color, cloudColor, cloudMask * streaks * 0.68);

        // Sun disk and its atmosphere.
        float sd = max(dot(dir, uSunDir), 0.0);
        float disk = smoothstep(0.99935, 0.99965, sd);
        float glow = pow(sd, 880.0) * 0.6 + pow(sd, 72.0) * 0.5 + pow(sd, 9.0) * 0.2;
        color += vec3(1.0, 0.72, 0.42) * glow;
        color = mix(color, vec3(1.0, 0.94, 0.73), disk);

        // A distant sea catches a thin warm edge below the stands.
        float below = smoothstep(-0.015, -0.12, h);
        color = mix(color, vec3(0.09, 0.15, 0.19), below * 0.85);

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  return { mesh: sky, material: mat };
}

function makeSunTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(256, 256, 20, 256, 256, 250);
  glow.addColorStop(0, 'rgba(255,248,215,1)');
  glow.addColorStop(0.18, 'rgba(255,225,150,0.98)');
  glow.addColorStop(0.32, 'rgba(255,177,104,0.38)');
  glow.addColorStop(0.68, 'rgba(255,133,88,0.08)');
  glow.addColorStop(1, 'rgba(255,120,80,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSun(scene, sunDirection) {
  const group = new THREE.Group();
  const position = sunDirection.clone().multiplyScalar(300);
  const tex = makeSunTexture();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  }));
  glow.position.copy(position);
  glow.scale.set(170, 170, 1);
  group.add(glow);

  const disc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.98,
    color: 0xfff4d2,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  }));
  disc.position.copy(position).add(new THREE.Vector3(0, 0, -1));
  disc.scale.set(36, 36, 1);
  group.add(disc);
  scene.add(group);
  return group;
}

/* ────────────────────────────── Lighting ────────────────────────────── */
function buildLighting(scene, sunDirection, quality) {
  const hemi = new THREE.HemisphereLight(0xffc39a, 0x0b2935, 0.98);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffc083, 2.65);
  sun.position.copy(sunDirection).multiplyScalar(52);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = quality !== 'low';
  const shadowSize = quality === 'low' ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -19;
  sun.shadow.camera.right = 19;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 95;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.022;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x74b7d6, 0.82);
  fill.position.set(16, 14, 26);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xff9068, 0.48);
  rim.position.set(-22, 8, -28);
  scene.add(rim);

  const backFill = new THREE.DirectionalLight(0x95d3e6, 0.85);
  backFill.position.set(6, 11, 26);
  scene.add(backFill);

  const bounce = new THREE.AmbientLight(0x1a3441, 0.45);
  scene.add(bounce);

  return { hemi, sun, fill, rim };
}

/* ────────────────────────────── Materials ────────────────────────────── */
function makeMaterials(anisotropy) {
  const surfaceMap = makeCourtSurfaceTexture();
  surfaceMap.anisotropy = Math.min(8, anisotropy);
  const surroundMap = surfaceMap.clone();
  surroundMap.needsUpdate = true;

  return {
    surface: new THREE.MeshStandardMaterial({
      color: 0x10808d,
      map: surfaceMap,
      roughness: 0.88,
      metalness: 0.02,
    }),
    surround: new THREE.MeshStandardMaterial({
      color: 0x0a4255,
      map: surroundMap,
      roughness: 0.82,
      metalness: 0.04,
    }),
    apron: new THREE.MeshStandardMaterial({ color: 0x082b38, roughness: 0.94 }),
    line: new THREE.MeshStandardMaterial({
      color: 0xf8f3e3,
      roughness: 0.5,
      metalness: 0.02,
      emissive: 0x29271f,
      emissiveIntensity: 0.2,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0x1b3340,
      roughness: 0.34,
      metalness: 0.72,
    }),
    metalDark: new THREE.MeshStandardMaterial({
      color: 0x0d2029,
      roughness: 0.42,
      metalness: 0.6,
    }),
    netCord: new THREE.MeshStandardMaterial({ color: 0xfff8e9, roughness: 0.7 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe7ded0, roughness: 0.52 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x0c2732, roughness: 0.9 }),
    concreteLight: new THREE.MeshStandardMaterial({ color: 0x163845, roughness: 0.82 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x1a5662, roughness: 0.7 }),
    seatWarm: new THREE.MeshStandardMaterial({ color: 0x6a3940, roughness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7d5031, roughness: 0.76 }),
    planter: new THREE.MeshStandardMaterial({ color: 0x123d3a, roughness: 0.82 }),
    leaf: new THREE.MeshStandardMaterial({
      color: 0x1a6e54,
      roughness: 0.84,
      side: THREE.DoubleSide,
    }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5c4633, roughness: 0.92 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff3ca }),
    bannerBack: new THREE.MeshStandardMaterial({ color: 0x0a2330, roughness: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x113c4d, roughness: 0.16, metalness: 0.7 }),
    hill: new THREE.MeshBasicMaterial({ color: 0x6f5b6f, fog: true }),
    water: new THREE.MeshStandardMaterial({
      color: 0x1b4a60,
      roughness: 0.22,
      metalness: 0.35,
      transparent: true,
      opacity: 0.92,
    }),
    ball: new THREE.MeshStandardMaterial({
      color: 0xdce836,
      roughness: 0.75,
      map: makeBallTexture(),
      emissive: 0x3d470b,
      emissiveIntensity: 0.22,
    }),
  };
}

/* ────────────────────────────── Court ────────────────────────────── */
function buildCourt(root, materials) {
  const group = new THREE.Group();
  group.name = 'court';

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(84, 94), materials.apron);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.16;
  apron.receiveShadow = true;
  group.add(apron);

  const surround = new THREE.Mesh(new THREE.PlaneGeometry(27, 40), materials.surround);
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.03;
  surround.receiveShadow = true;
  group.add(surround);

  const surface = new THREE.Mesh(new THREE.PlaneGeometry(10.97, 23.77), materials.surface);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0;
  surface.receiveShadow = true;
  group.add(surface);

  // Court perimeter trim: a narrow dark frame around the painted surface.
  const trimGeometry = [];
  trimGeometry.push(boxGeometry(11.25, 0.012, 0.18, 0, -0.018, -12.0));
  trimGeometry.push(boxGeometry(11.25, 0.012, 0.18, 0, -0.018, 12.0));
  trimGeometry.push(boxGeometry(0.18, 0.012, 24.15, -5.62, -0.018, 0));
  trimGeometry.push(boxGeometry(0.18, 0.012, 24.15, 5.62, -0.018, 0));
  const trim = mergeAll(trimGeometry, materials.metalDark);
  group.add(trim);

  // Official lines, merged into a single draw call.
  const lineY = 0.008;
  const lineGeometries = [];
  const addLine = (w, d, x, z) => {
    lineGeometries.push(boxGeometry(w, 0.01, d, x, lineY, z));
  };

  // Sidelines: singles and doubles.
  addLine(0.05, 23.77, COURT.singlesHalf, 0);
  addLine(0.05, 23.77, -COURT.singlesHalf, 0);
  addLine(0.05, 23.77, COURT.doublesHalf, 0);
  addLine(0.05, 23.77, -COURT.doublesHalf, 0);

  // Baselines.
  addLine(10.97, 0.05, 0, COURT.baseline);
  addLine(10.97, 0.05, 0, -COURT.baseline);

  // Service lines and center service line.
  addLine(8.23, 0.05, 0, COURT.serviceLine);
  addLine(8.23, 0.05, 0, -COURT.serviceLine);
  addLine(0.05, 6.4, 0, 3.2);
  addLine(0.05, 6.4, 0, -3.2);

  // Center marks on the baselines.
  addLine(0.05, 0.3, 0, COURT.baseline - 0.15);
  addLine(0.05, 0.3, 0, -COURT.baseline + 0.15);

  const lines = mergeAll(lineGeometries, materials.line);
  lines.castShadow = false;
  group.add(lines);

  // Painted logos on each half.
  const logoTexture = makeCourtLogoTexture();
  const logoMaterial = new THREE.MeshBasicMaterial({
    map: logoTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.42,
    color: 0x8fb8a8,
    toneMapped: true,
  });
  for (const z of [-8.4, 8.4]) {
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 4.1), logoMaterial);
    logo.rotation.x = -Math.PI / 2;
    logo.rotation.z = z < 0 ? Math.PI : 0;
    logo.position.set(0, 0.013, z);
    logo.renderOrder = 1;
    group.add(logo);
  }

  // Baseline hatch marks / small painted branding at each end.
  const endMarks = [];
  for (const z of [-12.15, 12.15]) {
    endMarks.push(boxGeometry(0.7, 0.011, 0.07, -4.8, 0.008, z));
    endMarks.push(boxGeometry(0.7, 0.011, 0.07, 4.8, 0.008, z));
  }
  const marks = mergeAll(endMarks, materials.line);
  group.add(marks);

  // Painted service boxes get a very subtle darker inset tone.
  const serviceTint = new THREE.MeshBasicMaterial({
    color: 0x0a5d6b,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
  });
  for (const z of [-3.2, 3.2]) {
    const tint = new THREE.Mesh(new THREE.PlaneGeometry(8.1, 6.2), serviceTint);
    tint.rotation.x = -Math.PI / 2;
    tint.position.set(0, 0.005, z);
    group.add(tint);
  }

  root.add(group);
  return { group, surface, logoTexture };
}

/* ────────────────────────────── Net ────────────────────────────── */
function buildNet(root, materials, anisotropy) {
  const group = new THREE.Group();
  group.name = 'net';

  const netTexture = makeNetTexture();
  netTexture.anisotropy = Math.min(8, anisotropy);

  const geometry = new THREE.PlaneGeometry(12.8, 1.0, 48, 6);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const t = pos.getY(i) + 0.5;
    const height = netHeightAt(x);
    const sag = Math.sin((x / 12.8 + 0.5) * Math.PI) * 0.012 * (1 - t);
    pos.setXYZ(i, x, t * height + sag, 0);
  }
  geometry.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: netTexture,
    color: 0xfff8e9,
    roughness: 0.85,
    metalness: 0.02,
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: 0.22,
    depthWrite: true,
  });
  const net = new THREE.Mesh(geometry, mat);
  net.position.set(0, 0, 0);
  net.castShadow = false;
  net.receiveShadow = true;
  group.add(net);

  // White tape along the top edge.
  const tapePoints = [];
  for (let i = 0; i <= 64; i += 1) {
    const x = -6.4 + (i / 64) * 12.8;
    tapePoints.push(new THREE.Vector3(x, netHeightAt(x) + 0.005, 0));
  }
  const tapeCurve = new THREE.CatmullRomCurve3(tapePoints);
  const tape = new THREE.Mesh(
    new THREE.TubeGeometry(tapeCurve, 64, 0.045, 6, false),
    materials.netCord
  );
  tape.castShadow = true;
  group.add(tape);

  // Center strap.
  const centerStrap = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, COURT.netHeightCenter, 0.018),
    materials.netCord
  );
  centerStrap.position.set(0, COURT.netHeightCenter / 2, 0.03);
  group.add(centerStrap);

  // Posts.
  for (const x of [-COURT.netPostX, COURT.netPostX]) {
    const post = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.07, 1.18, 10),
      materials.metal
    );
    pole.position.y = 0.59;
    pole.castShadow = true;
    post.add(pole);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 0.08, 12),
      materials.metalDark
    );
    base.position.y = 0.04;
    post.add(base);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), materials.netCord);
    cap.position.y = 1.2;
    post.add(cap);
    post.position.set(x, 0, 0);
    group.add(post);
  }

  // Singles sticks define the singles net width.
  for (const x of [-COURT.singlesHalf, COURT.singlesHalf]) {
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 1.08, 8),
      materials.white
    );
    stick.position.set(x, 0.54, 0.02);
    stick.castShadow = true;
    group.add(stick);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.03, 0.3), materials.metalDark);
    foot.position.set(x, 0.015, 0.02);
    group.add(foot);
  }

  // Side net supports from posts to the ground.
  for (const x of [-COURT.netPostX, COURT.netPostX]) {
    const support = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.026, 1.1, 6),
      materials.metal
    );
    support.position.set(x, 0.55, -0.1);
    support.rotation.x = 0.09;
    group.add(support);
  }

  root.add(group);
  return { group, net, netTexture };
}

/* ────────────────────────────── Fencing ────────────────────────────── */
function buildFencing(root, materials, anisotropy) {
  const group = new THREE.Group();
  group.name = 'fencing';
  const chainTexture = makeChainlinkTexture();
  chainTexture.anisotropy = Math.min(4, anisotropy);
  chainTexture.repeat.set(1, 1);

  const chainPanels = [];
  const metalParts = [];
  const HEIGHT = 3.35;

  const addPanel = (width, height, x, y, z, rotY) => {
    const geo = new THREE.PlaneGeometry(width, height, 1, 1);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) * (width / 2.8), uv.getY(i) * (height / 1.25));
    }
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    geo.applyMatrix4(matrix);
    chainPanels.push(geo);
  };

  const addPost = (x, z, rotY = 0) => {
    metalParts.push(boxGeometry(0.11, HEIGHT + 0.1, 0.11, x, (HEIGHT + 0.1) / 2, z, rotY));
  };

  const addRail = (w, d, x, y, z) => {
    metalParts.push(boxGeometry(w, 0.07, d, x, y, z));
  };

  // Far fence.
  addPanel(27.5, HEIGHT, 0, HEIGHT / 2, -16.9, 0);
  addRail(27.6, 0.09, 0, HEIGHT, -16.9);
  addRail(27.6, 0.09, 0, 0.14, -16.9);
  for (let x = -13.5; x <= 13.5; x += 3.0) addPost(x, -16.9);

  // Side fences.
  for (const side of [-1, 1]) {
    const x = 11.4 * side;
    const centerZ = -1.3;
    addPanel(33.2, HEIGHT, x, HEIGHT / 2, centerZ, side * Math.PI / 2);
    addRail(0.09, 33.4, x, HEIGHT, centerZ);
    addRail(0.09, 33.4, x, 0.14, centerZ);
    for (let z = -16.9; z <= 16.9; z += 3.0) addPost(x, z);
  }

  // Low back fence behind the camera area, useful in wide camera moments.
  addPanel(27.5, HEIGHT, 0, HEIGHT / 2, 20.2, Math.PI);
  addRail(27.6, 0.09, 0, HEIGHT, 20.2);
  for (let x = -13.5; x <= 13.5; x += 3.0) addPost(x, 20.2);

  const chain = mergeAll(chainPanels, new THREE.MeshStandardMaterial({
    map: chainTexture,
    color: 0xd6e5e5,
    roughness: 0.55,
    metalness: 0.65,
    alphaTest: 0.16,
    side: THREE.DoubleSide,
    transparent: false,
  }));
  chain.receiveShadow = true;
  group.add(chain);

  const metal = mergeAll(metalParts, materials.metal);
  group.add(metal);

  // Sponsor ribbon on the far fence, facing the court.
  const banners = [
    makeBannerTexture('Sunset Slam', 'Center court', '#ffd36e'),
    makeBannerTexture('Neon Palms', 'Est. 2026', '#5be7c7'),
    makeBannerTexture('Ace Athletic', 'Play bold', '#ff6846'),
  ];
  const bannerGeometry = new THREE.PlaneGeometry(7.2, 1.8);
  banners.forEach((texture, i) => {
    const mat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: true });
    const banner = new THREE.Mesh(bannerGeometry, mat);
    banner.position.set(-16.8 + i * 8.4, 1.38, -16.78);
    group.add(banner);
  });

  // Side-court windscreens: dark green bands at the bottom of the side fences.
  const windscreenMat = new THREE.MeshStandardMaterial({
    color: 0x0d2d2c,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(26, 1.0), windscreenMat);
    screen.rotation.y = side * Math.PI / 2;
    screen.position.set(side * 11.33, 0.56, -1.4);
    group.add(screen);
  }

  // Ball-kid benches tucked along the side fence.
  for (const side of [-1, 1]) {
    for (const z of [-8.4, 8.4]) {
      const bench = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.38), materials.wood);
      seat.position.y = 0.44;
      bench.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.32, 0.06), materials.wood);
      back.position.set(0, 0.68, 0.16);
      back.rotation.x = -0.12;
      bench.add(back);
      for (const lx of [-0.78, 0.78]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.3), materials.metalDark);
        leg.position.set(lx, 0.22, 0);
        bench.add(leg);
      }
      bench.position.set(side * 8.2, 0.02, z);
      bench.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(bench);
    }
  }

  root.add(group);
  return group;
}

/* ────────────────────────────── Umpire chair & props ────────────────────────────── */
function buildCourtFurniture(root, materials) {
  const group = new THREE.Group();
  group.name = 'court-furniture';

  const chair = new THREE.Group();
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.1, 1.1), materials.metalDark);
  platform.position.y = 2.25;
  chair.add(platform);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.04, 0.04), materials.white);
  rail.position.set(0, 3.15, 0.53);
  chair.add(rail);
  for (const x of [-0.62, 0.62]) {
    for (const z of [-0.48, 0.48]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), materials.metal);
      leg.position.set(x, 1.1, z);
      leg.rotation.z = x * 0.035;
      chair.add(leg);
    }
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.16, 0.62), materials.seatWarm);
  seat.position.set(0, 2.4, 0.12);
  chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.1), materials.seatWarm);
  back.position.set(0, 2.78, 0.4);
  chair.add(back);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.6), materials.wood);
  desk.position.set(0, 2.6, -0.25);
  chair.add(desk);
  const umbrellaPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6),
    materials.metal
  );
  umbrellaPole.position.set(0.48, 3.3, 0.1);
  chair.add(umbrellaPole);
  const umbrella = new THREE.Mesh(
    new THREE.ConeGeometry(1.75, 0.55, 10, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xffd36e,
      roughness: 0.8,
      side: THREE.DoubleSide,
    })
  );
  umbrella.position.set(0.48, 4.32, 0.1);
  chair.add(umbrella);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.4),
    new THREE.MeshBasicMaterial({ map: makeUmpireTexture(), toneMapped: true })
  );
  sign.position.set(0, 2.12, 0.56);
  chair.add(sign);
  chair.position.set(7.3, 0, 0.2);
  chair.rotation.y = -0.22;
  chair.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });
  group.add(chair);

  // Player benches on both sides of the net.
  for (const side of [-1, 1]) {
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.7), materials.wood);
    seat.position.y = 0.48;
    bench.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 0.1), materials.metal);
    back.position.set(0, 0.8, 0.36);
    bench.add(back);
    for (const x of [-1.35, 1.35]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.6), materials.metalDark);
      leg.position.set(x, 0.24, 0);
      bench.add(leg);
    }
    bench.position.set(-7.35, 0, side * 9.6);
    bench.rotation.y = side * Math.PI / 2;
    bench.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    group.add(bench);
  }

  // Courtside planters with tropical shrubs.
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0x1c6b4d, roughness: 0.86 });
  const planterGeo = new THREE.CylinderGeometry(0.42, 0.32, 0.55, 8);
  const shrubGeo = new THREE.IcosahedronGeometry(0.44, 1);
  for (const side of [-1, 1]) {
    for (const z of [-4.8, 4.8]) {
      const planter = new THREE.Group();
      const pot = new THREE.Mesh(planterGeo, materials.planter);
      pot.position.y = 0.27;
      pot.castShadow = true;
      planter.add(pot);
      for (let i = 0; i < 4; i += 1) {
        const shrub = new THREE.Mesh(shrubGeo, shrubMat);
        shrub.position.set(
          Math.sin(i * 2.2) * 0.26,
          0.62 + (i % 2) * 0.18,
          Math.cos(i * 2.2) * 0.26
        );
        shrub.scale.setScalar(0.7 + (i % 3) * 0.14);
        shrub.castShadow = true;
        planter.add(shrub);
      }
      planter.position.set(side * 8.9, 0, z);
      group.add(planter);
    }
  }

  // Ball cart with spare balls.
  const cart = new THREE.Group();
  const cartBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.9), materials.metal);
  cartBody.position.y = 0.55;
  cart.add(cartBody);
  const cartMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.64, 0.3, 0.82),
    new THREE.MeshStandardMaterial({
      color: 0xb9c4c0,
      roughness: 0.6,
      metalness: 0.5,
      wireframe: true,
    })
  );
  cartMesh.position.y = 0.85;
  cart.add(cartMesh);
  const wheelGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.07, 8);
  for (const x of [-0.36, 0.36]) {
    for (const z of [-0.3, 0.3]) {
      const wheel = new THREE.Mesh(wheelGeo, materials.metalDark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.12, z);
      cart.add(wheel);
    }
  }
  const spareBallGeo = new THREE.SphereGeometry(0.034, 8, 6);
  for (let i = 0; i < 12; i += 1) {
    const ball = new THREE.Mesh(spareBallGeo, materials.ball);
    ball.position.set(
      (i % 4) * 0.14 - 0.21,
      0.62 + Math.floor(i / 8) * 0.08,
      (Math.floor(i / 4) % 2) * 0.18
    );
    cart.add(ball);
  }
  cart.position.set(-7.8, 0, -2.6);
  cart.rotation.y = 0.3;
  cart.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });
  group.add(cart);

  // Broadcast camera on a tripod at the side line.
  const cameraRig = new THREE.Group();
  const tripod = new THREE.Mesh(
    new THREE.ConeGeometry(0.48, 1.4, 4),
    materials.metalDark
  );
  tripod.position.y = 0.72;
  cameraRig.add(tripod);
  const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.3), materials.metal);
  camBody.position.y = 1.55;
  cameraRig.add(camBody);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.28, 12), materials.metalDark);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 1.55, 0.28);
  cameraRig.add(lens);
  cameraRig.position.set(-8.9, 0, 11.8);
  cameraRig.rotation.y = 0.7;
  cameraRig.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });
  group.add(cameraRig);

  root.add(group);
  return group;
}

/* ────────────────────────────── Stands & crowd ────────────────────────────── */
function buildStands(root, materials, rng, quality) {
  const group = new THREE.Group();
  group.name = 'stands';
  const crowdSpots = [];
  const concreteParts = [];
  const seatParts = [];

  const farRows = 9;
  const farStartZ = -20.2;
  const rowDepth = 1.02;
  const rowRise = 0.54;

  for (let r = 0; r < farRows; r += 1) {
    const z = farStartZ - r * rowDepth;
    const y = 0.28 + r * rowRise;
    concreteParts.push(boxGeometry(34, 0.52, rowDepth + 0.12, 0, y - 0.26, z));
    seatParts.push(boxGeometry(33.2, 0.06, 0.24, 0, y + 0.02, z - 0.24));
    for (let x = -16.2; x <= 16.2; x += 0.62) {
      if (Math.abs(x) < 0.7) continue;
      if (rng.chance(0.17)) continue;
      if (rng.chance(0.08)) continue;
      crowdSpots.push({
        x: x + rng.range(-0.1, 0.1),
        y: y + 0.2,
        z: z + rng.range(-0.12, 0.12),
        yaw: 0,
        tier: r,
        standing: false,
      });
    }
  }

  // Side stands.
  const sideRows = 7;
  for (const side of [-1, 1]) {
    for (let r = 0; r < sideRows; r += 1) {
      const x = side * (13.2 + r * 0.95);
      const y = 0.28 + r * rowRise;
      concreteParts.push(boxGeometry(rowDepth + 0.1, 0.52, 31, x, y - 0.26, -0.6));
      seatParts.push(boxGeometry(0.24, 0.06, 30.2, x - side * 0.23, y + 0.02, -0.6));
      for (let z = -15.2; z <= 14.8; z += 0.65) {
        if (rng.chance(0.77)) {
          crowdSpots.push({
            x: x + rng.range(-0.1, 0.1),
            y: y + 0.2,
            z: z + rng.range(-0.1, 0.1),
            yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
            tier: r,
            standing: false,
          });
        }
      }
    }
  }

  // A low stand behind the near baseline keeps the world enclosed when the
  // camera swings wide.
  for (let r = 0; r < 4; r += 1) {
    const z = 23.2 + r * rowDepth;
    const y = 0.24 + r * rowRise;
    concreteParts.push(boxGeometry(30, 0.46, rowDepth + 0.1, 0, y - 0.23, z));
    for (let x = -14; x <= 14; x += 0.9) {
      if (rng.chance(0.38)) {
        crowdSpots.push({ x, y: y + 0.18, z, yaw: Math.PI, tier: r, standing: false });
      }
    }
  }

  const concrete = mergeAll(concreteParts, materials.concrete, { receiveShadow: true });
  group.add(concrete);
  const seats = mergeAll(seatParts, materials.seat, { receiveShadow: false });
  group.add(seats);

  // Concrete steps / aisles trim.
  const steps = [];
  for (const x of [-10.5, 10.5]) {
    for (let r = 0; r < farRows; r += 1) {
      steps.push(boxGeometry(0.09, 0.06, rowDepth, x, 0.28 + r * rowRise + 0.02, farStartZ - r * rowDepth));
    }
  }
  const stepsMesh = mergeAll(steps, materials.concreteLight);
  group.add(stepsMesh);

  // Front rail for far stand.
  const rails = [];
  rails.push(boxGeometry(33.6, 0.06, 0.06, 0, 1.02, -18.7));
  for (let x = -16.4; x <= 16.4; x += 2.0) {
    rails.push(boxGeometry(0.06, 1.02, 0.06, x, 0.51, -18.7));
  }
  group.add(mergeAll(rails, materials.metal));

  // Stadium lighting masts.
  const masts = [];
  const lamps = [];
  for (const positions of [
    [-15.1, -24.5],
    [15.1, -24.5],
    [-16.4, 21.5],
    [16.4, 21.5],
  ]) {
    const [x, z] = positions;
    const poleHeight = 15.5;
    masts.push(boxGeometry(0.32, poleHeight, 0.32, x, poleHeight / 2, z));
    masts.push(boxGeometry(3.6, 0.18, 0.2, x, poleHeight - 0.2, z));
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        const lx = x + (i - 1.5) * 0.8;
        const ly = poleHeight - 0.72 + j * 0.55;
        masts.push(boxGeometry(0.55, 0.38, 0.18, lx, ly, z - 0.12));
        lamps.push({ x: lx, y: ly, z: z - 0.21 });
      }
    }
  }
  group.add(mergeAll(masts, materials.metal));

  // Emissive lamp panels (one baked mesh) and one soft halo per mast.
  const lampGeo = new THREE.PlaneGeometry(0.48, 0.3);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3cb, toneMapped: false });
  const panelGeos = [];
  for (const lamp of lamps) {
    const geo = lampGeo.clone();
    geo.translate(lamp.x, lamp.y, lamp.z);
    panelGeos.push(geo);
  }
  const lampPanels = new THREE.Mesh(mergeGeometries(panelGeos, false), lampMat);
  panelGeos.forEach((g) => g.dispose());
  lampGeo.dispose();
  group.add(lampPanels);

  const haloTexture = makeLampHalo();
  for (const positions of [
    [-15.1, -24.5],
    [15.1, -24.5],
    [-16.4, 21.5],
    [16.4, 21.5],
  ]) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture,
      color: 0xffcf88,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    halo.position.set(positions[0], 14.8, positions[1] - 0.1);
    halo.scale.set(6.4, 6.4, 1);
    group.add(halo);
  }

  // The big screen above the far stand.
  const board = buildBigScreen(group, materials);
  const screen = board;

  // Banners hanging at the front of the far stand.
  const bannerTextures = [
    makeBannerTexture('Center Court', 'Sunset session', '#5be7c7'),
    makeBannerTexture('Neon Palms', 'Open 2026', '#ffd36e'),
  ];
  bannerTextures.forEach((texture, i) => {
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 1.5),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: true })
    );
    banner.position.set(-8 + i * 16, 1.9, -18.61);
    group.add(banner);
  });

  // Build instanced crowd.
  const crowd = buildCrowd(group, crowdSpots, materials, rng, quality);
  root.add(group);

  return { group, crowd, crowdSpots, screen, lamps };
}

let lampHaloTexture = null;
function makeLampHalo() {
  if (lampHaloTexture) return lampHaloTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,245,214,0.95)');
  grad.addColorStop(0.25, 'rgba(255,207,136,0.4)');
  grad.addColorStop(1, 'rgba(255,180,100,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  lampHaloTexture = tex;
  return tex;
}

// Bake static child meshes into one mesh per material. Keeps court furniture
// from consuming dozens of draw calls without using InstancedMesh bookkeeping.
function mergeStaticChildren(group) {
  group.updateMatrixWorld(true);
  const groupInverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const originals = [];
  group.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || obj.isLine || obj.isLineSegments || obj.isPoints) return;
    if (Array.isArray(obj.material)) return;
    const material = obj.material;
    if (!material || material.transparent) return;
    const key = material.uuid;
    if (!buckets.has(key)) buckets.set(key, { material, geometries: [], owners: [] });
    let geometry = obj.geometry.clone();
    const matrix = new THREE.Matrix4().multiplyMatrices(groupInverse, obj.matrixWorld);
    geometry.applyMatrix4(matrix);
    // mergeGeometries requires a compatible attribute set: flatten everything
    // to non-indexed (extrusions and polyhedra are non-indexed, boxes are not)
    // and synthesize any missing uv layer.
    if (geometry.index) geometry = geometry.toNonIndexed();
    if (!geometry.attributes.uv) {
      const count = geometry.attributes.position.count;
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    buckets.get(key).geometries.push(geometry);
    buckets.get(key).owners.push(obj);
    originals.push(obj);
  });
  // Build every merge first; only swap the originals out when its merge
  // succeeded, so a compatibility failure can never delete scenery.
  const mergedMeshes = [];
  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geometries, false);
    bucket.geometries.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mergedMeshes.push({ mesh, owners: bucket.owners });
  }
  if (!mergedMeshes.length) return;
  const replaced = new Set();
  for (const { mesh, owners } of mergedMeshes) {
    group.add(mesh);
    for (const owner of owners) replaced.add(owner);
  }
  for (const obj of originals) {
    if (replaced.has(obj)) obj.removeFromParent();
  }
}

function buildBigScreen(parent, materials) {
  const screenData = makeBigScreenTexture();
  const group = new THREE.Group();
  group.name = 'big-screen';

  const back = new THREE.Mesh(new THREE.BoxGeometry(10.8, 6.0, 0.55), materials.metalDark);
  back.position.set(0, 9.6, -24.2);
  group.add(back);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(9.6, 4.8),
    new THREE.MeshBasicMaterial({ map: screenData.texture, toneMapped: true })
  );
  screen.position.set(0, 9.6, -23.9);
  group.add(screen);

  const framePieces = [];
  framePieces.push(boxGeometry(10.2, 0.14, 0.15, 0, 12.15, -23.85));
  framePieces.push(boxGeometry(10.2, 0.14, 0.15, 0, 7.05, -23.85));
  framePieces.push(boxGeometry(0.14, 5.2, 0.15, -4.92, 9.6, -23.85));
  framePieces.push(boxGeometry(0.14, 5.2, 0.15, 4.92, 9.6, -23.85));
  group.add(mergeAll(framePieces, materials.metal));

  for (const x of [-4.1, 4.1]) {
    group.add((() => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7.0, 0.3), materials.metal);
      leg.position.set(x, 5.2, -24.45);
      return leg;
    })());
  }

  // Soft glow behind the screen frame.
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeLampHalo(),
    color: 0x169bb0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  glow.position.set(0, 9.6, -24.6);
  glow.scale.set(19, 12, 1);
  group.add(glow);

  parent.add(group);
  return screenData;
}

function buildCrowd(parent, spots, materials, rng, quality) {
  const count = quality === 'low' ? Math.floor(spots.length * 0.55) : spots.length;
  const bodyGeo = new THREE.CapsuleGeometry(0.115, 0.3, 3, 6);
  bodyGeo.translate(0, 0.32, 0);
  const headGeo = new THREE.SphereGeometry(0.092, 7, 5);
  headGeo.translate(0, 0.71, 0);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.02,
    vertexColors: false,
  });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });

  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
  const heads = new THREE.InstancedMesh(headGeo, headMat, count);
  bodies.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  heads.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const skinTones = [
    new THREE.Color(0xd9a47e),
    new THREE.Color(0xb57952),
    new THREE.Color(0x8e5a3c),
    new THREE.Color(0xefc9a5),
    new THREE.Color(0x6b422c),
    new THREE.Color(0xc48b64),
  ];
  const clothing = [
    new THREE.Color(0xe66b4b),
    new THREE.Color(0x2a7e88),
    new THREE.Color(0xd9bc6a),
    new THREE.Color(0x355f7a),
    new THREE.Color(0xe5dfd2),
    new THREE.Color(0x7a4550),
    new THREE.Color(0x2c8c7a),
    new THREE.Color(0x8e6b9e),
    new THREE.Color(0x33434d),
    new THREE.Color(0xd98a5f),
  ];
  const dummy = new THREE.Object3D();
  const base = [];
  for (let i = 0; i < count; i += 1) {
    const spot = spots[i];
    dummy.position.set(spot.x, spot.y, spot.z);
    dummy.rotation.set(0, spot.yaw + rng.range(-0.14, 0.14), 0);
    const scale = rng.range(0.86, 1.12);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    heads.setMatrixAt(i, dummy.matrix);
    bodies.setColorAt(i, clothing[rng.int(0, clothing.length - 1)]);
    heads.setColorAt(i, skinTones[rng.int(0, skinTones.length - 1)]);
    base.push({
      x: spot.x,
      y: spot.y,
      z: spot.z,
      yaw: dummy.rotation.y,
      scale,
      phase: rng.range(0, Math.PI * 2),
    });
  }
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  bodies.instanceColor.needsUpdate = true;
  heads.instanceColor.needsUpdate = true;
  bodies.castShadow = false;
  heads.castShadow = false;
  bodies.receiveShadow = false;
  heads.receiveShadow = false;
  parent.add(bodies, heads);

  return { bodies, heads, base, count, cheerTime: -1 };
}

/* ────────────────────────────── Palms ────────────────────────────── */
function buildPalms(root, materials, rng) {
  const group = new THREE.Group();
  group.name = 'palms';
  const trunkGeos = [];
  const frondGeos = [];

  const palmLocations = [
    [-19, -28, 10.5],
    [-13.5, -30.5, 12.2],
    [14.8, -29, 11.1],
    [20.5, -26.5, 9.8],
    [-21, -10, 9.2],
    [21.5, -7, 10.2],
    [-20.5, 12, 8.8],
    [20.2, 14, 9.6],
  ];

  for (const [x, z, height] of palmLocations) {
    const leanX = rng.range(-0.8, 0.8);
    const leanZ = rng.range(-0.5, 0.5);
    const points = [];
    for (let s = 0; s <= 7; s += 1) {
      const t = s / 7;
      points.push(new THREE.Vector3(
        x + leanX * t * t,
        height * t,
        z + leanZ * t * t
      ));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const trunk = new THREE.TubeGeometry(curve, 12, 0.22, 6, false);
    trunkGeos.push(trunk);

    const crown = new THREE.Vector3(x + leanX, height, z + leanZ);
    const frondCount = 10;
    for (let f = 0; f < frondCount; f += 1) {
      const angle = (f / frondCount) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const len = rng.range(3.2, 4.6);
      const droop = rng.range(1.0, 1.8);
      const segments = 6;
      const verts = [];
      const indices = [];
      for (let s = 0; s <= segments; s += 1) {
        const t = s / segments;
        const dist = len * t;
        const y = -droop * t * t;
        const width = 0.48 * Math.sin(t * Math.PI) * (1 - t * 0.55) + 0.015;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const cx = crown.x + cos * dist;
        const cz = crown.z + sin * dist;
        const cy = crown.y + 0.08 + y;
        // side vector perpendicular to the frond in the XZ plane
        verts.push(cx - sin * width, cy, cz + cos * width);
        verts.push(cx + sin * width, cy, cz - cos * width);
        if (s < segments) {
          const base = s * 2;
          indices.push(base, base + 1, base + 2);
          indices.push(base + 1, base + 3, base + 2);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      frondGeos.push(geometry);
    }
  }

  const trunks = mergeAll(trunkGeos, materials.trunk, { receiveShadow: false });
  const fronds = mergeAll(frondGeos, materials.leaf, { receiveShadow: false });
  group.add(trunks, fronds);
  group.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = false;
  });
  root.add(group);
  return group;
}

/* ────────────────────────────── Distant world ────────────────────────────── */
function buildBackdrop(root, materials) {
  const group = new THREE.Group();
  group.name = 'backdrop';

  const water = new THREE.Mesh(new THREE.PlaneGeometry(280, 160), materials.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -1.2, -90);
  group.add(water);

  const hillGeo = new THREE.IcosahedronGeometry(1, 1);
  for (const [x, z, sx, sy, sz] of [
    [-72, -96, 34, 10, 22],
    [-31, -112, 24, 7, 16],
    [44, -108, 31, 9, 20],
    [83, -95, 26, 8, 16],
  ]) {
    const hill = new THREE.Mesh(hillGeo, materials.hill);
    hill.position.set(x, -1, z);
    hill.scale.set(sx, sy, sz);
    group.add(hill);
  }

  // Loose dune silhouettes to frame the stadium east/west.
  for (const side of [-1, 1]) {
    const dune = new THREE.Mesh(new THREE.SphereGeometry(18, 12, 8), materials.hill);
    dune.scale.set(1.8, 0.35, 1.2);
    dune.position.set(side * 44, -2.5, -38);
    group.add(dune);
  }

  root.add(group);
  return group;
}

/* ────────────────────────────── Dust motes ────────────────────────────── */
function buildDust(root, quality) {
  const count = quality === 'low' ? 90 : 220;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const rand = new SeededRandom(551);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = rand.range(-16, 16);
    positions[i * 3 + 1] = rand.range(0.3, 10);
    positions[i * 3 + 2] = rand.range(-20, 18);
    sizes[i] = rand.range(0.6, 1.9);
    phases[i] = rand.range(0, Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying float vFade;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.18 + aPhase) * 0.5;
        p.y += sin(uTime * 0.12 + aPhase * 1.7) * 0.35;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(aSize * 140.0 / max(-mv.z, 1.0), 0.7, 4.5);
        gl_Position = projectionMatrix * mv;
        vFade = 0.35 + 0.3 * sin(uTime * 0.5 + aPhase);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d) * vFade;
        gl_FragColor = vec4(1.0, 0.82, 0.55, a);
      }
    `,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  root.add(points);
  return { points, material, geometry: geo };
}

/* ────────────────────────────── Public builder ────────────────────────────── */
export function buildWorld(scene, { quality = 'high', anisotropy = 8 } = {}) {
  const rand = new SeededRandom(20260814);
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  const sunDirection = new THREE.Vector3(0.26, 0.315, -0.91).normalize();
  const sky = buildSky(scene, sunDirection);
  const sun = buildSun(scene, sunDirection);
  const lights = buildLighting(scene, sunDirection, quality);
  const materials = makeMaterials(anisotropy);
  scene.fog = new THREE.Fog(0xdd8a66, 66, 270);

  const court = buildCourt(root, materials);
  const net = buildNet(root, materials, anisotropy);
  const fencing = buildFencing(root, materials, anisotropy);
  mergeStaticChildren(fencing);
  const furniture = buildCourtFurniture(root, materials);
  mergeStaticChildren(furniture);
  const stands = buildStands(root, materials, rand, quality);
  const palms = buildPalms(root, materials, rand);
  const backdrop = buildBackdrop(root, materials);
  mergeStaticChildren(backdrop);
  const dust = buildDust(root, quality);

  let elapsed = 0;
  let cheerRemaining = 0;

  function update(dt, time) {
    elapsed = time;
    sky.material.uniforms.uTime.value = elapsed;
    dust.material.uniforms.uTime.value = elapsed;
    dust.points.rotation.y = Math.sin(elapsed * 0.02) * 0.01;

    if (cheerRemaining > 0) {
      cheerRemaining = Math.max(0, cheerRemaining - dt);
      const strength = Math.min(1, cheerRemaining * 2.4);
      const { bodies, heads, base, count } = stands.crowd;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i += 1) {
        const b = base[i];
        const jump = Math.max(0, Math.sin(elapsed * 10 + b.phase * 3.2)) * 0.13 * strength;
        dummy.position.set(b.x, b.y + jump, b.z);
        dummy.rotation.set(0, b.yaw, 0);
        dummy.scale.setScalar(b.scale);
        dummy.updateMatrix();
        bodies.setMatrixAt(i, dummy.matrix);
        heads.setMatrixAt(i, dummy.matrix);
      }
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
    } else if (stands.crowd.cheerTime > 0) {
      // Settle back to the static positions once the cheer finishes.
      const { bodies, heads, base, count } = stands.crowd;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i += 1) {
        const b = base[i];
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(0, b.yaw, 0);
        dummy.scale.setScalar(b.scale);
        dummy.updateMatrix();
        bodies.setMatrixAt(i, dummy.matrix);
        heads.setMatrixAt(i, dummy.matrix);
      }
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
      stands.crowd.cheerTime = 0;
    }
  }

  function cheer(duration = 1.8) {
    cheerRemaining = duration;
    stands.crowd.cheerTime = duration;
  }

  return {
    root,
    materials,
    court,
    net,
    stands,
    palms,
    dust,
    sunDirection,
    lights,
    setScoreboard: stands.screen.draw,
    cheer,
    update,
    netHeightAt,
    getCrowdCount: () => stands.crowd.count,
  };
}
