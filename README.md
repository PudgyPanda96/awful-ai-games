# Awful AI Games

**awfulaigames.com** — free browser games made by AI and asked for by no one.
They are awful. That is the point.

A static site: no framework, no dependencies, no server, no accounts, no tracking.
Push to `main` and Vercel redeploys in under a minute.

## Run it locally

Needs Node 20+.

```bash
npm run dev      # http://localhost:4400 — rebuilds on every page refresh
npm run build    # writes the finished site to dist/
npm test         # tests for the build script
```

## Add a game

1. Copy `games/_template` to `games/your-game-name` (lowercase-with-dashes — it becomes the URL).
2. Build the game in that folder. `index.html` is the entry point; use **relative** paths
   (`game.js`, not `/game.js`). Plain HTML/CSS/JS is the default, but a game may bring anything
   it needs as long as it ends up as static files in its own folder.
3. Fill in `game.json` and delete the `"draft": true` line:

   | Field | |
   |---|---|
   | `title`, `tagline`, `emoji`, `added` | required. `added` is a date (`2026-09-19`); newest games come first and get a "new" badge for two weeks |
   | `color` | accent colour of the card (`#rrggbb`) |
   | `tags` | short labels: genre, how long it takes, "works on phones" |
   | `draft` | `true` keeps the game off the site entirely |

4. `git push`. That is the whole release process.

The home page, the "back to the arcade" link on every game, and `games.json` are generated
by `scripts/build.mjs`. A game with a missing or broken `game.json` **fails the build** —
Vercel then keeps serving the last good version instead of publishing a broken site.

## House rules for the site

- No fake reviews, star ratings or testimonials. Anywhere.
- The FAQ and the "support indie devs" note on the home page stay. The note is sincere: AI games
  are a joke, not a replacement for real game developers.

## House rules for games

- Original only. Parody a *genre* as hard as you like; never use real game names, characters,
  logos, music or art.
- **Playable and good-feeling on both PC and mobile.** Not "technically runs on a phone":
  every game gets two first-class control schemes, designed up front.
  - PC: keyboard (and mouse where it helps). Game keys must never scroll the page.
  - Mobile: touch. Nothing may depend on hover, right-click or a keyboard. For action games,
    drag-to-steer with automatic fire works well (see `games/poop-rocket`).
  - Thumb-sized buttons (about 44px or more), a play area that works in portrait, and no page
    scrolling, pinch-zoom or long-press menus during play (`touch-action: none`,
    `-webkit-touch-callout: none`, `overscroll-behavior: none`).
  - Sound: create or resume the `AudioContext` inside the first tap (iOS starts it suspended).
  - Show the instructions that fit the device, and provide on-screen pause and mute.
  - Test both before calling it done: keyboard in a desktop browser, touch on a real phone.
- No tracking, no accounts, no network calls. High scores go in `localStorage`
  under a key starting with `aag.<game-slug>.`
- Respect `prefers-reduced-motion` where it is cheap to do so.
- Short. If it takes more than five minutes it is not awful, it is just long.

## Layout

```
games/<slug>/        one folder per game (game.json + index.html + whatever it needs)
games/_template/     starting point for a new game (folders starting with _ are ignored)
site/                home page template and shared static files (css, favicon, 404)
scripts/build.mjs    builds dist/        scripts/dev.mjs   local preview server
vercel.json          tells Vercel: run the build, serve dist/
```

## Deploying (one-time setup)

1. Push this repo to GitHub.
2. vercel.com → **Add New… → Project** → import the repo. Vercel reads `vercel.json`; there is
   nothing to configure. Every push to `main` deploys; every other branch gets a preview URL.
3. Project → **Settings → Domains** → add `awfulaigames.com`, then follow Vercel's DNS
   instructions at the registrar (or buy the domain through Vercel and skip that step).

Vercel's free Hobby plan is for non-commercial sites. If the site ever runs ads, it needs Pro.
