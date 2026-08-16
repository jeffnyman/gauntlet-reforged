#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const BUNDLES = [
  {
    out: "public/scripts/vendor.js",
    sources: [
      "public/scripts/game/vendor/sizzle.js", // http://sizzlejs.com/
      "public/scripts/game/vendor/animator.js", // http://berniesumption.com/software/animator/
      "public/scripts/game/vendor/audio-fx.js", // https://github.com/jakesgordon/javascript-audio-fx
      "public/scripts/game/vendor/state-machine.js", // https://github.com/jakesgordon/javascript-state-machine
    ],
  },
  {
    out: "public/scripts/game.js",
    sources: [
      "public/scripts/game/base.js",
      "public/scripts/game/game.js",
      "public/scripts/game/pubsub.js",
      "public/scripts/game/dom.js",
      "public/scripts/game/key.js",
      "public/scripts/game/gamepad.js",
      "public/scripts/game/math.js",
    ],
  },
];

function buildOne(bundle) {
  const content = bundle.sources
    .map((src) =>
      fs.readFileSync(path.join(root, src), "utf8").replace(/\s+$/, ""),
    )
    .join("\n\n");

  fs.writeFileSync(path.join(root, bundle.out), content + "\n");

  console.log(`built ${bundle.out} (${bundle.sources.length} files)`);
}

function buildAll() {
  BUNDLES.forEach(buildOne);
}

function watch() {
  buildAll();

  console.log("watching for changes...");

  for (const bundle of BUNDLES) {
    for (const src of bundle.sources) {
      fs.watchFile(path.join(root, src), { interval: 300 }, () => {
        try {
          buildOne(bundle);
        } catch (err) {
          console.error(err.message);
        }
      });
    }
  }
}

if (require.main === module) {
  if (process.argv.includes("--watch")) {
    watch();
  } else {
    buildAll();
  }
}

module.exports = { buildAll, buildOne, BUNDLES };
