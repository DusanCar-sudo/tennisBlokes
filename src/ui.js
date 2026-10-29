import { clamp } from './utils.js';

export class UI {
  constructor() {
    this.handlers = {};
    this.winTimeouts = new WeakMap();
    this.timers = new Set();
    this.state = {
      playing: false,
      paused: false,
      mobile: false,
    };

    const $ = (id) => document.getElementById(id);
    this.el = {
      body: document.body,
      boot: $('boot-screen'),
      title: $('title-screen'),
      hud: $('hud'),
      playBtn: $('play-btn'),
      sportTennis: $('sport-tennis'),
      sportBasket: $('sport-basket'),
      howtoBtn: $('howto-btn'),
      howtoScreen: $('howto-screen'),
      howtoClose: $('howto-close'),
      pauseBtn: $('pause-btn'),
      pauseScreen: $('pause-screen'),
      resumeBtn: $('resume-btn'),
      pauseRestart: $('pause-restart'),
      pauseSound: $('pause-sound'),
      pauseMusic: $('pause-music'),
      pauseQuit: $('pause-quit'),
      soundBtn: $('sound-btn'),
      playerPoints: $('player-points'),
      rivalPoints: $('rival-points'),
      playerServe: $('player-serve'),
      rivalServe: $('rival-serve'),
      matchLabel: $('match-label'),
      scoreMeta: $('score-meta'),
      matchPointFlag: $('match-point-flag'),
      rallyCount: $('rally-count'),
      topSpeed: $('top-speed'),
      reticle: $('reticle'),
      readinessRing: $('readiness-ring'),
      shotChip: $('shot-chip'),
      autoShot: $('auto-shot'),
      autoHand: $('auto-hand'),
      prompt: $('prompt'),
      hitFeedback: $('hit-feedback'),
      hitRating: $('hit-rating'),
      hitDetail: $('hit-detail'),
      touchUi: $('touch-ui'),
      touchAimLabel: $('touch-aim-label'),
      hitButton: $('hit-button'),
      joystickZone: $('joystick-zone'),
      joystickKnob: $('joystick-knob'),
      aimTouchZone: $('aim-touch-zone'),
      pointBanner: $('point-banner'),
      pointKicker: $('point-kicker'),
      pointTitle: $('point-title'),
      pointReason: $('point-reason'),
      countdown: $('countdown'),
      countdownValue: $('countdown-value'),
      countdownSub: $('countdown-sub'),
      countdownKicker: document.querySelector('#countdown .countdown-kicker'),
      toast: $('toast'),
      flash: $('flash'),
      confetti: $('confetti'),
      resultsScreen: $('results-screen'),
      resultsModal: document.querySelector('#results-screen .results-modal'),
      resultKicker: $('result-kicker'),
      resultTitle: $('result-title'),
      resultLine: $('result-line'),
      resultScoreline: $('result-scoreline'),
      statPoints: $('stat-points'),
      statSpeed: $('stat-speed'),
      statRally: $('stat-rally'),
      statPerfect: $('stat-perfect'),
      resultFoot: $('result-foot'),
      rematchBtn: $('rematch-btn'),
      titleBtn: $('title-btn'),
      offScreenMarker: $('off-screen-marker'),
      replayBadge: $('replay-badge'),
      cinemaBars: $('cinema-bars'),
      lobbyScreen: $('lobby-screen'),
      lobbyKicker: $('lobby-kicker'),
      lobbyTitle: $('lobby-title'),
      lobbyLede: $('lobby-lede'),
      lobbyCodeRow: $('lobby-code-row'),
      lobbyCode: $('lobby-code'),
      copyLinkBtn: $('copy-link-btn'),
      nameInput: $('name-input'),
      codeInput: $('code-input'),
      codeField: $('code-field'),
      lobbyStatus: $('lobby-status'),
      lobbyStatusText: $('lobby-status-text'),
      lobbyVs: $('lobby-vs'),
      lobbyVsMe: $('lobby-vs-me'),
      lobbyVsOpp: $('lobby-vs-opp'),
      lobbyCancel: $('lobby-cancel'),
      lobbyGo: $('lobby-go'),
      lobbyFoot: $('lobby-foot'),
      hostBtn: $('host-btn'),
      joinBtn: $('join-btn'),
    };

    this.bindButtons();
    this._initViewportMode();
    window.addEventListener('resize', () => this._initViewportMode());
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => this._initViewportMode(), 200);
    });
  }

  bind(handlers = {}) {
    this.handlers = handlers;
  }

  bindButtons() {
    const fire = (name, ...args) => {
      const handler = this.handlers[name];
      if (typeof handler === 'function') handler(...args);
    };

    const sportBtns = [
      [this.el.sportTennis, 'tennis'],
      [this.el.sportBasket, 'basket'],
    ];
    for (const [btn, sport] of sportBtns) {
      btn?.addEventListener('click', () => {
        if (btn.classList.contains('is-active')) return;
        for (const [other] of sportBtns) other?.classList.remove('is-active');
        btn.classList.add('is-active');
        fire('onSport', sport);
      });
    }
    this.el.playBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      fire('onPlay');
    });
    this.el.hostBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      fire('onHost');
    });
    this.el.joinBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      fire('onJoin');
    });
    this.el.lobbyCancel?.addEventListener('click', () => fire('onLobbyCancel'));
    this.el.lobbyGo?.addEventListener('click', () => fire('onLobbyGo'));
    this.el.copyLinkBtn?.addEventListener('click', () => fire('onCopyLink'));
    this.el.codeInput?.addEventListener('input', () => {
      const input = this.el.codeInput;
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });
    this.el.howtoBtn?.addEventListener('click', () => fire('onHowto'));
    this.el.howtoClose?.addEventListener('click', () => fire('onHowtoClose'));
    this.el.pauseBtn?.addEventListener('click', () => fire('onPause'));
    this.el.resumeBtn?.addEventListener('click', () => fire('onResume'));
    this.el.pauseRestart?.addEventListener('click', () => fire('onRestart'));
    this.el.pauseQuit?.addEventListener('click', () => fire('onQuitToTitle'));
    this.el.pauseSound?.addEventListener('click', () => fire('onSoundToggle'));
    this.el.pauseMusic?.addEventListener('click', () => fire('onMusicToggle'));
    this.el.soundBtn?.addEventListener('click', () => fire('onSoundToggle'));
    this.el.rematchBtn?.addEventListener('click', () => fire('onRematch'));
    this.el.titleBtn?.addEventListener('click', () => fire('onQuitToTitle'));

    const hitButton = this.el.hitButton;
    if (hitButton) {
      const press = (event) => {
        event.preventDefault();
        event.stopPropagation();
        hitButton.classList.add('is-pressed');
        fire('onHit');
      };
      const release = (event) => {
        event.preventDefault();
        hitButton.classList.remove('is-pressed');
      };
      hitButton.addEventListener('pointerdown', press);
      hitButton.addEventListener('pointerup', release);
      hitButton.addEventListener('pointercancel', release);
      hitButton.addEventListener('pointerleave', release);
    }
  }

  _initViewportMode() {
    const isTouch =
      window.matchMedia?.('(pointer: coarse)').matches ||
      (navigator.maxTouchPoints ?? 0) > 0;
    const narrow = window.innerWidth <= 900;
    const mobile = isTouch || narrow;
    this.state.mobile = mobile;
    this.el.body.classList.toggle('is-mobile', mobile);
    if (mobile) {
      this.el.touchUi?.removeAttribute('hidden');
      this.setPrompt(this.state.playing ? 'TAP HIT WHEN READY' : 'DRAG TO AIM · TAP HIT');
    } else {
      this.el.touchUi?.setAttribute('hidden', '');
    }
  }

  hideBoot() {
    this.el.boot?.classList.add('is-gone');
    window.setTimeout(() => {
      if (this.el.boot) this.el.boot.hidden = true;
    }, 650);
    this.el.body.classList.remove('is-booting');
  }

  showTitle() {
    this.state.playing = false;
    this.el.body.classList.remove('is-playing', 'is-paused');
    this.el.title.removeAttribute('hidden');
    this.el.hud?.setAttribute('hidden', '');
    this.el.pauseScreen?.setAttribute('hidden', '');
    this.el.resultsScreen?.setAttribute('hidden', '');
    this.el.howtoScreen?.setAttribute('hidden', '');
    this.el.matchPointFlag?.setAttribute('hidden', '');
    this.hidePointBanner();
    this.hideCountdown();
    this.hideToast();
    this.setOffscreenMarker(false);
  }

  showGame() {
    this.state.playing = true;
    this.el.body.classList.add('is-playing');
    this.el.body.classList.remove('is-paused');
    this.el.title?.setAttribute('hidden', '');
    this.el.hud?.removeAttribute('hidden');
    this.el.hud?.setAttribute('aria-hidden', 'false');
    this.el.pauseScreen?.setAttribute('hidden', '');
    this.el.resultsScreen?.setAttribute('hidden', '');
    this.el.howtoScreen?.setAttribute('hidden', '');
    this.setPaused(false);
    this._initViewportMode();
    if (this.state.mobile) {
      this.el.touchUi?.removeAttribute('hidden');
    }
  }

  showHud(visible) {
    if (visible) {
      this.el.hud?.removeAttribute('hidden');
      this.el.hud?.setAttribute('aria-hidden', 'false');
    } else {
      this.el.hud?.setAttribute('hidden', '');
      this.el.hud?.setAttribute('aria-hidden', 'true');
    }
  }

  setPaused(paused) {
    this.state.paused = paused;
    this.el.body.classList.toggle('is-paused', paused);
    if (paused) {
      this.el.pauseScreen?.removeAttribute('hidden');
    } else {
      this.el.pauseScreen?.setAttribute('hidden', '');
    }
  }

  showHowTo(visible) {
    if (visible) this.el.howtoScreen?.removeAttribute('hidden');
    else this.el.howtoScreen?.setAttribute('hidden', '');
  }

  hideHowTo() {
    this.el.howtoScreen?.setAttribute('hidden', '');
  }

  /* ── LAN lobby ── */
  showLobby(mode, { code = null, opp = null, name = null, status = null, error = false } = {}) {
    const el = this.el;
    if (!el.lobbyScreen) return;
    el.lobbyScreen.removeAttribute('hidden');
    el.title?.setAttribute('hidden', '');
    el.lobbyVs.setAttribute('hidden', '');
    el.lobbyGo.setAttribute('hidden', '');
    el.lobbyStatus.removeAttribute('hidden');
    el.lobbyStatus.classList.toggle('is-error', error);
    el.nameInput.value = name ?? el.nameInput.value ?? '';
    if (mode === 'host') {
      el.lobbyKicker.textContent = 'HOSTING LAN MATCH';
      el.lobbyTitle.textContent = 'WAITING…';
      el.lobbyLede.textContent = 'Share the code or the link — Laki joins from any device on this network.';
      el.lobbyCodeRow?.removeAttribute('hidden');
      el.lobbyCode.textContent = code || '····';
      el.codeField?.setAttribute('hidden', '');
      el.lobbyStatusText.textContent = status || 'WAITING FOR LAKI TO JOIN…';
      el.lobbyFoot.textContent = 'LINK WORKS ON ANY NETWORK — SEND IT TO LAKI';
    } else if (mode === 'join') {
      el.lobbyKicker.textContent = 'JOIN LAN MATCH';
      el.lobbyTitle.textContent = 'JOINING…';
      el.lobbyLede.textContent = code ? `Using match code ${code}.` : 'Looking for a hosted match on this network.';
      el.lobbyCodeRow?.setAttribute('hidden', '');
      el.codeField?.removeAttribute('hidden');
      el.lobbyStatusText.textContent = status || 'SEARCHING FOR HOST…';
      el.lobbyFoot.textContent = 'AUTO-JOIN IS ON — THIS PAGE WILL CONNECT WHEN DUKA HOSTS';
    } else {
      el.lobbyKicker.textContent = 'LAN MATCH';
      el.lobbyStatusText.textContent = status || 'CONNECTING…';
    }
  }

  updateLobbyStatus(text, { error = false, hideSpinner = false } = {}) {
    if (!this.el.lobbyStatus) return;
    this.el.lobbyStatusText.textContent = text;
    this.el.lobbyStatus.classList.toggle('is-error', error);
    const spinner = this.el.lobbyStatus.querySelector('.lobby-spinner');
    if (spinner) spinner.style.display = hideSpinner ? 'none' : '';
  }

  showLobbyMatched({ me, opp, role }) {
    const el = this.el;
    if (!el.lobbyScreen) return;
    el.lobbyVs.removeAttribute('hidden');
    el.lobbyVsMe.textContent = me;
    el.lobbyVsOpp.textContent = opp;
    const meAvatar = el.lobbyVs.querySelector('.avatar-jax');
    const oppAvatar = el.lobbyVs.querySelector('.avatar-riko');
    if (meAvatar) meAvatar.textContent = me.slice(0, 2).toUpperCase();
    if (oppAvatar) oppAvatar.textContent = opp.slice(0, 2).toUpperCase();
    el.lobbyTitle.textContent = 'MATCHED!';
    el.lobbyLede.textContent = role === 'host'
      ? `${opp} is in. Starting the match — you serve first.`
      : `Connected to ${opp}. Starting the match.`;
    el.lobbyStatus.setAttribute('hidden', '');
    el.lobbyCodeRow?.setAttribute('hidden', '');
  }

  hideLobby() {
    this.el.lobbyScreen?.setAttribute('hidden', '');
  }

  showResults({ win, line, score, points, topSpeed, longestRally, perfects, foot }) {
    if (!this.el.resultsScreen) return;
    this.el.resultsScreen.removeAttribute('hidden');
    this.el.resultsModal?.classList.toggle('is-win', Boolean(win));
    this.el.resultsModal?.classList.toggle('is-loss', !win);
    this.el.resultKicker.textContent = win ? 'MATCH COMPLETE · VICTORY' : 'MATCH COMPLETE';
    this.el.resultTitle.textContent = win ? 'MATCH WON' : 'MATCH LOST';
    this.el.resultLine.textContent = line;
    this.el.resultScoreline.textContent = score;
    this.el.statPoints.textContent = String(points);
    this.el.statSpeed.textContent = String(topSpeed);
    this.el.statRally.textContent = String(longestRally);
    this.el.statPerfect.textContent = String(perfects);
    this.el.resultFoot.textContent = foot || 'AUTO-SHOT SYSTEM REPORT';
    this.el.pauseScreen?.setAttribute('hidden', '');
    this.state.paused = false;
    this.el.body.classList.remove('is-paused');
    if (win) this._burstConfetti();
  }

  hideResults() {
    this.el.resultsScreen?.setAttribute('hidden', '');
  }

  setScore({ player, rival, meta, matchLabel, serving, matchPoint, names }) {
    this.el.playerPoints.textContent = player;
    this.el.rivalPoints.textContent = rival;
    if (names) {
      const left = this.el.hud?.querySelector('.score-mate .score-name');
      const right = this.el.hud?.querySelector('.score-rival .score-name');
      if (left && left.textContent !== names[0]) left.textContent = names[0];
      if (right && right.textContent !== names[1]) right.textContent = names[1];
    }
    if (meta != null) this.el.scoreMeta.textContent = meta;
    if (matchLabel != null) this.el.matchLabel.textContent = matchLabel;
    this.el.playerServe?.classList.toggle('is-serving', serving === 'player');
    this.el.rivalServe?.classList.toggle('is-serving', serving === 'rival');
    if (matchPoint) this.el.matchPointFlag?.removeAttribute('hidden');
    else this.el.matchPointFlag?.setAttribute('hidden', '');
  }

  setRally(count) {
    if (!this.el.rallyCount) return;
    this.el.rallyCount.textContent = String(count);
  }

  setTopSpeed(kmh) {
    if (!this.el.topSpeed) return;
    this.el.topSpeed.textContent = String(Math.round(kmh));
  }

  setPlayerPanel(name, initials = 'DU') {
    const panel = document.querySelector('.player-panel');
    if (!panel) return;
    const id = panel.querySelector('.player-id b');
    const avatar = panel.querySelector('.player-avatar');
    if (id && id.textContent !== name) id.textContent = name;
    if (avatar && avatar.textContent !== initials) avatar.textContent = initials;
  }

  setAim({ shot = 'TOPSPIN', hand = 'FOREHAND', ready = false, danger = false, readiness = 0 }) {
    if (this.el.autoShot && this.el.autoShot.textContent !== shot) {
      this.el.autoShot.textContent = shot;
    }
    const handText = hand === 'BACKHAND' ? '◀ BACKHAND' : hand === 'FOREHAND' ? 'FOREHAND ▶' : hand;
    if (this.el.autoHand && this.el.autoHand.textContent !== handText) {
      this.el.autoHand.textContent = handText;
    }
    this.el.reticle?.classList.toggle('is-ready', ready);
    this.el.reticle?.classList.toggle('is-danger', danger);
    this.el.shotChip?.classList.toggle('is-ready', ready);
    if (this.el.readinessRing) {
      const offset = 283 * (1 - clamp(readiness, 0, 1));
      this.el.readinessRing.style.strokeDashoffset = String(offset);
    }
    this.el.hitButton?.classList.toggle('is-ready', ready);
  }

  setPrompt(text, tone = 'neutral') {
    if (!this.el.prompt) return;
    if (this.el.prompt.textContent !== text) this.el.prompt.textContent = text;
    this.el.prompt.classList.toggle('is-ready', tone === 'ready');
    this.el.prompt.classList.toggle('is-warning', tone === 'warning');
  }

  showHitFeedback({ rating, detail, tone = 'good', duration = 1050 }) {
    const el = this.el.hitFeedback;
    if (!el) return;
    this.el.hitRating.textContent = rating;
    this.el.hitDetail.textContent = detail;
    el.classList.remove('is-visible', 'is-perfect', 'is-poor');
    void el.offsetWidth;
    el.classList.add('is-visible');
    if (tone === 'perfect') el.classList.add('is-perfect');
    if (tone === 'poor') el.classList.add('is-poor');
    window.clearTimeout(this.winTimeouts.get(el));
    const timer = window.setTimeout(() => {
      el.classList.remove('is-visible');
    }, duration);
    this.winTimeouts.set(el, timer);
  }

  showPointBanner({ kicker = 'POINT', title = 'DUKA', reason = '', tone = 'player' }) {
    if (!this.el.pointBanner) return;
    this.el.pointKicker.textContent = kicker;
    this.el.pointTitle.textContent = title;
    this.el.pointReason.textContent = reason;
    this.el.pointBanner.classList.toggle('is-rival', tone === 'rival');
    this.el.pointBanner.removeAttribute('hidden');
    void this.el.pointBanner.offsetWidth;
    this.el.pointBanner.style.animation = 'none';
    void this.el.pointBanner.offsetWidth;
    this.el.pointBanner.style.animation = '';
    this._updateBannerState();
  }

  hidePointBanner() {
    this.el.pointBanner?.setAttribute('hidden', '');
    this._updateBannerState();
  }

  showCountdown({ kicker = 'NEXT POINT', value = 'READY', sub = 'YOUR SERVE' } = {}) {
    if (!this.el.countdown) return;
    this.el.countdownKicker.textContent = kicker;
    this.el.countdownValue.textContent = value;
    this.el.countdownSub.textContent = sub;
    this.el.countdown.removeAttribute('hidden');
    void this.el.countdown.offsetWidth;
    this.el.countdown.style.animation = 'none';
    void this.el.countdown.offsetWidth;
    this.el.countdown.style.animation = '';
    this._updateBannerState();
  }

  hideCountdown() {
    this.el.countdown?.setAttribute('hidden', '');
    this._updateBannerState();
  }

  hideBanners() {
    this.hidePointBanner();
    this.hideCountdown();
    this.hideReplay();
  }

  showReplay() {
    this.el.replayBadge?.removeAttribute('hidden');
    document.body.classList.add('is-replay');
  }

  hideReplay() {
    this.el.replayBadge?.setAttribute('hidden', '');
    document.body.classList.remove('is-replay');
  }

  _updateBannerState() {
    const bannerVisible =
      (this.el.pointBanner && !this.el.pointBanner.hidden) ||
      (this.el.countdown && !this.el.countdown.hidden);
    this.el.hud?.classList.toggle('has-banner', Boolean(bannerVisible));
  }

  showToast(title, detail, duration = 4500) {
    if (!this.el.toast) return;
    const strong = this.el.toast.querySelector('b');
    const small = this.el.toast.querySelector('small');
    if (strong) strong.textContent = title;
    if (small) small.textContent = detail;
    this.el.toast.removeAttribute('hidden');
    this.hideToast.clearTimer = window.clearTimeout(this.hideToast.clearTimer);
    this.hideToast.clearTimer = window.setTimeout(() => this.hideToast(), duration);
  }

  hideToast() {
    this.el.toast?.setAttribute('hidden', '');
  }

  flashPoint() {
    const flash = this.el.flash;
    if (!flash) return;
    flash.classList.remove('is-flashing', 'is-point-flash');
    void flash.offsetWidth;
    flash.classList.add('is-point-flash');
    window.setTimeout(() => flash.classList.remove('is-point-flash'), 450);
  }

  flashHit() {
    const flash = this.el.flash;
    if (!flash) return;
    flash.classList.remove('is-flashing', 'is-point-flash');
    void flash.offsetWidth;
    flash.classList.add('is-flashing');
    window.setTimeout(() => flash.classList.remove('is-flashing'), 250);
  }

  setOffscreenMarker(visible) {
    if (!this.el.offScreenMarker) return;
    this.el.offScreenMarker.hidden = !visible;
  }

  updateAudioState({ sound, music }) {
    this.el.body.classList.toggle('is-muted', !sound);
    if (this.el.pauseSound) this.el.pauseSound.querySelector('span').textContent = sound ? 'ON' : 'OFF';
    if (this.el.pauseMusic) this.el.pauseMusic.querySelector('span').textContent = music ? 'ON' : 'OFF';
    const soundBtn = this.el.soundBtn;
    if (soundBtn) {
      soundBtn.setAttribute('aria-pressed', String(sound));
      soundBtn.title = sound ? 'Mute sound' : 'Unmute sound';
    }
  }

  _burstConfetti() {
    const layer = this.el.confetti;
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#ffd36e', '#ff6846', '#5be7c7', '#fff5e6', '#6fb7d9', '#ff8fa3'];
    const count = 90;
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement('i');
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 1.5}s`;
      piece.style.animationDuration = `${2.4 + Math.random() * 2.4}s`;
      piece.style.setProperty('--drift', `${-90 + Math.random() * 180}px`);
      piece.style.width = `${5 + Math.random() * 7}px`;
      piece.style.height = `${9 + Math.random() * 9}px`;
      piece.style.transform = `rotate(${Math.random() * 180}deg)`;
      layer.appendChild(piece);
    }
    window.setTimeout(() => {
      if (layer) layer.innerHTML = '';
    }, 6500);
  }

  clearConfetti() {
    if (this.el.confetti) this.el.confetti.innerHTML = '';
  }
}
