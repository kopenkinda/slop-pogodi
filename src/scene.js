import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const palette = {
  grass: "#c3d19a",
  grassLight: "#d0dba9",
  leaf: "#8eaa6b",
  leafLight: "#a9bd80",
  wood: "#b79261",
  woodLight: "#d6b47e",
  woodDark: "#8f7350",
  straw: "#d4b56d",
  cream: "#faf4dd",
  red: "#b56b50",
  roof: "#64766a",
  wolf: "#777e81",
  muzzle: "#b8bcb3",
  dark: "#38433d",
  shirt: "#bb7f77",
  pants: "#67798b",
  egg: "#fff6dc",
  gold: "#ffc139",
};

export const LANES = [
  { start: [-4.8, 3.42, -0.75], end: [-1.45, 2.3, -0.75] },
  { start: [-4.8, 1.93, 1.5], end: [-1.45, 0.85, 1.5] },
  { start: [4.8, 3.42, -0.75], end: [1.45, 2.3, -0.75] },
  { start: [4.8, 1.93, 1.5], end: [1.45, 0.85, 1.5] },
];

export function createFarm(mount) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d4ddc0");
  scene.fog = new THREE.Fog("#d4ddc0", 35, 65);
  const camera = new THREE.OrthographicCamera(-10, 10, 5, -5, 0.1, 90);
  camera.position.set(0, 10.5, 21);
  camera.lookAt(0, 1.25, 0);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  mount.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute(
    "aria-label",
    "A 3D farm with four hens, wooden egg ramps, and a wolf holding a wicker basket. Use Q, A, E and D or the on-screen arrows to catch eggs.",
  );

  const ambient = new THREE.HemisphereLight("#fff9e4", "#8e9c73", 1.9);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight("#fff4d7", 2.7);
  sun.position.set(-7, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -13,
    right: 13,
    top: 10,
    bottom: -10,
    near: 0.1,
    far: 45,
  });
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.00015;
  sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new THREE.DirectionalLight("#eaf1dd", 0.8);
  fill.position.set(8, 6, -5);
  scene.add(fill);

  const materials = new Map();
  const geometry = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.IcosahedronGeometry(1, 1),
    smooth: new THREE.SphereGeometry(1, 16, 12),
    cone: new THREE.ConeGeometry(1, 1, 4),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
    egg: new THREE.SphereGeometry(1, 16, 12),
  };
  // Narrow the top of the egg while preserving its rounded base.
  const positions = geometry.egg.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    const taper = 1 - Math.max(0, y) * 0.23;
    positions.setXYZ(
      i,
      positions.getX(i) * taper,
      y * 1.35,
      positions.getZ(i) * taper,
    );
  }
  geometry.egg.computeVertexNormals();

  function material(color) {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.9,
          flatShading: true,
        }),
      );
    return materials.get(color);
  }
  function shape(type, color, position, scale, parent = scene, rotation) {
    const mesh = new THREE.Mesh(
      geometry[type],
      material(palette[color] || color),
    );
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const box = (c, p, s, g = scene, r) => shape("box", c, p, s, g, r);
  const ball = (c, p, s, g = scene) => shape("sphere", c, p, s, g);
  function bar(start, end, width, depth, color, parent = scene) {
    const a = new THREE.Vector3(...start),
      b = new THREE.Vector3(...end);
    const mesh = box(
      color,
      a.clone().add(b).multiplyScalar(0.5).toArray(),
      [width, a.distanceTo(b), depth],
      parent,
    );
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.sub(a).normalize(),
    );
    return mesh;
  }
  function ring(radius, tube, color, parent, position, scale = [1, 1, 1]) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 5, 24),
      material(palette[color] || color),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function seeded(seed) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  const rand = seeded(52);

  // Combine objects that move together to keep the farm inexpensive to draw.
  function batchStatic(parent, excluded = new Set()) {
    parent.updateWorldMatrix(true, true);
    const inverse = parent.matrixWorld.clone().invert();
    const batches = new Map();
    function collect(object) {
      if (excluded.has(object)) return;
      if (object.isMesh) {
        const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push(object);
      }
      for (const child of object.children) collect(child);
    }
    for (const child of parent.children) collect(child);
    for (const meshes of batches.values()) {
      if (meshes.length < 2) continue;
      const pieces = meshes.map((mesh) => {
        const piece = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        if (!piece.attributes.uv)
          piece.setAttribute(
            "uv",
            new THREE.BufferAttribute(
              new Float32Array(piece.attributes.position.count * 2),
              2,
            ),
          );
        return piece.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
      });
      const merged = new THREE.Mesh(
        mergeGeometries(pieces),
        meshes[0].material,
      );
      merged.castShadow = meshes[0].castShadow;
      merged.receiveShadow = meshes[0].receiveShadow;
      for (const mesh of meshes) mesh.removeFromParent();
      pieces.forEach((piece) => piece.dispose());
      parent.add(merged);
    }
  }

  // The meadow is a little raised diorama, with a soft, uninterrupted horizon.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    material("#d4ddc0"),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.52;
  ground.receiveShadow = true;
  scene.add(ground);
  const island = shape("cylinder", "grass", [0, -0.27, 0], [8.9, 0.45, 5.4]);
  island.geometry = new THREE.CylinderGeometry(1, 1.025, 1, 64);
  const dirt = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    material("#d6d6ac"),
  );
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.set(0, -0.025, 1.2);
  dirt.scale.set(4.8, 3.0, 1);
  dirt.receiveShadow = true;
  scene.add(dirt);

  function tree(x, z, size = 1) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.scale.setScalar(size);
    scene.add(group);
    shape("cylinder", "woodDark", [0, 1.2, 0], [0.13, 2.4, 0.13], group);
    bar([0, 1.8, 0], [0.55, 2.5, 0], 0.12, 0.12, "woodDark", group);
    ball("leaf", [0, 2.7, 0], [1.15, 1.35, 1.03], group);
    ball("leafLight", [-0.43, 3.1, 0.25], [0.9, 1, 0.92], group);
    ball("#9fb97a", [0.6, 2.65, 0.1], [0.8, 0.95, 0.8], group);
    return group;
  }
  tree(-7.0, -2.5, 1.15);
  tree(7.0, -3.2, 1.23);
  tree(-4.4, -4.1, 0.73);
  tree(4.6, -4.7, 0.83);

  // Rear barn, deliberately low so the four catching lanes remain readable.
  const barn = new THREE.Group();
  barn.position.set(0.1, 0, -3.7);
  scene.add(barn);
  box("red", [0, 1.15, 0], [3.1, 2.3, 2.25], barn);
  for (let i = -1.4; i < 1.5; i += 0.28)
    box("#c18061", [i, 1.15, 1.135], [0.025, 2.25, 0.015], barn);
  const gableGeometry = new THREE.BufferGeometry();
  gableGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-1.55, 2.3, 1.13, 1.55, 2.3, 1.13, 0, 3.35, 1.13],
      3,
    ),
  );
  gableGeometry.computeVertexNormals();
  const gable = new THREE.Mesh(gableGeometry, material("#b56b50"));
  barn.add(gable);
  box("roof", [-0.83, 2.88, 0], [2.05, 0.16, 2.75], barn, [0, 0, 0.58]);
  box("roof", [0.83, 2.88, 0], [2.05, 0.16, 2.75], barn, [0, 0, -0.58]);
  box("#eef0d8", [0, 1.05, 1.18], [1.48, 2.1, 0.07], barn);
  box("#6f7d68", [0, 0.97, 1.23], [1.24, 1.92, 0.07], barn);
  box("#edf0d6", [0, 1, 1.28], [0.055, 1.9, 0.04], barn);
  bar([-0.56, 0.06, 1.29], [0.56, 1.88, 1.29], 0.06, 0.04, "#d9ddc0", barn);
  bar([0.56, 0.06, 1.29], [-0.56, 1.88, 1.29], 0.06, 0.04, "#d9ddc0", barn);
  box("#ece9cf", [0, 2.63, 1.15], [0.5, 0.43, 0.06], barn);
  box("#626f5d", [0, 2.63, 1.2], [0.34, 0.29, 0.025], barn);
  box("cream", [0, 2.63, 1.23], [0.04, 0.29, 0.015], barn);
  box("cream", [0, 2.63, 1.23], [0.34, 0.035, 0.015], barn);
  box("#dbdec4", [-1.5, 1.1, 1.19], [0.1, 2.2, 0.08], barn);
  box("#dbdec4", [1.5, 1.1, 1.19], [0.1, 2.2, 0.08], barn);

  function fence(x1, x2, z, height = 0.85) {
    const count = Math.ceil(Math.abs(x2 - x1) / 0.62);
    for (let i = 0; i <= count; i++) {
      const x = x1 + ((x2 - x1) * i) / count;
      box("#dedcba", [x, height / 2, z], [0.13, height, 0.12]);
      shape(
        "cone",
        "#dedcba",
        [x, height + 0.06, z],
        [0.092, 0.13, 0.092],
        scene,
        [0, Math.PI / 4, 0],
      );
    }
    box(
      "#d0ceaa",
      [(x1 + x2) / 2, height * 0.4, z - 0.035],
      [Math.abs(x2 - x1), 0.11, 0.1],
    );
    box(
      "#d0ceaa",
      [(x1 + x2) / 2, height * 0.79, z - 0.035],
      [Math.abs(x2 - x1), 0.11, 0.1],
    );
  }
  fence(-7.3, -2.05, -3.1);
  fence(2.1, 7.5, -3.1);
  fence(-7.3, -4.1, 3.5, 0.7);
  fence(4.1, 7.3, 3.5, 0.7);

  for (let i = 0; i < 48; i++) {
    const x = (rand() - 0.5) * 15.8,
      z = (rand() - 0.5) * 8.6;
    if (Math.abs(x) < 4.2 && z > -2.5 && z < 3.8) continue;
    const size = 0.07 + rand() * 0.1;
    shape(
      "cone",
      i % 3 ? "#9bb678" : "#aec58b",
      [x, size / 2, z],
      [size * 0.4, size * 1.7, size * 0.4],
      scene,
      [0, rand() * 4, 0.2],
    );
    if (i % 5 === 0) {
      shape("cylinder", "#82935f", [x + 0.1, 0.13, z], [0.015, 0.26, 0.015]);
      ball(
        i % 2 ? "#faf0c1" : "#d2ad58",
        [x + 0.1, 0.28, z],
        [0.055, 0.04, 0.055],
      );
    }
  }
  for (const [x, z, s] of [
    [-6.7, 2.3, 0.5],
    [6.7, 0.3, 0.45],
    [3.3, -3, 0.45],
    [-2.8, -3.8, 0.5],
    [7, 1.9, 0.35],
  ]) {
    ball("leaf", [x, s * 0.45, z], [s, s * 0.7, s * 0.85]);
    ball(
      "leafLight",
      [x + s * 0.5, s * 0.45, z + 0.1],
      [s * 0.6, s * 0.6, s * 0.6],
    );
  }
  // A few farmyard details: stacked hay, a water trough, stepping stones, and a sign.
  for (const [x, y, z] of [
    [3.55, 0.32, -2.2],
    [4.25, 0.32, -2.2],
    [3.9, 0.9, -2.2],
  ]) {
    box("straw", [x, y, z], [0.69, 0.58, 0.65]);
    box("#b69c5b", [x, y + 0.005, z], [0.045, 0.6, 0.67]);
  }
  shape("cylinder", "#91a298", [-3.2, 0.28, -2.1], [0.42, 0.55, 0.42]);
  shape("cylinder", "#adc8bf", [-3.2, 0.565, -2.1], [0.355, 0.015, 0.355]);
  ring(0.4, 0.025, "#d1d6c2", scene, [-3.2, 0.57, -2.1]);
  for (let i = 0; i < 5; i++) {
    const stone = shape(
      "cylinder",
      "#c2c3a7",
      [Math.sin(i) * 0.22, 0.01, -2 + i * 0.58],
      [0.25 + rand() * 0.1, 0.06, 0.2],
    );
    stone.rotation.y = i;
  }
  const sign = new THREE.Group();
  sign.position.set(3.1, 0, 3.15);
  sign.rotation.y = -0.15;
  scene.add(sign);
  box("woodDark", [0, 0.46, 0], [0.08, 0.9, 0.08], sign);
  box("woodLight", [0, 0.94, 0], [1.02, 0.45, 0.1], sign, [0, 0, -0.07]);
  const signCanvas = document.createElement("canvas");
  signCanvas.width = 256;
  signCanvas.height = 112;
  const ctx = signCanvas.getContext("2d");
  ctx.fillStyle = "#675a3e";
  ctx.font = "bold 27px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("THE COOP", 128, 52);
  ctx.font = "17px sans-serif";
  ctx.fillText("fresh eggs daily", 128, 82);
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const signFace = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.41),
    new THREE.MeshBasicMaterial({ map: signTexture, transparent: true }),
  );
  signFace.position.set(0, 0.94, 0.061);
  signFace.rotation.z = -0.07;
  sign.add(signFace);

  const hens = [];
  function chicken(parent, position, direction) {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.y = direction;
    parent.add(group);
    ball("cream", [0, 0.24, 0], [0.38, 0.37, 0.44], group);
    ball("#e6e6cf", [-0.31, 0.21, 0.015], [0.14, 0.25, 0.31], group);
    ball("#fff7e5", [0.31, 0.21, 0.015], [0.14, 0.25, 0.31], group);
    ball("cream", [0, 0.53, 0.25], [0.245, 0.27, 0.26], group);
    for (let i = 0; i < 3; i++)
      ball(
        "#c26b48",
        [0, 0.79 + (i === 1 ? 0.025 : -0.015), 0.12 + i * 0.1],
        [0.063, 0.12, 0.075],
        group,
      );
    const beak = shape(
      "cone",
      "#dfaa49",
      [0, 0.5, 0.52],
      [0.12, 0.24, 0.12],
      group,
      [Math.PI / 2, 0, 0],
    );
    beak.rotation.z = Math.PI / 4;
    ball("#c56c4a", [0, 0.37, 0.46], [0.073, 0.1, 0.07], group);
    ball("dark", [-0.19, 0.58, 0.4], [0.028, 0.037, 0.027], group);
    ball("dark", [0.19, 0.58, 0.4], [0.028, 0.037, 0.027], group);
    for (const side of [-1, 0, 1]) {
      const feather = ball(
        "#e5e8d2",
        [side * 0.1, 0.43, -0.38],
        [0.1, 0.28, 0.12],
        group,
      );
      feather.rotation.x = -0.55;
      feather.rotation.z = -side * 0.25;
    }
    batchStatic(group);
    return group;
  }

  for (let i = 0; i < 4; i++) {
    const lane = LANES[i],
      side = i < 2 ? -1 : 1;
    const [sx, sy, sz] = lane.start,
      [ex, ey, ez] = lane.end;
    const cx = side * 5.25;
    for (const offset of [-0.42, 0.42])
      box(
        "woodDark",
        [cx + offset, (sy - 0.1) / 2, sz - 0.16],
        [0.12, sy - 0.1, 0.13],
      );
    box("woodLight", [cx, sy - 0.14, sz], [1.35, 0.15, 1.05]);
    box("wood", [cx + side * 0.57, sy + 0.38, sz - 0.31], [0.11, 1.0, 0.85]);
    box("wood", [cx, sy + 0.33, sz - 0.44], [1.15, 0.85, 0.1]);
    box("#cab083", [cx, sy + 0.9, sz - 0.05], [1.48, 0.13, 1.3], scene, [
      0,
      0,
      -side * 0.08,
    ]);
    // Straw nest and a white hen facing the middle of the scene.
    shape("cylinder", "straw", [cx, sy, sz], [0.47, 0.13, 0.4]);
    ring(0.37, 0.065, "straw", scene, [cx, sy + 0.065, sz], [1.2, 1, 1]);
    const hen = chicken(scene, [cx, sy + 0.03, sz], -side * 0.9);
    hens.push({ mesh: hen, y: sy + 0.03, excitement: 0 });
    // Open troughs with side rails, a wooden floor, and visible cross slats.
    bar([sx, sy - 0.1, sz], [ex, ey - 0.1, ez], 0.105, 0.49, "woodLight");
    for (const zOffset of [-0.28, 0.28])
      bar(
        [sx, sy + 0.07, sz + zOffset],
        [ex, ey + 0.07, ez + zOffset],
        0.17,
        0.06,
        "wood",
      );
    for (let j = 0; j <= 8; j++) {
      const t = j / 8;
      box(
        "#ac8a5c",
        [sx + (ex - sx) * t, sy + (ey - sy) * t - 0.031, sz],
        [0.038, 0.032, 0.47],
      );
    }
    bar(
      [side * 4.7, 0.05, sz - 0.08],
      [side * 3.65, sy - 0.52, sz - 0.08],
      0.09,
      0.09,
      "woodDark",
    );
    // Numbered brass plate at the mouth of each chute.
    box(
      "#9c865d",
      [ex + side * 0.18, ey - 0.17, ez + 0.3],
      [0.28, 0.16, 0.015],
    );
  }

  batchStatic(scene, new Set(hens.map((hen) => hen.mesh)));

  const nightSky = new THREE.Group();
  scene.add(nightSky);
  const moon = new THREE.Mesh(
    geometry.smooth,
    new THREE.MeshBasicMaterial({ color: "#e1e9cc" }),
  );
  moon.scale.setScalar(0.28);
  scene.add(moon);
  const sunOrb = new THREE.Mesh(
    geometry.smooth,
    new THREE.MeshBasicMaterial({ color: "#ffd270" }),
  );
  sunOrb.scale.setScalar(0.28);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.035, 5, 32),
    new THREE.MeshBasicMaterial({
      color: "#edbd5a",
      transparent: true,
      opacity: 0.5,
    }),
  );
  sunOrb.add(halo);
  scene.add(sunOrb);
  const stars = new Float32Array(36 * 3);
  for (let i = 0; i < 36; i++)
    stars.set([(rand() - 0.5) * 16, 3.0 + rand() * 1.1, -4.7], i * 3);
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: "#dce9ee",
    size: 0.045,
    sizeAttenuation: true,
    transparent: true,
  });
  nightSky.add(new THREE.Points(starGeometry, starMaterial));
  const windowLight = new THREE.PointLight("#ffc276", 3, 5);
  windowLight.position.set(0, 2.6, -2.1);
  nightSky.add(windowLight);
  nightSky.visible = false;

  let themeInitialized = false,
    nightAmount = 0,
    nightStart = 0,
    nightTarget = 0;
  let orbit = 0,
    orbitStart = 0,
    orbitTarget = 0,
    themeElapsed = 1.5;
  const mixedColor = new THREE.Color();
  function paintDaylight() {
    const blend = (color, day, night) =>
      color.set(day).lerp(mixedColor.set(night), nightAmount);
    blend(scene.background, "#d4ddc0", "#14212f");
    scene.fog.color.copy(scene.background);
    ground.material.color.copy(scene.background);
    blend(ambient.color, "#fff9e4", "#91b3dc");
    blend(ambient.groundColor, "#8e9c73", "#25394d");
    ambient.intensity = THREE.MathUtils.lerp(1.9, 0.95, nightAmount);
    blend(sun.color, "#fff4d7", "#9dc5ff");
    sun.intensity = THREE.MathUtils.lerp(2.7, 1.15, nightAmount);
    blend(fill.color, "#eaf1dd", "#bdccb0");
    fill.intensity = THREE.MathUtils.lerp(0.8, 0.3, nightAmount);
    material("#626f5d").emissive.set("#ffd48d");
    material("#626f5d").emissiveIntensity = 1.3 * nightAmount;
    material(palette.egg).emissive.set("#8499b3");
    material(palette.egg).emissiveIntensity = 0.2 * nightAmount;
    nightSky.visible = nightAmount > 0.001;
    starMaterial.opacity = nightAmount;
    windowLight.intensity = 3 * nightAmount;
    // Both bodies travel around the same circle, half a turn apart.
    const angle = 2.3 + orbit;
    sunOrb.position.set(Math.cos(angle) * 4, 0.3 + Math.sin(angle) * 4, -4.4);
    moon.position.set(
      Math.cos(angle + Math.PI) * 4,
      0.3 + Math.sin(angle + Math.PI) * 4,
      -4.4,
    );
    sunOrb.visible = sunOrb.position.y > 0.1;
    moon.visible = moon.position.y > 0.1;
  }

  const goldMaterial = material(palette.gold);
  goldMaterial.metalness = 0.45;
  goldMaterial.roughness = 0.28;
  goldMaterial.emissive.set("#d58a08");
  goldMaterial.emissiveIntensity = 0.45;

  const wolf = new THREE.Group();
  wolf.position.set(-0.16, 0, 1.12);
  scene.add(wolf);
  const torso = new THREE.Group();
  wolf.add(torso);
  // Big paws, loose trousers, and the pink shirt of the original cartoon wolf.
  ball("dark", [-0.27, 0.17, 0.16], [0.25, 0.16, 0.38], torso);
  ball("dark", [0.27, 0.17, 0.16], [0.25, 0.16, 0.38], torso);
  bar([-0.25, 0.27, 0], [-0.2, 0.85, 0], 0.29, 0.32, "pants", torso);
  bar([0.25, 0.27, 0], [0.2, 0.85, 0], 0.29, 0.32, "pants", torso);
  ball("pants", [0, 0.83, 0], [0.42, 0.35, 0.3], torso);
  const body = shape(
    "cylinder",
    "shirt",
    [0, 1.34, 0],
    [0.4, 0.86, 0.3],
    torso,
  );
  body.geometry = new THREE.CylinderGeometry(0.88, 1, 1, 8);
  box("#dbc5a8", [0, 0.96, 0.012], [0.75, 0.09, 0.56], torso);
  box("dark", [0.03, 0.96, 0.313], [0.13, 0.115, 0.03], torso);
  shape("cylinder", "wolf", [0, 1.91, 0], [0.18, 0.5, 0.17], torso);
  const head = new THREE.Group();
  head.position.set(0, 2.14, 0.02);
  torso.add(head);
  ball("wolf", [0, 0.23, 0], [0.42, 0.47, 0.38], head);
  ball("wolf", [-0.36, 0.08, 0.02], [0.16, 0.24, 0.23], head);
  ball("wolf", [0.36, 0.08, 0.02], [0.16, 0.24, 0.23], head);
  for (const side of [-1, 1]) {
    shape("cone", "wolf", [side * 0.28, 0.75, -0.03], [0.2, 0.6, 0.18], head, [
      0,
      0,
      -side * 0.18,
    ]);
    shape(
      "cone",
      "#b6a29b",
      [side * 0.28, 0.75, 0.088],
      [0.095, 0.36, 0.035],
      head,
      [0, 0, -side * 0.18],
    );
    ball("#f2ecdc", [side * 0.155, 0.36, 0.32], [0.137, 0.177, 0.075], head);
    ball("dark", [side * 0.137, 0.33, 0.388], [0.047, 0.079, 0.035], head);
    ball(
      "#fff9e6",
      [side * 0.137 - 0.013, 0.363, 0.415],
      [0.016, 0.022, 0.012],
      head,
    );
    box("#414c49", [side * 0.17, 0.53, 0.335], [0.22, 0.065, 0.055], head, [
      0,
      0,
      side * 0.15,
    ]);
  }
  ball("muzzle", [0, 0.085, 0.37], [0.28, 0.21, 0.36], head);
  ball("#343f3b", [0, 0.15, 0.68], [0.185, 0.12, 0.12], head);
  box("#53605a", [0, -0.015, 0.57], [0.26, 0.025, 0.16], head);
  box(
    "#f5ecd6",
    [-0.115, -0.045, 0.59],
    [0.055, 0.09, 0.06],
    head,
    [0, 0, -0.1],
  );
  for (let i = 0; i < 3; i++)
    shape(
      "cone",
      "#4e5c55",
      [-0.15 + i * 0.13, 0.65, -0.18],
      [0.13, 0.24, 0.12],
      head,
      [-0.5, 0, -0.28],
    );
  // The tail peeks out at the side instead of being hidden behind the body.
  const tail = bar(
    [0.23, 0.82, -0.12],
    [0.87, 0.56, -0.24],
    0.23,
    0.24,
    "wolf",
    torso,
  );
  ball("muzzle", [0.92, 0.54, -0.25], [0.15, 0.14, 0.15], torso);

  const basket = new THREE.Group();
  scene.add(basket);
  const basketBody = shape(
    "cylinder",
    "#ba8f52",
    [0, -0.18, 0],
    [0.51, 0.39, 0.39],
    basket,
  );
  basketBody.geometry = new THREE.CylinderGeometry(1, 0.76, 1, 18, 1, true);
  basketBody.material = material("#ba8f52").clone();
  basketBody.material.side = THREE.DoubleSide;
  shape("cylinder", "#8c723f", [0, -0.36, 0], [0.39, 0.035, 0.3], basket);
  for (let i = 0; i < 4; i++)
    ring(
      0.45 - i * 0.026,
      0.028,
      i % 2 ? "#c4a168" : "#d3b57b",
      basket,
      [0, -0.045 - i * 0.085, 0],
      [1.12, 0.82, 1],
    );
  for (let i = 0; i < 14; i++) {
    const a = (i * Math.PI * 2) / 14;
    bar(
      [Math.sin(a) * 0.37, -0.35, Math.cos(a) * 0.28],
      [Math.sin(a) * 0.5, -0.035, Math.cos(a) * 0.37],
      0.025,
      0.025,
      "#d4b681",
      basket,
    );
  }
  ring(0.47, 0.047, "#d6b67a", basket, [0, 0, 0], [1.1, 0.82, 1]);
  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.037, 5, 18, Math.PI),
    material("#b99155"),
  );
  handle.position.set(0, -0.01, -0.13);
  basket.add(handle);
  batchStatic(basket);
  batchStatic(head);
  const armLeft = bar([0, 0, 0], [0, 1, 0], 0.16, 0.16, "wolf");
  const armRight = bar([0, 0, 0], [0, 1, 0], 0.16, 0.16, "wolf");
  const sleeveLeft = ball("shirt", [-0.4, 1.6, 1.1], [0.21, 0.24, 0.22]);
  const sleeveRight = ball("shirt", [0.4, 1.6, 1.1], [0.21, 0.24, 0.22]);
  const pawLeft = ball("wolf", [0, 0, 0], [0.13, 0.14, 0.14]);
  const pawRight = ball("wolf", [0, 0, 0], [0.13, 0.14, 0.14]);
  const targetBasket = new THREE.Vector3();
  const targetWolf = new THREE.Vector3();
  basket.position.set(-1.45, 0.95, 1.5);

  // A small, original rabbit cameo for the bonus ending.
  const rabbit = new THREE.Group();
  scene.add(rabbit);
  for (const side of [-1, 1]) {
    ball("#e1e0cb", [side * 0.19, 0.12, 0.16], [0.19, 0.12, 0.27], rabbit);
    ball("#dbe1ca", [side * 0.29, 0.76, 0.18], [0.12, 0.25, 0.13], rabbit);
  }
  ball("#79a889", [0, 0.68, 0], [0.33, 0.45, 0.25], rabbit);
  ball("#dce0cd", [0, 1.27, 0.02], [0.34, 0.35, 0.3], rabbit);
  ball("#f0eedb", [0, 1.1, 0.28], [0.22, 0.14, 0.13], rabbit);
  ball("#c98983", [0, 1.2, 0.35], [0.065, 0.045, 0.045], rabbit);
  ball("#f0edda", [0, 0.48, -0.27], [0.16, 0.16, 0.16], rabbit);
  for (const side of [-1, 1]) {
    const ear = ball(
      "#dce0cd",
      [side * 0.17, 1.9, -0.03],
      [0.115, 0.48, 0.11],
      rabbit,
    );
    ear.rotation.z = -side * 0.12;
    const inner = ball(
      "#cfa39b",
      [side * 0.17, 1.92, 0.06],
      [0.055, 0.33, 0.035],
      rabbit,
    );
    inner.rotation.z = -side * 0.12;
    ball("cream", [side * 0.135, 1.36, 0.27], [0.1, 0.13, 0.045], rabbit);
    ball("dark", [side * 0.125, 1.35, 0.307], [0.035, 0.065, 0.025], rabbit);
    box("cream", [side * 0.045, 1.035, 0.355], [0.07, 0.12, 0.04], rabbit);
  }
  batchStatic(rabbit);
  rabbit.visible = false;

  const eggMeshes = new Map(),
    particles = [],
    fallingEggs = [];
  function eggMesh(golden = false) {
    const size = golden ? 0.19 : 0.155;
    const mesh = shape(
      "egg",
      golden ? "gold" : "egg",
      [0, 0, 0],
      [size, size, size],
    );
    if (golden) {
      const sparkles = new THREE.Group();
      mesh.add(sparkles);
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        shape(
          "sphere",
          "gold",
          [Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, 0.15],
          [0.12, 0.2, 0.12],
          sparkles,
        );
      }
    }
    return mesh;
  }
  const gift = eggMesh(true);
  gift.visible = false;
  let encoreCelebrated = false;
  const previewEggs = [0, 1, 2, 3].map((lane, i) => ({
    mesh: eggMesh(i === 2),
    lane,
    offset: [0.38, 0.68, 0.72, 0.18][i],
  }));
  let catchBounce = 0,
    missShake = 0;
  function moveArm(mesh, from, to) {
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.set(0.16, from.distanceTo(to), 0.16);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
  }
  function eggPosition(mesh, lane, t, time) {
    const { start, end } = LANES[lane];
    mesh.position.set(
      THREE.MathUtils.lerp(start[0], end[0], t),
      THREE.MathUtils.lerp(start[1], end[1], t) + 0.2,
      start[2],
    );
    if (t > 1) mesh.position.y -= Math.pow((t - 1) * 8, 2) * 0.1;
    mesh.rotation.set(time * 2, 0, time * (lane < 2 ? -2.6 : 2.6));
  }
  function burst(pos, caught, golden = false) {
    for (let i = 0; i < (golden ? 14 : caught ? 5 : 9); i++) {
      const mesh = ball(
        golden ? "gold" : caught ? "#efd389" : i % 2 ? "egg" : "#e5b148",
        [pos[0], pos[1] + 0.2, pos[2]],
        [caught ? 0.045 : 0.075, 0.05, 0.05],
      );
      particles.push({
        mesh,
        velocity: new THREE.Vector3(
          (rand() - 0.5) * 2,
          1 + rand() * 1.4,
          (rand() - 0.5) * 1.5,
        ),
        life: 0.75,
        caught,
      });
    }
  }

  function resize() {
    const w = mount.clientWidth,
      h = mount.clientHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    // On phones, keep all four chutes visible rather than cropping the play area.
    const width = Math.max(14.0, 9.5 * aspect);
    const height = width / aspect;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    camera.setViewOffset(w, h, 0, aspect < 1.2 ? h * 0.1 : -h * 0.035, w, h);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(mount);
  resize();

  return {
    setTheme(dark) {
      const next = dark ? 1 : 0;
      if (!themeInitialized || reducedMotion) {
        themeInitialized = true;
        nightAmount = nightTarget = next;
        orbit = orbitTarget = dark ? Math.PI : 0;
        themeElapsed = 1.5;
        paintDaylight();
      } else if (next !== nightTarget) {
        nightStart = nightAmount;
        nightTarget = next;
        orbitStart = orbit;
        orbitTarget += Math.PI;
        themeElapsed = 0;
      }
    },
    render(game, dt, time, encoreTime = null) {
      if (themeElapsed < 1.5) {
        themeElapsed = Math.min(1.5, themeElapsed + dt);
        const ease = THREE.MathUtils.smoothstep(themeElapsed, 0, 1.5);
        nightAmount = THREE.MathUtils.lerp(nightStart, nightTarget, ease);
        orbit = THREE.MathUtils.lerp(orbitStart, orbitTarget, ease);
        paintDaylight();
      }
      const encore = encoreTime !== null;
      const movieTime = reducedMotion && encore ? 6 : encoreTime;
      const idle = game.state === "ready";
      const animate = game.state === "playing" || idle;
      const smoothing = 1 - Math.exp(-dt * 17);
      const lane = LANES[game.lane];
      targetBasket.set(lane.end[0], lane.end[1] + 0.09, lane.end[2]);
      if (encore) targetBasket.set(0, 1.3, 2.35);
      basket.position.lerp(targetBasket, smoothing);
      catchBounce = Math.max(0, catchBounce - dt * 4);
      basket.rotation.z =
        (game.lane < 2 ? -0.05 : 0.05) + Math.sin(catchBounce * Math.PI) * 0.1;
      targetWolf.set(game.lane < 2 ? -0.25 : 0.25, 0, 1.12);
      if (encore) targetWolf.set(-0.15, 0, 1.65);
      wolf.position.lerp(targetWolf, smoothing);
      const cheer =
        encore && movieTime > 5.4 && !reducedMotion
          ? Math.abs(Math.sin((movieTime - 5.4) * 5)) * 0.08
          : 0;
      const breathe =
        cheer + (!reducedMotion && animate ? Math.sin(time * 2.5) * 0.025 : 0);
      torso.position.y = breathe;
      torso.rotation.z = THREE.MathUtils.lerp(
        torso.rotation.z,
        encore ? 0 : game.lane < 2 ? -0.065 : 0.065,
        smoothing,
      );
      head.rotation.y = THREE.MathUtils.lerp(
        head.rotation.y,
        encore ? 0.25 : game.lane < 2 ? -0.27 : 0.27,
        smoothing,
      );
      tail.rotation.z +=
        !reducedMotion && animate ? Math.sin(time * 3) * 0.0009 : 0;
      head.rotation.x =
        encore && movieTime > 3.2 && movieTime < 5.4 ? -0.16 : 0;
      rabbit.visible = gift.visible = encore;
      if (encore) {
        const arrival = THREE.MathUtils.smoothstep(movieTime, 0.8, 3.2);
        rabbit.position.set(
          6.8 - arrival * 5.1,
          arrival > 0 && arrival < 1 && !reducedMotion
            ? Math.abs(Math.sin(movieTime * 10)) * 0.2
            : 0,
          2.4,
        );
        rabbit.rotation.set(
          0,
          -0.35,
          !reducedMotion && movieTime > 5.4
            ? Math.sin((movieTime - 5.4) * 3) * 0.08
            : 0,
        );
        const toss = THREE.MathUtils.clamp((movieTime - 3.2) / 2.2, 0, 1);
        gift.scale.setScalar(0.32);
        gift.position.set(
          THREE.MathUtils.lerp(rabbit.position.x - 0.3, 0, toss),
          THREE.MathUtils.lerp(1.1, 1.5, toss) + Math.sin(toss * Math.PI) * 2,
          2.5,
        );
        gift.rotation.z = reducedMotion ? 0 : toss * Math.PI * 2;
        if (movieTime >= 5.4 && !encoreCelebrated) {
          encoreCelebrated = true;
          if (!reducedMotion) burst([0, 1.6, 2.35], true, true);
        }
      } else encoreCelebrated = false;
      const zoom = encore && !reducedMotion ? 1.3 : 1;
      if (Math.abs(camera.zoom - zoom) > 0.001) {
        camera.zoom = THREE.MathUtils.lerp(camera.zoom, zoom, smoothing * 0.15);
        camera.updateProjectionMatrix();
      }
      const leftShoulder = new THREE.Vector3(
        wolf.position.x - 0.36,
        1.65 + breathe,
        wolf.position.z,
      );
      const rightShoulder = new THREE.Vector3(
        wolf.position.x + 0.36,
        1.65 + breathe,
        wolf.position.z,
      );
      const leftHand = basket.position
        .clone()
        .add(new THREE.Vector3(-0.37, -0.1, 0.16));
      const rightHand = basket.position
        .clone()
        .add(new THREE.Vector3(0.37, -0.1, 0.16));
      moveArm(armLeft, leftShoulder, leftHand);
      moveArm(armRight, rightShoulder, rightHand);
      sleeveLeft.position.copy(leftShoulder);
      sleeveRight.position.copy(rightShoulder);
      pawLeft.position.copy(leftHand);
      pawRight.position.copy(rightHand);
      for (let i = 0; i < hens.length; i++) {
        const hen = hens[i];
        hen.excitement = Math.max(0, hen.excitement - dt * 2);
        hen.mesh.position.y =
          hen.y +
          (!reducedMotion && animate ? Math.sin(time * 2 + i * 2) * 0.025 : 0) +
          Math.sin(hen.excitement * Math.PI) * 0.12 +
          cheer * 1.5;
      }
      for (const preview of previewEggs) {
        preview.mesh.visible = idle;
        if (idle)
          eggPosition(
            preview.mesh,
            preview.lane,
            reducedMotion
              ? preview.offset
              : (time * 0.055 + preview.offset) % 0.9,
            time,
          );
      }
      const liveIds = new Set(game.eggs.map((egg) => egg.id));
      for (const [id, mesh] of eggMeshes)
        if (!liveIds.has(id)) {
          scene.remove(mesh);
          eggMeshes.delete(id);
        }
      for (const egg of game.eggs) {
        if (!eggMeshes.has(egg.id)) eggMeshes.set(egg.id, eggMesh(egg.golden));
        eggMeshes.get(egg.id).visible = !encore;
        eggPosition(
          eggMeshes.get(egg.id),
          egg.lane,
          egg.progress,
          game.elapsed * (egg.golden ? 2 : 1),
        );
      }
      for (let i = fallingEggs.length - 1; i >= 0; i--) {
        if (game.state === "paused") continue;
        const egg = fallingEggs[i];
        egg.velocity.y -= dt * 7;
        egg.mesh.position.addScaledVector(egg.velocity, dt);
        egg.mesh.rotation.z += dt * 3;
        if (egg.mesh.position.y <= 0.14) {
          const p = egg.mesh.position;
          burst([p.x, 0.05, p.z], false);
          const white = ball("#f4edd5", [p.x, 0.018, p.z], [0.26, 0.025, 0.22]);
          const yolk = ball(
            "#dfa94b",
            [p.x + 0.04, 0.04, p.z],
            [0.12, 0.04, 0.11],
          );
          particles.push(
            { mesh: white, life: 2, grounded: true },
            { mesh: yolk, life: 2, grounded: true },
          );
          scene.remove(egg.mesh);
          fallingEggs.splice(i, 1);
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        if (game.state === "paused") continue;
        particle.life -= dt;
        if (!particle.grounded) {
          particle.velocity.y -= dt * 5;
          particle.mesh.position.addScaledVector(particle.velocity, dt);
          particle.mesh.rotation.x += dt * 4;
        }
        particle.mesh.scale.multiplyScalar(Math.pow(0.96, dt * 60));
        if (particle.life <= 0) {
          scene.remove(particle.mesh);
          particles.splice(i, 1);
        }
      }
      missShake = Math.max(0, missShake - dt * 4);
      camera.position.x = !reducedMotion
        ? Math.sin(time * 55) * missShake * 0.065
        : 0;
      renderer.render(scene, camera);
    },
    event(event) {
      if (event.type === "spawn") hens[event.egg.lane].excitement = 1;
      if (event.type === "catch") {
        catchBounce = 1;
        burst(LANES[event.egg.lane].end, true, event.egg.golden);
      }
      if (event.type === "miss") {
        missShake = 1;
        const mesh = eggMesh(event.egg.golden),
          direction = event.egg.lane < 2 ? 1 : -1;
        mesh.position.set(...LANES[event.egg.lane].end);
        mesh.position.x += direction * 0.3;
        fallingEggs.push({
          mesh,
          velocity: new THREE.Vector3(direction * 0.45, -0.8, 0.1),
        });
      }
      if (event.type === "start") {
        for (const particle of particles) scene.remove(particle.mesh);
        particles.length = 0;
        for (const egg of fallingEggs) scene.remove(egg.mesh);
        fallingEggs.length = 0;
      }
    },
    dispose() {
      resizeObserver.disconnect();
      renderer.dispose();
      const geometries = new Set(),
        mats = new Set();
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) mats.add(object.material);
      });
      geometries.forEach((item) => item.dispose());
      mats.forEach((item) => item.dispose());
      signTexture.dispose();
    },
  };
}
