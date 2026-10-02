# Nu, Pogodi! 3D

A playable 3D reimagining of the four-ramp egg-catching game. Built with Three.js and Vite. All models, scenery, and sound effects are generated locally in code. No model downloads or API keys are needed. The fonts are bundled locally, with their open font licenses in `public/fonts/`.

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
- White eggs earn 1 point. Golden eggs have a 5% spawn chance, travel twice as fast, and earn 5 points. A missed egg of either kind costs one life. Three misses end the round.
- The game speeds up every ten points. Best score, sound, and theme preferences are saved in this browser.
- The theme dial switches between day and night. The sun and moon orbit through the farm as its lighting changes.
- Losing with more than 50 points unlocks a short rabbit cameo. Skip it with the on-screen button, Space, or Escape.

Switching away from the page pauses the game. Opening the instructions also pauses it and returns to the same round when closed. Sound starts after a user gesture. WebGL is required.

`src/game.js` owns the gameplay rules. `src/scene.js` owns the Three.js scene. `src/main.js` connects inputs, sound, and the interface.

Inspired by the [Elektronika Nu, Pogodi! handheld](https://www.deutsche-digitale-bibliothek.de/item/3QUYS35WLMMSWZWS2NVU3E6J2X4J34VL). This is an independent fan project with original procedural artwork.

## Install on a phone

Use **Install** on the website. On iPhone, open the browser's Share menu and select **Add to Home Screen**, then **Add**. Keep **Open as Web App** enabled if offered. On Android, use the browser's install prompt or **Install app** menu item.

The installed app hides the website header, intro, instructions, and footer. It keeps the game, score, lives, large touch arrows, theme, mute, and pause controls. It supports portrait and landscape layouts and accounts for screen cutouts.

The service worker caches the game and fonts after the first online visit, so subsequent launches work offline. Updates activate after the app and any open game tabs close, avoiding a reload during a round. Test this with `npm run build` and `npm run preview`; the service worker is disabled in development.

## Deployment

[Play on GitHub Pages](https://kopenkinda.github.io/slop-pogodi/).

Every push to `main` runs the gameplay tests, builds the site, and deploys `dist/` through GitHub Actions. The Vite base path is `/slop-pogodi/` for this repository. The same path is used by the local development and preview servers.
