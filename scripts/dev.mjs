// Local preview: builds, serves dist/ on http://localhost:4400, rebuilds on every page load.
// Zero dependencies. Not used in production (Vercel serves the static files itself).

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT) || 4400;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".woff2": "font/woff2",
};

async function rebuild(reason) {
  try {
    // Re-import with a cache-busting query so edits to build.mjs itself take effect
    // without restarting the preview (Node otherwise caches the first version it loaded).
    const { build } = await import(`./build.mjs?t=${Date.now()}`);
    const games = await build();
    console.log(`[${new Date().toLocaleTimeString()}] built ${games.length} game(s)${reason ? ` (${reason})` : ""}`);
  } catch (error) {
    console.error(`BUILD FAILED: ${error.message}`);
  }
}

async function resolveFile(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const base = path.join(DIST, clean);
  if (!base.startsWith(DIST)) return null; // no escaping dist/
  for (const candidate of [base, `${base}.html`, path.join(base, "index.html")]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

// File watching is unreliable on network/WSL shares, so instead of watching we simply
// rebuild whenever a page is requested (the build takes milliseconds). Refresh = fresh build.
await rebuild();
let lastBuild = Date.now();

createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://x").pathname;
  const wantsPage = !path.extname(pathname) || pathname.endsWith(".html");
  if (wantsPage && Date.now() - lastBuild > 1000) {
    await rebuild("page request");
    lastBuild = Date.now();
  }
  const file = await resolveFile(pathname);
  if (!file) {
    const notFound = await readFile(path.join(DIST, "404.html")).catch(() => "404");
    response.writeHead(404, { "content-type": TYPES[".html"] }).end(notFound);
    return;
  }
  response
    .writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" })
    .end(await readFile(file));
}).listen(PORT, "127.0.0.1", () => console.log(`preview: http://localhost:${PORT}`));
