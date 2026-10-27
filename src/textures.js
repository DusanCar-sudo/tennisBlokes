import * as THREE from 'three';
import { PALETTE } from './config.js';
import { mulberry32 } from './rng.js';

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}

function finishTexture(canvas, { repeat = null, colorSpace = THREE.SRGBColorSpace, anisotropy = 4 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.anisotropy = anisotropy;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  } else {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }
  texture.needsUpdate = true;
  return texture;
}

/* Court acrylic: a light, chalky grain with faint directional brush marks. */
export function makeCourtSurfaceTexture() {
  const { canvas, ctx } = makeCanvas(512, 512);
  const rand = mulberry32(4171);
  ctx.fillStyle = '#e8e8e2';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 6800; i += 1) {
    const shade = 120 + Math.floor(rand() * 90);
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.08 + rand() * 0.12})`;
    const size = rand() * 1.7 + 0.3;
    ctx.fillRect(rand() * 512, rand() * 512, size, size);
  }

  for (let i = 0; i < 36; i += 1) {
    ctx.strokeStyle = `rgba(80,80,80,${0.025 + rand() * 0.03})`;
    ctx.lineWidth = 0.5 + rand() * 1.4;
    ctx.beginPath();
    const y = rand() * 512;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(160, y + rand() * 12 - 6, 330, y - rand() * 12 + 6, 512, y + rand() * 9 - 4.5);
    ctx.stroke();
  }

  return finishTexture(canvas, {
    repeat: [7, 14],
    colorSpace: THREE.NoColorSpace,
    anisotropy: 8,
  });
}

export function makeBallTexture() {
  const { canvas, ctx } = makeCanvas(1024, 512);
  const rand = mulberry32(911);
  const base = ctx.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, '#e8f74a');
  base.addColorStop(0.45, '#d7e93b');
  base.addColorStop(1, '#c5d82e');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 512);

  for (let i = 0; i < 9000; i += 1) {
    const g = 180 + Math.floor(rand() * 70);
    ctx.fillStyle = `rgba(${g},${g},${80 + rand() * 50},${rand() * 0.16})`;
    ctx.fillRect(rand() * 1024, rand() * 512, 1.5, 1.5);
  }

  // Felt tufts.
  for (let i = 0; i < 1200; i += 1) {
    ctx.strokeStyle = `rgba(255,255,180,${0.03 + rand() * 0.08})`;
    ctx.lineWidth = 0.7;
    const x = rand() * 1024;
    const y = rand() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rand() * 5 - 2.5, y + rand() * 4 - 2);
    ctx.stroke();
  }

  // The classic S-shaped seam: two interleaved curves in UV space.
  const seam = (phase, yBase, width, alpha) => {
    ctx.beginPath();
    for (let x = -20; x <= 1044; x += 4) {
      const u = x / 1024;
      const y = yBase + Math.sin(u * Math.PI * 4 + phase) * 38 + Math.sin(u * Math.PI * 2) * 14;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(245,242,195,${alpha})`;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  seam(0.2, 196, 7, 0.92);
  seam(Math.PI + 0.2, 316, 7, 0.92);

  // Slight darker rim enhances the sphere read.
  const rim = ctx.createLinearGradient(0, 0, 1024, 0);
  rim.addColorStop(0, 'rgba(0,0,0,0.10)');
  rim.addColorStop(0.12, 'rgba(0,0,0,0)');
  rim.addColorStop(0.88, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, 1024, 512);

  return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });
}

