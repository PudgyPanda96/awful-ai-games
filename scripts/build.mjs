// Builds the site into dist/. Zero dependencies.
//
//   games/<slug>/game.json + index.html  ->  dist/games/<slug>/   (+ a card on the home page)
//   site/static/*                        ->  dist/
//   site/index.template.html             ->  dist/index.html
//
// Adding a game = adding a folder under games/. Folders starting with "_" are ignored
// (games/_template is the starting point for a new game).

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQUIRED = ["title", "tagline", "emoji", "added"];

export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function loadGames(gamesDir) {
  const games = [];
  for (const entry of await readdir(gamesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const slug = entry.name;
    const dir = path.join(gamesDir, slug);
    if (!SLUG.test(slug)) throw new Error(`games/${slug}: folder name must be lowercase-with-dashes`);
    if (!existsSync(path.join(dir, "index.html"))) throw new Error(`games/${slug}: missing index.html`);

    let meta;
    try {
      meta = JSON.parse(await readFile(path.join(dir, "game.json"), "utf8"));
    } catch (error) {
      throw new Error(`games/${slug}/game.json: ${error.message}`);
    }
    for (const field of REQUIRED) {
      if (!meta[field]) throw new Error(`games/${slug}/game.json: missing "${field}"`);
    }
    if (Number.isNaN(Date.parse(meta.added))) throw new Error(`games/${slug}/game.json: "added" must be a date`);
    if (meta.draft) continue; // drafts build nowhere: not on the home page, not in dist
    games.push({ slug, color: "#7c5cff", tags: [], ...meta });
  }
  // Newest first; title as a stable tie-break.
  return games.sort((a, b) => Date.parse(b.added) - Date.parse(a.added) || a.title.localeCompare(b.title));
}

export function renderCard(game, isNew) {
  const tags = game.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("");
  return `
      <a class="card" href="/games/${game.slug}/" style="--accent:${escapeHtml(game.color)}">
        <div class="card-art" aria-hidden="true">${escapeHtml(game.emoji)}</div>
        <div class="card-body">
          <h3>${escapeHtml(game.title)}${isNew ? ' <span class="badge">new</span>' : ""}</h3>
          <p>${escapeHtml(game.tagline)}</p>
          ${tags ? `<ul class="tags">${tags}</ul>` : ""}
        </div>
      </a>`;
}

// Every game gets the same small "back to the arcade" link without having to include it.
const SHELL = `<link rel="stylesheet" href="/shell.css"><a class="aag-back" href="/">&larr; Awful AI Games</a>`;
export const injectShell = (html) =>
  html.includes("aag-back") ? html : html.replace(/<\/body>/i, `${SHELL}</body>`);

export async function build({ root = ROOT, out = path.join(root, "dist"), now = new Date() } = {}) {
  const games = await loadGames(path.join(root, "games"));
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, "games"), { recursive: true });
  await cp(path.join(root, "site", "static"), out, { recursive: true });

  for (const game of games) {
    const target = path.join(out, "games", game.slug);
    await cp(path.join(root, "games", game.slug), target, { recursive: true });
    await rm(path.join(target, "game.json"));
    const page = path.join(target, "index.html");
    await writeFile(page, injectShell(await readFile(page, "utf8")));
  }

  const fortnight = 14 * 24 * 3600 * 1000;
  const cards = games.map((g) => renderCard(g, now - Date.parse(g.added) < fortnight)).join("\n");
  const template = await readFile(path.join(root, "site", "index.template.html"), "utf8");
  const countLine =
    games.length === 0
      ? "The first game is on its way. Lower your expectations now."
      : `<b>${games.length}</b> ${games.length === 1 ? "game" : "games"} of questionable merit and counting`;
  const emptyState = `
      <div class="empty">
        <div class="empty-art" aria-hidden="true">🕹️</div>
        <h3>Nothing to play yet</h3>
        <p>The arcade is open. The cabinets have not arrived. Check back soon.</p>
      </div>`;
  const html = template
    .replaceAll("{{cards}}", cards || emptyState)
    .replaceAll("{{count_line}}", countLine)
    .replaceAll("{{count}}", String(games.length))
    .replaceAll("{{games_word}}", games.length === 1 ? "game" : "games")
    .replaceAll("{{year}}", String(now.getFullYear()));
  await writeFile(path.join(out, "index.html"), html);
  await writeFile(
    path.join(out, "games.json"),
    JSON.stringify(games.map(({ slug, title, tagline, emoji, added, tags }) => ({ slug, title, tagline, emoji, added, tags })), null, 2),
  );
  return games;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const games = await build();
    console.log(`built ${games.length} game(s): ${games.map((g) => g.slug).join(", ") || "none"}`);
  } catch (error) {
    console.error(`BUILD FAILED: ${error.message}`);
    process.exit(1);
  }
}
