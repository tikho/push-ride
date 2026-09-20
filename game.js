(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const safeProbe = document.getElementById('safe-probe');

  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if (tg.BackButton) {
      tg.BackButton.show();
      tg.BackButton.onClick(function () {
        pauseGame();
      });
    }
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
  (function initPerm() {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let seed = 1337;
    for (let i = 255; i > 0; i--) {
      seed = (seed * 16807 + 7) >>> 0;
      const j = seed % (i + 1);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
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
    }
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

  function setMuted(next) {
    muted = next;
    try {
      localStorage.setItem(CONFIG.muteStorageKey, muted ? '1' : '0');
    } catch (e) {}
    if (muted) stopRumble();
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

  function loadAsset(file, fallback) {
    const img = new Image();
    const slot = { img: img, fallback: fallback, ok: false };
    img.onload = function () {
      slot.ok = img.naturalWidth > 0;
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
  let replayBtn = { x: 0, y: 0, w: 180, h: 48 };
  let shareBtn = { x: 0, y: 0, w: 180, h: 48 };
  let continueBtn = { x: 0, y: 0, w: 180, h: 48 };
  let muteBtn = { x: 0, y: 0, w: 44, h: 44 };

  function pauseGame() {
    if (state !== 'play') return;
    state = 'pause';
    pointerHeld = false;
    holdMs = 0;
    stopRumble();
  }

  function resumeGame() {
    if (state !== 'pause') return;
    state = 'play';
    lastTs = 0;
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
    layoutButtons();
  }

  function layoutButtons() {
    const btnW = Math.min(220, cssW * 0.6);
    const bottomLimit = cssH - safeBottom - 24;

    replayBtn.w = btnW;
    replayBtn.h = 52;
    replayBtn.x = (cssW - replayBtn.w) / 2;

    shareBtn.w = btnW;
    shareBtn.h = 52;
    shareBtn.x = (cssW - shareBtn.w) / 2;
    shareBtn.y = bottomLimit - shareBtn.h;
    replayBtn.y = shareBtn.y - 14 - replayBtn.h;

    continueBtn.w = btnW;
    continueBtn.h = 52;
    continueBtn.x = (cssW - continueBtn.w) / 2;
    continueBtn.y = Math.min(cssH * 0.52, bottomLimit - continueBtn.h);

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
    return true;
  }

  function startFlip() {
    if (player.flipping) return;
    player.flipping = true;
    player.flipAgeMs = 0;
    player.boardSpin = 0;
    haptic('medium');
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

    if (state === 'pause') {
      if (hitRect(continueBtn, p.x, p.y)) resumeGame();
      return;
    }

    if (state === 'result') {
      if (hitRect(replayBtn, p.x, p.y)) resetRun();
      else if (hitRect(shareBtn, p.x, p.y)) shareScore();
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
    obstacles.push({ type: type, x: x, hit: false });
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
    if (!obstaclesArmed && runElapsedMs >= CONFIG.graceSec * 1000) {
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
  }

  function burstParticles(wx, wy, color, lifeMs) {
    const budget = CONFIG.maxParticles - particles.length;
    const n = Math.min(14, budget);
    const life = lifeMs || 400;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3.5;
      particles.push({
        x: wx,
        y: wy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.5,
        life: life,
        maxLife: life,
        color: color,
        r: 2 + Math.random() * 2,
      });
    }
  }

  function spawnLandDust(wx, wy) {
    const budget = CONFIG.maxParticles - particles.length;
    const n = Math.min(CONFIG.dustCount, budget);
    for (let i = 0; i < n; i++) {
      const life = CONFIG.particleFadeMs;
      particles.push({
        x: wx + (Math.random() * 2 - 1) * 16,
        y: wy - 2,
        vx: -1.2 - Math.random() * 2.4,
        vy: -0.4 - Math.random() * 1.6,
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
      if (!circlesHit(px, pcy, o.x, oy)) continue;
      o.hit = true;
      if (o.type === 'crack') {
        applyStumble(CONFIG.crackSpeedFactor, CONFIG.crackMs, false);
      } else {
        applyStumble(CONFIG.stumbleSpeedFactor, CONFIG.stumbleMs, true);
      }
    }

    for (let i = 0; i < stickers.length; i++) {
      const s = stickers[i];
      if (s.taken) continue;
      const sy = terrain(s.x) - s.lift;
      if (!circlesHit(px, pcy, s.x, sy)) continue;
      s.taken = true;
      score += CONFIG.stickerPoints;
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

  function update(dt) {
    if (state === 'pause') {
      stopRumble();
      return;
    }
    if (state !== 'play') {
      stopRumble();
      return;
    }

    runElapsedMs += dt;
    timeLeftMs -= dt;
    if (timeLeftMs <= 0) {
      timeLeftMs = 0;
      state = 'result';
      stopRumble();
      return;
    }

    if (pointerHeld) {
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

    const progress = Math.min(1, runElapsedMs / (CONFIG.timerSec * 1000));
    currentSpeed =
      (CONFIG.speedBase + (CONFIG.speedMax - CONFIG.speedBase) * progress) * speedMul;
    worldX += currentSpeed;
    const px = worldX + player.screenX;
    const groundY = terrain(px);

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
        player.y = groundY;
        player.vy = 0;
        player.onGround = true;
        player.inAir = false;
        player.flipping = false;
        player.boardSpin = 0;
        spawnLandDust(px, groundY);
        haptic('medium');
        playSound('land');
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

  function drawSky() {
    const phase = dayPhase();
    const noon = 1 - Math.abs(phase - 0.5) * 2;
    const top = lerpColor('#0b1a33', '#6ec6ff', noon);
    const bot = lerpColor('#1a2a44', '#c9e9ff', noon);
    const g = ctx.createLinearGradient(0, 0, 0, cssH);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);

    if (noon < 0.35) {
      ctx.fillStyle = 'rgba(255,255,220,' + (0.35 - noon) + ')';
      const moonX = cssW * (0.2 + phase * 0.6);
      ctx.beginPath();
      ctx.arc(moonX, cssH * 0.18, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function lerpColor(a, b, t) {
    const ar = parseInt(a.slice(1, 3), 16);
    const ag = parseInt(a.slice(3, 5), 16);
    const ab = parseInt(a.slice(5, 7), 16);
    const br = parseInt(b.slice(1, 3), 16);
    const bg = parseInt(b.slice(3, 5), 16);
    const bb = parseInt(b.slice(5, 7), 16);
    const r = (ar + (br - ar) * t) | 0;
    const g = (ag + (bg - ag) * t) | 0;
    const bl = (ab + (bb - ab) * t) | 0;
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function drawParallax(drawCamY) {
    const phase = dayPhase();
    const noon = 1 - Math.abs(phase - 0.5) * 2;
    drawMountainLayer(CONFIG.parallaxFar, drawCamY, 0.55, lerpColor('#2a3a55', '#7a9bb8', noon), 90);
    drawForestLayer(CONFIG.parallaxMid, drawCamY, lerpColor('#1e3d28', '#3d7a4a', noon), 70);
    drawMountainLayer(CONFIG.parallaxNear, drawCamY, 0.7, lerpColor('#243248', '#5f7f6a', noon), 110);
    drawGuardrail(CONFIG.parallaxFar * 0.85, drawCamY);
  }

  function drawMountainLayer(factor, drawCamY, baseRatio, color, amp) {
    const offset = Math.round(worldX * factor);
    const base = Math.round(cssH * baseRatio - (drawCamY - CONFIG.terrainBase) * factor * 0.15);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, cssH);
    for (let sx = 0; sx <= cssW + 40; sx += 40) {
      const wx = sx + offset;
      const y =
        base -
        Math.abs(Math.sin(wx * 0.004)) * amp -
        Math.abs(Math.sin(wx * 0.01)) * (amp * 0.35);
      ctx.lineTo(sx, Math.round(y));
    }
    ctx.lineTo(cssW, cssH);
    ctx.closePath();
    ctx.fill();
  }

  function drawForestLayer(factor, drawCamY, color, amp) {
    const offset = Math.round(worldX * factor);
    const base = Math.round(cssH * 0.62 - (drawCamY - CONFIG.terrainBase) * factor * 0.12);
    ctx.fillStyle = color;
    for (let sx = -20; sx <= cssW + 40; sx += 28) {
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
    ctx.strokeStyle = 'rgba(180,190,200,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, base);
    ctx.lineTo(cssW, base);
    ctx.stroke();
    for (let sx = -((offset % 36) + 36) % 36; sx <= cssW; sx += 36) {
      ctx.fillStyle = 'rgba(160,170,180,0.65)';
      ctx.fillRect(sx, base - 10, 3, 14);
    }
  }

  function drawTerrain(drawCamY) {
    const step = CONFIG.terrainStep;
    const half = CONFIG.roadWidth / 2;

    ctx.beginPath();
    ctx.moveTo(0, cssH + 2);
    for (let sx = 0; sx <= cssW + step; sx += step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY) + half + 18;
      ctx.lineTo(sx, gy);
    }
    ctx.lineTo(cssW + step, cssH + 2);
    ctx.closePath();
    ctx.fillStyle = '#3d8f4a';
    ctx.fill();

    ctx.beginPath();
    for (let sx = 0; sx <= cssW + step; sx += step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY);
      const y = gy - half;
      if (sx === 0) ctx.moveTo(sx, y);
      else ctx.lineTo(sx, y);
    }
    for (let sx = cssW + step; sx >= 0; sx -= step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY);
      ctx.lineTo(sx, gy + half);
    }
    ctx.closePath();
    ctx.fillStyle = '#3a3f46';
    ctx.fill();

    ctx.strokeStyle = '#f5f7fa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = 0; sx <= cssW + step; sx += step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY) - half;
      if (sx === 0) ctx.moveTo(sx, gy);
      else ctx.lineTo(sx, gy);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let sx = 0; sx <= cssW + step; sx += step) {
      const gy = Math.round(terrain(worldX + sx) - drawCamY) + half;
      if (sx === 0) ctx.moveTo(sx, gy);
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
      if (s.x < -40 || s.x > cssW + 40) continue;
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
      if (s.x < -30 || s.x > cssW + 30) continue;
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
      ctx.arc(s.x, s.y, p.r || 3, 0, Math.PI * 2);
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

    ctx.restore();
  }

  function drawSpeedLines() {
    if (currentSpeed <= CONFIG.speedLineThreshold) return;
    const strength = Math.min(1, (currentSpeed - CONFIG.speedLineThreshold) / 2);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.12 + strength * 0.2) + ')';
    ctx.lineWidth = 1;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const y = ((i + 1) / (n + 1)) * cssH;
      const len = 18 + (i % 3) * 10;
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

  function drawHud() {
    const padTop = safeTop + 16;
    const pad = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(pad, padTop, 150, 54);
    ctx.fillRect(cssW - pad - 150 - 52, padTop, 150, 54);

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Стикеры', pad + 12, padTop + 22);
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(String(score), pad + 12, padTop + 46);

    const sec = Math.ceil(timeLeftMs / 1000);
    ctx.textAlign = 'right';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('Время', cssW - pad - 64, padTop + 22);
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(String(sec), cssW - pad - 64, padTop + 46);

    drawMuteButton();

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
  }

  function drawResult() {
    ctx.fillStyle = 'rgba(20, 24, 32, 0.72)';
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 36px system-ui, sans-serif';
    ctx.fillText(GAME_TITLE, cssW / 2, cssH * 0.28);

    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillStyle = '#cfd5dd';
    ctx.fillText('Счёт', cssW / 2, cssH * 0.38);
    ctx.font = '800 56px system-ui, sans-serif';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(String(score), cssW / 2, cssH * 0.48);

    ctx.fillStyle = '#ff4d6d';
    roundRect(replayBtn.x, replayBtn.y, replayBtn.w, replayBtn.h, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText('Заново', cssW / 2, replayBtn.y + 34);

    ctx.fillStyle = '#3d7cff';
    roundRect(shareBtn.x, shareBtn.y, shareBtn.w, shareBtn.h, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText('Поделиться', cssW / 2, shareBtn.y + 34);

    drawMuteButton();
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
    drawSky();
    drawParallax(drawCamY);
    drawTerrain(drawCamY);
    drawObstacles(drawCamY);
    drawStickers(drawCamY);
    drawParticles(drawCamY);
    drawPlayer(drawCamY);
    drawSpeedLines();
    if (state === 'play' || state === 'pause') drawHud();
    if (state === 'pause') drawPause();
    if (state === 'result') drawResult();
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
