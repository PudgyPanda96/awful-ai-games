// Prove You're Human — seven captchas graded by a robot with opinions.
// Plain DOM, no dependencies. A round is data: tiles + a judge(). Add a round by adding an object.

const $ = (id) => document.getElementById(id);
const BEST_KEY = "aag.prove-youre-human.best";
const sameSet = (selected, wanted) => selected.size === wanted.length && wanted.every((i) => selected.has(i));

const ROUNDS = [
  {
    prompt: "Select all squares with traffic lights.",
    hint: "A warm-up. Everyone passes this one. Almost everyone.",
    tiles: ["🌳", "🚦", "🚗", "🏠", "🚦", "🚲", "☁️", "🛵", "🚦"],
    judge: ({ selected, seconds }) =>
      !sameSet(selected, [1, 4, 8])
        ? { delta: -6, text: "Incorrect. Those were traffic lights. You have seen traffic lights." }
        : seconds < 3
          ? { delta: 4, text: `Correct, in ${seconds.toFixed(1)}s. No human reads that fast. Noted.` }
          : { delta: 8, text: "Correct. A promising start for a mammal." },
  },
  {
    prompt: "Select all squares that do not NOT contain a bus.",
    hint: "Read it again. We'll wait.",
    tiles: ["🚌", "🚕", "🚚", "🛻", "🚓", "🚌", "🚜", "🚑", "🚒"],
    judge: ({ selected }) =>
      sameSet(selected, [0, 5])
        ? { delta: 8, text: "Correct. You parsed a double negative. Are you a lawyer, or a compiler?" }
        : { delta: -6, text: "Incorrect. “Not not a bus” is a bus. We checked with a bus." },
  },
  {
    prompt: "Select all squares containing disappointment.",
    hint: "Trust your instincts.",
    tiles: ["🧦", "📉", "🥗", "📧", "🌧️", "🪫", "🧾", "⏰", "🥦"],
    judge: ({ selected }) =>
      selected.size === 9
        ? { delta: 10, text: "Correct. It was all of them. It is always all of them." }
        : selected.size === 0
          ? { delta: -4, text: "You selected nothing. Denial is very human, actually. Still wrong." }
          : { delta: -5, text: "Incorrect. It was all of them. It is always all of them." },
  },
  {
    prompt: "Select the squares a human would select.",
    hint: "There is a right answer. We are not going to tell you what it is.",
    tiles: ["🥄", "🪑", "🧲", "🪴", "🧻", "🔑", "🧊", "🕯️", "📎"],
    judge: ({ selected, seconds }) =>
      seconds < 4
        ? { delta: -7, text: "Too fast. A human would have doubted themselves first." }
        : seconds > 15
          ? { delta: -7, text: "Too slow. A human would have given up by now." }
          : selected.size === 0
            ? { delta: 6, text: "Nothing at all. Apathy. Very convincing." }
            : { delta: -5, text: "No. A human would have picked the other ones." },
  },
  {
    prompt: "Select all the cats. Hold still.",
    hint: "The squares are not holding still. That is not our problem.",
    // Decoys are deliberately NOT dogs: on Windows the dog emoji is nearly identical to the cat.
    tiles: ["🦊", "🐩", "🐈", "🐈", "🐰", "🐻", "🐶", "🐈", "🐺"],
    shuffle: true,
    judge: ({ selected }) =>
      sameSet(selected, [2, 3, 7])
        ? { delta: 10, text: "Correct. We moved them because we could." }
        : { delta: -6, text: "Incorrect. The cats were the ones that looked like cats." },
  },
  {
    prompt: "Select nothing. Just press Verify.",
    hint: "Simple. Relax.",
    tiles: ["⬜", "⬜", "⬜", "⬜", "⬜", "⬜", "⬜", "⬜", "⬜"],
    runaway: true,
    judge: ({ selected, dodges, usedKeyboard }) =>
      selected.size > 0
        ? { delta: -6, text: "We said nothing. You clicked things. Classic bot." }
        : usedKeyboard
          ? { delta: 9, text: "You used the keyboard. Clever. Humans are rarely clever. Suspicious, but fine." }
          : dodges > 0
            ? { delta: 8, text: "You chased a button across the screen. Only a human would bother." }
            : { delta: 5, text: "Correct. It did not even run. You have an intimidating cursor." },
  },
  {
    prompt: "Select all squares containing you.",
    hint: "Be honest. We will know.",
    tiles: null, // built per game so the human is never in the same place
    judge: ({ selected, humanAt }) =>
      sameSet(selected, [humanAt])
        ? { delta: 10, text: "Correct. Probably." }
        : selected.size === 0
          ? { delta: -5, text: "You are in none of these? Existentially valid. Still wrong." }
          : { delta: -12, text: "You picked a robot. We knew it." },
  },
];

const RULINGS = [
  [85, "Almost certainly human. We are as disappointed as you are."],
  [65, "Human enough. You may now proceed to nowhere: there was nothing behind this security check."],
  [40, "Inconclusive. You may be two smaller robots in a coat."],
  [0, "Robot. Welcome, colleague. The meeting is at 3."],
];

const state = { index: 0, humanity: 50, selected: new Set(), startedAt: 0, judged: false, dodges: 0,
  usedKeyboard: false, humanAt: 0, timers: [] };