/* Net cord mesh: transparent cells with pale cord lines. */
export function makeNetTexture() {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255,250,236,0.92)';
  ctx.lineWidth = 3.2;
  for (let i = 0; i <= 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(206,220,214,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 256; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  return finishTexture(canvas, {
    repeat: [24, 2.6],
    colorSpace: THREE.SRGBColorSpace,
    anisotropy: 8,
  });
}

export function makeChainlinkTexture() {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(184,205,208,0.78)';
  ctx.lineWidth = 2.2;
  for (let offset = -256; offset <= 512; offset += 32) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + 256, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(offset, 256);
    ctx.lineTo(offset + 256, 0);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(8,28,39,0.25)';
  ctx.lineWidth = 1;
  for (let offset = -256; offset <= 512; offset += 32) {
    ctx.beginPath();
    ctx.moveTo(offset + 2, 0);
    ctx.lineTo(offset + 258, 256);
    ctx.stroke();
  }
  return finishTexture(canvas, {
    repeat: [10, 3],
    colorSpace: THREE.SRGBColorSpace,
    anisotropy: 4,
  });
}

export function makeCourtLogoTexture() {
  const { canvas, ctx } = makeCanvas(1024, 1024);
  ctx.clearRect(0, 0, 1024, 1024);

  ctx.save();
  ctx.translate(512, 430);
  const sun = ctx.createRadialGradient(0, 0, 20, 0, 0, 235);
  sun.addColorStop(0, 'rgba(255, 245, 225, 0.98)');
  sun.addColorStop(0.64, 'rgba(255, 211, 110, 0.95)');
  sun.addColorStop(1, 'rgba(255, 104, 70, 0)');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(0, 0, 235, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,245,230,0.95)';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.arc(0, 0, 154, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,245,230,0.82)';
  ctx.lineWidth = 10;
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 188, Math.sin(angle) * 188);
    ctx.lineTo(Math.cos(angle) * 232, Math.sin(angle) * 232);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(9,45,53,0.92)';
  ctx.beginPath();
  ctx.arc(0, 0, 118, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff5e6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = "900 92px 'Slam Display', Arial, sans-serif";
  ctx.fillText('SUNSET', 0, -18);
  ctx.fillStyle = '#ffd36e';
  ctx.fillText('SLAM', 0, 76);
  ctx.restore();

  ctx.fillStyle = 'rgba(255,245,230,0.78)';
  ctx.textAlign = 'center';
  ctx.font = "700 30px 'Slam Sans', Arial, sans-serif";
  ctx.fillText('NEON PALMS', 512, 752);

  return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });
}

export function makeBannerTexture(text, subtext, accent = '#ffd36e') {
  const { canvas, ctx } = makeCanvas(1024, 256);
  const grad = ctx.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#0b2b39');
  grad.addColorStop(0.55, '#103f4b');
  grad.addColorStop(1, '#0b2b39');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 256);

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 22, 256);
  ctx.fillStyle = 'rgba(255,245,230,0.08)';
  for (let x = -256; x < 1024; x += 88) {
    ctx.save();
    ctx.translate(x, 0);
    ctx.rotate(-0.5);
    ctx.fillRect(0, -120, 30, 500);
    ctx.restore();
  }
  ctx.fillStyle = '#fff5e6';
  ctx.font = "900 92px 'Slam Display', Arial, sans-serif";
  ctx.textBaseline = 'middle';
  ctx.fillText(text.toUpperCase(), 62, 108);
  ctx.fillStyle = accent;
  ctx.font = "700 34px 'Slam Sans', Arial, sans-serif";
  ctx.fillText(subtext.toUpperCase(), 66, 182);
  ctx.strokeStyle = 'rgba(255,245,230,0.22)';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, 1008, 240);

  return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });
}

