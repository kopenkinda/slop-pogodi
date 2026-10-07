// Time and input are kept separate from rendering so catches do not depend on frame rate.
export type GameState = "ready" | "playing" | "paused" | "over";

export interface Egg {
  id: number;
  lane: number;
  progress: number;
  golden: boolean;
}

export type GameEvent =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "spawn"; egg: Egg }
  | {
      type: "catch";
      egg: Egg;
      score: number;
      points: number;
      levelUp: boolean;
    }
  | { type: "miss"; egg: Egg }
  | { type: "over"; score: number };

export interface EggGameOptions {
  random?: () => number;
  onEvent?: (event: GameEvent) => void;
}

export class EggGame {
  random: () => number;
  onEvent: (event: GameEvent) => void;
  state: GameState = "ready";
  score = 0;
  misses = 0;
  lane = 1;
  eggs: Egg[] = [];
  nextId = 0;
  elapsed = 0;
  spawnIn = 0;
  lastLane = -1;

  constructor({ random = Math.random, onEvent = () => {} }: EggGameOptions = {}) {
    this.random = random;
    this.onEvent = onEvent;
  }

  get level(): number {
    return 1 + Math.floor(this.score / 10);
  }
  get hasEncore(): boolean {
    return this.state === "over" && this.score >= 50;
  }
  get speed(): number {
    return Math.min(0.42, 0.18 + (this.level - 1) * 0.018);
  }
  get spawnInterval(): number {
    return Math.max(0.72, 1.9 - (this.level - 1) * 0.105);
  }

  start(): void {
    this.score = 0;
    this.misses = 0;
    this.eggs = [];
    this.elapsed = 0;
    this.spawnIn = 0.6;
    this.lastLane = -1;
    this.state = "playing";
    this.onEvent({ type: "start" });
  }

  move(lane: number): void {
    if (!Number.isInteger(lane) || lane < 0 || lane > 3) return;
    this.lane = lane;
  }

  pause(): void {
    if (this.state === "playing") {
      this.state = "paused";
      this.onEvent({ type: "pause" });
    }
  }

  resume(): void {
    if (this.state === "paused") {
      this.state = "playing";
      this.onEvent({ type: "resume" });
    }
  }

  update(delta: number): void {
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

  step(dt: number): void {
    this.elapsed += dt;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      let lane = Math.floor(this.random() * 4);
      if (lane === this.lastLane)
        lane = (lane + 1 + Math.floor(this.random() * 3)) % 4;
      const egg: Egg = {
        id: this.nextId++,
        lane,
        progress: 0,
        golden: this.random() < 0.05,
      };
      this.eggs.push(egg);
      this.lastLane = lane;
      this.spawnIn += this.spawnInterval;
      this.onEvent({ type: "spawn", egg });
    }
    for (const egg of [...this.eggs]) {
      egg.progress += dt * this.speed * (egg.golden ? 2 : 1);
      // A small catch window makes moving to the basket feel forgiving.
      if (
        egg.progress >= 0.94 &&
        egg.progress <= 1.1 &&
        egg.lane === this.lane
      ) {
        this.eggs = this.eggs.filter((item) => item.id !== egg.id);
        const points = egg.golden ? 5 : 1;
        const previousLevel = this.level;
        this.score += points;
        this.onEvent({
          type: "catch",
          egg,
          score: this.score,
          points,
          levelUp: this.level > previousLevel,
        });
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
