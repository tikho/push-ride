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
  }

  window.addEventListener('resize', resize);
  resize();

  function jump() {
    if (!player.onGround) return;
    player.vy = -CONFIG.jumpPower;
    player.onGround = false;
    player.inAir = true;
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    jump();
  });

  function update() {
    worldX += CONFIG.speedBase;
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
  }

  function drawTerrain() {
    const step = CONFIG.terrainStep;
    ctx.beginPath();
    ctx.moveTo(0, cssH + 2);
    for (let sx = 0; sx <= cssW + step; sx += step) {
      const gy = terrain(worldX + sx) - camY;
      if (sx === 0) ctx.lineTo(sx, gy);
      else ctx.lineTo(sx, gy);
    }
    ctx.lineTo(cssW + step, cssH + 2);
    ctx.closePath();
    ctx.fillStyle = '#f0f6fa';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = 0; sx <= cssW + step; sx += step) {
      const gy = terrain(worldX + sx) - camY;
      if (sx === 0) ctx.moveTo(sx, gy);
      else ctx.lineTo(sx, gy);
    }
    ctx.stroke();
  }

  function drawPlayer() {
    const size = CONFIG.playerSize;
    const screenY = player.y - camY;
    ctx.save();
    ctx.translate(player.screenX, screenY);
    ctx.rotate(player.angle);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(-size / 2, -size, size, size);
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, cssW, cssH);
    drawTerrain();
    drawPlayer();
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
