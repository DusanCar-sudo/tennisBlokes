// Mulberry32 seeded RNG. All gameplay randomness routes through this so test
// states and bot playtests are reproducible.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRandom {
  constructor(seed = 20260814) {
    this.seed = seed >>> 0;
    this.random = mulberry32(this.seed);
  }

  reseed(seed) {
    this.seed = seed >>> 0;
    this.random = mulberry32(this.seed);
  }

  next() {
    return this.random();
  }

  range(min, max) {
    return min + (max - min) * this.random();
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  chance(probability) {
    return this.random() < probability;
  }

  pick(items) {
    return items[Math.floor(this.random * items.length)];
  }

  sign() {
    return this.random() < 0.5 ? -1 : 1;
  }

  gauss(mean = 0, deviation = 1) {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.random();
    while (v === 0) v = this.random();
    return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export const rng = new SeededRandom();
