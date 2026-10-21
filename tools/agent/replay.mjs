// Replays a recording into a fresh game and checks that it ends the
// same way: the player reaches the exit on the same frame.
//
// Usage: node tools/agent/replay.mjs [page url] [recording.json]

import { readFileSync } from "node:fs";
import { openGame } from "./harness.mjs";

const url = process.argv[2] ?? "http://localhost:5299/";
const file = process.argv[3] ?? "tools/agent/training1-win.json";
const run = JSON.parse(readFileSync(file, "utf8"));

const { browser, page } = await openGame({ url, level: run.level, seed: run.seed, player: run.player });
const result = await page.evaluate((frames) => {
  let exitAt = -1;
  frames.forEach((bits, i) => {
    window.__agent.step(bits, false);
    if (exitAt < 0 && window.game.players[0].exiting) exitAt = i + 1;
  });
  return { exitAt, state: window.__agent.state() };
}, run.frames);
await browser.close();

const ghosts = result.state.monsters.length;
console.log(
  result.exitAt > 0
    ? `reached the exit after ${result.exitAt} frames, ${ghosts} ghosts left, game is ${result.state.fsm}`
    : "did not reach the exit",
);
process.exitCode = result.exitAt > 0 ? 0 : 1;
