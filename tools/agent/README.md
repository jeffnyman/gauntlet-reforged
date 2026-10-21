# Training One agent

An agent that clears Training One ("Shoot ghosts and find the exit"), plus tools to replay and film the run. It drives the real game in headless Chromium, with no changes to the game's code.

## How it stays repeatable

| Problem | What the harness does |
| --- | --- |
| The game uses `Math.random` | Replaces it before the page loads with a generator seeded from the recording |
| The engine runs on the display's clock | Stops the engine loop once the level has loaded and steps one fixed frame at a time |
| Stopping the loop leaves one frame already scheduled | Waits for that frame to run while the level's help popup is still up, then resets the frame counter |
| A pain sound is only rolled when the last one has finished playing | Reports every sound as finished, so that roll happens every time and audio timing cannot shift the random numbers |

## Files

| File | Purpose |
| --- | --- |
| `harness.mjs` | Opens the game, takes control of the loop, and exposes step, state and playback helpers |
| `agent.mjs` | Plays Training One and writes the recording |
| `replay.mjs` | Replays a recording in a fresh game and reports the frame the exit was reached |
| `record.mjs` | Films a recording playing back in real time |
| `training1-win.json` | The recording: seed, character and one input value per frame |
| `training1-win.webm` | The video |

## Commands

Start the dev server on a known port first:

```sh
npx vite --port 5299 --strictPort
```

Then:

```sh
node tools/agent/agent.mjs  http://localhost:5299/ tools/agent/training1-win.json 1
node tools/agent/replay.mjs http://localhost:5299/ tools/agent/training1-win.json
node tools/agent/record.mjs http://localhost:5299/ tools/agent/training1-win.json tools/agent/training1-win.webm
```

Playwright is not a project dependency. Set `PLAYWRIGHT` to an installed copy's `index.mjs` and, if its browser is missing, `CHROMIUM` to a Chromium executable. Filming also needs `FFMPEG`, an ffmpeg that can encode VP8.

## Recording format

`frames` holds one number per game frame. Its bits are up 1, down 2, left 4, right 8 and fire 16. The `seed` must travel with the frames: the same frames with a different seed play a different game.
