// Time and input are kept separate from rendering so catches do not depend on frame rate.
export class EggGame {
  constructor({ random = Math.random, onEvent = () => {} } = {}) {
    this.random = random;
    this.onEvent = onEvent;
    this.state = "ready";
    this.score = 0;
    this.misses = 0;
    this.lane = 1;
    this.eggs = [];
    this.nextId = 0;
    this.elapsed = 0;
    this.spawnIn = 0;
    this.lastLane = -1;
  }

  get level() {
    return 1 + Math.floor(this.score / 10);
  }
  get speed() {
    return Math.min(0.42, 0.18 + (this.level - 1) * 0.018);
  }
  get spawnInterval() {
    return Math.max(0.72, 1.9 - (this.level - 1) * 0.105);
  }

  start() {
    this.score = 0;
    this.misses = 0;
    this.eggs = [];
    this.elapsed = 0;
    this.spawnIn = 0.6;
    this.lastLane = -1;
    this.state = "playing";
    this.onEvent({ type: "start" });
  }

  move(lane) {
    if (!Number.isInteger(lane) || lane < 0 || lane > 3) return;
    this.lane = lane;
  }

  pause() {
    if (this.state === "playing") {
      this.state = "paused";
      this.onEvent({ type: "pause" });
    }
  }

  resume() {
    if (this.state === "paused") {
      this.state = "playing";
      this.onEvent({ type: "resume" });
    }
  }

  update(delta) {
    if (this.state !== "playing" || !Number.isFinite(delta) || delta <= 0)
      return;
    // Bound each simulation step to avoid crossing multiple catch windows at once.
    let remaining = Math.min(delta, 0.25);
    while (remaining > 0 && this.state === "playing") {
      const step = Math.min(remaining, 1 / 60);
      this.step(step);
      remaining -= step;
    }
  }

  step(dt) {
    this.elapsed += dt;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      let lane = Math.floor(this.random() * 4);
      if (lane === this.lastLane)
        lane = (lane + 1 + Math.floor(this.random() * 3)) % 4;
      const egg = { id: this.nextId++, lane, progress: 0 };
      this.eggs.push(egg);
      this.lastLane = lane;
      this.spawnIn += this.spawnInterval;
      this.onEvent({ type: "spawn", egg });
    }
    for (const egg of [...this.eggs]) {
      egg.progress += dt * this.speed;
      // A small catch window makes moving to the basket feel forgiving.
      if (
        egg.progress >= 0.94 &&
        egg.progress <= 1.1 &&
        egg.lane === this.lane
      ) {
        this.eggs = this.eggs.filter((item) => item.id !== egg.id);
        this.score++;
        this.onEvent({ type: "catch", egg, score: this.score });
      } else if (egg.progress > 1.1) {
        this.eggs = this.eggs.filter((item) => item.id !== egg.id);
        this.misses++;
        this.onEvent({ type: "miss", egg });
        if (this.misses >= 3) {
          this.state = "over";
          this.onEvent({ type: "over", score: this.score });
          break;
        }
      }
    }
  }
}
