# Nu, Pogodi! 3D

A playable 3D reimagining of the four-ramp egg-catching game. Built with Three.js and Vite. All models, scenery, and sound effects are generated locally in code. No model downloads or API keys are needed. The interface uses Google Fonts, with local system fallbacks.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

```sh
npm test       # Gameplay checks
npm run build # Production bundle in dist/
npm run preview
```

## Play

- Q / A: upper left / lower left.
- E / D: upper right / lower right.
- Arrow keys: choose a side and height.
- Touch or click the four arrow buttons to move the basket.
- Space: start or pause. Escape or P also pauses.
- Catch an egg for one point. Three misses end the round.
- The game speeds up every ten catches. Best score and sound preference are saved in this browser.

Switching away from the page pauses the game. Opening the instructions also pauses it and returns to the same round when closed. Sound starts after a user gesture. WebGL is required.

`src/game.js` owns the gameplay rules. `src/scene.js` owns the Three.js scene. `src/main.js` connects inputs, sound, and the interface.

Inspired by the [Elektronika Nu, Pogodi! handheld](https://www.deutsche-digitale-bibliothek.de/item/3QUYS35WLMMSWZWS2NVU3E6J2X4J34VL). This is an independent fan project with original procedural artwork.

## Deployment

[Play on GitHub Pages](https://kopenkinda.github.io/slop-pogodi/).

Every push to `main` runs the gameplay tests, builds the site, and deploys `dist/` through GitHub Actions. The Vite base path is `/slop-pogodi/` for this repository. The same path is used by the local development and preview servers.
