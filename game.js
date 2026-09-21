(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const safeProbe = document.getElementById('safe-probe');
  const attractMode =
    new URLSearchParams(window.location.search).get('attract') === '1';
  let isOffline = !navigator.onLine;

  window.addEventListener('online', function () {
    isOffline = false;
  });
  window.addEventListener('offline', function () {
    isOffline = true;
  });

  if (tg && !attractMode) {
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if (tg.BackButton) {
      tg.BackButton.show();
      tg.BackButton.onClick(function () {
        if (state === 'leaderboard') {
          state = 'result';
          return;
        }
        pauseGame();
      });
    }
  } else if (tg && attractMode) {
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if (tg.BackButton) tg.BackButton.hide();
  }

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let safeTop = 0;
  let safeBottom = 0;

  function readSafeInsets() {
    if (!safeProbe) {
      safeTop = 0;
      safeBottom = 0;
      return;
    }
    const style = window.getComputedStyle(safeProbe);
    safeTop = parseFloat(style.paddingTop) || 0;
    safeBottom = parseFloat(style.paddingBottom) || 0;
  }

  const perm = new Uint8Array(512);

  function daySeedString() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 1;
  }

  function initPerm(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 16807) + 7) >>> 0;
      const j = s % (i + 1);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }

  initPerm(hashSeed(daySeedString()));

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOutCubic(t) {
    const x = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - x, 3);
  }

  function easeOutBack(t) {
    const x = Math.max(0, Math.min(1, t));
    const c1 = CONFIG.overlaySpringOvershoot;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  function speedK() {
    return Math.max(0, Math.min(1, currentSpeed / CONFIG.speedMax));
  }

  function perlin1(x) {
    const xi = Math.floor(x);
    const xf = x - xi;
    const u = fade(xf);
    const a = perm[xi & 255];
    const b = perm[(xi + 1) & 255];
    const ga = (a & 1) === 0 ? xf : -xf;
    const gb = (b & 1) === 0 ? xf - 1 : -(xf - 1);
    return lerp(ga, gb, u);
  }

  function terrain(x) {
    return (
      CONFIG.terrainBase +
      CONFIG.terrainAmp1 * Math.sin(x / CONFIG.terrainPeriod1) +
      CONFIG.terrainAmp2 * Math.sin(x / CONFIG.terrainPeriod2) +
      CONFIG.terrainAmp3 * Math.sin(x / CONFIG.terrainPeriod3) +
      CONFIG.terrainNoiseAmp * perlin1(x * CONFIG.terrainNoiseScale)
    );
  }

  function slopeAngle(x) {
    const d = CONFIG.slopeSample;
    const dy = terrain(x + d) - terrain(x - d);
    return Math.atan2(dy, d * 2);
  }

  let audioCtx = null;
  let rumbleOsc = null;
  let rumbleGain = null;
  let rumbleFilter = null;
  let flowPadOsc1 = null;
  let flowPadOsc2 = null;
  let flowPadGain = null;
  let flowPadFilter = null;
  let muted = false;
  try {
    muted = localStorage.getItem(CONFIG.muteStorageKey) === '1';
  } catch (e) {
    muted = false;
  }

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function haptic(style) {
    try {
      if (tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
        tg.HapticFeedback.impactOccurred(style);
      }
    } catch (e) {}
  }

  function hapticDouble() {
    haptic('medium');
    setTimeout(function () {
      haptic('medium');
    }, CONFIG.hapticDoubleMs);
  }

  function playTone(freq, dur, type, vol) {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.value = vol || 0.08;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  function playNoiseBurst(dur, vol) {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const len = Math.max(1, (ctx.sampleRate * dur) | 0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = vol || 0.1;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  function playSound(name) {
    if (muted) return;
    if (name === 'sticker') {
      playTone(880, 0.08, 'triangle', 0.07);
      playTone(1320, 0.1, 'sine', 0.05);
    } else if (name === 'land') {
      playNoiseBurst(0.12, 0.12);
      playTone(120, 0.1, 'sine', 0.06);
    } else if (name === 'flip') {
      playTone(420, 0.15, 'sawtooth', 0.04);
      playTone(640, 0.18, 'triangle', 0.035);
    } else if (name === 'jump') {
      playTone(360, 0.07, 'sine', 0.05);
    } else if (name === 'whoosh') {
      playWhoosh();
    }
  }

  function playWhoosh() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const dur = CONFIG.whooshDur;
    const len = Math.max(1, (ctx.sampleRate * dur) | 0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = CONFIG.whooshFilter;
    const gain = ctx.createGain();
    gain.gain.value = CONFIG.whooshVol;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    playTone(CONFIG.whooshTone, dur, 'sine', CONFIG.whooshToneVol);
    playTone(CONFIG.whooshTone2, dur, 'triangle', CONFIG.whooshToneVol);
  }

  function startRumble() {
    if (muted || rumbleOsc) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    rumbleOsc = ctx.createOscillator();
    rumbleFilter = ctx.createBiquadFilter();
    rumbleGain = ctx.createGain();
    rumbleOsc.type = 'sawtooth';
    rumbleOsc.frequency.value = 55;
    rumbleFilter.type = 'bandpass';
    rumbleFilter.frequency.value = 180;
    rumbleFilter.Q.value = 4;
    rumbleGain.gain.value = 0;
    rumbleOsc.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(ctx.destination);
    rumbleOsc.start();
  }

  function updateRumble(onGround, speed) {
    if (muted) {
      stopRumble();
      return;
    }
    if (onGround && state === 'play') {
      startRumble();
      if (rumbleGain) {
        const target = Math.min(CONFIG.rumbleGain, 0.01 + speed * 0.004);
        rumbleGain.gain.value = target;
      }
      if (rumbleOsc) rumbleOsc.frequency.value = 45 + speed * 4;
    } else if (rumbleGain) {
      rumbleGain.gain.value = 0;
    }
  }

  function stopRumble() {
    if (rumbleOsc) {
      try {
        rumbleOsc.stop();
      } catch (e) {}
      rumbleOsc.disconnect();
      if (rumbleFilter) rumbleFilter.disconnect();
      if (rumbleGain) rumbleGain.disconnect();
      rumbleOsc = null;
      rumbleFilter = null;
      rumbleGain = null;
    }
  }

  function startFlowPad() {
    if (muted || flowPadOsc1) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    flowPadFilter = ctx.createBiquadFilter();
    flowPadFilter.type = 'lowpass';
    flowPadFilter.frequency.value = CONFIG.flowPadCutoff;
    flowPadGain = ctx.createGain();
    flowPadGain.gain.value = 0.001;
    flowPadOsc1 = ctx.createOscillator();
    flowPadOsc2 = ctx.createOscillator();
    flowPadOsc1.type = 'sine';
    flowPadOsc2.type = 'triangle';
    flowPadOsc1.frequency.value = CONFIG.flowPadFreq1;
    flowPadOsc2.frequency.value = CONFIG.flowPadFreq2;
    flowPadOsc1.connect(flowPadFilter);
    flowPadOsc2.connect(flowPadFilter);
    flowPadFilter.connect(flowPadGain);
    flowPadGain.connect(ctx.destination);
    flowPadOsc1.start();
    flowPadOsc2.start();
    flowPadGain.gain.exponentialRampToValueAtTime(
      CONFIG.flowPadGain,
      ctx.currentTime + CONFIG.flowPadAttackMs / 1000
    );
  }

  function stopFlowPad() {
    const ctx = audioCtx;
    const osc1 = flowPadOsc1;
    const osc2 = flowPadOsc2;
    const gain = flowPadGain;
    const filter = flowPadFilter;
    flowPadOsc1 = null;
    flowPadOsc2 = null;
    flowPadGain = null;
    flowPadFilter = null;
    if (!osc1 && !gain) return;
    const fade = CONFIG.flowPadFadeMs / 1000;
    if (ctx && gain) {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        const now = Math.max(gain.gain.value, 0.001);
        gain.gain.setValueAtTime(now, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + fade);
      } catch (e) {}
    }
    setTimeout(function () {
      try {
        if (osc1) osc1.stop();
      } catch (e) {}
      try {
        if (osc2) osc2.stop();
      } catch (e) {}
      if (osc1) osc1.disconnect();
      if (osc2) osc2.disconnect();
      if (filter) filter.disconnect();
      if (gain) gain.disconnect();
    }, CONFIG.flowPadFadeMs + 30);
  }

  function setMuted(next) {
    muted = next;
    try {
      localStorage.setItem(CONFIG.muteStorageKey, muted ? '1' : '0');
    } catch (e) {}
    if (muted) stopRumble();
    if (muted) stopFlowPad();
    else if (flowLeftMs > 0) startFlowPad();
  }

  function makePlaceholder(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d'), w, h);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    return img;
  }

  const phStand = makePlaceholder(CONFIG.spriteW, CONFIG.spriteH, function (g, w, h) {
    g.fillStyle = '#e74c3c';
    g.beginPath();
    g.ellipse(w / 2, h * 0.42, w * 0.32, h * 0.36, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(w * 0.38, h * 0.36, 4, 0, Math.PI * 2);
    g.arc(w * 0.62, h * 0.36, 4, 0, Math.PI * 2);
    g.fill();
  });

  const phJump = makePlaceholder(CONFIG.spriteW, CONFIG.spriteH, function (g, w, h) {
    g.fillStyle = '#e74c3c';
    g.beginPath();
    g.ellipse(w / 2, h * 0.5, w * 0.34, h * 0.28, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(w * 0.38, h * 0.44, 4, 0, Math.PI * 2);
    g.arc(w * 0.62, h * 0.44, 4, 0, Math.PI * 2);
    g.fill();
  });

  const phFlip = makePlaceholder(CONFIG.spriteW, CONFIG.spriteH, function (g, w, h) {
    g.fillStyle = '#e74c3c';
    g.beginPath();
    g.ellipse(w / 2, h / 2, w * 0.28, h * 0.28, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c0392b';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(8, 18);
    g.lineTo(w - 8, h - 18);
    g.moveTo(w - 8, 18);
    g.lineTo(8, h - 18);
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(w * 0.4, h * 0.42, 3.5, 0, Math.PI * 2);
    g.arc(w * 0.6, h * 0.42, 3.5, 0, Math.PI * 2);
    g.fill();
  });

  const phBoard = makePlaceholder(CONFIG.boardW, CONFIG.boardH, function (g, w, h) {
    g.fillStyle = '#2b2f36';
    g.fillRect(2, h * 0.25, w - 4, h * 0.45);
    g.fillStyle = '#888';
    g.beginPath();
    g.arc(w * 0.22, h * 0.75, 3.5, 0, Math.PI * 2);
    g.arc(w * 0.78, h * 0.75, 3.5, 0, Math.PI * 2);
    g.fill();
  });

  const chromaScratch = document.createElement('canvas');

  function purpleKeyAmount(r, gv, b) {
    const max = Math.max(r, gv, b);
    const min = Math.min(r, gv, b);
    const delta = max - min;
    if (max === 0) return 0;
    const s = delta / max;
    const v = max / 255;
    let h = 0;
    if (delta !== 0) {
      if (max === r) h = (gv - b) / delta;
      else if (max === gv) h = 2 + (b - r) / delta;
      else h = 4 + (r - gv) / delta;
      h *= 60;
      if (h < 0) h += 360;
    }
    let dh = Math.abs(h - CONFIG.chromaHue);
    if (dh > 180) dh = 360 - dh;
    if (s < CONFIG.chromaSatMin || v < CONFIG.chromaValMin || dh > CONFIG.chromaHueRange) {
      return 0;
    }
    return 1;
  }

  function applyChromaKey(img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    chromaScratch.width = w;
    chromaScratch.height = h;
    const g = chromaScratch.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.drawImage(img, 0, 0);
    let data;
    try {
      data = g.getImageData(0, 0, w, h);
    } catch (e) {
      return img;
    }
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const key = purpleKeyAmount(px[i], px[i + 1], px[i + 2]);
      if (key > 0) px[i + 3] = Math.round(px[i + 3] * (1 - key));
    }
    g.putImageData(data, 0, 0);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d').drawImage(chromaScratch, 0, 0);
    return out;
  }

  function loadAsset(file, fallback) {
    const img = new Image();
    const slot = { img: img, fallback: fallback, ok: false };
    img.onload = function () {
      if (img.naturalWidth > 0) {
        slot.img = applyChromaKey(img);
        slot.ok = true;
      } else {
        slot.ok = false;
      }
    };
    img.onerror = function () {
      slot.ok = false;
    };
    img.src = 'assets/' + file;
    return slot;
  }

  const sprites = {
    stand: loadAsset('stand.png', phStand),
    jump: loadAsset('jump.png', phJump),
    flip: loadAsset('flip.png', phFlip),
    board: loadAsset('board.png', phBoard),
  };

  function spriteOf(slot) {
    return slot.ok ? slot.img : slot.fallback;
  }

  const OBSTACLE_TYPES = ['cone', 'crack', 'curb'];

  const player = {
    screenX: 0,
    y: 0,
    vy: 0,
    onGround: true,
    inAir: false,
    flipping: false,
    angle: 0,
    boardSpin: 0,
    flipAgeMs: 0,
  };

  let worldX = 0;
  let camY = 0;
  let state = 'play';
  let score = 0;
  let timeLeftMs = 0;
  let runElapsedMs = 0;
  let speedMul = 1;
  let slowUntilMs = 0;
  let shakeLeftMs = 0;
  let obstacles = [];
  let stickers = [];
  let particles = [];
  let nextObstacleX = 0;
  let nextStickerX = 0;
  let obstaclesArmed = false;
  let lastTs = 0;
  let pointerHeld = false;
  let holdMs = 0;
  let currentSpeed = CONFIG.speedBase;
  let cruiseSpeed = CONFIG.speedBase;
  let comboMul = 1;
  let comboPopMs = 0;
  let airTimeMs = 0;
  let airTricks = 0;
  let camZoom = 1;
  let flowChargeMs = 0;
  let flowLeftMs = 0;
  let flowVisual = 0;
  let scoreShown = 0;
  let scoreFrom = 0;
  let scoreTo = 0;
  let scoreTweenLeft = 0;
  let timeShown = CONFIG.timerSec;
  let timeFrom = CONFIG.timerSec;
  let timeTo = CONFIG.timerSec;
  let timeTweenLeft = 0;
  let squashX = 1;
  let squashY = 1;
  let squashPeakX = 1;
  let squashPeakY = 1;
  let squashLeft = 0;
  let overlayAgeMs = 0;
  let hitStopLeft = 0;
  let meterShown = 0;
  let replayBtn = { x: 0, y: 0, w: 180, h: 48 };
  let shareBtn = { x: 0, y: 0, w: 180, h: 48 };
  let recordsBtn = { x: 0, y: 0, w: 180, h: 48 };
  let continueBtn = { x: 0, y: 0, w: 180, h: 48 };
  let backLbBtn = { x: 0, y: 0, w: 180, h: 48 };
  let muteBtn = { x: 0, y: 0, w: 44, h: 44 };
  let leaderboard = { top: [], me: null, loading: false, error: '' };
  let scoreSubmitted = false;
  let attractJumpCd = 0;
  let attractFlipArmed = false;

  function apiBase() {
    return (CONFIG.workerUrl || CONFIG.scoresApiUrl || '').replace(/\/+$/, '');
  }

  function submitScore() {
    const base = apiBase();
    if (!base || scoreSubmitted) return;
    const initData = tg && tg.initData ? tg.initData : '';
    if (!initData) return;
    scoreSubmitted = true;
    fetch(base + '/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: initData, score: score }),
    }).catch(function () {});
  }

  function openLeaderboard() {
    state = 'leaderboard';
    overlayAgeMs = 0;
    leaderboard.loading = true;
    leaderboard.error = '';
    leaderboard.top = [];
    leaderboard.me = null;
    const base = apiBase();
    if (!base) {
      leaderboard.loading = false;
      leaderboard.error = 'API не настроен';
      return;
    }
    const initData = tg && tg.initData ? tg.initData : '';
    const q = initData ? '?initData=' + encodeURIComponent(initData) : '';
    fetch(base + '/api/leaderboard' + q)
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        leaderboard.loading = false;
        leaderboard.top = (data && data.top) || [];
        leaderboard.me = (data && data.me) || null;
      })
      .catch(function () {
        leaderboard.loading = false;
        leaderboard.error = 'Не удалось загрузить';
      });
  }

  function pauseGame() {
    if (attractMode) return;
    if (state !== 'play') return;
    state = 'pause';
    overlayAgeMs = 0;
    pointerHeld = false;
    holdMs = 0;
    stopRumble();
    stopFlowPad();
  }

  function resumeGame() {
    if (state !== 'pause') return;
    state = 'play';
    lastTs = 0;
    if (flowLeftMs > 0) startFlowPad();
  }

  function shareScore() {
    const text = GAME_TITLE + ': мой счёт ' + score + '!';
    if (tg && tg.switchInlineQuery) {
      try {
        tg.switchInlineQuery(text);
        return;
      } catch (e) {}
    }
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
    }
  }

  function resetRun() {
    worldX = 0;
    score = 0;
    timeLeftMs = CONFIG.timerSec * 1000;
    runElapsedMs = 0;
    speedMul = 1;
    slowUntilMs = 0;
    shakeLeftMs = 0;
    obstacles = [];
    stickers = [];
    particles = [];
    obstaclesArmed = false;
    nextObstacleX = 0;
    nextStickerX = CONFIG.coinGap;
    pointerHeld = false;
    holdMs = 0;
    currentSpeed = CONFIG.speedBase;
    cruiseSpeed = CONFIG.speedBase;
    comboMul = 1;
    comboPopMs = 0;
    airTimeMs = 0;
    airTricks = 0;
    camZoom = 1;
    flowChargeMs = 0;
    flowLeftMs = 0;
    flowVisual = 0;
    scoreShown = 0;
    scoreFrom = 0;
    scoreTo = 0;
    scoreTweenLeft = 0;
    timeShown = CONFIG.timerSec;
    timeFrom = CONFIG.timerSec;
    timeTo = CONFIG.timerSec;
    timeTweenLeft = 0;
    squashX = 1;
    squashY = 1;
    squashPeakX = 1;
    squashPeakY = 1;
    squashLeft = 0;
    overlayAgeMs = 0;
    hitStopLeft = 0;
    meterShown = 0;
    stopFlowPad();
    player.vy = 0;
    player.onGround = true;
    player.inAir = false;
    player.flipping = false;
    player.boardSpin = 0;
    player.flipAgeMs = 0;
    player.angle = 0;
    player.screenX = cssW * CONFIG.playerScreenRatio;
    player.y = terrain(worldX + player.screenX);
    camY = player.y - cssH * 0.65;
    state = 'play';
    scoreSubmitted = false;
    attractJumpCd = 0;
    attractFlipArmed = false;
    layoutButtons();
  }

  function layoutButtons() {
    const btnW = Math.min(220, cssW * 0.6);
    const bottomLimit = cssH - safeBottom - 24;
    const gap = 12;

    recordsBtn.w = btnW;
    recordsBtn.h = 48;
    recordsBtn.x = (cssW - recordsBtn.w) / 2;
    recordsBtn.y = bottomLimit - recordsBtn.h;

    shareBtn.w = btnW;
    shareBtn.h = 48;
    shareBtn.x = (cssW - shareBtn.w) / 2;
    shareBtn.y = recordsBtn.y - gap - shareBtn.h;

    replayBtn.w = btnW;
    replayBtn.h = 48;
    replayBtn.x = (cssW - replayBtn.w) / 2;
    replayBtn.y = shareBtn.y - gap - replayBtn.h;

    continueBtn.w = btnW;
    continueBtn.h = 52;
    continueBtn.x = (cssW - continueBtn.w) / 2;
    continueBtn.y = Math.min(cssH * 0.52, bottomLimit - continueBtn.h);

    backLbBtn.w = btnW;
    backLbBtn.h = 48;
    backLbBtn.x = (cssW - backLbBtn.w) / 2;
    backLbBtn.y = bottomLimit - backLbBtn.h;

    muteBtn.w = 44;
    muteBtn.h = 44;
    muteBtn.x = cssW - 16 - muteBtn.w;
    muteBtn.y = safeTop + 16;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    readSafeInsets();
    player.screenX = cssW * CONFIG.playerScreenRatio;
    if (player.onGround) {
      player.y = terrain(worldX + player.screenX);
    }
    camY = player.y - cssH * 0.65;
    layoutButtons();
  }

  window.addEventListener('resize', resize);
  resize();
  resetRun();

  function jump() {
    if (!player.onGround) return false;
    player.vy = -CONFIG.jumpPower;
    player.onGround = false;
    player.inAir = true;
    airTimeMs = 0;
    airTricks = 0;
    squashPeakX = 1 - CONFIG.squashAmt;
    squashPeakY = 1 + CONFIG.squashAmt;
    squashX = squashPeakX;
    squashY = squashPeakY;
    squashLeft = CONFIG.squashMs;
    return true;
  }

  function startFlip() {
    if (player.flipping) return;
    player.flipping = true;
    player.flipAgeMs = 0;
    player.boardSpin = 0;
    airTricks += 1;
    bumpCombo();
    if (!attractMode) haptic('medium');
    playSound('flip');
  }

  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * cssW,
      y: ((clientY - rect.top) / rect.height) * cssH,
    };
  }

  function hitRect(btn, x, y) {
    return x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h;
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    ensureAudio();
    const p = canvasPoint(e.clientX, e.clientY);

    if (hitRect(muteBtn, p.x, p.y)) {
      setMuted(!muted);
      haptic('light');
      return;
    }

    if (attractMode) return;

    if (state === 'pause') {
      if (hitRect(continueBtn, p.x, p.y)) resumeGame();
      return;
    }

    if (state === 'leaderboard') {
      if (hitRect(backLbBtn, p.x, p.y)) {
        state = 'result';
        overlayAgeMs = 0;
      }
      return;
    }

    if (state === 'result') {
      if (hitRect(replayBtn, p.x, p.y)) resetRun();
      else if (hitRect(shareBtn, p.x, p.y)) shareScore();
      else if (hitRect(recordsBtn, p.x, p.y)) openLeaderboard();
      return;
    }

    pointerHeld = true;
    holdMs = 0;
    haptic('light');
    if (jump()) playSound('jump');
  });

  canvas.addEventListener('pointerup', function () {
    pointerHeld = false;
    holdMs = 0;
  });

  canvas.addEventListener('pointercancel', function () {
    pointerHeld = false;
    holdMs = 0;
  });

  function spawnObstacle(x) {
    const type = OBSTACLE_TYPES[(Math.random() * OBSTACLE_TYPES.length) | 0];
    obstacles.push({
      type: type,
      x: x,
      hit: false,
      nearAwarded: false,
      minDist: Infinity,
    });
  }

  function spawnStickerArc(baseX) {
    const spread = CONFIG.stickerArcSpread;
    const height = CONFIG.stickerArcHeight;
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      const x = baseX + (i - 1) * spread;
      const lift = Math.sin(t * Math.PI) * height + height * 0.35;
      stickers.push({ x: x, lift: lift, taken: false });
    }
  }

  function spawnAhead() {
    const viewEnd = worldX + cssW + 120;
    if (!obstaclesArmed && runElapsedMs >= (attractMode ? 0 : CONFIG.graceSec * 1000)) {
      obstaclesArmed = true;
      nextObstacleX = worldX + player.screenX + CONFIG.obstacleGap;
    }
    if (obstaclesArmed) {
      while (nextObstacleX < viewEnd) {
        const jitter = (Math.random() * 2 - 1) * CONFIG.obstacleGapJitter;
        spawnObstacle(nextObstacleX + jitter);
        nextObstacleX += CONFIG.obstacleGap;
      }
    }
    while (nextStickerX < viewEnd) {
      spawnStickerArc(nextStickerX);
      nextStickerX += CONFIG.coinGap;
    }
  }

  function applyStumble(factor, ms, withShake) {
    speedMul = Math.min(speedMul, factor);
    slowUntilMs = Math.max(slowUntilMs, ms);
    if (withShake) shakeLeftMs = CONFIG.shakeMs;
    halfCombo();
    flowChargeMs = 0;
    if (flowLeftMs > 0) {
      flowLeftMs = 0;
      stopFlowPad();
    }
  }

  function bumpCombo() {
    if (attractMode) return;
    const next = comboMul < 2 ? 2 : Math.min(CONFIG.comboMax, Math.floor(comboMul) + 1);
    comboMul = next;
    comboPopMs = CONFIG.comboPopMs;
  }

  function halfCombo() {
    if (comboMul <= 1) return;
    comboMul = Math.max(1, comboMul / 2);
    comboPopMs = CONFIG.comboPopMs;
  }

  function applyScore(base) {
    if (attractMode) return;
    let pts = base * Math.max(1, comboMul);
    if (flowLeftMs > 0) pts *= CONFIG.flowScoreMul;
    score += Math.round(pts);
    scoreFrom = scoreShown;
    scoreTo = score;
    scoreTweenLeft = CONFIG.scoreTweenMs;
  }

  function updateScoreTween(dt) {
    if (scoreTweenLeft <= 0) {
      scoreShown = score;
      return;
    }
    scoreTweenLeft -= dt;
    const t = 1 - Math.max(0, scoreTweenLeft) / CONFIG.scoreTweenMs;
    scoreShown = lerp(scoreFrom, scoreTo, easeOutCubic(t));
    if (scoreTweenLeft <= 0) {
      scoreTweenLeft = 0;
      scoreShown = scoreTo;
    }
  }

  function updateTimeTween(dt) {
    const target = Math.ceil(Math.max(0, timeLeftMs) / 1000);
    if (target !== timeTo) {
      timeFrom = timeShown;
      timeTo = target;
      timeTweenLeft = CONFIG.scoreTweenMs;
    }
    if (timeTweenLeft <= 0) {
      timeShown = timeTo;
      return;
    }
    timeTweenLeft -= dt;
    const t = 1 - Math.max(0, timeTweenLeft) / CONFIG.scoreTweenMs;
    timeShown = lerp(timeFrom, timeTo, easeOutCubic(t));
    if (timeTweenLeft <= 0) {
      timeTweenLeft = 0;
      timeShown = timeTo;
    }
  }

  function updateSquash(dt) {
    if (squashLeft <= 0) {
      squashX = 1;
      squashY = 1;
      return;
    }
    squashLeft -= dt;
    const t = 1 - Math.max(0, squashLeft) / CONFIG.squashMs;
    const e = easeOutCubic(t);
    squashX = lerp(squashPeakX, 1, e);
    squashY = lerp(squashPeakY, 1, e);
    if (squashLeft <= 0) {
      squashLeft = 0;
      squashX = 1;
      squashY = 1;
    }
  }

  function overlayScale() {
    const t = overlayAgeMs / CONFIG.overlaySpringMs;
    const e = easeOutBack(t);
    return CONFIG.overlaySpringFrom + (1 - CONFIG.overlaySpringFrom) * e;
  }

  function beginOverlay() {
    const s = overlayScale();
    ctx.save();
    ctx.translate(cssW / 2, cssH / 2);
    ctx.scale(s, s);
    ctx.translate(-cssW / 2, -cssH / 2);
  }

  function endOverlay() {
    ctx.restore();
  }

  function applyAirLandingBonus() {
    let bonus = 0;
    if (airTricks > 0) bonus += CONFIG.airTrickSpeedBonus * airTricks;
    if (airTimeMs >= CONFIG.airTimeBonusMs) bonus += CONFIG.airTrickSpeedBonus;
    if (bonus > 0) {
      cruiseSpeed = Math.min(CONFIG.speedMax, cruiseSpeed + bonus);
    }
    airTricks = 0;
    airTimeMs = 0;
  }

  function burstParticles(wx, wy, color, lifeMs) {
    const budget = CONFIG.maxParticles - particles.length;
    const k = CONFIG.particleSpeedFloor + (1 - CONFIG.particleSpeedFloor) * speedK();
    const n = Math.min(budget, Math.max(0, Math.round(CONFIG.burstCount * k)));
    const life = lifeMs || 400;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1.5 + Math.random() * 3.5) * k;
      particles.push({
        x: wx,
        y: wy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.5 * k,
        life: life,
        maxLife: life,
        color: color,
        r: 2 + Math.random() * 2,
      });
    }
  }

  function spawnLandDust(wx, wy) {
    const budget = CONFIG.maxParticles - particles.length;
    const k = CONFIG.particleSpeedFloor + (1 - CONFIG.particleSpeedFloor) * speedK();
    const n = Math.min(budget, Math.max(1, Math.round(CONFIG.dustCount * k)));
    for (let i = 0; i < n; i++) {
      const life = CONFIG.particleFadeMs;
      particles.push({
        x: wx + (Math.random() * 2 - 1) * 16,
        y: wy - 2,
        vx: (-1.2 - Math.random() * 2.4) * k,
        vy: (-0.4 - Math.random() * 1.6) * k,
        life: life,
        maxLife: life,
        color: i % 2 === 0 ? '#c4b59a' : '#9a8b72',
        r: 2 + Math.random() * 3,
      });
    }
  }

  function circlesHit(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    const r = CONFIG.hitRadius * 2;
    return dx * dx + dy * dy <= r * r;
  }

  function updateCollisions(px) {
    const pcy = player.y - CONFIG.playerSize * 0.5;

    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.hit) continue;
      const oy = terrain(o.x) - (o.type === 'crack' ? 4 : 18);
      if (circlesHit(px, pcy, o.x, oy)) {
        o.hit = true;
        if (o.type === 'crack') {
          applyStumble(CONFIG.crackSpeedFactor, CONFIG.crackMs, false);
        } else {
          applyStumble(CONFIG.stumbleSpeedFactor, CONFIG.stumbleMs, true);
        }
        continue;
      }
      const dx = o.x - px;
      const dy = oy - pcy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < o.minDist) o.minDist = dist;
      if (!o.nearAwarded && px > o.x) {
        o.nearAwarded = true;
        const hitDist = CONFIG.hitRadius * 2;
        if (o.minDist < hitDist + CONFIG.nearMissPx) {
          applyScore(CONFIG.nearMissPoints);
          bumpCombo();
          playSound('whoosh');
          if (!attractMode) haptic('light');
        }
      }
    }

    for (let i = 0; i < stickers.length; i++) {
      const s = stickers[i];
      if (s.taken) continue;
      const sy = terrain(s.x) - s.lift;
      if (!circlesHit(px, pcy, s.x, sy)) continue;
      s.taken = true;
      applyScore(CONFIG.stickerPoints);
      if (player.inAir) bumpCombo();
      burstParticles(s.x, sy, '#ffd24a', 400);
      playSound('sticker');
    }
  }

  function pruneEntities(px) {
    const minX = px - 200;
    obstacles = obstacles.filter(function (o) {
      return o.x > minX;
    });
    stickers = stickers.filter(function (s) {
      return !s.taken && s.x > minX;
    });
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
    }
  }

  function updateAttract(dt, px) {
    if (attractJumpCd > 0) attractJumpCd -= dt;

    if (player.inAir) {
      if (attractFlipArmed && !player.flipping) {
        startFlip();
        attractFlipArmed = false;
      }
      return;
    }

    let needJump = false;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.hit) continue;
      const dx = o.x - px;
      if (dx > 28 && dx < CONFIG.attractJumpAhead) {
        needJump = true;
        if (o.type !== 'crack' && Math.random() < CONFIG.attractFlipChance) {
          attractFlipArmed = true;
        }
        break;
      }
    }

    if (!needJump) {
      for (let i = 0; i < stickers.length; i++) {
        const s = stickers[i];
        if (s.taken) continue;
        const dx = s.x - px;
        if (dx > 20 && dx < CONFIG.attractJumpAhead * 0.85 && s.lift > 28) {
          needJump = true;
          break;
        }
      }
    }

    if (needJump && attractJumpCd <= 0) {
      if (jump()) {
        attractJumpCd = CONFIG.attractJumpCooldownMs;
        playSound('jump');
      }
    }
  }

  function update(dt) {
    updateScoreTween(dt);
    updateTimeTween(dt);
    updateSquash(dt);

    if (state === 'pause' || state === 'result' || state === 'leaderboard') {
      overlayAgeMs += dt;
      stopRumble();
      return;
    }
    if (state !== 'play') {
      stopRumble();
      return;
    }

    if (hitStopLeft > 0) {
      hitStopLeft -= dt;
      if (hitStopLeft < 0) hitStopLeft = 0;
      return;
    }

    runElapsedMs += dt;

    if (!attractMode) {
      timeLeftMs -= dt;
      if (timeLeftMs <= 0) {
        timeLeftMs = 0;
        state = 'result';
        overlayAgeMs = 0;
        stopRumble();
        stopFlowPad();
        submitScore();
        return;
      }
    }

    if (pointerHeld && !attractMode) {
      holdMs += dt;
      if (holdMs >= CONFIG.flipHoldMs && player.inAir) startFlip();
    }

    if (slowUntilMs > 0) {
      slowUntilMs -= dt;
      if (slowUntilMs <= 0) {
        slowUntilMs = 0;
        speedMul = 1;
      }
    }
    if (shakeLeftMs > 0) shakeLeftMs -= dt;
    if (comboPopMs > 0) {
      comboPopMs -= dt;
      if (comboPopMs < 0) comboPopMs = 0;
    }

    const pxNow = worldX + player.screenX;
    if (player.inAir) {
      airTimeMs += dt;
    } else {
      const ang = slopeAngle(pxNow);
      let target = CONFIG.speedBase;
      if (ang > CONFIG.slopeDeadzone) target = CONFIG.speedMax;
      else if (ang < -CONFIG.slopeDeadzone) {
        target = CONFIG.speedBase - CONFIG.speedUphillDelta;
      }
      cruiseSpeed = lerp(cruiseSpeed, target, CONFIG.speedSlopeLerp);
    }
    cruiseSpeed = Math.max(
      CONFIG.speedBase - CONFIG.speedUphillDelta,
      Math.min(CONFIG.speedMax, cruiseSpeed)
    );
    currentSpeed = cruiseSpeed * speedMul;
    worldX += currentSpeed;
    const px = worldX + player.screenX;
    const groundY = terrain(px);

    if (attractMode) updateAttract(dt, px);

    if (player.flipping) {
      player.flipAgeMs += dt;
      player.boardSpin = (player.flipAgeMs / CONFIG.flipSpinMs) * Math.PI * 2;
      if (player.flipAgeMs >= CONFIG.flipSpinMs) {
        player.flipping = false;
        player.boardSpin = 0;
      }
    }

    if (player.inAir) {
      player.vy += CONFIG.gravity;
      player.y += player.vy;
      if (player.vy > 0 && player.y >= groundY) {
        const didTrick = airTricks > 0;
        player.y = groundY;
        player.vy = 0;
        player.onGround = true;
        player.inAir = false;
        player.flipping = false;
        player.boardSpin = 0;
        applyAirLandingBonus();
        squashPeakX = 1 + CONFIG.squashAmt;
        squashPeakY = 1 - CONFIG.squashAmt;
        squashX = squashPeakX;
        squashY = squashPeakY;
        squashLeft = CONFIG.squashMs;
        spawnLandDust(px, groundY);
        playSound('land');
        if (!attractMode) {
          if (didTrick) haptic('medium');
          else haptic('light');
        }
        if (didTrick) hitStopLeft = CONFIG.hitStopMs;
      }
    } else {
      player.y = groundY;
      player.vy = 0;
      player.angle = slopeAngle(px);
    }

    if (player.inAir) {
      player.angle *= 0.9;
    }

    const camTarget = player.y - cssH * 0.65;
    camY += (camTarget - camY) * CONFIG.cameraSmooth;

    let zoomTarget = CONFIG.camZoomOut;
    if (slowUntilMs > 0 || currentSpeed <= CONFIG.camZoomSpeed) zoomTarget = 1;
    camZoom = lerp(camZoom, zoomTarget, CONFIG.camZoomLerp);

    if (slowUntilMs > 0) {
      flowChargeMs = 0;
    } else if (flowLeftMs <= 0) {
      flowChargeMs += dt;
      if (flowChargeMs >= CONFIG.flowChargeMs) {
        flowChargeMs = 0;
        flowLeftMs = CONFIG.flowDurationMs;
        startFlowPad();
        burstParticles(px, player.y, '#ffb347', 500);
        if (!attractMode) hapticDouble();
      }
    }
    if (flowLeftMs > 0) {
      flowLeftMs -= dt;
      if (flowLeftMs <= 0) {
        flowLeftMs = 0;
        stopFlowPad();
      }
    }
    flowVisual = lerp(flowVisual, flowLeftMs > 0 ? 1 : 0, CONFIG.flowVisualLerp);
    const meterTarget = flowLeftMs > 0 ? 1 : Math.min(1, flowChargeMs / CONFIG.flowChargeMs);
    meterShown = lerp(meterShown, meterTarget, CONFIG.flowVisualLerp);

    spawnAhead();
    updateCollisions(px);
    pruneEntities(px);
    updateParticles(dt);
    updateRumble(player.onGround, currentSpeed);
  }

  function worldToScreen(x, y, drawCamY) {
    return { x: Math.round(x - worldX), y: Math.round(y - drawCamY) };
  }

  function dayPhase() {
    return ((runElapsedMs / 1000) / CONFIG.dayCycleSec) % 1;
  }

  function viewPad() {
    const z = Math.min(camZoom, 1);
    return Math.ceil(cssW * (1 / z - 1)) + 40;
  }

  function drawSky() {
    const phase = dayPhase();
    const noon = 1 - Math.abs(phase - 0.5) * 2;
    const coolTop = lerpColor('#0b1a33', '#6ec6ff', noon);
    const coolBot = lerpColor('#1a2a44', '#c9e9ff', noon);
    const top = lerpColor(coolTop, '#ff7a3a', flowVisual);
    const bot = lerpColor(coolBot, '#ffe0a8', flowVisual);
    const pad = viewPad();
    const g = ctx.createLinearGradient(0, -pad, 0, cssH + pad);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(-pad, -pad, cssW + pad * 2, cssH + pad * 2);

    if (noon < 0.35) {
      ctx.fillStyle = 'rgba(255,255,220,' + (0.35 - noon) + ')';
      const moonX = cssW * (0.2 + phase * 0.6);
      ctx.beginPath();
      ctx.arc(moonX, cssH * 0.18, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function parseColor(c) {
    if (c.charAt(0) === '#') {
      return [
        parseInt(c.slice(1, 3), 16),
        parseInt(c.slice(3, 5), 16),
        parseInt(c.slice(5, 7), 16),
      ];
    }
    const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c);
    if (!m) return [255, 255, 255];
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  function lerpColor(a, b, t) {
    const A = parseColor(a);
    const B = parseColor(b);
    const r = (A[0] + (B[0] - A[0]) * t) | 0;
    const g = (A[1] + (B[1] - A[1]) * t) | 0;
    const bl = (A[2] + (B[2] - A[2]) * t) | 0;
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function drawParallax(drawCamY) {
    const phase = dayPhase();
    const noon = 1 - Math.abs(phase - 0.5) * 2;
    drawMountainLayer(
      CONFIG.parallaxFar,
      drawCamY,
      0.55,
      lerpColor(lerpColor('#2a3a55', '#7a9bb8', noon), '#d9894a', flowVisual),
      90
    );
    drawForestLayer(
      CONFIG.parallaxMid,
      drawCamY,
      lerpColor(lerpColor('#1e3d28', '#3d7a4a', noon), '#c4a02a', flowVisual),
      70
    );
    drawMountainLayer(
      CONFIG.parallaxNear,
      drawCamY,
      0.7,
      lerpColor(lerpColor('#243248', '#5f7f6a', noon), '#c97a38', flowVisual),
      110
    );
    drawGuardrail(CONFIG.parallaxFar * 0.85, drawCamY);
  }

  function drawMountainLayer(factor, drawCamY, baseRatio, color, amp) {
    const offset = Math.round(worldX * factor);
    const base = Math.round(cssH * baseRatio - (drawCamY - CONFIG.terrainBase) * factor * 0.15);
    const pad = viewPad();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-pad, cssH + pad);
    for (let sx = -pad; sx <= cssW + pad; sx += 40) {
      const wx = sx + offset;
      const y =
        base -
        Math.abs(Math.sin(wx * 0.004)) * amp -
        Math.abs(Math.sin(wx * 0.01)) * (amp * 0.35);
      ctx.lineTo(sx, Math.round(y));
    }
    ctx.lineTo(cssW + pad, cssH + pad);
    ctx.closePath();
    ctx.fill();
  }

  function drawForestLayer(factor, drawCamY, color, amp) {
    const offset = Math.round(worldX * factor);
    const base = Math.round(cssH * 0.62 - (drawCamY - CONFIG.terrainBase) * factor * 0.12);
    const pad = viewPad();
    ctx.fillStyle = color;
    for (let sx = -pad; sx <= cssW + pad; sx += 28) {
      const wx = sx + offset;
      const h = 28 + (Math.sin(wx * 0.05) * 0.5 + 0.5) * amp * 0.5;
      const y = Math.round(base - h);
      ctx.beginPath();
      ctx.moveTo(sx, base + 8);
      ctx.lineTo(sx + 12, y);
      ctx.lineTo(sx + 24, base + 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawGuardrail(factor, drawCamY) {
    const offset = Math.round(worldX * factor);
    const base = Math.round(cssH * 0.58 - (drawCamY - CONFIG.terrainBase) * factor * 0.12);
    const pad = viewPad();
    ctx.strokeStyle = 'rgba(180,190,200,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-pad, base);
    ctx.lineTo(cssW + pad, base);
    ctx.stroke();
    for (let sx = -pad - ((offset % 36) + 36) % 36; sx <= cssW + pad; sx += 36) {
      ctx.fillStyle = 'rgba(160,170,180,0.65)';
      ctx.fillRect(sx, base - 10, 3, 14);
    }
  }

  function drawTerrain(drawCamY) {
    const step = CONFIG.terrainStep;
    const half = CONFIG.roadWidth / 2;
    const pad = viewPad();
    const x0 = -pad;
    const x1 = cssW + pad;

    ctx.beginPath();
    ctx.moveTo(x0, cssH + pad);
    for (let sx = x0; sx <= x1 + step; sx += step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY) + half + 18;
      ctx.lineTo(sx, gy);
    }
    ctx.lineTo(x1 + step, cssH + pad);
    ctx.closePath();
    ctx.fillStyle = lerpColor('#3d8f4a', '#c9a227', flowVisual);
    ctx.fill();

    ctx.beginPath();
    for (let sx = x0; sx <= x1 + step; sx += step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY);
      const y = gy - half;
      if (sx === x0) ctx.moveTo(sx, y);
      else ctx.lineTo(sx, y);
    }
    for (let sx = x1 + step; sx >= x0; sx -= step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY);
      ctx.lineTo(sx, gy + half);
    }
    ctx.closePath();
    ctx.fillStyle = '#3a3f46';
    ctx.fill();

    ctx.strokeStyle = '#f5f7fa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = x0; sx <= x1 + step; sx += step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY) - half;
      if (sx === x0) ctx.moveTo(sx, gy);
      else ctx.lineTo(sx, gy);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let sx = x0; sx <= x1 + step; sx += step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY) + half;
      if (sx === x0) ctx.moveTo(sx, gy);
      else ctx.lineTo(sx, gy);
    }
    ctx.stroke();
  }

  function drawCone(sx, sy) {
    ctx.fillStyle = '#ff6a00';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 34);
    ctx.lineTo(sx + 14, sy);
    ctx.lineTo(sx - 14, sy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 8, sy - 18, 16, 5);
  }

  function drawCrack(sx, sy) {
    ctx.strokeStyle = '#1a1c20';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - 18, sy);
    ctx.lineTo(sx - 6, sy + 4);
    ctx.lineTo(sx + 2, sy - 3);
    ctx.lineTo(sx + 12, sy + 5);
    ctx.lineTo(sx + 20, sy);
    ctx.stroke();
  }

  function drawCurb(sx, sy) {
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(sx - 18, sy - 16, 36, 16);
    ctx.fillStyle = '#6d737c';
    ctx.fillRect(sx - 18, sy - 16, 36, 4);
  }

  function drawObstacles(drawCamY) {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.hit) continue;
      const gy = terrain(o.x);
      const s = worldToScreen(o.x, gy, drawCamY);
      if (s.x < -40 - viewPad() || s.x > cssW + 40 + viewPad()) continue;
      if (o.type === 'cone') drawCone(s.x, s.y);
      else if (o.type === 'crack') drawCrack(s.x, s.y);
      else drawCurb(s.x, s.y);
    }
  }

  function drawStickers(drawCamY) {
    for (let i = 0; i < stickers.length; i++) {
      const st = stickers[i];
      if (st.taken) continue;
      const wy = terrain(st.x) - st.lift;
      const s = worldToScreen(st.x, wy, drawCamY);
      if (s.x < -30 - viewPad() || s.x > cssW + 30 + viewPad()) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(runElapsedMs * 0.004);
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k * Math.PI) / 5 - Math.PI / 2;
        const r = k % 2 === 0 ? 12 : 5;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawParticles(drawCamY) {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const s = worldToScreen(p.x, p.y, drawCamY);
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, (p.r || 3) * (CONFIG.particleSpeedFloor + (1 - CONFIG.particleSpeedFloor) * speedK()), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawImageCentered(img, ox, oy, w, h) {
    ctx.drawImage(img, ox - w / 2, oy - h, w, h);
  }

  function drawPlayer(drawCamY) {
    const screenY = Math.round(player.y - drawCamY);
    let shakeX = 0;
    let shakeY = 0;
    if (shakeLeftMs > 0) {
      const t = shakeLeftMs / CONFIG.shakeMs;
      const wave = Math.sin(runElapsedMs * 0.09);
      shakeX = Math.round(wave * CONFIG.shakeAmp * t);
      shakeY = Math.round(Math.cos(runElapsedMs * 0.11) * CONFIG.shakeAmp * 0.6 * t);
    }

    const pose = player.flipping
      ? sprites.flip
      : player.inAir
        ? sprites.jump
        : sprites.stand;
    const body = spriteOf(pose);
    const board = spriteOf(sprites.board);
    const bw = CONFIG.boardW;
    const bh = CONFIG.boardH;
    const sw = CONFIG.spriteW;
    const sh = CONFIG.spriteH;

    ctx.save();
    ctx.translate(Math.round(player.screenX + shakeX), screenY + shakeY);
    ctx.rotate(player.angle);
    ctx.scale(squashX, squashY);

    if (player.flipping) {
      drawImageCentered(body, 0, 0, sw, sh);
      ctx.save();
      ctx.rotate(player.boardSpin);
      drawImageCentered(board, 0, 4, bw, bh);
      ctx.restore();
    } else {
      drawImageCentered(board, 0, 4, bw, bh);
      drawImageCentered(body, 0, 0, sw, sh);
    }

    drawHappyEyes(sh);
    drawFlowSparks(sh);
    ctx.restore();
  }

  function drawHappyEyes(sh) {
    if (comboMul < CONFIG.comboEyesMin) return;
    const y = -sh * CONFIG.happyEyeY;
    const spread = CONFIG.happyEyeSpread;
    const r = CONFIG.happyEyeRadius;
    ctx.strokeStyle = '#1a1020';
    ctx.lineWidth = CONFIG.happyEyeWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(-spread, y, r, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(spread, y, r, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }

  function drawSpark(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x - r * 0.7, y - r * 0.7);
    ctx.lineTo(x + r * 0.7, y + r * 0.7);
    ctx.moveTo(x + r * 0.7, y - r * 0.7);
    ctx.lineTo(x - r * 0.7, y + r * 0.7);
    ctx.stroke();
  }

  function drawFlowSparks(sh) {
    if (flowVisual <= 0) return;
    const n = CONFIG.flowSparkCount;
    const baseR = CONFIG.flowSparkRadius;
    ctx.strokeStyle = '#ffe7a3';
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = runElapsedMs * CONFIG.flowSparkSpin + (i * Math.PI * 2) / n;
      const pulse = 0.55 + 0.45 * Math.sin(runElapsedMs * CONFIG.flowSparkTwinkle + i * 1.7);
      const rad = baseR * (0.65 + 0.35 * pulse);
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad - sh * CONFIG.flowSparkLift;
      ctx.globalAlpha = flowVisual * pulse;
      ctx.lineWidth = 1.4 + pulse;
      drawSpark(x, y, 2.2 + pulse * 2.2);
    }
    ctx.globalAlpha = 1;
  }

  function comboLabel() {
    if (comboMul % 1 === 0) return 'x' + comboMul;
    return 'x' + comboMul.toFixed(1);
  }

  function drawCombo(drawCamY) {
    if (comboMul <= 1) return;
    const pop = comboPopMs > 0 ? comboPopMs / CONFIG.comboPopMs : 0;
    const scale = 1 + pop * CONFIG.comboPopScale;
    const sx = player.screenX;
    const sy = Math.round(player.y - drawCamY) - CONFIG.spriteH;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(20,16,10,0.55)';
    ctx.fillStyle = flowLeftMs > 0 ? '#ffd24a' : '#ffffff';
    const label = comboLabel();
    ctx.strokeText(label, 0, 0);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  function drawSpeedLines() {
    const k = speedK();
    if (k <= 0) return;
    const n = Math.max(1, Math.round(CONFIG.speedLineCount * k));
    const alpha = CONFIG.speedLineAlpha * k;
    ctx.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
    ctx.lineWidth = 1 + k;
    for (let i = 0; i < n; i++) {
      const y = ((i + 1) / (n + 1)) * cssH;
      const len = CONFIG.speedLineLen * (CONFIG.particleSpeedFloor + (1 - CONFIG.particleSpeedFloor) * k);
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(8 + len, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cssW - 8, y + 6);
      ctx.lineTo(cssW - 8 - len, y + 6);
      ctx.stroke();
    }
  }

  function drawOfflineBadge() {
    if (!isOffline) return;
    const x = muteBtn.x - 48;
    const y = muteBtn.y + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(x, y, 40, 28, 8);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 14, y + 16, 5, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(x + 22, y + 14, 7, Math.PI * 1.15, Math.PI * 0.15, true);
    ctx.arc(x + 30, y + 16, 5, Math.PI * 1.2, Math.PI * 0.2, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 22);
    ctx.lineTo(x + 32, y + 6);
    ctx.stroke();
  }

  function drawHud() {
    const padTop = safeTop + 16;
    const pad = 16;

    if (attractMode) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '800 28px system-ui, sans-serif';
      ctx.fillText(GAME_TITLE, cssW / 2, padTop + 28);
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Режим стенда', cssW / 2, padTop + 52);
      drawMuteButton();
      drawOfflineBadge();
      return;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(pad, padTop, 150, 54);
    ctx.fillRect(cssW - pad - 150 - 52, padTop, 150, 54);

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Стикеры', pad + 12, padTop + 22);
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(String(Math.round(scoreShown)), pad + 12, padTop + 46);

    const meterY = padTop + 54 + CONFIG.flowMeterGap;
    const meterW = 150;
    const meterH = CONFIG.flowMeterH;
    const meterT = meterShown;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(pad, meterY, meterW, meterH, 4);
    ctx.fill();
    if (meterT > 0) {
      ctx.fillStyle = flowLeftMs > 0 ? '#ffb347' : '#7ec8ff';
      roundRect(pad, meterY, meterW * meterT, meterH, 4);
      ctx.fill();
    }

    const sec = Math.max(0, Math.round(timeShown));
    ctx.textAlign = 'right';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('Время', cssW - pad - 64, padTop + 22);
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(String(sec), cssW - pad - 64, padTop + 46);

    drawMuteButton();
    drawOfflineBadge();

    if (state === 'play' && runElapsedMs < CONFIG.graceSec * 1000) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText('Тап — прыжок · Удерживай — сальто', cssW / 2, padTop + 78);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText('Собирай стикеры · Прыгай через конусы и бордюры', cssW / 2, padTop + 104);
    }
  }

  function drawMuteButton() {
    muteBtn.x = cssW - 16 - muteBtn.w;
    muteBtn.y = safeTop + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(muteBtn.x, muteBtn.y, muteBtn.w, muteBtn.h, 10);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    const cx = muteBtn.x + muteBtn.w / 2;
    const cy = muteBtn.y + muteBtn.h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 5);
    ctx.lineTo(cx - 2, cy - 5);
    ctx.lineTo(cx + 5, cy - 10);
    ctx.lineTo(cx + 5, cy + 10);
    ctx.lineTo(cx - 2, cy + 5);
    ctx.lineTo(cx - 8, cy + 5);
    ctx.closePath();
    ctx.stroke();
    if (muted) {
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy + 10);
      ctx.lineTo(cx + 10, cy - 10);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx + 6, cy, 6, -0.7, 0.7);
      ctx.stroke();
    }
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(20, 24, 32, 0.72)';
    ctx.fillRect(0, 0, cssW, cssH);

    beginOverlay();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.fillText('Пауза', cssW / 2, cssH * 0.38);

    ctx.fillStyle = '#ff4d6d';
    roundRect(continueBtn.x, continueBtn.y, continueBtn.w, continueBtn.h, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText('Продолжить', cssW / 2, continueBtn.y + 34);
    endOverlay();
  }

  function drawResult() {
    ctx.fillStyle = 'rgba(20, 24, 32, 0.72)';
    ctx.fillRect(0, 0, cssW, cssH);

    beginOverlay();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 36px system-ui, sans-serif';
    ctx.fillText(GAME_TITLE, cssW / 2, cssH * 0.22);

    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillStyle = '#cfd5dd';
    ctx.fillText('Счёт', cssW / 2, cssH * 0.3);
    ctx.font = '800 56px system-ui, sans-serif';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(String(Math.round(scoreShown)), cssW / 2, cssH * 0.4);

    ctx.fillStyle = '#ff4d6d';
    roundRect(replayBtn.x, replayBtn.y, replayBtn.w, replayBtn.h, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillText('Заново', cssW / 2, replayBtn.y + 32);

    ctx.fillStyle = '#3d7cff';
    roundRect(shareBtn.x, shareBtn.y, shareBtn.w, shareBtn.h, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Поделиться', cssW / 2, shareBtn.y + 32);

    ctx.fillStyle = '#2f9e44';
    roundRect(recordsBtn.x, recordsBtn.y, recordsBtn.w, recordsBtn.h, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Рекорды', cssW / 2, recordsBtn.y + 32);
    endOverlay();

    drawMuteButton();
  }

  function drawLeaderboard() {
    ctx.fillStyle = 'rgba(20, 24, 32, 0.88)';
    ctx.fillRect(0, 0, cssW, cssH);

    beginOverlay();
    const topY = safeTop + 36;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.fillText(GAME_TITLE, cssW / 2, topY);
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillStyle = '#cfd5dd';
    ctx.fillText('Топ-10 дня', cssW / 2, topY + 28);

    let y = topY + 64;
    if (leaderboard.loading) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillText('Загрузка…', cssW / 2, y + 40);
    } else if (leaderboard.error) {
      ctx.fillStyle = '#ff8a8a';
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText(leaderboard.error, cssW / 2, y + 40);
    } else if (!leaderboard.top.length) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText('Пока пусто — будь первым', cssW / 2, y + 40);
    } else {
      ctx.textAlign = 'left';
      ctx.font = '600 16px system-ui, sans-serif';
      for (let i = 0; i < leaderboard.top.length; i++) {
        const row = leaderboard.top[i];
        const rowY = y + i * 28;
        ctx.fillStyle = i < 3 ? '#ffd24a' : '#ffffff';
        ctx.fillText(row.place + '. ' + row.name, 28, rowY);
        ctx.textAlign = 'right';
        ctx.fillText(String(row.score), cssW - 28, rowY);
        ctx.textAlign = 'left';
      }
    }

    if (leaderboard.me && leaderboard.me.place != null) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9ad0ff';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText(
        'Ты: #' + leaderboard.me.place + ' · ' + leaderboard.me.score,
        cssW / 2,
        backLbBtn.y - 24
      );
    }

    ctx.fillStyle = '#ff4d6d';
    roundRect(backLbBtn.x, backLbBtn.y, backLbBtn.w, backLbBtn.h, 12);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillText('Назад', cssW / 2, backLbBtn.y + 32);
    endOverlay();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    const drawCamY = Math.round(camY);
    ctx.save();
    const ax = player.screenX;
    const ay = player.y - drawCamY;
    ctx.translate(ax, ay);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-ax, -ay);
    drawSky();
    drawParallax(drawCamY);
    drawTerrain(drawCamY);
    drawObstacles(drawCamY);
    drawStickers(drawCamY);
    drawParticles(drawCamY);
    drawPlayer(drawCamY);
    drawCombo(drawCamY);
    drawSpeedLines();
    ctx.restore();
    if (state === 'play' || state === 'pause') drawHud();
    if (state === 'pause') drawPause();
    if (state === 'result') drawResult();
    if (state === 'leaderboard') drawLeaderboard();
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(50, ts - lastTs);
    lastTs = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
