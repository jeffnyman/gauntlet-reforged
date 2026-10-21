// An agent that clears Training One: "Shoot ghosts and find the exit".
//
// Each frame it reads the game state, shoots any ghost lined up with
// it in one of the eight firing directions, and otherwise walks a
// tile path to the exit. Every frame's input is recorded together
// with the random seed, so the run can be replayed exactly.
//
// Usage: node tools/agent/agent.mjs [page url] [out.json] [seed]

import { writeFileSync } from "node:fs";
import { BIT, openGame } from "./harness.mjs";

const URL_ = process.argv[2] ?? "http://localhost:5299/";
const OUT = process.argv[3] ?? "tools/agent/training1-win.json";
const SEED = Number(process.argv[4] ?? 1);
const LEVEL = 1;
const TILE = 32;
const MAX_FRAMES = 60 * 60 * 5;
const RANGE = 7 * TILE; // how far away a lined-up ghost is worth a shot
const ALIGN = 12; // pixels of slack when deciding a ghost is lined up

const { browser, page } = await openGame({ url: URL_, level: LEVEL, seed: SEED });
const grid = await page.evaluate(() => window.__agent.grid());
const wall = (tx, ty) =>
  tx < 0 || ty < 0 || tx >= grid.tw || ty >= grid.th || grid.rows[ty][tx] === "#";

// The player's sprite is a tile; its collision box is the middle half
// horizontally and the lower three quarters vertically.
const center = (p) => ({ x: p.x + TILE / 2, y: p.y + TILE / 2 + 4 });
const tileOf = (pt) => ({ tx: Math.floor(pt.x / TILE), ty: Math.floor(pt.y / TILE) });

// Breadth-first search over tiles, eight ways, without cutting
// corners between two walls. Returns tile centers to walk through.
function route(from, to) {
  const key = (tx, ty) => ty * grid.tw + tx;
  const prev = new Map([[key(from.tx, from.ty), -1]]);
  const queue = [from];
  const steps = [
    [0, -1], [1, 0], [0, 1], [-1, 0],
    [1, -1], [1, 1], [-1, 1], [-1, -1],
  ];
  while (queue.length) {
    const t = queue.shift();
    if (t.tx === to.tx && t.ty === to.ty) break;
    for (const [dx, dy] of steps) {
      const nx = t.tx + dx;
      const ny = t.ty + dy;
      if (wall(nx, ny) || prev.has(key(nx, ny))) continue;
      if (dx && dy && (wall(t.tx + dx, t.ty) || wall(t.tx, t.ty + dy))) continue;
      prev.set(key(nx, ny), key(t.tx, t.ty));
      queue.push({ tx: nx, ty: ny });
    }
  }
  const path = [];
  for (let k = key(to.tx, to.ty); k !== -1 && prev.has(k); k = prev.get(k)) {
    path.push({ x: (k % grid.tw) * TILE + TILE / 2, y: Math.floor(k / grid.tw) * TILE + TILE / 2 });
  }
  return path.reverse();
}

// Whether a projectile flying from a to b would clear every wall. A
// projectile's collision box is a third of a tile, so each sample
// checks the corners of that box, not just its center.
function clearLine(a, b) {
  const half = TILE / 6 + 1;
  const n = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 4);
  for (let i = 1; i < n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n;
    const y = a.y + ((b.y - a.y) * i) / n;
    for (const [ox, oy] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
      const t = tileOf({ x: x + ox, y: y + oy });
      if (wall(t.tx, t.ty)) return false;
    }
  }
  return true;
}

// Input bits for a move toward (dx, dy), ignoring small offsets.
function steer(dx, dy, slack) {
  let bits = 0;
  if (dy < -slack) bits |= BIT.up;
  if (dy > slack) bits |= BIT.down;
  if (dx < -slack) bits |= BIT.left;
  if (dx > slack) bits |= BIT.right;
  return bits;
}

