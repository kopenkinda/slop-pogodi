import test from "node:test";
import assert from "node:assert/strict";
import { EggGame, type GameEvent } from "./game.ts";

function advance(
  game: EggGame,
  seconds: number,
  beforeStep: () => void = () => {},
): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    beforeStep();
    game.update(1 / 60);
  }
}

test("an egg is caught only at its ramp end, with the correct basket position", () => {
  for (let lane = 0; lane < 4; lane++) {
    const events: GameEvent[] = [];
    const game = new EggGame({
      random: () => (lane + 0.3) / 4,
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
    const caught = events.find((event) => event.type === "catch");
    assert.equal(caught?.type, "catch");
    assert.equal(caught?.egg.lane, lane);
  }
});

test("golden eggs use a 5% chance and travel twice as fast as white eggs", () => {
  const golden = new EggGame({ random: () => 0.049 });
  const white = new EggGame({ random: () => 0.05 });
  golden.start();
  white.start();
  advance(golden, 1.5);
  advance(white, 1.5);
  assert.equal(golden.eggs[0].golden, true);
  assert.equal(white.eggs[0].golden, false);
  assert.ok(
    Math.abs(golden.eggs[0].progress - white.eggs[0].progress * 2) < 0.0001,
  );
  golden.move(0);
  advance(golden, 1.9);
  assert.equal(golden.score, 5);
  assert.equal(golden.misses, 0);
});

test("a five-point catch reports crossing a level, and a missed golden egg costs one life", () => {
  const events: GameEvent[] = [];
  const game = new EggGame({
    random: () => 0.01,
    onEvent: (event) => events.push(event),
  });
  game.start();
  game.score = 8;
  game.move(0);
  advance(game, 3.3);
  assert.equal(game.score, 13);
  assert.equal(game.level, 2);
  const caught = events.find((event) => event.type === "catch");
  assert.equal(caught?.type, "catch");
  assert.equal(caught?.points, 5);
  assert.equal(caught?.levelUp, true);
  game.start();
  game.move(3);
  advance(game, 3.8);
  assert.equal(game.score, 0);
  assert.equal(game.misses, 1);
});

test("the bonus ending unlocks after losing with 50 points or more and resets on replay", () => {
  for (const score of [49, 50]) {
    const game = new EggGame({ random: () => 0.4 });
    game.start();
    game.score = score;
    assert.equal(game.hasEncore, false);
    advance(game, 20, () => {
      if (game.eggs.length) game.move((game.eggs[0].lane + 2) % 4);
    });
    assert.equal(game.state, "over");
    assert.equal(game.hasEncore, score >= 50);
    game.start();
    assert.equal(game.hasEncore, false);
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
