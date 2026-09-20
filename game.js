(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const PLAYER_SIZE = 40;
  const GROUND_Y_RATIO = 0.75;

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resize);
  resize();

  function draw() {
    const groundY = cssH * GROUND_Y_RATIO;
    const playerX = cssW * 0.25;
    const playerY = groundY - PLAYER_SIZE;

    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(cssW, groundY);
    ctx.stroke();

    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(playerX, playerY, PLAYER_SIZE, PLAYER_SIZE);
  }

  function loop() {
    draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
