// Poop Rocket — arrow keys to fly, space to fire, three lives.
// Plain canvas, no dependencies. Touch/mouse: drag to steer, fires automatically.
(() => {
  "use strict";

  const W = 480, H = 720;
  const BEST_KEY = "aag.poop-rocket.best";
  const MUTE_KEY = "aag.poop-rocket.muted";
  const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // --- storage (private mode may throw; the game just forgets) ----------------------
  const store = {
    get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch {} },
  };

  // --- sizing: fit the window, render crisp -----------------------------------------
  function resize() {
    const scale = Math.min(innerWidth / W, innerHeight / H);
    canvas.style.width = `${Math.floor(W * scale)}px`;
    canvas.style.height = `${Math.floor(H * scale)}px`;
    const ratio = clamp(scale * (devicePixelRatio || 1), 1, 3);
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  addEventListener("resize", resize);
  resize();

  // --- sprites: each emoji is rasterised once, then drawn as an image -----------------
  const spriteCache = new Map();
  function sprite(emoji, size) {
    const key = `${emoji}@${size}`;
    let image = spriteCache.get(key);
    if (!image) {
      const pad = Math.ceil(size * 1.5);
      image = document.createElement("canvas");
      image.width = image.height = pad * 2;
      const c = image.getContext("2d");
      c.font = `${size * 2}px ${EMOJI_FONT}`; // 2x for sharpness when rotated/scaled
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(emoji, pad, pad + size * 0.08);
      spriteCache.set(key, image);
    }
    return image;
  }
  function drawSprite(emoji, size, x, y, rotation = 0, alpha = 1) {
    const image = sprite(emoji, size);
    const half = image.width / 4; // drawn at half its raster size
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    ctx.drawImage(image, -half, -half, half * 2, half * 2);
    ctx.restore();
  }

  // --- sound: tiny synthesised effects, created on the first key press/tap --------------
  let audio = null;
  let muted = store.get(MUTE_KEY) === "1";
  function ensureAudio() {
    // iOS Safari hands back a suspended context even inside a tap; it has to be resumed.
    if (audio && audio.state === "suspended") audio.resume().catch(() => {});
    if (audio || muted) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    audio = new Ctor();
    if (audio.state === "suspended") audio.resume().catch(() => {});
    const length = audio.sampleRate * 0.5;
    audio.noise = audio.createBuffer(1, length, audio.sampleRate);
    const data = audio.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  function noiseBurst(duration, fromHz, toHz, volume) {
    if (!audio || muted) return;
    const now = audio.currentTime;
    const source = audio.createBufferSource();
    source.buffer = audio.noise;
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(fromHz, now);
    filter.frequency.exponentialRampToValueAtTime(toHz, now + duration);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start(now);
    source.stop(now + duration);
  }
  function tone(type, fromHz, toHz, duration, volume, delay = 0) {
    if (!audio || muted) return;
    const now = audio.currentTime + delay;
    const osc = audio.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, now);
    osc.frequency.exponentialRampToValueAtTime(toHz, now + duration);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
  const sfx = {
    shoot: () => noiseBurst(0.09, 900, 120, 0.16), // pfft
    splat: () => tone("sine", 160, 60, 0.08, 0.2),
    boom: () => { noiseBurst(0.32, 1400, 60, 0.32); tone("sine", 120, 35, 0.3, 0.3); },
    hurt: () => { tone("sawtooth", 420, 50, 0.55, 0.22); noiseBurst(0.5, 2000, 80, 0.3); },
    power: () => [330, 440, 660].forEach((hz, i) => tone("square", hz, hz * 1.02, 0.1, 0.1, i * 0.07)),
    over: () => [392, 330, 262, 196].forEach((hz, i) => tone("triangle", hz, hz * 0.97, 0.24, 0.18, i * 0.2)),
  };

  // --- enemy catalogue -------------------------------------------------------------
  const ENEMIES = {
    // Meteors are drawn, not emoji: the moon/rock emoji look completely different on each OS.
    meteorBig: { emoji: null, size: 54, radius: 24, hp: 3, points: 25 },
    meteorSmall: { emoji: null, size: 30, radius: 13, hp: 1, points: 10 },
    saucer: { emoji: "🛸", size: 46, radius: 20, hp: 2, points: 50 },
    invader: { emoji: "👾", size: 38, radius: 16, hp: 1, points: 30 },
  };
  const POWERUPS = {
    triple: { emoji: "🧻", label: "TRIPLE PLY" },
    rapid: { emoji: "🌮", label: "TACO NIGHT" },
  };
  const POWER_SECONDS = 8;
  const QUIPS = [
    "The galaxy is safe. It is also filthy.",
    "Mission control has stopped returning your calls.",
    "Historians will not mention this.",
    "Somewhere, an alien is filing a complaint.",
    "You fought bravely. And disgustingly.",
  ];

  // --- state -----------------------------------------------------------------------
  const keys = new Set();
  const pointer = { active: false, x: 0, y: 0 };
  const stars = Array.from({ length: 70 }, () => ({
    x: rand(0, W), y: rand(0, H), depth: rand(0.2, 1),
  }));
  let best = Number(store.get(BEST_KEY)) || 0;
  let mode = "title"; // title | playing | paused | over
  let game = null;

  function newGame() {
    return {
      player: { x: W / 2, y: H - 90, radius: 15, cooldown: 0, invulnerable: 1.2, tilt: 0 },
      lives: 3, score: 0, elapsed: 0, spawnIn: 0.8, shake: 0, overFor: 0, newBest: false,
      power: null, powerLeft: 0, quip: "",
      bullets: [], enemies: [], shots: [], particles: [], drops: [], floaters: [],
    };
  }

  function setMode(next) {
    mode = next;
    document.body.classList.toggle("playing", next === "playing");
    document.getElementById("pause").textContent = next === "paused" ? "▶" : "⏸";
  }
  function start() {
    ensureAudio();
    game = newGame();
    setMode("playing");
  }
  function togglePause() {
    if (mode === "playing") setMode("paused");
    else if (mode === "paused") setMode("playing");
  }
  function toggleMute() {
    muted = !muted;
    store.set(MUTE_KEY, muted ? "1" : "0");
    document.getElementById("mute").textContent = muted ? "🔇" : "🔊";
    if (!muted) ensureAudio();
  }
  document.getElementById("mute").textContent = muted ? "🔇" : "🔊";

  // --- spawning --------------------------------------------------------------------
  function spawnEnemy(kind, x = rand(40, W - 40), y = -40) {
    const def = ENEMIES[kind];
    const enemy = { kind, ...def, x, y, vx: 0, vy: 0, rotation: rand(0, 6.28), spin: 0, age: 0, fireIn: 0, flash: 0 };
    const speedUp = 1 + Math.min(game.elapsed, 150) / 150; // up to 2x over 2.5 minutes
    if (!def.emoji) {
      // A lumpy outline and a few craters, fixed per rock so it tumbles instead of boiling.
      enemy.outline = Array.from({ length: 10 }, () => rand(0.78, 1.12));
      enemy.craters = Array.from({ length: kind === "meteorBig" ? 4 : 2 }, () => ({
        angle: rand(0, 6.28), distance: rand(0.15, 0.55), size: rand(0.12, 0.24),
      }));
    }
    if (kind === "meteorBig") { enemy.vy = rand(60, 95) * speedUp; enemy.vx = rand(-25, 25); enemy.spin = rand(-1, 1); }
    if (kind === "meteorSmall") { enemy.vy = rand(105, 165) * speedUp; enemy.vx = rand(-60, 60); enemy.spin = rand(-3, 3); }
    if (kind === "saucer") { enemy.vy = 50 * speedUp; enemy.baseX = clamp(x, 110, W - 110); enemy.sway = rand(60, 95); enemy.fireIn = rand(0.9, 1.8); enemy.rotation = 0; }
    if (kind === "invader") { enemy.vy = 175 * speedUp; enemy.rotation = 0; }
    game.enemies.push(enemy);
    return enemy;
  }
  function spawnWave() {
    const t = game.elapsed;
    const options = ["meteorSmall", "meteorSmall", "meteorBig"];
    if (t > 6) options.push("saucer");
    if (t > 18) options.push("invader", "invader");
    if (t > 45) options.push("saucer", "meteorBig");
    spawnEnemy(pick(options));
    if (t > 30 && Math.random() < 0.3) spawnEnemy("meteorSmall");
  }

  // --- effects ---------------------------------------------------------------------
  function burst(x, y, colors, count, speed) {
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const velocity = rand(speed * 0.3, speed);
      game.particles.push({
        x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
        life: rand(0.35, 0.8), age: 0, size: rand(2, 5), color: pick(colors),
      });
    }
  }
  const floater = (x, y, text, color = "#ffd23f") => game.floaters.push({ x, y, text, color, age: 0 });

  // --- combat ----------------------------------------------------------------------
  function fire() {
    const p = game.player;
    const rapid = game.power === "rapid";
    p.cooldown = rapid ? 0.085 : 0.19;
    const angles = game.power === "triple" ? [-0.22, 0, 0.22] : [0];
    for (const angle of angles) {
      game.bullets.push({
        x: p.x, y: p.y - 22, vx: Math.sin(angle) * 560, vy: -Math.cos(angle) * 560,
        rotation: rand(0, 6.28), spin: rand(-9, 9), radius: 9,
      });
    }
    sfx.shoot();
  }

  function destroy(enemy) {
    game.score += enemy.points;
    floater(enemy.x, enemy.y, `+${enemy.points}`);
    const rocky = enemy.kind.startsWith("meteor");
    burst(enemy.x, enemy.y, rocky ? ["#8d8d99", "#5d5d6b", "#c9c9d6"] : ["#7CFC9A", "#3ee6d3", "#ffffff"], rocky ? 12 : 18, 210);
    sfx.boom();
    if (enemy.kind === "meteorBig") {
      for (const dir of [-1, 1]) {
        const chunk = spawnEnemy("meteorSmall", enemy.x + dir * 12, enemy.y);
        chunk.vx = dir * rand(50, 100);
      }
    }
    const dropChance = enemy.kind === "saucer" ? 0.2 : enemy.kind === "invader" ? 0.1 : enemy.kind === "meteorBig" ? 0.06 : 0;
    if (Math.random() < dropChance && game.drops.length === 0) {
      game.drops.push({ kind: pick(Object.keys(POWERUPS)), x: enemy.x, y: enemy.y, age: 0 });
    }
  }

  function hurtPlayer() {
    const p = game.player;
    if (p.invulnerable > 0) return;
    game.lives -= 1;
    game.shake = REDUCED_MOTION ? 0 : 0.45;
    game.power = null;
    burst(p.x, p.y, ["#ff4fa3", "#ffd23f", "#ffffff", "#ff8a3d"], 28, 280);
    sfx.hurt();
    if (game.lives <= 0) {
      game.newBest = game.score > best;
      if (game.newBest) { best = game.score; store.set(BEST_KEY, String(best)); }
      game.quip = pick(QUIPS);
      game.overFor = 0;
      setMode("over");
      sfx.over();
      return;
    }
    p.invulnerable = 2.2;
    p.x = W / 2;
    p.y = H - 90;
    game.shots.length = 0; // a fair restart: no shot already on top of the respawn point
  }

  const hit = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (a.radius + b.radius) ** 2;

  // --- update ----------------------------------------------------------------------
  function update(dt) {
    for (const star of stars) {
      star.y += (20 + star.depth * 90) * dt;
      if (star.y > H) { star.y = -2; star.x = rand(0, W); }
    }
    if (mode === "over") game.overFor += dt;
    if (mode !== "playing" && mode !== "over") return;

    // Particles and floating text keep animating on the game-over screen.
    for (const particle of game.particles) {
      particle.age += dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += 160 * dt;
    }
    game.particles = game.particles.filter((particle) => particle.age < particle.life);
    for (const text of game.floaters) { text.age += dt; text.y -= 38 * dt; }
    game.floaters = game.floaters.filter((text) => text.age < 0.9);
    game.shake = Math.max(0, game.shake - dt);
    if (mode !== "playing") return;

    game.elapsed += dt;
    const p = game.player;

    // Steering: keyboard, or follow the finger/mouse (offset so the ship stays visible).
    let dx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
    let dy = (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0);
    const speed = 330;
    if (pointer.active && !dx && !dy) {
      const tx = pointer.x - p.x, ty = pointer.y - 64 - p.y;
      const distance = Math.hypot(tx, ty);
      if (distance > 3) {
        const step = Math.min(distance, speed * 1.5 * dt);
        p.x += (tx / distance) * step; p.y += (ty / distance) * step;
        dx = clamp(tx / 40, -1, 1);
      }
    } else if (dx || dy) {
      const length = Math.hypot(dx, dy);
      p.x += (dx / length) * speed * dt; p.y += (dy / length) * speed * dt;
    }
    p.x = clamp(p.x, 22, W - 22);
    p.y = clamp(p.y, 70, H - 30);
    p.tilt += (dx * 0.28 - p.tilt) * Math.min(1, dt * 12);
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    p.cooldown -= dt;
    if ((keys.has("Space") || pointer.active) && p.cooldown <= 0) fire();

    if (game.power) {
      game.powerLeft -= dt;
      if (game.powerLeft <= 0) game.power = null;
    }

    game.spawnIn -= dt;
    if (game.spawnIn <= 0) {
      spawnWave();
      game.spawnIn = Math.max(0.32, 1.05 - game.elapsed * 0.011) * rand(0.7, 1.3);
    }

    for (const bullet of game.bullets) {
      bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.rotation += bullet.spin * dt;
    }
    game.bullets = game.bullets.filter((bullet) => bullet.y > -30 && bullet.x > -30 && bullet.x < W + 30 && !bullet.dead);

    for (const enemy of game.enemies) {
      enemy.age += dt;
      enemy.flash = Math.max(0, enemy.flash - dt);
      if (enemy.kind === "saucer") {
        enemy.y += enemy.vy * dt;
        enemy.x = enemy.baseX + Math.sin(enemy.age * 1.7) * enemy.sway;
        enemy.fireIn -= dt;
        if (enemy.fireIn <= 0 && enemy.y > 20 && enemy.y < H * 0.62) {
          enemy.fireIn = rand(1.5, 2.6);
          const aim = clamp((p.x - enemy.x) * 0.6, -110, 110);
          game.shots.push({ x: enemy.x, y: enemy.y + 16, vx: aim, vy: 235, radius: 6 });
        }
      } else if (enemy.kind === "invader") {
        enemy.y += enemy.vy * dt;
        enemy.x += clamp(p.x - enemy.x, -1, 1) * 95 * dt; // dives at you
        enemy.rotation = Math.sin(enemy.age * 9) * 0.18;
      } else {
        enemy.x += enemy.vx * dt; enemy.y += enemy.vy * dt; enemy.rotation += enemy.spin * dt;
        if (enemy.x < enemy.radius || enemy.x > W - enemy.radius) enemy.vx *= -1;
      }

      for (const bullet of game.bullets) {
        if (bullet.dead || !hit(bullet, enemy)) continue;
        bullet.dead = true;
        enemy.hp -= 1;
        enemy.flash = 0.08;
        burst(bullet.x, bullet.y, ["#7a4a1e", "#5a3512", "#9c6a35"], 5, 120);
        if (enemy.hp <= 0) { enemy.dead = true; destroy(enemy); break; }
        sfx.splat();
      }
      if (!enemy.dead && hit(enemy, p) && p.invulnerable <= 0) {
        enemy.dead = true;
        burst(enemy.x, enemy.y, ["#ffffff", "#8d8d99"], 10, 180);
        hurtPlayer();
        if (mode !== "playing") return;
      }
    }
    game.enemies = game.enemies.filter((enemy) => !enemy.dead && enemy.y < H + 70);

    for (const shot of game.shots) {
      shot.x += shot.vx * dt; shot.y += shot.vy * dt;
      if (hit(shot, p) && p.invulnerable <= 0) {
        shot.dead = true;
        hurtPlayer();
        if (mode !== "playing") return;
      }
    }
    game.shots = game.shots.filter((shot) => !shot.dead && shot.y < H + 20);

    for (const drop of game.drops) {
      drop.age += dt; drop.y += 85 * dt;
      if (hit({ x: drop.x, y: drop.y, radius: 18 }, p)) {
        drop.dead = true;
        game.power = drop.kind; game.powerLeft = POWER_SECONDS;
        floater(p.x, p.y - 30, POWERUPS[drop.kind].label, "#3ee6d3");
        sfx.power();
      }
    }
    game.drops = game.drops.filter((drop) => !drop.dead && drop.y < H + 30);
  }

  // --- draw ------------------------------------------------------------------------
  function text(value, x, y, size, color = "#fff", align = "center", weight = 800) {
    ctx.font = `${weight} ${size}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,.65)";
    ctx.fillText(value, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  function drawMeteor(enemy) {
    const r = enemy.radius * 1.12;
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(enemy.rotation);
    ctx.beginPath();
    enemy.outline.forEach((scale, i) => {
      const angle = (i / enemy.outline.length) * Math.PI * 2;
      const x = Math.cos(angle) * r * scale, y = Math.sin(angle) * r * scale;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    const shade = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r * 1.15);
    shade.addColorStop(0, "#b9aea4"); shade.addColorStop(0.6, "#7d726a"); shade.addColorStop(1, "#453d38");
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#2a2421"; ctx.stroke();
    for (const crater of enemy.craters) {
      const x = Math.cos(crater.angle) * r * crater.distance, y = Math.sin(crater.angle) * r * crater.distance;
      ctx.beginPath(); ctx.arc(x, y, r * crater.size, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(40,33,30,.55)"; ctx.fill();
      ctx.beginPath(); ctx.arc(x + 1, y + 1, r * crater.size, 0.2, Math.PI * 0.9);
      ctx.strokeStyle = "rgba(215,205,195,.45)"; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer(p, time) {
    if (p.invulnerable > 0 && Math.floor(time * 14) % 2 === 0) return; // blink
    const flame = 10 + Math.sin(time * 40) * 4;
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 24, 5, flame, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff8a3d";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 22, 3, flame * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    drawSprite("🚀", 40, p.x, p.y, -Math.PI / 4 + p.tilt); // the emoji points up-right; aim it up
  }

  function drawHud() {
    text(String(game.score).padStart(5, "0"), 14, 24, 24, "#ffd23f", "left");
    text(`BEST ${Math.max(best, game.score)}`, 14, 48, 12, "#b3a7d6", "left", 700);
    for (let i = 0; i < 3; i++) drawSprite("🚀", 20, W / 2 - 24 + i * 24, 26, -Math.PI / 4, i < game.lives ? 1 : 0.18);
    if (game.power) {
      const width = 120, left = W / 2 - width / 2;
      ctx.fillStyle = "rgba(255,255,255,.15)"; ctx.fillRect(left, 50, width, 6);
      ctx.fillStyle = "#3ee6d3"; ctx.fillRect(left, 50, width * (game.powerLeft / POWER_SECONDS), 6);
      text(`${POWERUPS[game.power].emoji} ${POWERUPS[game.power].label}`, W / 2, 68, 11, "#3ee6d3", "center", 700);
    }
  }

  function draw(time) {
    ctx.save();
    if (game && game.shake > 0) ctx.translate(rand(-1, 1) * game.shake * 16, rand(-1, 1) * game.shake * 16);

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#0a0620"); sky.addColorStop(1, "#1a0f3a");
    ctx.fillStyle = sky; ctx.fillRect(-20, -20, W + 40, H + 40);
    for (const star of stars) {
      ctx.globalAlpha = 0.3 + star.depth * 0.7;
      ctx.fillStyle = "#fff";
      ctx.fillRect(star.x, star.y, star.depth * 2.2, star.depth * 2.2);
    }
    ctx.globalAlpha = 1;

    if (game) {
      for (const drop of game.drops) {
        ctx.strokeStyle = "rgba(62,230,211,.8)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(drop.x, drop.y, 19 + Math.sin(drop.age * 8) * 2, 0, Math.PI * 2); ctx.stroke();
        drawSprite(POWERUPS[drop.kind].emoji, 26, drop.x, drop.y, Math.sin(drop.age * 4) * 0.25);
      }
      for (const enemy of game.enemies) {
        if (enemy.emoji) drawSprite(enemy.emoji, enemy.size, enemy.x, enemy.y, enemy.rotation);
        else drawMeteor(enemy);
        if (enemy.flash > 0) {
          ctx.globalAlpha = 0.55; ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      for (const shot of game.shots) {
        ctx.fillStyle = "#7CFC9A"; ctx.shadowColor = "#7CFC9A"; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(shot.x, shot.y, shot.radius, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      for (const bullet of game.bullets) drawSprite("💩", 18, bullet.x, bullet.y, bullet.rotation);
      if (mode !== "over") drawPlayer(game.player, time);
      for (const particle of game.particles) {
        ctx.globalAlpha = 1 - particle.age / particle.life;
        ctx.fillStyle = particle.color;
        ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
      }
      ctx.globalAlpha = 1;
      for (const floating of game.floaters) {
        ctx.globalAlpha = 1 - floating.age / 0.9;
        text(floating.text, floating.x, floating.y, 15, floating.color);
      }
      ctx.globalAlpha = 1;
      drawHud();
    }
    ctx.restore();

    if (mode === "title") {
      drawSprite("🚀", 84, W / 2, 196 + Math.sin(time * 2) * 8, -Math.PI / 4);
      drawSprite("💩", 30, W / 2 - 4, 286 + Math.sin(time * 2) * 8, time * 2);
      text("POOP", W / 2, 352, 72, "#ff8a3d", "center", 900);
      text("ROCKET", W / 2, 418, 72, "#ffd23f", "center", 900);
      text("← ↑ ↓ →  fly        SPACE  fire", W / 2, 492, 17, "#f6f1ff", "center", 700);
      text("on a phone: drag to fly, it fires by itself", W / 2, 520, 13, "#b3a7d6", "center", 600);
      text("3 lives · shoot the aliens and the meteors", W / 2, 548, 13, "#b3a7d6", "center", 600);
      if (Math.floor(time * 2) % 2 === 0) text("PRESS SPACE OR TAP TO START", W / 2, 612, 18, "#3ee6d3");
      if (best) text(`BEST ${best}`, W / 2, 650, 14, "#ffd23f", "center", 700);
    }
    if (mode === "paused") {
      ctx.fillStyle = "rgba(5,3,15,.7)"; ctx.fillRect(0, 0, W, H);
      text("PAUSED", W / 2, H / 2 - 12, 44, "#ffd23f", "center", 900);
      text("P to resume", W / 2, H / 2 + 30, 15, "#b3a7d6", "center", 600);
    }
    if (mode === "over") {
      ctx.fillStyle = `rgba(5,3,15,${Math.min(0.78, game.overFor * 1.6)})`; ctx.fillRect(0, 0, W, H);
      text("GAME OVER", W / 2, 236, 52, "#ff4fa3", "center", 900);
      text(String(game.score), W / 2, 318, 66, "#ffd23f", "center", 900);
      text(game.newBest ? "NEW BEST. Your family is so proud." : `BEST ${best}`, W / 2, 374, 15, game.newBest ? "#3ee6d3" : "#b3a7d6", "center", 700);
      text(game.quip, W / 2, 432, 14, "#f6f1ff", "center", 600);
      if (game.overFor > 0.9 && Math.floor(time * 2) % 2 === 0) text("SPACE OR TAP TO GO AGAIN", W / 2, 520, 18, "#3ee6d3");
    }
  }

  // --- input -----------------------------------------------------------------------
  const GAME_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
  function confirmPressed() {
    if (mode === "title") start();
    else if (mode === "over" && game.overFor > 0.9) start(); // the delay stops a held SPACE skipping the score
    else if (mode === "paused") setMode("playing");
  }
  addEventListener("keydown", (event) => {
    if (GAME_KEYS.has(event.code)) event.preventDefault(); // never scroll the page
    if (event.repeat) return;
    keys.add(event.code);
    if (event.code === "Space" || event.code === "Enter") confirmPressed();
    if (event.code === "KeyP" || event.code === "Escape") togglePause();
    if (event.code === "KeyM") toggleMute();
  });
  addEventListener("keyup", (event) => keys.delete(event.code));
  addEventListener("blur", () => { keys.clear(); pointer.active = false; if (mode === "playing") setMode("paused"); });

  function toGame(event) {
    const box = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - box.left) / box.width) * W;
    pointer.y = ((event.clientY - box.top) / box.height) * H;
  }
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    ensureAudio();
    toGame(event);
    if (mode !== "playing") confirmPressed();
    // The same touch that starts (or resumes) a round also steers: no need to lift and re-touch.
    if (mode === "playing") {
      pointer.active = true;
      // Capture keeps the drag alive if the finger slides off the canvas. It is a nicety:
      // if the browser refuses, steering must still work.
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    }
  });
  canvas.addEventListener("pointermove", (event) => { if (pointer.active) toGame(event); });
  for (const type of ["pointerup", "pointercancel"]) canvas.addEventListener(type, () => { pointer.active = false; });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  document.getElementById("pause").addEventListener("click", (event) => { togglePause(); event.currentTarget.blur(); });
  document.getElementById("mute").addEventListener("click", (event) => { toggleMute(); event.currentTarget.blur(); });

  // --- loop ------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.034, (now - last) / 1000); // clamp: a background tab must not teleport things
    last = now;
    update(dt);
    draw(now / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // A handle for poking at the game while developing; absent on the real site.
  if (location.hostname === "localhost") window.__poopRocket = { get game() { return game; }, get mode() { return mode; } };
})();
