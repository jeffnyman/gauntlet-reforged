// Films a recording playing back in the real game, in real time.
//
// It opens the game with the recording's seed, plays the recorded
// frames back at 60 frames per second with drawing on, streams the
// page's screencast into ffmpeg, and reports whether the playback
// reached the exit on the same frame as the recording. The video has
// no sound.
//
// Environment variables, besides those in harness.mjs:
//   FFMPEG  path to an ffmpeg that can encode VP8, if not on the PATH
//
// Usage: node tools/agent/record.mjs [page url] [recording.json] [video.webm]

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { openGame } from "./harness.mjs";

const url = process.argv[2] ?? "http://localhost:5299/";
const file = process.argv[3] ?? "tools/agent/training1-win.json";
const videoPath = process.argv[4] ?? "tools/agent/training1-win.webm";
const run = JSON.parse(readFileSync(file, "utf8"));
const FPS = 30;

const ffmpeg = spawn(
  process.env.FFMPEG ?? "ffmpeg",
  [
    // These match the settings Playwright uses with its own ffmpeg build.
    "-loglevel", "error",
    "-f", "image2pipe", "-avioflags", "direct", "-fpsprobesize", "0",
    "-probesize", "32", "-analyzeduration", "0",
    "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "pipe:0",
    "-y", "-an", "-c:v", "vp8", "-qmin", "0", "-qmax", "50", "-crf", "8",
    "-deadline", "realtime", "-speed", "8", "-b:v", "4M", "-threads", "1",
    videoPath,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const encoded = new Promise((resolve, reject) => {
  ffmpeg.on("error", reject);
  ffmpeg.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
});

const { browser, page } = await openGame({
  url,
  level: run.level,
  seed: run.seed,
  player: run.player,
  viewport: { width: 1280, height: 800 },
});

// The screencast only sends frames when the page changes, so a timer
// writes the latest one at a steady rate, catching up on the wall
// clock if the timer slips.
const cdp = await page.context().newCDPSession(page);
let latest = null;
cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
  latest = Buffer.from(data, "base64");
  void cdp.send("Page.screencastFrameAck", { sessionId });
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1280, maxHeight: 800 });
let startedAt = 0;
let written = 0;
const writer = setInterval(() => {
  if (!latest) return;
  if (!startedAt) startedAt = performance.now();
  const due = Math.floor(((performance.now() - startedAt) / 1000) * FPS) + 1;
  for (; written < due; written++) ffmpeg.stdin.write(latest);
}, 1000 / FPS);

// The "click to begin" curtain waits for a click that unlocks audio.
// Hide it directly so no game handler runs.
await page.evaluate(() => {
  const curtain = document.getElementById("curtain");
  if (curtain) curtain.style.display = "none";
  window.game.runner.draw();
});
await page.waitForTimeout(500);
const exitAt = await page.evaluate(async (frames) => {
  let at = -1;
  const step = window.__agent.step.bind(window.__agent);
  window.__agent.step = (bits, draw) => {
    step(bits, draw);
    if (at < 0 && window.game.players[0].exiting) at = window.__agent.frames.length;
  };
  await window.__agent.playback(frames, 60);
  return at;
}, run.frames);
await page.waitForTimeout(1500);

clearInterval(writer);
await cdp.send("Page.stopScreencast");
await browser.close();
ffmpeg.stdin.end();
await encoded;

console.log(`saved ${videoPath}; playback reached the exit after ${exitAt} frames`);
