// Procedural Web Audio: stadium air, synth-sunset music, and event-driven SFX.
// No external samples or network audio; the mix is built from noise + oscillators.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.music = null;
    this.ambient = null;
    this.reverb = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.soundEnabled = true;
    this.musicEnabled = true;
    this.started = false;
    this.musicTimer = null;
    this.crowdGain = null;
    this.crowdSource = null;
    this.chordIndex = 0;
    this.nextChordAt = 0;
    this.mood = 'menu';
    this.onStateChange = null;
  }

  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.62;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 16;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.24;
    this.master.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(1.5, 2.8);
    const reverbGain = this.ctx.createGain();
    reverbGain.gain.value = 0.16;
    this.reverb.connect(reverbGain);
    reverbGain.connect(this.master);

    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.72;
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverb);

    this.music = this.ctx.createGain();
    this.music.gain.value = 0.22;
    this.music.connect(this.master);
    this.music.connect(this.reverb);

    this.ambient = this.ctx.createGain();
    this.ambient.gain.value = 0.3;
    this.ambient.connect(this.master);
    this.ambient.connect(this.reverb);

    this.master.gain.value = this.soundEnabled ? 0.62 : 0.0001;
    this.music.gain.value = this.musicEnabled ? 0.22 : 0.0001;

    this.noiseBuffer = this._makeNoise(2.0);
    this._startCrowd();
    this._scheduleMusic();
    this.started = true;
    this._notify();
  }

  _notify() {
    this.onStateChange?.({
      sound: this.soundEnabled,
      music: this.musicEnabled,
    });
  }

  _makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        // Slightly pink crowd-spectrum noise.
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.17;
      }
    }
    return buffer;
  }

  _makeImpulse(seconds, decay) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  _startCrowd() {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.7;

    const high = this.ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 90;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.035;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();

    source.connect(filter);
    filter.connect(high);
    high.connect(gain);
    gain.connect(this.ambient);
    source.start();
    this.crowdSource = source;
    this.crowdGain = gain;
  }

  _startBufferNoise(duration, filterType, frequency, volume, pan = 0) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    const panNode = this.ctx.createStereoPanner();
    panNode.pan.value = clamp(pan, -1, 1);
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(panNode);
    panNode.connect(this.sfx);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  _tone(frequency, duration, volume, type = 'sine', startOffset = 0, pan = 0) {
    const now = this.ctx.currentTime + startOffset;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panNode = this.ctx.createStereoPanner();
    panNode.pan.value = clamp(pan, -1, 1);
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(panNode);
    panNode.connect(this.sfx);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  playServeToss() {
    if (!this.ctx || !this.soundEnabled) return;
    this._tone(880, 0.08, 0.03, 'sine', 0, 0);
    this._tone(1320, 0.06, 0.018, 'sine', 0.05, 0);
  }

  playSwing(type = 'forehand') {
    if (!this.ctx || !this.soundEnabled) return;
    const frequency = type === 'smash' ? 1800 : type === 'serve' ? 1500 : 1100;
    this._startBufferNoise(0.13, 'bandpass', frequency, 0.035);
  }

  playHit(type = 'topspin', quality = 0.75, pan = 0) {
    if (!this.ctx || !this.soundEnabled) return;
    const heavy = type === 'smash' || type === 'serve';
    const base = heavy ? 105 : type === 'slice' ? 175 : 145;
    const noiseFreq = heavy ? 2600 : type === 'slice' ? 1500 : 1900;
    const volume = heavy ? 0.32 : 0.22;
    this._startBufferNoise(heavy ? 0.11 : 0.08, 'bandpass', noiseFreq, volume * (0.7 + quality * 0.45), pan);
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panNode = this.ctx.createStereoPanner();
    panNode.pan.value = clamp(pan, -1, 1);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base * 2.1, now);
    osc.frequency.exponentialRampToValueAtTime(base, now + 0.055);
    osc.frequency.exponentialRampToValueAtTime(base * 0.6, now + 0.15);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22 * (0.8 + quality * 0.4), now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain);
    gain.connect(panNode);
    panNode.connect(this.sfx);
    osc.start(now);
    osc.stop(now + 0.18);

    if (heavy) {
      this._startBufferNoise(0.18, 'lowpass', 420, 0.09, pan);
    }
  }

  playBounce(speed = 8, pan = 0) {
    if (!this.ctx || !this.soundEnabled) return;
    const volume = clamp(0.035 + speed * 0.0035, 0.03, 0.12);
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panNode = this.ctx.createStereoPanner();
    panNode.pan.value = clamp(pan, -1, 1);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(74, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(gain);
    gain.connect(panNode);
    panNode.connect(this.sfx);
    osc.start(now);
    osc.stop(now + 0.15);
    this._startBufferNoise(0.05, 'highpass', 1800, 0.02, pan);
  }

  playNet() {
    if (!this.ctx || !this.soundEnabled) return;
    this._startBufferNoise(0.16, 'lowpass', 760, 0.07);
    this._tone(110, 0.14, 0.06, 'triangle');
  }

  playFootstep() {
    if (!this.ctx || !this.soundEnabled) return;
    this._startBufferNoise(0.04, 'bandpass', 900, 0.012);
  }

  playUi() {
    if (!this.ctx || !this.soundEnabled) return;
    this._tone(740, 0.06, 0.04, 'sine');
    this._tone(1180, 0.05, 0.024, 'sine', 0.035);
  }

  // Distinct "someone arrived" chime — plays even when the tab is hidden
  // (handled by the caller) so a waiting host notices a friend joining.
  playAlert() {
    if (!this.ctx || !this.soundEnabled) return;
    const notes = [659.25, 880.0, 1174.66];
    notes.forEach((note, i) => {
      this._tone(note, 0.42, 0.05, 'triangle', i * 0.12);
      this._tone(note * 2, 0.2, 0.016, 'sine', i * 0.12 + 0.01);
    });
  }

  playCountdown(final = false) {
    if (!this.ctx || !this.soundEnabled) return;
    this._tone(final ? 880 : 560, final ? 0.3 : 0.12, 0.07, 'triangle');
    if (final) this._tone(1320, 0.34, 0.035, 'sine', 0.05);
  }

  cheer(strength = 1) {
    if (!this.ctx || !this.soundEnabled) return;
    const now = this.ctx.currentTime;
    if (this.crowdGain) {
      const gain = this.crowdGain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0.045 + 0.1 * strength, now + 0.18);
      gain.linearRampToValueAtTime(0.085 + 0.06 * strength, now + 0.5);
      gain.linearRampToValueAtTime(0.035, now + 2.3);
    }
    // A short burst of applause.
    const count = Math.round(10 + 14 * strength);
    for (let i = 0; i < count; i += 1) {
      const when = 0.05 + Math.random() * 1.25;
      const volume = 0.006 + Math.random() * 0.018 * strength;
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900 + Math.random() * 1300;
      filter.Q.value = 1.1;
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      gain.gain.setValueAtTime(0.0001, now + when);
      gain.gain.linearRampToValueAtTime(volume, now + when + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + when + 0.06);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(this.ambient);
      source.start(now + when);
      source.stop(now + when + 0.09);
    }
  }

  playPoint(winner = 'player') {
    if (!this.ctx || !this.soundEnabled) return;
    const notes = winner === 'player'
      ? [523.25, 659.25, 783.99, 1046.5]
      : [392.0, 349.23, 293.66];
    notes.forEach((note, i) => {
      this._tone(note, 0.3, 0.038, 'triangle', i * 0.08);
    });
    this.cheer(winner === 'player' ? 1 : 0.35);
  }

  playMatch(win = true) {
    if (!this.ctx || !this.soundEnabled) return;
    const melody = win
      ? [523.25, 659.25, 783.99, 1046.5, 1318.5]
      : [392.0, 349.23, 311.13, 261.63];
    melody.forEach((note, i) => {
      this._tone(note, 0.42, 0.05, 'triangle', i * 0.14);
      this._tone(note * 2, 0.25, 0.017, 'sine', i * 0.14 + 0.02);
    });
    this.cheer(win ? 1.2 : 0.4);
  }

  // A warm, slow four-chord pad with a sparse high arpeggio. It runs under
  // everything and wraps in the same reverb as the court hits.
  _scheduleMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.nextChordAt = this.ctx.currentTime + 0.2;
    const chords = [
      [130.81, 164.81, 196.0, 246.94], // Cmaj7
      [110.0, 130.81, 164.81, 196.0], // Am7
      [87.31, 130.81, 164.81, 220.0], // Fmaj7
      [98.0, 123.47, 146.83, 196.0], // G
    ];
    const playChord = () => {
      if (!this.ctx || !this.musicEnabled) return;
      const now = this.ctx.currentTime;
      if (this.nextChordAt < now - 0.5) this.nextChordAt = now + 0.1;
      const chord = chords[this.chordIndex % chords.length];
      this.chordIndex += 1;
      const chordStart = this.nextChordAt;
      const duration = 4.0;

      // Detuned triangle pad.
      for (let i = 0; i < chord.length; i += 1) {
        const frequency = chord[i];
        for (const detune of [-4, 4]) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = this.mood === 'match' ? 720 : 560;
          filter.Q.value = 0.4;
          osc.type = 'triangle';
          osc.frequency.value = frequency;
          osc.detune.value = detune;
          gain.gain.setValueAtTime(0.0001, chordStart);
          gain.gain.linearRampToValueAtTime(0.012, chordStart + 0.9);
          gain.gain.linearRampToValueAtTime(0.0001, chordStart + duration);
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.music);
          osc.start(chordStart);
          osc.stop(chordStart + duration + 0.1);
        }
      }

      // Bass pulse.
      const bass = this.ctx.createOscillator();
      const bassGain = this.ctx.createGain();
      bass.type = 'sine';
      bass.frequency.value = chord[0] / 2;
      bassGain.gain.setValueAtTime(0.0001, chordStart);
      bassGain.gain.linearRampToValueAtTime(0.05, chordStart + 0.12);
      bassGain.gain.exponentialRampToValueAtTime(0.0001, chordStart + 1.5);
      bass.connect(bassGain);
      bassGain.connect(this.music);
      bass.start(chordStart);
      bass.stop(chordStart + 1.7);

      // High notes drift like a distant melody.
      const melody = [chord[2] * 2, chord[1] * 2, chord[3] * 2, chord[2] * 2];
      melody.forEach((note, i) => {
        const start = chordStart + 0.55 + i * 0.72;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = note;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.009, start + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.0);
        osc.connect(gain);
        gain.connect(this.music);
        osc.start(start);
        osc.stop(start + 1.1);
      });

      this.nextChordAt += duration;
    };
    playChord();
    this.musicTimer = setInterval(playChord, 3900);
  }

  setMood(mood = 'menu') {
    this.mood = mood;
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = enabled;
    if (this.master) {
      const target = enabled ? 0.62 : 0.0001;
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
    }
    this._notify();
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = enabled;
    if (this.music) {
      const target = enabled ? 0.22 : 0.0001;
      this.music.gain.cancelScheduledValues(this.ctx.currentTime);
      this.music.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    }
    this._notify();
  }

  toggleSound() {
    this.setSoundEnabled(!this.soundEnabled);
    return this.soundEnabled;
  }

  toggleMusic() {
    this.setMusicEnabled(!this.musicEnabled);
    return this.musicEnabled;
  }

  getState() {
    return { sound: this.soundEnabled, music: this.musicEnabled, ready: Boolean(this.ctx) };
  }
}
