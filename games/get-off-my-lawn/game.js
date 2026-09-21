// Get Off My Lawn — you are Gladys, the kids are on your grass, and the lawn can only take so much.
// Plain canvas, no dependencies. Keyboard: arrows/WASD walk, SPACE throws. Touch/mouse: drag to
// walk, she throws by herself. She always aims at the nearest kid and canes anyone in reach.
(() => {
  "use strict";

  const W = 480, H = 720;
  const LAWN = { top: 84, bottom: 636 }; // street + sidewalk above, porch below
  const BEST_KEY = "aag.get-off-my-lawn.best";
  const MUTE_KEY = "aag.get-off-my-lawn.muted";
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
  function drawSprite(target, emoji, size, x, y, rotation = 0, alpha = 1, flip = false) {
    const image = sprite(emoji, size);
    const half = image.width / 4; // drawn at half its raster size
    target.save();
    target.globalAlpha = alpha;
    target.translate(x, y);
    if (flip) target.scale(-1, 1);
    if (rotation) target.rotate(rotation);
    target.drawImage(image, -half, -half, half * 2, half * 2);
    target.restore();
  }
  function roundedRect(target, x, y, w, h, r) {
    target.beginPath();
    target.moveTo(x + r, y);
    target.arcTo(x + w, y, x + w, y + h, r); target.arcTo(x + w, y + h, x, y + h, r);
    target.arcTo(x, y + h, x, y, r); target.arcTo(x, y, x + w, y, r);
    target.closePath();
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
    toss: () => noiseBurst(0.1, 1600, 300, 0.12), // fwip
    thwack: () => { tone("square", 210, 90, 0.07, 0.16); noiseBurst(0.05, 2400, 500, 0.12); },
    bonk: () => { tone("sine", 190, 70, 0.16, 0.34); tone("square", 320, 120, 0.06, 0.12); },
    squeal: () => tone("sine", rand(900, 1200), rand(320, 420), 0.32, 0.13), // a kid rethinking things
    chatter: () => [0, 0.05, 0.1].forEach((delay) => tone("square", 1300, 1100, 0.025, 0.07, delay)),
    squirt: () => noiseBurst(0.06, 3200, 1400, 0.05),
    power: () => [392, 523, 659, 784].forEach((hz, i) => tone("square", hz, hz * 1.01, 0.09, 0.09, i * 0.06)),
    grow: () => [523, 659, 784, 1047].forEach((hz, i) => tone("sine", hz, hz * 1.01, 0.16, 0.12, i * 0.08)),
    mom: () => { tone("sawtooth", 300, 620, 0.5, 0.2); tone("sawtooth", 304, 628, 0.5, 0.14, 0.02); noiseBurst(0.5, 900, 2600, 0.12); },
    bell: () => [0, 0.16, 0.32, 0.48].forEach((delay) => { tone("square", 1760, 1750, 0.12, 0.09, delay); tone("sine", 2640, 2630, 0.12, 0.06, delay); }),
    dig: () => noiseBurst(0.12, 500, 120, 0.16),
    warn: () => tone("square", 440, 430, 0.09, 0.08),
    over: () => [392, 370, 349, 262].forEach((hz, i) => tone("triangle", hz, hz * 0.97, 0.3, 0.18, i * 0.24)),
  };

  // --- catalogues ---------------------------------------------------------------------
  // drain = how much lawn (out of 100) one of these ruins per second while standing on it.
  const KIDS = {
    kid: { faces: ["🧒", "👦", "👧"], body: true, size: 26, radius: 14, hp: 1, points: 10, drain: 0.7, speed: 62 },
    runner: { faces: ["🏃"], size: 34, radius: 14, hp: 1, points: 20, drain: 0.6, speed: 150 },
    dog: { faces: ["🐕"], size: 32, radius: 14, hp: 1, points: 15, drain: 0.7, speed: 170 },
    biker: { faces: ["🚴"], size: 40, radius: 17, hp: 2, points: 40, drain: 1.2, speed: 215 },
    dancer: { faces: ["🕺"], size: 40, radius: 16, hp: 3, points: 50, drain: 1.6, speed: 48 },
  };
  const SHIRTS = ["#ef476f", "#ffd166", "#118ab2", "#f78c6b", "#9b5de5", "#06d6a0", "#ffffff"];
  const POWERS = { // timed weapons
    teeth: { emoji: "🦷", label: "DENTURES: THEY CHASE" },
    yarn: { emoji: "🧶", label: "YARN BALL: GOES THROUGH" },
    hose: { emoji: "💦", label: "GARDEN HOSE" },
    scooter: { emoji: "🦼", label: "MOBILITY SCOOTER: RAM THEM" },
  };
  const INSTANTS = { // happen the moment she picks them up
    mom: { emoji: "☎️", label: "I'M CALLING YOUR MOTHERS!" },
    seed: { emoji: "🌱", label: "MIRACLE GROW +20" },
  };
  const POWER_SECONDS = 9;
  const SHOUTS = ["GET OFF MY LAWN!", "SCRAM!", "HOOLIGANS!", "I KNOW YOUR MOTHER!", "NOT ON MY GRASS!", "SHOO!", "BACK IN MY DAY...", "I HAVE A CANE!"];
  const QUIPS = [
    "The HOA has been notified.",
    "It was never really about the lawn.",
    "Back in her day, grass was respected.",
    "The kids will tell this story for years.",
    "Gladys has gone inside to write a strongly worded letter.",
    "The flamingo saw everything.",
  ];

  // --- the yard: painted once ---------------------------------------------------------
  const yard = document.createElement("canvas");
  yard.width = W * 2; yard.height = H * 2;
  (function paintYard() {
    const y = yard.getContext("2d");
    y.scale(2, 2);
    y.fillStyle = "#3a3a44"; y.fillRect(0, 0, W, 56); // street
    y.fillStyle = "#e8d44d";
    for (let x = 10; x < W; x += 56) y.fillRect(x, 26, 30, 4);
    y.fillStyle = "#b9b4a8"; y.fillRect(0, 56, W, 28); // sidewalk
    y.strokeStyle = "rgba(0,0,0,.18)"; y.lineWidth = 1;
    for (let x = 0; x < W; x += 60) { y.beginPath(); y.moveTo(x, 56); y.lineTo(x, 84); y.stroke(); }
    for (let i = 0; i * 46 < LAWN.bottom - LAWN.top; i++) { // mowing stripes
      y.fillStyle = i % 2 ? "#4fae45" : "#47a13e";
      y.fillRect(0, LAWN.top + i * 46, W, 46);
    }
    y.fillStyle = "rgba(255,255,255,.07)";
    for (let i = 0; i < 260; i++) y.fillRect(rand(0, W), rand(LAWN.top, LAWN.bottom), 1.5, 3); // grass flecks
    y.fillStyle = "#8a5a35"; y.fillRect(0, LAWN.bottom, W, H - LAWN.bottom); // porch
    y.strokeStyle = "rgba(0,0,0,.25)";
    for (let x = 0; x < W; x += 40) { y.beginPath(); y.moveTo(x, LAWN.bottom); y.lineTo(x, H); y.stroke(); }
    y.fillStyle = "#f4efe6"; y.fillRect(0, LAWN.bottom, W, 6); // porch edge
    y.fillStyle = "#6e4526"; roundedRect(y, W / 2 - 26, 664, 52, 56, 5); y.fill(); // front door
    y.fillStyle = "#e8d44d"; y.beginPath(); y.arc(W / 2 + 16, 694, 3, 0, Math.PI * 2); y.fill();
    y.fillStyle = "#f4efe6"; // picket fence down both sides
    for (let py = LAWN.top + 6; py < LAWN.bottom - 8; py += 18) { y.fillRect(2, py, 5, 13); y.fillRect(W - 7, py, 5, 13); }
    // The sign nobody reads.
    y.fillStyle = "#6e4526"; y.fillRect(399, 112, 4, 28);
    y.fillStyle = "#fffdf5"; roundedRect(y, 366, 92, 70, 26, 3); y.fill();
    y.strokeStyle = "#222"; y.lineWidth = 1.5; y.stroke();
    y.fillStyle = "#222"; y.font = "800 8px ui-rounded, 'Segoe UI', sans-serif"; y.textAlign = "center";
    y.fillText("KEEP OFF", 401, 103); y.fillText("THE GRASS", 401, 113);
    drawSprite(y, "🦩", 30, 40, 596);
    drawSprite(y, "🌷", 22, 120, 650); drawSprite(y, "🌻", 24, 150, 648); drawSprite(y, "🌷", 22, 330, 650); drawSprite(y, "🌼", 20, 358, 652);
    drawSprite(y, "🪑", 34, 420, 684); drawSprite(y, "📫", 26, 26, 66);
  })();

  // Trampled grass builds up here for the whole round.
  const wear = document.createElement("canvas");
  wear.width = W; wear.height = H;
  const wearCtx = wear.getContext("2d");
  function trample(x, y, radius, alpha) {
    if (y < LAWN.top + 4 || y > LAWN.bottom - 2) return;
    wearCtx.fillStyle = `rgba(110, 84, 38, ${alpha})`;
    wearCtx.beginPath(); wearCtx.ellipse(x, y, radius, radius * 0.6, 0, 0, Math.PI * 2); wearCtx.fill();
  }

  // --- state -----------------------------------------------------------------------
  const keys = new Set();
  const pointer = { active: false, x: 0, y: 0 };
  let best = Number(store.get(BEST_KEY)) || 0;
  let mode = "title"; // title | playing | paused | over
  let game = null;

  function newGame() {
    wearCtx.clearRect(0, 0, W, H);
    return {
      granny: { x: W / 2, y: 560, radius: 15, cooldown: 0, caneIn: 0, swing: null, walk: 0, moving: false, facing: 1 },
      lawn: 100, score: 0, elapsed: 0, spawnIn: 1.2, dropIn: 9, rushIn: 38, rush: null, banner: null,
      combo: 0, comboLeft: 0, scared: 0, shake: 0, overFor: 0, newBest: false, warnIn: 0,
      power: null, powerLeft: 0, shout: null, quip: "",
      kids: [], shots: [], particles: [], drops: [], floaters: [],
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

  // --- kids ---------------------------------------------------------------------------
  const lawnSpot = () => ({ x: rand(40, W - 40), y: rand(LAWN.top + 40, LAWN.bottom - 50) });
  const onLawn = (kid) => kid.state !== "flee" && kid.y > LAWN.top && kid.y < LAWN.bottom && kid.x > 0 && kid.x < W;

  function spawnKid(kind) {
    const def = KIDS[kind];
    const speedUp = 1 + Math.min(game.elapsed, 180) / 360; // up to 1.5x over three minutes
    const kid = {
      kind, ...def, face: pick(def.faces), shirt: pick(SHIRTS), speed: def.speed * speedUp * rand(0.9, 1.1),
      x: rand(30, W - 30), y: -24, kx: 0, ky: 0, state: "walk", wait: 0, age: rand(0, 6), flash: 0, facing: 1, target: lawnSpot(),
    };
    if (kind === "biker") { // rides straight across, turns round, comes back
      kid.facing = Math.random() < 0.5 ? 1 : -1;
      kid.x = kid.facing > 0 ? -30 : W + 30;
      kid.y = rand(LAWN.top + 50, LAWN.bottom - 70);
      kid.state = "ride";
    } else if (Math.random() < 0.3) { // over the fence
      kid.x = Math.random() < 0.5 ? -24 : W + 24;
      kid.y = rand(LAWN.top + 30, LAWN.bottom - 120);
    }
    game.kids.push(kid);
  }
  function spawnWave() {
    const t = game.elapsed;
    const options = ["kid", "kid", "kid"];
    if (t > 10) options.push("runner", "runner");
    if (t > 24) options.push("dog");
    if (t > 40) options.push("biker");
    if (t > 58) options.push("dancer");
    if (t > 90) options.push("biker", "dancer", "runner");
    if (game.kids.length < 40) spawnKid(pick(options));
  }

  function updateKid(kid, dt) {
    kid.age += dt;
    kid.flash = Math.max(0, kid.flash - dt);
    kid.x += kid.kx * dt; kid.y += kid.ky * dt; // knock-back, fading fast
    const fade = Math.exp(-7 * dt); kid.kx *= fade; kid.ky *= fade;

    if (kid.state === "flee") {
      kid.x += kid.fleeX * dt; kid.y += kid.fleeY * dt;
      if (kid.x < -50 || kid.x > W + 50 || kid.y < -50) kid.dead = true;
      return;
    }
    if (kid.state === "ride") {
      kid.x += kid.facing * kid.speed * dt;
      kid.y += Math.sin(kid.age * 3) * 18 * dt;
      if ((kid.facing > 0 && kid.x > W + 34) || (kid.facing < 0 && kid.x < -34)) {
        kid.facing *= -1;
        kid.y = rand(LAWN.top + 50, LAWN.bottom - 70);
      }
      trample(kid.x, kid.y + 14, 5, 0.1);
      return;
    }
    if (kid.state === "dig") {
      kid.wait -= dt;
      trample(kid.x + rand(-5, 5), kid.y + 10, 12, 0.05);
      if (Math.random() < dt * 14) game.particles.push({ x: kid.x, y: kid.y + 8, vx: rand(-90, 90), vy: rand(-170, -60), life: 0.5, age: 0, size: 3, color: "#6e5426" });
      if (kid.wait <= 0) { game.lawn -= 2; sfx.dig(); kid.state = "walk"; kid.target = lawnSpot(); }
      return;
    }
    if (kid.state === "dance") { trample(kid.x + rand(-8, 8), kid.y + 14, 8, 0.06); return; }

    if (kid.wait > 0) { kid.wait -= dt; return; }
    const dx = kid.target.x - kid.x, dy = kid.target.y - kid.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 6) {
      if (kid.kind === "dancer") kid.state = "dance";
      else if (kid.kind === "dog" && Math.random() < 0.6) { kid.state = "dig"; kid.wait = 1.5; }
      else { kid.wait = kid.kind === "kid" ? rand(0.5, 1.8) : rand(0.05, 0.4); kid.target = lawnSpot(); }
      return;
    }
    kid.x += (dx / distance) * kid.speed * dt; kid.y += (dy / distance) * kid.speed * dt;
    if (Math.abs(dx) > 2) kid.facing = Math.sign(dx);
    trample(kid.x, kid.y + 14, 6, 0.045);
  }

  function scare(kid) {
    kid.state = "flee";
    kid.face = "😭";
    kid.body = true; // runs off on foot (the bike is abandoned in spirit)
    // Out by the nearest way that is not through the house.
    const exits = [{ x: -60, y: kid.y }, { x: W + 60, y: kid.y }, { x: kid.x, y: -60 }];
    const exit = exits.sort((a, b) => Math.hypot(a.x - kid.x, a.y - kid.y) - Math.hypot(b.x - kid.x, b.y - kid.y))[0];
    const dx = exit.x - kid.x, dy = exit.y - kid.y, distance = Math.hypot(dx, dy) || 1;
    kid.fleeX = (dx / distance) * 300; kid.fleeY = (dy / distance) * 300;
    kid.facing = Math.sign(dx) || 1;

    game.combo = game.comboLeft > 0 ? game.combo + 1 : 1;
    game.comboLeft = 1.6;
    const multiplier = 1 + Math.min(4, Math.floor(game.combo / 4));
    const points = kid.points * multiplier;
    game.score += points;
    game.scared += 1;
    floater(kid.x, kid.y - 20, multiplier > 1 ? `+${points}  x${multiplier}` : `+${points}`, multiplier > 1 ? "#ff8a3d" : "#fff7c2");
    if (game.scared % 5 === 0) shout(pick(SHOUTS));
    for (let i = 0; i < 6; i++) game.particles.push({ x: kid.x, y: kid.y - 8, vx: rand(-110, 110), vy: rand(-190, -60), life: 0.55, age: 0, size: 3, color: "#8fd3ff" });
    sfx.squeal();
  }

  function hurtKid(kid, damage, fromX, fromY, knock) {
    if (kid.state === "flee") return;
    kid.hp -= damage;
    kid.flash = 0.1;
    const dx = kid.x - fromX, dy = kid.y - fromY, distance = Math.hypot(dx, dy) || 1;
    kid.kx += (dx / distance) * knock; kid.ky += (dy / distance) * knock;
    if (kid.state === "dig" || kid.state === "dance") { kid.state = "walk"; kid.target = lawnSpot(); kid.wait = 0.3; }
    if (kid.hp <= 0) scare(kid);
  }

  // --- effects ---------------------------------------------------------------------
  const floater = (x, y, text, color = "#fff7c2", size = 15) => game.floaters.push({ x, y, text, color, size, age: 0 });
  const shout = (text) => { game.shout = { text, age: 0 }; };
  function grassBurst(x, y, count) {
    for (let i = 0; i < count; i++) game.particles.push({ x, y, vx: rand(-150, 150), vy: rand(-210, -40), life: rand(0.3, 0.6), age: 0, size: rand(2, 4), color: pick(["#7bd66c", "#4fae45", "#c6f2b8"]) });
  }

  // --- granny's arsenal ---------------------------------------------------------------
  function nearestKid(x, y, maxDistance = Infinity) {
    let found = null, foundDistance = maxDistance;
    for (const kid of game.kids) {
      if (kid.state === "flee" || kid.y < -10) continue;
      const distance = Math.hypot(kid.x - x, kid.y - y);
      if (distance < foundDistance) { found = kid; foundDistance = distance; }
    }
    return found;
  }

  function throwThing() {
    const g = game.granny;
    const target = nearestKid(g.x, g.y);
    let angle = -Math.PI / 2;
    if (target) {
      // Lead the target a little so runners and bikers can actually be hit.
      const travel = Math.hypot(target.x - g.x, target.y - g.y) / 520;
      const vx = target.state === "ride" ? target.facing * target.speed : 0;
      angle = Math.atan2(target.y - g.y, target.x + vx * travel - g.x);
      g.facing = Math.cos(angle) >= 0 ? 1 : -1;
    }
    const shot = { x: g.x + Math.cos(angle) * 16, y: g.y - 6 + Math.sin(angle) * 16, rotation: rand(0, 6.28), spin: rand(10, 16), age: 0, hits: new Set() };
    if (game.power === "hose") {
      g.cooldown = 0.055;
      const spread = angle + rand(-0.16, 0.16);
      game.shots.push({ ...shot, kind: "water", vx: Math.cos(spread) * 430, vy: Math.sin(spread) * 430, radius: 7, damage: 0.34, knock: 130, life: 0.55 });
      if (Math.random() < 0.3) sfx.squirt();
      return;
    }
    if (game.power === "teeth") {
      g.cooldown = 0.5;
      game.shots.push({ ...shot, kind: "teeth", vx: Math.cos(angle) * 300, vy: Math.sin(angle) * 300, radius: 11, damage: 1, knock: 160, life: 3.2, spin: 0 });
      sfx.chatter();
      return;
    }
    if (game.power === "yarn") {
      g.cooldown = 0.55;
      game.shots.push({ ...shot, kind: "yarn", vx: Math.cos(angle) * 380, vy: Math.sin(angle) * 380, radius: 15, damage: 1, knock: 200, life: 2.6, bounces: 3 });
      sfx.toss();
      return;
    }
    g.cooldown = 0.32;
    game.shots.push({ ...shot, kind: "slipper", vx: Math.cos(angle) * 520, vy: Math.sin(angle) * 520, radius: 10, damage: 1, knock: 230, life: 1.4 });
    sfx.toss();
  }

  function swingCane(at) {
    const g = game.granny;
    g.caneIn = 0.62;
    g.swing = { age: 0, angle: Math.atan2(at.y - g.y, at.x - g.x) };
    g.facing = at.x >= g.x ? 1 : -1;
    let bonked = 0;
    for (const kid of game.kids) {
      if (kid.state === "flee" || Math.hypot(kid.x - g.x, kid.y - g.y) > 80) continue;
      hurtKid(kid, 2, g.x, g.y, 460);
      bonked += 1;
    }
    if (bonked) {
      floater(at.x, at.y - 34, "BONK!", "#ffd23f", 20);
      grassBurst(at.x, at.y + 8, 8);
      game.shake = REDUCED_MOTION ? 0 : 0.18;
      sfx.bonk();
      if (Math.random() < 0.35) shout(pick(SHOUTS));
    }
  }

  function collect(drop) {
    const g = game.granny;
    if (drop.kind === "mom") {
      for (const kid of game.kids) if (kid.state !== "flee" && kid.y > 0) { kid.hp = 0; scare(kid); }
      shout(INSTANTS.mom.label);
      game.shake = REDUCED_MOTION ? 0 : 0.4;
      sfx.mom();
    } else if (drop.kind === "seed") {
      game.lawn = Math.min(100, game.lawn + 20);
      wearCtx.save(); // the worn patches grow back a good deal
      wearCtx.globalCompositeOperation = "destination-out";
      wearCtx.fillStyle = "rgba(0,0,0,.6)"; wearCtx.fillRect(0, 0, W, H);
      wearCtx.restore();
      floater(g.x, g.y - 40, INSTANTS.seed.label, "#c6f2b8", 16);
      sfx.grow();
    } else {
      game.power = drop.kind; game.powerLeft = POWER_SECONDS;
      floater(g.x, g.y - 40, POWERS[drop.kind].label, "#3ee6d3", 14);
      sfx.power();
    }
  }

  // --- update ----------------------------------------------------------------------
  function update(dt) {
    if (mode === "over") game.overFor += dt;
    if (mode !== "playing" && mode !== "over") return;

    // Particles, floating text and fleeing kids keep going on the game-over screen.
    for (const particle of game.particles) { particle.age += dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += 520 * dt; }
    game.particles = game.particles.filter((particle) => particle.age < particle.life);
    for (const text of game.floaters) { text.age += dt; text.y -= 38 * dt; }
    game.floaters = game.floaters.filter((text) => text.age < 0.9);
    game.shake = Math.max(0, game.shake - dt);
    if (game.shout && (game.shout.age += dt) > 1.5) game.shout = null;
    if (mode !== "playing") return;

    game.elapsed += dt;
    const g = game.granny;
    const scooter = game.power === "scooter";

    // Walking: keyboard, or shuffle toward the finger/mouse (offset so she stays visible).
    let dx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
    let dy = (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0);
    const speed = scooter ? 430 : 235;
    g.moving = false;
    if (pointer.active && !dx && !dy) {
      const tx = pointer.x - g.x, ty = pointer.y - 56 - g.y;
      const distance = Math.hypot(tx, ty);
      if (distance > 4) {
        const step = Math.min(distance, speed * 1.25 * dt);
        g.x += (tx / distance) * step; g.y += (ty / distance) * step;
        g.moving = distance > 8;
        if (Math.abs(tx) > 6 && !nearestKid(g.x, g.y, 200)) g.facing = Math.sign(tx);
      }
    } else if (dx || dy) {
      const length = Math.hypot(dx, dy);
      g.x += (dx / length) * speed * dt; g.y += (dy / length) * speed * dt;
      g.moving = true;
      if (dx && !nearestKid(g.x, g.y, 200)) g.facing = dx;
    }
    g.x = clamp(g.x, 20, W - 20);
    g.y = clamp(g.y, LAWN.top + 16, LAWN.bottom - 14);
    if (g.moving) g.walk += dt * (scooter ? 0 : 13);
    g.cooldown -= dt; g.caneIn -= dt;
    if (g.swing && (g.swing.age += dt) > 0.22) g.swing = null;

    if ((keys.has("Space") || pointer.active) && g.cooldown <= 0) throwThing();
    const close = nearestKid(g.x, g.y, 60);
    if (close && g.caneIn <= 0 && !scooter) swingCane(close);
    if (scooter) {
      for (const kid of game.kids) {
        if (kid.state !== "flee" && Math.hypot(kid.x - g.x, kid.y - g.y) < kid.radius + 24) {
          hurtKid(kid, 3, g.x, g.y, 520); grassBurst(kid.x, kid.y, 5); sfx.bonk();
        }
      }
    }
    if (game.power && (game.powerLeft -= dt) <= 0) game.power = null;
    if ((game.comboLeft -= dt) <= 0) game.combo = 0;

    // New arrivals, and the school bell.
    if ((game.spawnIn -= dt) <= 0) {
      spawnWave();
      game.spawnIn = Math.max(0.5, 1.4 - game.elapsed * 0.0075) * rand(0.7, 1.3);
    }
    if ((game.rushIn -= dt) <= 0) {
      game.rushIn = 42;
      game.rush = { left: Math.min(16, 6 + Math.floor(game.elapsed / 40) * 2), next: 0.6 };
      game.banner = { text: "🔔 SCHOOL'S OUT!", age: 0 };
      sfx.bell();
    }
    if (game.rush && (game.rush.next -= dt) <= 0) {
      spawnKid(Math.random() < 0.7 ? "kid" : "runner");
      game.rush.next = 0.24;
      if ((game.rush.left -= 1) <= 0) game.rush = null;
    }
    if (game.banner && (game.banner.age += dt) > 2.4) game.banner = null;

    // Deliveries: something useful lands on the lawn every so often.
    if ((game.dropIn -= dt) <= 0 && game.drops.length < 2) {
      game.dropIn = rand(10, 15);
      const kinds = [...Object.keys(POWERS), "mom", game.lawn < 60 ? "seed" : "teeth", game.lawn < 35 ? "seed" : "yarn"];
      game.drops.push({ kind: pick(kinds), ...lawnSpot(), age: 0 });
    }
    for (const drop of game.drops) {
      drop.age += dt;
      if (Math.hypot(drop.x - g.x, drop.y - g.y) < 34) { drop.dead = true; collect(drop); }
    }
    game.drops = game.drops.filter((drop) => !drop.dead && drop.age < 11);

    // Things in the air.
    for (const shot of game.shots) {
      shot.age += dt;
      if (shot.kind === "teeth") { // dentures steer themselves
        const prey = nearestKid(shot.x, shot.y, 320);
        if (prey) {
          const want = Math.atan2(prey.y - shot.y, prey.x - shot.x), now = Math.atan2(shot.vy, shot.vx);
          let turn = want - now;
          while (turn > Math.PI) turn -= Math.PI * 2;
          while (turn < -Math.PI) turn += Math.PI * 2;
          const next = now + clamp(turn, -5.5 * dt, 5.5 * dt);
          shot.vx = Math.cos(next) * 330; shot.vy = Math.sin(next) * 330;
        }
      }
      shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.rotation += shot.spin * dt;
      if (shot.kind === "yarn" && shot.bounces > 0) {
        if ((shot.x < 14 && shot.vx < 0) || (shot.x > W - 14 && shot.vx > 0)) { shot.vx *= -1; shot.bounces -= 1; }
        if ((shot.y < LAWN.top && shot.vy < 0) || (shot.y > LAWN.bottom && shot.vy > 0)) { shot.vy *= -1; shot.bounces -= 1; }
      }
      for (const kid of game.kids) {
        if (kid.state === "flee" || shot.hits.has(kid)) continue;
        if (Math.hypot(kid.x - shot.x, kid.y - shot.y) > kid.radius + shot.radius) continue;
        hurtKid(kid, shot.damage, shot.x - shot.vx * 0.05, shot.y - shot.vy * 0.05, shot.knock);
        if (shot.kind !== "water") { sfx.thwack(); grassBurst(shot.x, shot.y, 4); }
        if (shot.kind === "yarn") shot.hits.add(kid); // rolls on through
        else { shot.dead = true; break; }
      }
    }
    game.shots = game.shots.filter((shot) => !shot.dead && shot.age < shot.life && shot.x > -40 && shot.x < W + 40 && shot.y > -40 && shot.y < H + 40);

    // The kids, and what they are doing to the grass.
    let trespassers = 0;
    for (const kid of game.kids) {
      updateKid(kid, dt);
      if (onLawn(kid)) { trespassers += 1; game.lawn -= kid.drain * dt; }
    }
    game.kids = game.kids.filter((kid) => !kid.dead);
    game.trespassers = trespassers;
    if (!trespassers) game.lawn = Math.min(100, game.lawn + 0.8 * dt); // grass recovers when left alone

    if (game.lawn < 25 && (game.warnIn -= dt) <= 0) { game.warnIn = 0.9; sfx.warn(); }
    if (game.lawn <= 0) {
      game.lawn = 0;
      game.newBest = game.score > best;
      if (game.newBest) { best = game.score; store.set(BEST_KEY, String(best)); }
      game.quip = pick(QUIPS);
      game.overFor = 0;
      setMode("over");
      sfx.over();
    }
  }

  // --- draw ------------------------------------------------------------------------
  function text(value, x, y, size, color = "#fff", align = "center", weight = 800) {
    ctx.font = `${weight} ${size}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,.7)";
    ctx.fillText(value, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  function shadow(x, y, width) {
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.beginPath(); ctx.ellipse(x, y, width, width * 0.38, 0, 0, Math.PI * 2); ctx.fill();
  }

  // A little body under an emoji head: shirt and two feet that shuffle.
  function drawBody(x, y, color, phase, moving) {
    const step = moving ? Math.sin(phase) * 3.5 : 0;
    ctx.fillStyle = "#2c2c38";
    ctx.fillRect(x - 7, y + 17 + step, 5, 7); ctx.fillRect(x + 2, y + 17 - step, 5, 7);
    ctx.fillStyle = color;
    roundedRect(ctx, x - 9, y + 2, 18, 18, 6); ctx.fill();
  }

  function drawKid(kid) {
    const fleeing = kid.state === "flee";
    shadow(kid.x, kid.y + 22, kid.radius);
    const bob = kid.state === "dance" ? Math.abs(Math.sin(kid.age * 9)) * -6 : fleeing ? Math.abs(Math.sin(kid.age * 22)) * -4 : 0;
    const tilt = kid.state === "dance" ? Math.sin(kid.age * 9) * 0.25 : kid.state === "dig" ? Math.sin(kid.age * 30) * 0.12 : 0;
    if (kid.body) {
      drawBody(kid.x, kid.y + bob, fleeing && kid.kind !== "kid" ? "#ffd166" : kid.shirt, kid.age * (fleeing ? 26 : 11), kid.wait <= 0 || fleeing);
      drawSprite(ctx, kid.face, kid.kind === "kid" ? kid.size : 26, kid.x, kid.y - 10 + bob, tilt);
    } else {
      drawSprite(ctx, kid.face, kid.size, kid.x, kid.y + bob, tilt, 1, kid.facing > 0); // these emoji face left
    }
    if (kid.flash > 0) {
      ctx.globalAlpha = 0.6; ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(kid.x, kid.y, kid.radius + 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (!fleeing && kid.hp > 1) { // pips for the stubborn ones
      for (let i = 0; i < kid.hp; i++) { ctx.fillStyle = "#ff4fa3"; ctx.fillRect(kid.x - kid.hp * 4 + i * 8, kid.y - 34, 6, 4); }
    }
  }

  function drawGranny(g, time) {
    const scooter = game.power === "scooter";
    shadow(g.x, g.y + 24, scooter ? 24 : 16);
    const bob = g.moving && !scooter ? Math.abs(Math.sin(g.walk)) * -3 : 0;
    if (scooter) drawSprite(ctx, "🦼", 44, g.x, g.y + 8, 0, 1, g.facing > 0);
    else {
      const step = g.moving ? Math.sin(g.walk) * 3 : 0;
      ctx.fillStyle = "#f4a7c0"; // slippers
      ctx.fillRect(g.x - 8, g.y + 20 + step, 6, 5); ctx.fillRect(g.x + 2, g.y + 20 - step, 6, 5);
      ctx.fillStyle = "#b48be0"; // housecoat
      ctx.beginPath(); ctx.moveTo(g.x - 8, g.y + bob); ctx.lineTo(g.x + 8, g.y + bob); ctx.lineTo(g.x + 13, g.y + 21); ctx.lineTo(g.x - 13, g.y + 21); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff"; // polka dots, obviously
      for (const [ox, oy] of [[-5, 8], [4, 12], [-2, 16], [7, 18]]) { ctx.beginPath(); ctx.arc(g.x + ox, g.y + oy + bob * 0.5, 1.4, 0, Math.PI * 2); ctx.fill(); }
    }
    // The cane: held at her side, or mid-swing.
    ctx.strokeStyle = "#6e4526"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    if (g.swing) {
      const progress = g.swing.age / 0.22, sweep = g.swing.angle - 1.1 + progress * 2.2;
      ctx.beginPath(); ctx.moveTo(g.x, g.y + 4); ctx.lineTo(g.x + Math.cos(sweep) * 46, g.y + 4 + Math.sin(sweep) * 46); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * (1 - progress)})`; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(g.x, g.y + 4, 44, g.swing.angle - 1.1, sweep); ctx.stroke();
    } else if (!scooter) {
      const side = g.facing * 15;
      ctx.beginPath(); ctx.moveTo(g.x + side, g.y + 24); ctx.lineTo(g.x + side, g.y + 2);
      ctx.arc(g.x + side - g.facing * 4, g.y + 2, 4, g.facing > 0 ? 0 : Math.PI, g.facing > 0 ? Math.PI : 0, g.facing > 0); ctx.stroke();
    }
    drawSprite(ctx, "👵", 34, g.x, g.y - 12 + bob, g.moving && !scooter ? Math.sin(g.walk) * 0.06 : 0);

    if (game.shout) {
      const alpha = Math.min(1, (1.5 - game.shout.age) * 3);
      ctx.globalAlpha = alpha;
      ctx.font = '800 12px ui-rounded, "Segoe UI", system-ui, sans-serif';
      const width = ctx.measureText(game.shout.text).width + 18;
      const left = clamp(g.x - width / 2, 6, W - width - 6), top = g.y - 66;
      ctx.fillStyle = "#fffdf5"; roundedRect(ctx, left, top, width, 24, 9); ctx.fill();
      ctx.beginPath(); ctx.moveTo(g.x - 5, top + 23); ctx.lineTo(g.x + 5, top + 23); ctx.lineTo(g.x, top + 31); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#222"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(game.shout.text, left + width / 2, top + 12.5);
      ctx.globalAlpha = 1;
    }
  }

  function drawShot(shot) {
    if (shot.kind === "water") {
      ctx.globalAlpha = 0.85 * (1 - shot.age / shot.life);
      ctx.fillStyle = "#8fd3ff";
      ctx.beginPath(); ctx.arc(shot.x, shot.y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (shot.kind === "teeth") {
      drawSprite(ctx, "🦷", 20, shot.x, shot.y + Math.sin(shot.age * 40) * 2, Math.atan2(shot.vy, shot.vx) + Math.PI / 2);
    } else if (shot.kind === "yarn") {
      drawSprite(ctx, "🧶", 26, shot.x, shot.y, shot.rotation);
    } else {
      drawSprite(ctx, "🩴", 22, shot.x, shot.y, shot.rotation);
    }
  }

  function drawDrop(drop, time) {
    const info = POWERS[drop.kind] || INSTANTS[drop.kind];
    if (drop.age > 8 && Math.floor(time * 8) % 2 === 0) return; // about to be taken back
    const landing = Math.max(0, 1 - drop.age * 3); // drops in from above
    shadow(drop.x, drop.y + 18, 15);
    ctx.strokeStyle = drop.kind === "seed" ? "rgba(198,242,184,.95)" : "rgba(255,255,255,.9)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(drop.x, drop.y, 21 + Math.sin(drop.age * 7) * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.arc(drop.x, drop.y, 20, 0, Math.PI * 2); ctx.fill();
    drawSprite(ctx, info.emoji, 26, drop.x, drop.y - landing * 120, Math.sin(drop.age * 4) * 0.2);
  }

  function drawHud(time) {
    text(String(game.score).padStart(5, "0"), 14, 22, 24, "#ffd23f", "left");
    text(`BEST ${Math.max(best, game.score)}`, 14, 44, 11, "#e9e4d4", "left", 700);
    // The lawn meter: this is your health bar.
    const left = 134, width = 190, low = game.lawn < 25;
    ctx.fillStyle = "rgba(0,0,0,.55)"; roundedRect(ctx, left - 3, 9, width + 6, 20, 7); ctx.fill();
    ctx.fillStyle = low ? (Math.floor(time * 5) % 2 ? "#ff4f4f" : "#a82020") : game.lawn < 55 ? "#d9b13b" : "#6fd65c";
    if (game.lawn > 0) { roundedRect(ctx, left, 12, Math.max(8, width * game.lawn / 100), 14, 5); ctx.fill(); }
    text(`LAWN ${Math.ceil(game.lawn)}%`, left + width / 2, 19.5, 11, "#fff", "center", 800);
    const onIt = game.trespassers || 0;
    text(onIt ? `${onIt} on the grass` : "lawn is clear", left + width / 2, 40, 11, onIt > 4 ? "#ff8a8a" : "#e9e4d4", "center", 700);
    if (game.power) {
      const barWidth = 150, barLeft = W / 2 - barWidth / 2;
      ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(barLeft, LAWN.bottom + 14, barWidth, 6);
      ctx.fillStyle = "#3ee6d3"; ctx.fillRect(barLeft, LAWN.bottom + 14, barWidth * (game.powerLeft / POWER_SECONDS), 6);
      text(`${POWERS[game.power].emoji} ${POWERS[game.power].label}`, W / 2, LAWN.bottom + 32, 11, "#3ee6d3", "center", 800);
    }
    if (game.combo >= 4) text(`COMBO x${1 + Math.min(4, Math.floor(game.combo / 4))}`, W - 14, 66, 13, "#ff8a3d", "right", 900);
    if (game.banner) {
      const alpha = Math.min(1, game.banner.age * 5, (2.4 - game.banner.age) * 3);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0, 196, W, 58);
      text(game.banner.text, W / 2, 226, 30, "#ffd23f", "center", 900);
      ctx.globalAlpha = 1;
    }
  }

  function draw(time) {
    ctx.save();
    if (game && game.shake > 0) ctx.translate(rand(-1, 1) * game.shake * 14, rand(-1, 1) * game.shake * 14);
    ctx.drawImage(yard, 0, 0, W, H);
    ctx.drawImage(wear, 0, 0);

    if (game) {
      if (game.lawn < 40) { // the whole lawn yellows as it dies
        ctx.fillStyle = `rgba(150, 120, 40, ${(40 - game.lawn) / 40 * 0.35})`;
        ctx.fillRect(0, LAWN.top, W, LAWN.bottom - LAWN.top);
      }
      for (const drop of game.drops) drawDrop(drop, time);
      const actors = [...game.kids.map((kid) => ({ y: kid.y, kid })), ...(mode !== "title" ? [{ y: game.granny.y, granny: true }] : [])];
      actors.sort((a, b) => a.y - b.y); // whoever is lower on screen is drawn in front
      for (const actor of actors) actor.granny ? drawGranny(game.granny, time) : drawKid(actor.kid);
      for (const shot of game.shots) drawShot(shot);
      for (const particle of game.particles) {
        ctx.globalAlpha = 1 - particle.age / particle.life;
        ctx.fillStyle = particle.color;
        ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
      }
      ctx.globalAlpha = 1;
      for (const floating of game.floaters) {
        ctx.globalAlpha = 1 - floating.age / 0.9;
        text(floating.text, floating.x, floating.y, floating.size, floating.color);
      }
      ctx.globalAlpha = 1;
      drawHud(time);
    }
    ctx.restore();

    if (mode === "title") {
      ctx.fillStyle = "rgba(8,20,8,.62)"; ctx.fillRect(0, 0, W, H);
      drawSprite(ctx, "👵", 92, W / 2, 170 + Math.sin(time * 2) * 6, Math.sin(time * 2) * 0.05);
      drawSprite(ctx, "🩴", 34, W / 2 + 84, 150, time * 5);
      text("GET OFF", W / 2, 282, 64, "#ffd23f", "center", 900);
      text("MY LAWN", W / 2, 346, 64, "#7bd66c", "center", 900);
      text("Kids ruin the grass. Chase them off before it hits 0%.", W / 2, 406, 14, "#f6f1ff", "center", 700);
      text("← ↑ ↓ →  walk        SPACE  throw slippers", W / 2, 450, 16, "#f6f1ff", "center", 700);
      text("on a phone: drag to walk, she throws by herself", W / 2, 478, 13, "#cfe8c8", "center", 600);
      text("she aims on her own and canes anyone who gets close", W / 2, 502, 13, "#cfe8c8", "center", 600);
      text("🦷 dentures   🧶 yarn   💦 hose   🦼 scooter   ☎️ their mothers", W / 2, 540, 12, "#cfe8c8", "center", 600);
      if (Math.floor(time * 2) % 2 === 0) text("PRESS SPACE OR TAP TO START", W / 2, 610, 18, "#3ee6d3");
      if (best) text(`BEST ${best}`, W / 2, 648, 14, "#ffd23f", "center", 700);
    }
    if (mode === "paused") {
      ctx.fillStyle = "rgba(8,20,8,.7)"; ctx.fillRect(0, 0, W, H);
      text("PAUSED", W / 2, H / 2 - 12, 44, "#ffd23f", "center", 900);
      text("P to resume. The kids are waiting.", W / 2, H / 2 + 30, 15, "#cfe8c8", "center", 600);
    }
    if (mode === "over") {
      ctx.fillStyle = `rgba(30,18,4,${Math.min(0.8, game.overFor * 1.6)})`; ctx.fillRect(0, 0, W, H);
      text("LAWN RUINED", W / 2, 226, 48, "#ff8a3d", "center", 900);
      text(String(game.score), W / 2, 306, 66, "#ffd23f", "center", 900);
      text(`${game.scared} kids sent home crying · ${Math.floor(game.elapsed)}s`, W / 2, 358, 14, "#f6f1ff", "center", 700);
      text(game.newBest ? "NEW BEST. The neighborhood fears you." : `BEST ${best}`, W / 2, 388, 15, game.newBest ? "#3ee6d3" : "#cfe8c8", "center", 700);
      text(game.quip, W / 2, 440, 14, "#f6f1ff", "center", 600);
      if (game.overFor > 0.9 && Math.floor(time * 2) % 2 === 0) text("SPACE OR TAP TO GO AGAIN", W / 2, 524, 18, "#3ee6d3");
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
  if (location.hostname === "localhost") {
    window.__lawn = {
      get game() { return game; }, get mode() { return mode; }, keys, pointer, start, spawnKid, collect,
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 60) update(1 / 60); draw(performance.now() / 1000); },
    };
  }
})();
