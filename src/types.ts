import type { EggGame, GameEvent } from "./game.ts";

/** The contract between the interface layer (main.ts) and the 3D scene (scene). */
export interface Farm {
  /** Animate toward day or night. The first call snaps without a transition. */
  setTheme(dark: boolean): void;
  /** Draw one frame. `encoreTime` is null outside the bonus cutscene. */
  render(game: EggGame, dt: number, time: number, encoreTime: number | null): void;
  /** React to a gameplay event (spawn, catch, miss, start, pause, resume, over). */
  event(event: GameEvent): void;
  /** Release GPU resources and observers. */
  dispose(): void;
}

export type CreateFarm = (mount: HTMLElement) => Farm;
