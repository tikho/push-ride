(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;

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

  function playSound(_name) {}

  const OBSTACLE_TYPES = ['cone', 'crack', 'curb'];

  const player = {
    screenX: 0,
    y: 0,
    vy: 0,
    onGround: true,
    inAir: false,
    angle: 0,
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
  let replayBtn = { x: 0, y: 0, w: 180, h: 48 };

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
    player.vy = 0;
    player.onGround = true;
    player.inAir = false;
    player.angle = 0;
    player.screenX = cssW * CONFIG.playerScreenRatio;
    player.y = terrain(worldX + player.screenX);
    camY = player.y - cssH * 0.65;
    state = 'play';
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
    player.screenX = cssW * CONFIG.playerScreenRatio;
    if (player.onGround) {
      player.y = terrain(worldX + player.screenX);
    }
    camY = player.y - cssH * 0.65;
    replayBtn.w = Math.min(220, cssW * 0.6);
    replayBtn.h = 52;
    replayBtn.x = (cssW - replayBtn.w) / 2;
    replayBtn.y = cssH * 0.58;
  }

  window.addEventListener('resize', resize);
  resize();
  resetRun();

  function jump() {
    if (!player.onGround) return;
    player.vy = -CONFIG.jumpPower;
    player.onGround = false;
    player.inAir = true;
  }

  function hitReplay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * cssW;
    const y = ((clientY - rect.top) / rect.height) * cssH;
    return (
      x >= replayBtn.x &&
      x <= replayBtn.x + replayBtn.w &&
      y >= replayBtn.y &&
      y <= replayBtn.y + replayBtn.h
    );
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state === 'result') {
      if (hitReplay(e.clientX, e.clientY)) resetRun();
      return;
    }
    jump();
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

  function burstParticles(wx, wy, color) {
    const budget = CONFIG.maxParticles - particles.length;
    const n = Math.min(14, budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3.5;
      particles.push({
        x: wx,
        y: wy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.5,
        life: 350 + Math.random() * 250,
        color: color,
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
      burstParticles(s.x, sy, '#ffd24a');
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
    if (state !== 'play') return;

    runElapsedMs += dt;
    timeLeftMs -= dt;
    if (timeLeftMs <= 0) {
      timeLeftMs = 0;
      state = 'result';
      return;
    }

    if (slowUntilMs > 0) {
      slowUntilMs -= dt;
      if (slowUntilMs <= 0) {
        slowUntilMs = 0;
        speedMul = 1;
      }
    }
    if (shakeLeftMs > 0) shakeLeftMs -= dt;

    worldX += CONFIG.speedBase * speedMul;
    const px = worldX + player.screenX;
    const groundY = terrain(px);

    if (player.inAir) {
      player.vy += CONFIG.gravity;
      player.y += player.vy;
      if (player.vy > 0 && player.y >= groundY) {
        player.y = groundY;
        player.vy = 0;
        player.onGround = true;
        player.inAir = false;
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
  }

  function worldToScreen(x, y) {
    return { x: x - worldX, y: y - camY };
  }

  function drawTerrain() {
    const step = CONFIG.terrainStep;
    ctx.beginPath();
    ctx.moveTo(0, cssH + 2);
    for (let sx = 0; sx <= cssW + step; sx += step) {
      const gy = terrain(worldX + sx) - camY;
      ctx.lineTo(sx, gy);
    }
    ctx.lineTo(cssW + step, cssH + 2);
    ctx.closePath();
    ctx.fillStyle = '#5a5f66';
    ctx.fill();

    ctx.strokeStyle = '#f2c94c';
    ctx.setLineDash([18, 16]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let sx = 0; sx <= cssW + step; sx += step) {
      const gy = terrain(worldX + sx) - camY + 10;
      if (sx === 0) ctx.moveTo(sx, gy);
      else ctx.lineTo(sx, gy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#3d4148';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = 0; sx <= cssW + step; sx += step) {
      const gy = terrain(worldX + sx) - camY;
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

  function drawObstacles() {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.hit) continue;
      const gy = terrain(o.x);
      const s = worldToScreen(o.x, gy);
      if (s.x < -40 || s.x > cssW + 40) continue;
      if (o.type === 'cone') drawCone(s.x, s.y);
      else if (o.type === 'crack') drawCrack(s.x, s.y);
      else drawCurb(s.x, s.y);
    }
  }

  function drawStickers() {
    for (let i = 0; i < stickers.length; i++) {
      const st = stickers[i];
      if (st.taken) continue;
      const wy = terrain(st.x) - st.lift;
      const s = worldToScreen(st.x, wy);
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

  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const s = worldToScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life / 500);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayer() {
    const size = CONFIG.playerSize;
    const screenY = player.y - camY;
    let shakeX = 0;
    let shakeY = 0;
    if (shakeLeftMs > 0) {
      const t = shakeLeftMs / CONFIG.shakeMs;
      shakeX = (Math.random() * 2 - 1) * CONFIG.shakeAmp * t;
      shakeY = (Math.random() * 2 - 1) * CONFIG.shakeAmp * t;
    }
    ctx.save();
    ctx.translate(player.screenX + shakeX, screenY + shakeY);
    ctx.rotate(player.angle);

    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(-size * 0.7, -6, size * 1.4, 8);
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(-size * 0.45, 2, 4, 0, Math.PI * 2);
    ctx.arc(size * 0.45, 2, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(-size / 2, -size, size, size);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-8, -size + 14, 4, 0, Math.PI * 2);
    ctx.arc(8, -size + 14, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHud() {
    const pad = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(pad, pad, 150, 54);
    ctx.fillRect(cssW - pad - 150, pad, 150, 54);

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Стикеры', pad + 12, pad + 22);
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(String(score), pad + 12, pad + 46);

    const sec = Math.ceil(timeLeftMs / 1000);
    ctx.textAlign = 'right';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('Время', cssW - pad - 12, pad + 22);
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(String(sec), cssW - pad - 12, pad + 46);

    if (runElapsedMs < CONFIG.graceSec * 1000) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText('Тап — прыжок', cssW / 2, cssH * 0.18);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText('Собирай стикеры · Прыгай через конусы и бордюры', cssW / 2, cssH * 0.18 + 26);
    }
  }

  function drawResult() {
    ctx.fillStyle = 'rgba(20, 24, 32, 0.72)';
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 36px system-ui, sans-serif';
    ctx.fillText(GAME_TITLE, cssW / 2, cssH * 0.32);

    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillStyle = '#cfd5dd';
    ctx.fillText('Счёт', cssW / 2, cssH * 0.42);
    ctx.font = '800 56px system-ui, sans-serif';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(String(score), cssW / 2, cssH * 0.52);

    ctx.fillStyle = '#ff4d6d';
    roundRect(replayBtn.x, replayBtn.y, replayBtn.w, replayBtn.h, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText('Заново', cssW / 2, replayBtn.y + 34);
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
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, cssW, cssH);
    drawTerrain();
    drawObstacles();
    drawStickers();
    drawParticles();
    drawPlayer();
    drawHud();
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
