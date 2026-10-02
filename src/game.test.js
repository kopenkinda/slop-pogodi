import test from "node:test";
import assert from "node:assert/strict";
import { EggGame } from "./game.js";

function advance(game, seconds, beforeStep = () => {}) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    beforeStep();
    game.update(1 / 60);
  }
}

test("an egg is caught only at its ramp end, with the correct basket position", () => {
  for (let lane = 0; lane < 4; lane++) {
    const events = [];
    const game = new EggGame({
      random: () => (lane + 0.1) / 4,
      onEvent: (event) => events.push(event),
    });
    game.start();
    game.move(lane);
    advance(game, 4);
    assert.equal(
      game.score,
      0,
      "basket position alone must not catch eggs early",
    );
    advance(game, 2);
    assert.equal(game.score, 1);
    assert.equal(game.misses, 0);
    assert.equal(events.find((event) => event.type === "catch").egg.lane, lane);
  }
});

test("three missed eggs end the round and restart clears the previous round", () => {
  const game = new EggGame({ random: () => 0.1 });
  game.start();
  advance(game, 20, () => {
    if (game.eggs.length) game.move((game.eggs[0].lane + 2) % 4);
  });
  assert.equal(game.state, "over");
  assert.equal(game.misses, 3);
  assert.equal(game.score, 0);
  const elapsed = game.elapsed;
  advance(game, 3);
  assert.equal(game.elapsed, elapsed);
  game.start();
  assert.equal(game.state, "playing");
  assert.equal(game.misses, 0);
  assert.equal(game.score, 0);
  assert.equal(game.eggs.length, 0);
});

test("pausing freezes egg travel and spawning, then resumes the same round", () => {
  const game = new EggGame({ random: () => 0.1 });
  game.start();
  advance(game, 2);
  game.pause();
  const eggs = structuredClone(game.eggs),
    elapsed = game.elapsed;
  advance(game, 20);
  assert.deepEqual(game.eggs, eggs);
  assert.equal(game.elapsed, elapsed);
  game.resume();
  advance(game, 0.5);
  assert.ok(game.eggs[0].progress > eggs[0].progress);
  assert.equal(game.state, "playing");
});

test("successful catches increase difficulty without losing eggs at higher speed", () => {
  const game = new EggGame({ random: () => 0.7 });
  game.start();
  const speed = game.speed,
    interval = game.spawnInterval;
  advance(game, 65, () => {
    if (game.eggs.length) game.move(game.eggs[0].lane);
  });
  assert.ok(game.score >= 30);
  assert.ok(game.speed > speed);
  assert.ok(game.spawnInterval < interval);
  assert.equal(game.misses, 0);
  assert.equal(game.state, "playing");
});