// A ghost lined up horizontally, vertically or diagonally within
// range and with a clear line of fire, or null. `me` is where the
// player's projectiles start: the middle of the player's tile.
function target(me, monsters, ignored) {
  let best = null;
  for (const m of monsters) {
    if (ignored.has(`${m.x},${m.y}`)) continue;
    const c = { x: m.x + TILE / 2, y: m.y + TILE / 2 };
    const dx = c.x - me.x;
    const dy = c.y - me.y;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist > RANGE) continue;
    const lined =
      Math.abs(dx) < ALIGN || Math.abs(dy) < ALIGN || Math.abs(Math.abs(dx) - Math.abs(dy)) < ALIGN;
    if (!lined || !clearLine(me, c)) continue;
    if (!best || dist < best.dist) best = { dx, dy, dist, id: `${m.x},${m.y}` };
  }
  return best;
}

const log = [];
const note = (frame, message) => {
  const line = `frame ${String(frame).padStart(5)}  ${message}`;
  log.push(line);
  console.log(line);
};

let path = [];
let lastTile = null;
let shots = 0;
// Ghosts we have shot at without effect, skipped until a given frame.
const ignored = new Map();
let firingSince = -1;
let ghostsWhenFiringStarted = 0;
let state = await page.evaluate(() => window.__agent.state());
note(state.frame, `Training One, ${state.monsters.length} ghosts, health ${state.player.health}`);

while (state.frame < MAX_FRAMES && !state.player.dead && !state.player.exiting) {
  const me = center(state.player);
  const here = tileOf(me);
  const exit = state.exits[0];
  let bits;

  for (const [id, until] of ignored) if (until <= state.frame) ignored.delete(id);
  const muzzle = { x: state.player.x + TILE / 2, y: state.player.y + TILE / 2 };
  const aim = target(muzzle, state.monsters, new Set(ignored.keys()));

  // Firing that kills nothing for a second and a half means the shots
  // are not landing. Skip that ghost for a while and keep walking.
  if (aim && firingSince >= 0 && state.frame - firingSince > 90 && state.monsters.length >= ghostsWhenFiringStarted) {
    ignored.set(aim.id, state.frame + 180);
    firingSince = -1;
  }
  if (!aim) firingSince = -1;
  else if (firingSince < 0) {
    firingSince = state.frame;
    ghostsWhenFiringStarted = state.monsters.length;
  } else if (state.monsters.length < ghostsWhenFiringStarted) {
    firingSince = state.frame;
    ghostsWhenFiringStarted = state.monsters.length;
  }

  if (aim && !ignored.has(aim.id)) {
    // Face the ghost and fire. The player cannot move while firing.
    bits = steer(aim.dx, aim.dy, ALIGN) | BIT.fire;
    shots++;
  } else {
    if (!lastTile || lastTile.tx !== here.tx || lastTile.ty !== here.ty || path.length === 0) {
      path = route(here, tileOf({ x: exit.x + TILE / 2, y: exit.y + TILE / 2 }));
      lastTile = here;
    }
    // Head for the first waypoint not yet reached.
    while (path.length > 1 && Math.hypot(path[0].x - me.x, path[0].y - me.y) < 6) path.shift();
    const next = path.length > 1 ? path[1] : path[0];
    bits = next ? steer(next.x - me.x, next.y - me.y, 2) : 0;
  }

  await page.evaluate((b) => window.__agent.step(b, false), bits);
  state = await page.evaluate(() => window.__agent.state());
  if (state.frame % 600 === 0) {
    note(state.frame, `health ${Math.round(state.player.health)}, ghosts left ${state.monsters.length}, tile ${here.tx},${here.ty}`);
  }
}

const cleared = state.player.exiting;
if (cleared) {
  note(state.frame, `reached the exit with health ${Math.round(state.player.health)}, ${state.monsters.length} ghosts left`);
  // Let the exit animation finish so the level actually completes.
  while (state.fsm === "playing" && state.frame < MAX_FRAMES) {
    await page.evaluate(() => window.__agent.step(0, false));
    state = await page.evaluate(() => window.__agent.state());
  }
  note(state.frame, `level complete, the game is now ${state.fsm} the next level`);
} else {
  note(state.frame, state.player.dead ? "the player died" : "ran out of time");
}

const frames = await page.evaluate(() => window.__agent.frames);
await browser.close();

writeFileSync(
  OUT,
  JSON.stringify({ level: LEVEL, player: "warrior", seed: SEED, cleared, frames, log }),
);
console.log(`${frames.length} frames written to ${OUT}, ${shots} frames spent firing`);