export function makeBigScreenTexture() {
  const { canvas, ctx } = makeCanvas(1024, 560);
  const texture = finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });

  function draw(state = {}) {
    const { playerPoints = '0', rivalPoints = '0', label = 'FIRST TO 4', detail = 'WARM-UP', serving = 'player' } = state;
    const bg = ctx.createLinearGradient(0, 0, 0, 560);
    bg.addColorStop(0, '#07131e');
    bg.addColorStop(0.55, '#0c3040');
    bg.addColorStop(1, '#06131d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1024, 560);

    ctx.fillStyle = 'rgba(255, 104, 70, 0.16)';
    ctx.beginPath();
    ctx.arc(890, 80, 200, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(91, 231, 199, 0.09)';
    ctx.beginPath();
    ctx.arc(100, 520, 240, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffd36e';
    ctx.font = "700 30px 'Slam Sans', Arial, sans-serif";
    ctx.fillText('NEON PALMS OPEN', 46, 56);
    ctx.fillStyle = 'rgba(255,245,230,0.55)';
    ctx.font = "500 21px 'Slam Sans', Arial, sans-serif";
    ctx.fillText(detail.toUpperCase(), 46, 90);

    ctx.strokeStyle = 'rgba(255,245,230,0.26)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(46, 112);
    ctx.lineTo(978, 112);
    ctx.stroke();

    ctx.fillStyle = '#fff5e6';
    ctx.font = "900 58px 'Slam Display', Arial, sans-serif";
    ctx.fillText('DUKA', 46, 206);
    ctx.fillText('LAKI', 46, 340);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#5be7c7';
    ctx.font = "900 108px 'Slam Display', Arial, sans-serif";
    ctx.fillText(playerPoints, 760, 218);
    ctx.fillStyle = '#ff6846';
    ctx.fillText(rivalPoints, 760, 350);

    ctx.fillStyle = serving === 'player' ? '#ffd36e' : 'rgba(255,245,230,0.2)';
    ctx.beginPath();
    ctx.arc(798, 188, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = serving === 'rival' ? '#ffd36e' : 'rgba(255,245,230,0.2)';
    ctx.beginPath();
    ctx.arc(798, 320, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,245,230,0.6)';
    ctx.font = "700 22px 'Slam Sans', Arial, sans-serif";
    ctx.textAlign = 'right';
    ctx.fillText('SUNSET SLAM', 978, 88);

    ctx.fillStyle = 'rgba(255,211,110,0.9)';
    ctx.fillRect(46, 404, 932, 3);
    ctx.fillStyle = '#ffd36e';
    ctx.font = "700 34px 'Slam Sans', Arial, sans-serif";
    ctx.textAlign = 'left';
    ctx.fillText(label.toUpperCase(), 46, 462);
    ctx.fillStyle = 'rgba(255,245,230,0.45)';
    ctx.font = "500 20px 'Slam Sans', Arial, sans-serif";
    ctx.textAlign = 'right';
    ctx.fillText('CENTER COURT · 18:42', 978, 462);

    ctx.textAlign = 'left';
    texture.needsUpdate = true;
  }

  draw();
  return { texture, draw };
}

export function makeJerseyBackTexture(number, name, accent = '#fff5e6') {
  const { canvas, ctx } = makeCanvas(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = accent;
  ctx.font = "900 236px 'Slam Display', Arial, sans-serif";
  ctx.fillText(String(number).padStart(2, '0'), 256, 262);
  ctx.font = "700 48px 'Slam Sans', Arial, sans-serif";
  ctx.fillStyle = 'rgba(255,245,230,0.8)';
  ctx.fillText(name.toUpperCase(), 256, 425);
  ctx.strokeStyle = 'rgba(255,245,230,0.5)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(126, 112);
  ctx.lineTo(386, 112);
  ctx.stroke();
  return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace });
}

export function makeNumberTexture(number, accent = '#fff5e6') {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = accent;
  ctx.font = "900 132px 'Slam Display', Arial, sans-serif";
  ctx.fillText(String(number), 128, 136);
  return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace });
}

export function makeUmpireTexture() {
  const { canvas, ctx } = makeCanvas(512, 256);
  ctx.fillStyle = '#0a2634';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#ffd36e';
  ctx.lineWidth = 5;
  ctx.strokeRect(12, 12, 488, 232);
  ctx.fillStyle = '#ffd36e';
  ctx.textAlign = 'center';
  ctx.font = "700 42px 'Slam Sans', Arial, sans-serif";
  ctx.fillText('NEON PALMS', 256, 98);
  ctx.fillStyle = '#fff5e6';
  ctx.font = "900 58px 'Slam Display', Arial, sans-serif";
  ctx.fillText('OPEN', 256, 166);
  ctx.fillStyle = 'rgba(255,245,230,0.5)';
  ctx.font = "500 20px 'Slam Sans', Arial, sans-serif";
  ctx.fillText('CENTER COURT', 256, 207);
  return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace });
}

export function makeSplashTexture() {
  const { canvas, ctx } = makeCanvas(256, 256);
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return finishTexture(canvas, { colorSpace: THREE.NoColorSpace });
}

export function makePalmLeafTexture() {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.translate(128, 236);
  for (let i = 0; i < 26; i += 1) {
    const angle = (-0.88 + (i / 25) * 1.76) * Math.PI * 0.52;
    const length = 104 + Math.sin(i * 2.1) * 33;
    ctx.save();
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(0, 0, length, 0);
    grad.addColorStop(0, 'rgba(21,85,69,0.98)');
    grad.addColorStop(0.65, 'rgba(31,117,83,0.96)');
    grad.addColorStop(1, 'rgba(13,65,60,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(length * 0.52, -length * 0.08, length, -length * 0.03);
    ctx.stroke();
    ctx.lineWidth = 2;
    for (let s = 0.22; s < 1; s += 0.16) {
      const x = length * s;
      const y = -Math.sin(s * Math.PI) * length * 0.045;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 5, y - (8 + s * 12));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + (8 + s * 12));
      ctx.stroke();
    }
    ctx.restore();
  }
  return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace });
}

export function makeSkyTexture() {
  // Unused fallback: the sky is shader-driven for a crisp sunset.
  const { canvas, ctx } = makeCanvas(512, 512);
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#273b66');
  grad.addColorStop(0.56, '#d36d68');
  grad.addColorStop(0.72, '#ffc17e');
  grad.addColorStop(1, '#ff9b69');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  return finishTexture(canvas, { colorSpace: THREE.SRGBColorSpace });
}

export { PALETTE };