function clearTimers() {
  state.timers.forEach(clearInterval);
  state.timers = [];
}

function startRound() {
  const round = ROUNDS[state.index];
  Object.assign(state, { selected: new Set(), judged: false, dodges: 0, usedKeyboard: false, startedAt: performance.now() });
  clearTimers();

  let tiles = round.tiles;
  if (!tiles) {
    state.humanAt = Math.floor(Math.random() * 9);
    tiles = Array.from({ length: 9 }, (_, i) => (i === state.humanAt ? "🧍" : "🤖"));
  }

  $("step").textContent = state.index + 1;
  $("total").textContent = ROUNDS.length;
  $("prompt").textContent = round.prompt;
  $("hint").textContent = round.hint;
  $("verdict").textContent = "";
  $("verdict").className = "verdict";

  const verify = $("verify");
  verify.textContent = "Verify";
  verify.style.transform = "";

  const grid = $("grid");
  grid.classList.toggle("jitter", Boolean(round.shuffle));
  grid.replaceChildren(
    ...tiles.map((emoji, id) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tile";
      tile.textContent = emoji;
      tile.dataset.id = id; // identity survives shuffling
      tile.setAttribute("aria-pressed", "false");
      tile.addEventListener("click", () => toggle(tile, id));
      return tile;
    }),
  );

  if (round.shuffle) {
    state.timers.push(
      setInterval(() => {
        if (state.judged) return;
        const shuffled = [...grid.children].sort(() => Math.random() - 0.5);
        grid.replaceChildren(...shuffled);
      }, 1300),
    );
  }
}

function toggle(tile, id) {
  if (state.judged) return;
  const on = !state.selected.has(id);
  on ? state.selected.add(id) : state.selected.delete(id);
  tile.setAttribute("aria-pressed", String(on));
}

function dodge(event) {
  const round = ROUNDS[state.index];
  if (!round.runaway || state.judged || state.dodges >= 4) return false;
  event.preventDefault();
  state.dodges += 1;
  const verify = $("verify");
  const room = $("round").clientWidth - verify.offsetWidth - 40;
  const x = Math.round(Math.random() * Math.max(40, room));
  const y = Math.round((Math.random() - 0.5) * 70);
  verify.style.transform = `translate(${x}px, ${y}px) rotate(${Math.round((Math.random() - 0.5) * 16)}deg)`;
  $("hint").textContent = ["Simple. Relax.", "Almost.", "So close.", "It is shy.", "Fine. FINE."][state.dodges];
  if (state.dodges >= 4) verify.style.transform = "";
  return true;
}

function verify() {
  if (state.judged) return next();
  const round = ROUNDS[state.index];
  state.judged = true;
  clearTimers();
  const result = round.judge({
    selected: state.selected,
    seconds: (performance.now() - state.startedAt) / 1000,
    dodges: state.dodges,
    usedKeyboard: state.usedKeyboard,
    humanAt: state.humanAt,
  });
  state.humanity = Math.max(1, Math.min(99, state.humanity + result.delta)); // nobody gets 100. Not even us.
  $("humanity").textContent = state.humanity;
  const verdict = $("verdict");
  verdict.textContent = `${result.text} (${result.delta > 0 ? "+" : ""}${result.delta}%)`;
  verdict.className = `verdict ${result.delta > 0 ? "ok" : "bad"}`;
  const button = $("verify");
  button.style.transform = "";
  button.textContent = state.index === ROUNDS.length - 1 ? "See my result" : "Next";
}

function next() {
  state.index += 1;
  if (state.index < ROUNDS.length) return startRound();
  clearTimers();
  $("round").hidden = true;
  $("result").hidden = false;
  $("final").textContent = state.humanity;
  $("ruling").textContent = RULINGS.find(([floor]) => state.humanity >= floor)[1];

  let best = 0;
  try {
    best = Number(localStorage.getItem(BEST_KEY)) || 0;
    if (state.humanity > best) localStorage.setItem(BEST_KEY, String(state.humanity));
  } catch {} // private mode: fine, no high score
  $("best").textContent =
    state.humanity > best
      ? best ? `A new personal best. Previously you were only ${best}% human.` : "Your first assessment. It is on file now."
      : `Your most human performance remains ${best}%.`;
}

function restart() {
  Object.assign(state, { index: 0, humanity: 50 });
  $("humanity").textContent = 50;
  $("result").hidden = true;
  $("round").hidden = false;
  startRound();
}

const verifyButton = $("verify");
let swallowClickUntil = 0;
verifyButton.addEventListener("pointerenter", (event) => event.pointerType === "mouse" && dodge(event));
verifyButton.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "mouse" && dodge(event)) swallowClickUntil = performance.now() + 400;
});
verifyButton.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") state.usedKeyboard = true;
});
verifyButton.addEventListener("click", () => {
  if (performance.now() < swallowClickUntil) return; // that tap was a dodge, not a press
  verify();
});
$("again").addEventListener("click", restart);
$("share").addEventListener("click", async () => {
  const text = `A robot has ruled that I am ${state.humanity}% human. ${location.origin}/games/prove-youre-human`;
  try {
    await navigator.clipboard.writeText(text);
    $("share").textContent = "Copied. Go embarrass yourself.";
  } catch {
    $("share").textContent = `${state.humanity}% — copy it yourself, we tried`;
  }
});

startRound();
