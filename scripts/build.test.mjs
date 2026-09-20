import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build, escapeHtml, injectShell } from "./build.mjs";

async function fixture(games) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aag-"));
  await mkdir(path.join(root, "site", "static"), { recursive: true });
  await writeFile(path.join(root, "site", "static", "style.css"), "body{}");
  await writeFile(
    path.join(root, "site", "index.template.html"),
    "<main>{{cards}}</main><p>{{count}} {{games_word}} {{year}}</p><p class=count>{{count_line}}</p>",
  );
  for (const [slug, meta, html = "<html><body><p>hi</p></body></html>"] of games) {
    await mkdir(path.join(root, "games", slug), { recursive: true });
    if (meta) await writeFile(path.join(root, "games", slug, "game.json"), JSON.stringify(meta));
    if (html) await writeFile(path.join(root, "games", slug, "index.html"), html);
  }
  return root;
}

const meta = (extra = {}) => ({ title: "A Game", tagline: "It is bad", emoji: "🎮", added: "2026-09-01", ...extra });

test("adding a folder is all it takes: card, page, feed, newest first", async () => {
  const root = await fixture([
    ["old-game", meta({ title: "Old", added: "2026-01-01" })],
    ["new-game", meta({ title: "New", added: "2026-09-10", tags: ["puzzle"] })],
  ]);
  const games = await build({ root, now: new Date("2026-09-15") });

  assert.deepEqual(games.map((g) => g.slug), ["new-game", "old-game"]);
  const home = await readFile(path.join(root, "dist", "index.html"), "utf8");
  assert.ok(home.indexOf("/games/new-game/") < home.indexOf("/games/old-game/"));
  assert.match(home, /2 games 2026/);
  assert.equal((home.match(/class="badge"/g) || []).length, 1, "only the recent game is badged new");
  assert.ok(existsSync(path.join(root, "dist", "games", "new-game", "index.html")));
  assert.ok(!existsSync(path.join(root, "dist", "games", "new-game", "game.json")), "metadata is not published");
  assert.equal(JSON.parse(await readFile(path.join(root, "dist", "games.json"), "utf8")).length, 2);
  assert.ok(existsSync(path.join(root, "dist", "style.css")));
});

test("drafts and _folders are never published; singular grammar works", async () => {
  const root = await fixture([
    ["real-game", meta()],
    ["secret-game", meta({ draft: true })],
    ["_template", meta()],
  ]);
  const games = await build({ root });
  assert.deepEqual(games.map((g) => g.slug), ["real-game"]);
  assert.ok(!existsSync(path.join(root, "dist", "games", "secret-game")));
  assert.ok(!existsSync(path.join(root, "dist", "games", "_template")));
  assert.match(await readFile(path.join(root, "dist", "index.html"), "utf8"), /1 game /);
});

test("an arcade with no games still builds a presentable page", async () => {
  const root = await fixture([["_template", meta()]]);
  assert.deepEqual(await build({ root }), []);
  const home = await readFile(path.join(root, "dist", "index.html"), "utf8");
  assert.match(home, /Nothing to play yet/);
  assert.match(home, /first game is on its way/);
  assert.ok(!home.includes("{{"), "no unfilled placeholders");
});

test("cards never carry ratings or reviews, even if a game.json asks for them", async () => {
  const root = await fixture([["rated-game", meta({ stars: 5, review: "“Best game ever”" })]]);
  await build({ root });
  const home = await readFile(path.join(root, "dist", "index.html"), "utf8");
  assert.ok(!/★|☆|stars|blockquote|Best game ever/.test(home));
  assert.match(home, /<b>1<\/b> game of questionable merit/);
});

test("a broken game fails the build loudly instead of shipping a broken site", async () => {
  await assert.rejects(build({ root: await fixture([["no-meta", null]]) }), /no-meta\/game\.json/);
  await assert.rejects(build({ root: await fixture([["no-page", meta(), null]]) }), /missing index\.html/);
  await assert.rejects(build({ root: await fixture([["Bad_Name", meta()]]) }), /lowercase-with-dashes/);
  await assert.rejects(build({ root: await fixture([["no-title", { ...meta(), title: "" }]]) }), /missing "title"/);
  await assert.rejects(build({ root: await fixture([["bad-date", meta({ added: "soon" })]]) }), /must be a date/);
});

test("game text cannot inject markup into the home page", async () => {
  const root = await fixture([["xss-game", meta({ title: '<script>alert("x")</script>', tagline: "a & b" })]]);
  await build({ root });
  const home = await readFile(path.join(root, "dist", "index.html"), "utf8");
  assert.ok(!home.includes("<script>alert"));
  assert.ok(home.includes("&lt;script&gt;") && home.includes("a &amp; b"));
  assert.equal(escapeHtml(`<'">&`), "&lt;&#39;&quot;&gt;&amp;");
});

test("game URLs keep their trailing slash, and games use relative asset paths", async () => {
  // Shipped once with trailingSlash:false: /games/x/ redirected to /games/x, so the game's
  // relative style.css and game.js resolved to /games/style.css -> 404 -> blank white page.
  const repo = path.resolve(import.meta.dirname, "..");
  const vercel = JSON.parse(await readFile(path.join(repo, "vercel.json"), "utf8"));
  assert.equal(vercel.trailingSlash, true);

  const root = await fixture([["some-game", meta()]]);
  await build({ root });
  const home = await readFile(path.join(root, "dist", "index.html"), "utf8");
  assert.match(home, /href="\/games\/some-game\/"/, "cards link to the folder URL, slash included");
});

test("every game gets the back-to-arcade link exactly once", () => {
  const once = injectShell("<html><body><p>game</p></body></html>");
  assert.match(once, /class="aag-back" href="\/"/);
  assert.equal(injectShell(once), once);
});
