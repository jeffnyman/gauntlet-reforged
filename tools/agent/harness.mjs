// Browser harness for driving the real game deterministically.
//
// It opens the game in headless Chromium with a seeded random number
// generator injected before any game script runs, boots straight into
// a level through the ?level flag, stops the engine's own loop, and
// then advances the game one fixed frame at a time with scripted input.
//
// Environment variables, for when Playwright is not installed locally:
//   PLAYWRIGHT  path to playwright's index.mjs
//   CHROMIUM    path to a Chromium executable

import { pathToFileURL } from "node:url";

const playwright = process.env.PLAYWRIGHT
  ? await import(pathToFileURL(process.env.PLAYWRIGHT).href)
  : await import("playwright");
const { chromium } = playwright.default ?? playwright;

// Input bits for one frame.
export const BIT = { up: 1, down: 2, left: 4, right: 8, fire: 16 };

// Runs in the page before any game script. Replaces Math.random with
// mulberry32, a small seeded generator, and defines the helpers the
// harness calls through page.evaluate.
function pageSetup(seed) {
  let a = seed >>> 0;
  Math.random = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // The game only rolls for a pain sound once the previous one has
  // finished playing, so audio timing, which runs on real time, changes
  // how many random numbers get drawn. Reporting every sound as
  // finished makes that roll happen every time. It only affects which
  // pain sounds overlap, not gameplay.
  Object.defineProperty(HTMLMediaElement.prototype, "ended", { get: () => true });

  window.__agent = {
    frames: [],

    // Stops the engine loop and resets its frame counter, so every
    // run starts from the same frame regardless of load time. Stopping
    // does not cancel the animation frame the loop already scheduled,
    // and that last frame may or may not advance the game depending on
    // timing. So wait for it to run while the game is still paused on
    // the level's help popup, then reset and resume.
    async takeControl() {
      window.game.runner.stop();
      for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
      window.game.runner.frame = 0;
      if (window.game.is("help")) window.game.resume();
    },

    // Applies one frame's input bits to player 1 and advances one frame.
    step(bits, draw) {
      const p = window.game.players[0];
      p.moveUp((bits & 1) !== 0);
      p.moveDown((bits & 2) !== 0);
      p.moveLeft((bits & 4) !== 0);
      p.moveRight((bits & 8) !== 0);
      p.fire((bits & 16) !== 0);
      window.game.runner.update(window.game.runner.dstep);
      this.frames.push(bits);
      if (draw) window.game.runner.draw();
    },

    // Plays recorded frames back in real time, drawing every frame.
    playback(frames, fps) {
      return new Promise((resolve) => {
        let i = 0;
        const timer = setInterval(() => {
          if (i >= frames.length) {
            clearInterval(timer);
            resolve();
            return;
          }
          this.step(frames[i++], true);
        }, 1000 / fps);
      });
    },

    // A snapshot of everything the agent needs to decide its next move.
    state() {
      const g = window.game;
      const map = g.map;
      const p = g.players[0];
      const ents = map.entities.filter((e) => e.active);
      const pick = (e) => ({ x: e.x, y: e.y });
      return {
        fsm: g.current,
        nlevel: map.nlevel,
        frame: window.game.runner.frame,
        player: {
          x: p.x,
          y: p.y,
          health: p.health,
          keys: p.keys,
          dir: p.dir,
          dead: p.dead,
          exiting: !!p.exiting,
          score: p.score,
        },
        monsters: ents.filter((e) => e.monster).map((e) => ({ ...pick(e), type: e.type.name })),
        generators: ents.filter((e) => e.generator).map((e) => ({ ...pick(e), type: e.mtype.name })),
        treasure: ents.filter((e) => e.treasure).map((e) => ({ ...pick(e), key: !!e.type.key })),
        doors: ents.filter((e) => e.door).map(pick),
        exits: ents.filter((e) => e.exit === true).map(pick),
      };
    },

    // The static map: one character per tile, '#' for walls.
    grid() {
      const map = window.game.map;
      const rows = [];
      for (let ty = 0; ty < map.th; ty++) {
        let row = "";
        for (let tx = 0; tx < map.tw; tx++) {
          const cell = map.cells[tx + ty * map.tw];
          row += !cell || cell.wall !== undefined ? "#" : cell.nothing ? " " : ".";
        }
        rows.push(row);
      }
      return { tw: map.tw, th: map.th, rows, start: map.start };
    },
  };
}

// Opens the game at `level` with `seed` and returns once the harness
// has taken control of the loop.
export async function openGame({ url, level, seed, player = "warrior", viewport }) {
  const browser = await chromium.launch(
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  );
  const page = await browser.newPage({ viewport: viewport ?? { width: 1280, height: 800 } });
  await page.addInitScript(pageSetup, seed);

  const target = new URL(url);
  target.searchParams.set("level", String(level));
  target.searchParams.set("player", player);
  await page.goto(target.href);

  await page.waitForFunction(
    () => window.game && window.game.map && window.game.is("help"),
    null,
    { timeout: 30_000 },
  );
  await page.evaluate(() => window.__agent.takeControl());

  return { browser, page };
}
