import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { Farm } from "./types.ts";
import type { EggGame, GameEvent, Egg } from "./game.ts";

type Triple = [number, number, number];
type SceneMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
type PaintedMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
// Metadata is populated by eggMesh/chicken before animation reads it.
type EggMesh = PaintedMesh & { userData: { size?: number; golden?: boolean } };
type Hen = {
  mesh: THREE.Group & { userData: { wings?: THREE.Group[] } };
  y: number;
  excitement: number;
};
type GlintUniforms = {
  time: THREE.IUniform<number>;
  amount: THREE.IUniform<number>;
  color: THREE.IUniform<THREE.Color>;
  size: THREE.IUniform<number>;
  drift: THREE.IUniform<number>;
};
type EggFlight = {
  mesh: EggMesh;
  age: number;
  origin: THREE.Vector3;
  rotation: number;
  direction: number;
} & ({ caught: true } | { caught: false; front: number; duration: number });

const palette: Record<string, string> = {
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

export const LANES: readonly { start: Triple; end: Triple }[] = [
  { start: [-4.8, 3.42, -0.75], end: [-1.45, 2.3, -0.75] },
  { start: [-4.8, 1.93, 1.5], end: [-1.45, 0.85, 1.5] },
  { start: [4.8, 3.42, -0.75], end: [1.45, 2.3, -0.75] },
  { start: [4.8, 1.93, 1.5], end: [1.45, 0.85, 1.5] },
];

export function createFarm(mount: HTMLElement): Farm {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // These fields stay a Color and Fog for the lifetime of this scene.
  const scene = new THREE.Scene() as THREE.Scene & {
    background: THREE.Color;
    fog: THREE.Fog;
  };
  scene.background = new THREE.Color("#d4ddc0");
  scene.fog = new THREE.Fog("#d4ddc0", 59, 89);
  const camera = new THREE.OrthographicCamera(-10, 10, 5, -5, 0.1, 114);
  camera.position.set(0, 10.5, 21);
  camera.lookAt(0, 1.25, 0);
  // A tall orthographic view reaches behind the original camera and clips the
  // foreground into a straight seam. Dolly back without changing the framing.
  camera.position.addScaledVector(
    camera.getWorldDirection(new THREE.Vector3()),
    -24,
  );
  const cameraHome = camera.position.clone();
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
    left: -11,
    right: 11,
    top: 8,
    bottom: -8,
    near: 0.1,
    far: 45,
  });
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.00015;
  scene.add(sun);
  const fill = new THREE.DirectionalLight("#c9def0", 0.65);
  fill.position.set(8, 6, -5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight("#d7e6ff", 0.35);
  rim.position.set(0, 5, -8);
  scene.add(rim);

  const materials = new Map<
    THREE.ColorRepresentation,
    THREE.MeshStandardMaterial
  >();
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
  // Retain source geometry too: batching removes its mesh from the scene.
  const ownedGeometries = new Set<THREE.BufferGeometry>(Object.values(geometry));
  const ownedMaterials = new Set<THREE.Material>();

  function material(color: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.9,
          flatShading: true,
        }),
      );
    return materials.get(color)!;
  }
  function shape(
    type: keyof typeof geometry,
    color: string,
    position: Triple,
    scale: Triple,
    parent: THREE.Object3D = scene,
    rotation?: Triple,
  ): PaintedMesh {
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
  const box = (
    c: string,
    p: Triple,
    s: Triple,
    g: THREE.Object3D = scene,
    r?: Triple,
  ) => shape("box", c, p, s, g, r);
  const ball = (c: string, p: Triple, s: Triple, g: THREE.Object3D = scene) =>
    shape("sphere", c, p, s, g);
  function bar(
    start: Triple,
    end: Triple,
    width: number,
    depth: number,
    color: string,
    parent: THREE.Object3D = scene,
  ) {
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
  function ring(
    radius: number,
    tube: number,
    color: string,
    parent: THREE.Object3D,
    position: Triple,
    scale: Triple = [1, 1, 1],
  ) {
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
  function seeded(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  const rand = seeded(52);

  // Combine objects that move together to keep the farm inexpensive to draw.
  function batchStatic(
    parent: THREE.Object3D,
    excluded = new Set<THREE.Object3D>(),
    bakeColors = false,
  ) {
    // Three exposes subclass flags without narrowing the base Material type.
    const canBake = (mesh: SceneMesh): mesh is PaintedMesh =>
      bakeColors &&
      (mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial &&
      !(mesh.material as THREE.MeshStandardMaterial).map &&
      !mesh.material.transparent &&
      (mesh.material as THREE.MeshStandardMaterial).roughness === 0.9 &&
      (mesh.material as THREE.MeshStandardMaterial).metalness === 0 &&
      mesh.material.side === THREE.FrontSide &&
      (mesh.material as THREE.MeshStandardMaterial).emissive.getHex() === 0;
    const bakedMaterial = bakeColors
      ? new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.9,
          flatShading: true,
        })
      : null;
    if (bakedMaterial) ownedMaterials.add(bakedMaterial);
    parent.updateWorldMatrix(true, true);
    const inverse = parent.matrixWorld.clone().invert();
    const batches = new Map<string, SceneMesh[]>();
    // Object3D does not expose the mesh flag or render resources in Three's types.
    function collect(
      object: THREE.Object3D &
        Partial<Pick<THREE.Mesh, "isMesh" | "geometry" | "material">>,
    ) {
      if (excluded.has(object) || !object.visible) return;
      if (object.isMesh && !Array.isArray(object.material)) {
        ownedGeometries.add(object.geometry!);
        ownedMaterials.add(object.material!);
        const bake = canBake(object as SceneMesh);
        const attributes = Object.keys(object.geometry!.attributes)
          .filter((key) => key !== "uv" && (!bake || key !== "color"))
          .sort()
          .join();
        const key = `${bake ? "painted" : object.material!.uuid}:${object.castShadow}:${object.receiveShadow}:${attributes}`;
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key)!.push(object as SceneMesh);
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
        if (canBake(mesh)) {
          const colors = piece.attributes.color;
          const tint = mesh.material.color;
          const baked = new Float32Array(piece.attributes.position.count * 3);
          for (let i = 0; i < piece.attributes.position.count; i++) {
            baked[i * 3] = tint.r * (colors ? colors.getX(i) : 1);
            baked[i * 3 + 1] = tint.g * (colors ? colors.getY(i) : 1);
            baked[i * 3 + 2] = tint.b * (colors ? colors.getZ(i) : 1);
          }
          piece.setAttribute("color", new THREE.BufferAttribute(baked, 3));
        }
        return piece.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
      });
      const combined = mergeGeometries(pieces);
      pieces.forEach((piece) => piece.dispose());
      if (!combined) continue;
      const merged = new THREE.Mesh(
        combined,
        canBake(meshes[0]) ? bakedMaterial! : meshes[0].material,
      );
      merged.castShadow = meshes[0].castShadow;
      merged.receiveShadow = meshes[0].receiveShadow;
      for (const mesh of meshes) mesh.removeFromParent();
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
  const islandGeometry = new THREE.CylinderGeometry(1, 1.025, 1, 64, 3);
  island.geometry = islandGeometry.toNonIndexed();
  islandGeometry.dispose();
  const grassPositions = island.geometry.attributes.position;
  const grassColors = new Float32Array(grassPositions.count * 3);
  const grassColor = new THREE.Color();
  for (let i = 0; i < grassPositions.count; i += 3) {
    const shade = 0.94 + rand() * 0.1;
    grassColor.setRGB(shade, shade, shade * (0.97 + rand() * 0.03));
    for (let j = 0; j < 3; j++) grassColor.toArray(grassColors, (i + j) * 3);
  }
  island.geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(grassColors, 3),
  );
  island.material = material(palette.grass).clone();
  island.material.vertexColors = true;
  const dirt = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    material("#d6d6ac"),
  );
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.set(0, -0.025, 1.2);
  dirt.scale.set(4.8, 3.0, 1);
  dirt.receiveShadow = true;
  scene.add(dirt);

  function tree(x: number, z: number, size = 1) {
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
  const windowPane = box("#626f5d", [0, 2.63, 1.2], [0.34, 0.29, 0.025], barn);
  box("cream", [0, 2.63, 1.23], [0.04, 0.29, 0.015], barn);
  box("cream", [0, 2.63, 1.23], [0.34, 0.035, 0.015], barn);
  box("#dbdec4", [-1.5, 1.1, 1.19], [0.1, 2.2, 0.08], barn);
  box("#dbdec4", [1.5, 1.1, 1.19], [0.1, 2.2, 0.08], barn);

  function fence(x1: number, x2: number, z: number, height = 0.85) {
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
  // Fresh canvases use a 2D context; retain the existing failure behavior if unavailable.
  const ctx = signCanvas.getContext("2d")!;
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

  const hens: Hen[] = [];
  function chicken(parent: THREE.Object3D, position: Triple, direction: number) {
    const group: Hen["mesh"] = new THREE.Group();
    group.position.set(...position);
    group.rotation.y = direction;
    parent.add(group);
    ball("cream", [0, 0.24, 0], [0.38, 0.37, 0.44], group);
    const wings = [-1, 1].map((side) => {
      const wing = new THREE.Group();
      wing.position.set(side * 0.29, 0.38, 0.015);
      group.add(wing);
      ball("#e6e6cf", [side * 0.03, -0.17, 0], [0.14, 0.25, 0.31], wing);
      return wing;
    });
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
    batchStatic(group, new Set(wings));
    group.userData.wings = wings;
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

  // Bake scenery colors into vertices; keep theme-driven surfaces separate.
  batchStatic(
    scene,
    new Set([ground, windowPane, ...hens.map((hen) => hen.mesh)]),
    true,
  );

  // Sky and distant meadow use identical linear colours and output transforms.
  const skyUniforms = {
    skyTop: { value: new THREE.Color("#b8d1ce") },
    skyHorizon: { value: new THREE.Color("#d4ddc0") },
    sunset: { value: 0 },
    skyHeight: { value: 1 },
  };
  const skyColorGLSL = `
    uniform vec3 skyTop; uniform vec3 skyHorizon;
    uniform float sunset; uniform float skyHeight;
    vec3 skyColorAt(float screenY) {
      vec3 color = mix(skyHorizon, skyTop, smoothstep(0.38, 1.0, screenY));
      return mix(color, vec3(0.92, 0.49, 0.25), sunset * exp(-pow((screenY - 0.53) * 4.0, 2.0)) * 0.32);
    }
  `;
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: `void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: `${skyColorGLSL}
      void main() {
        gl_FragColor = vec4(skyColorAt(gl_FragCoord.y / skyHeight), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
    depthTest: false,
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);
  // The pitched orthographic view sees meadow all the way to the top edge.
  // Fade distant ground into the same sky so the gradient remains visible.
  ground.material.fog = false;
  ground.material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skyUniforms);
    shader.vertexShader = "varying float meadowDepth;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      meadowDepth = -(modelMatrix * vec4(position, 1.0)).z;
    `,
    );
    shader.fragmentShader =
      `varying float meadowDepth;
${skyColorGLSL}` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
      outgoingLight = mix(outgoingLight, skyColorAt(gl_FragCoord.y / skyHeight), smoothstep(4.0, 12.0, meadowDepth));
      #include <opaque_fragment>
    `,
    );
  };

  const hills = [
    { z: -9.5, height: 1.45, haze: 0.64, day: "#859779", night: "#192d39" },
    { z: -7.3, height: 1.3, haze: 0.28, day: "#98a47e", night: "#233b40" },
  ].map((layer, index) => {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      fog: false,
      transparent: true,
      depthWrite: false,
    });
    // Dissolve the foot of each hill into the meadow instead of drawing a band.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = "varying float hillHeight;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nhillHeight = position.y;",
      );
      shader.fragmentShader = "varying float hillHeight;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        "diffuseColor.a *= smoothstep(-0.5, 0.25, hillHeight);\n#include <opaque_fragment>",
      );
    };
    scene.add(group);
    for (let i = -5; i <= 5; i++) {
      const hill = new THREE.Mesh(geometry.sphere, mat);
      hill.position.set(i * 10 + index * 4, -0.7, layer.z - (i % 2) * 0.5);
      hill.scale.set(
        8.5 + Math.sin(i * 2) * 1.5,
        layer.height + Math.cos(i * 2) * 0.35,
        1.2,
      );
      group.add(hill);
    }
    batchStatic(group);
    return { ...layer, material: mat };
  });

  // A small procedural radial texture keeps glows soft without post-processing.
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 64;
  const glowContext = glowCanvas.getContext("2d")!;
  const gradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,0.65)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.24)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  glowContext.fillStyle = gradient;
  glowContext.fillRect(0, 0, 64, 64);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  function glow(parent: THREE.Object3D, color: THREE.ColorRepresentation, size: number) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    sprite.scale.set(size, size, 1);
    parent.add(sprite);
    return sprite;
  }
  const moon = new THREE.Mesh(
    geometry.smooth,
    new THREE.MeshBasicMaterial({ color: "#dce7ed" }),
  );
  moon.scale.setScalar(0.28);
  moon.quaternion.copy(camera.quaternion);
  glow(moon, "#a3bde8", 4.8);
  const craters = new THREE.Group();
  const craterMaterial = new THREE.MeshBasicMaterial({
    color: "#9eb4c8",
    transparent: true,
    opacity: 0.28,
  });
  moon.add(craters);
  for (const [x, y, radius] of [
    [-0.32, 0.22, 0.24],
    [0.3, -0.3, 0.18],
    [0.3, 0.4, 0.11],
  ]) {
    const crater = new THREE.Mesh(geometry.smooth, craterMaterial);
    crater.position.set(x, y, Math.sqrt(1 - x * x - y * y) - 0.015);
    crater.scale.set(radius, radius, 0.025);
    craters.add(crater);
  }
  batchStatic(craters);
  scene.add(moon);
  const sunOrb = new THREE.Mesh(
    geometry.smooth,
    new THREE.MeshBasicMaterial({ color: "#ffd270" }),
  );
  sunOrb.scale.setScalar(0.28);
  glow(sunOrb, "#ffcf83", 6);
  scene.add(sunOrb);

  function glints(positions: number[], color: THREE.ColorRepresentation, size: number) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute(
      "phase",
      new THREE.Float32BufferAttribute(
        positions.filter((_, i) => i % 3 === 0).map(() => rand() * 6.28),
        1,
      ),
    );
    // ShaderMaterial does not preserve the concrete uniform map in its type.
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        amount: { value: 0 },
        color: { value: new THREE.Color(color) },
        size: { value: size * renderer.getPixelRatio() },
        drift: { value: 0 },
      },
      vertexShader: `attribute float phase; varying float brightness;
        uniform float time; uniform float size; uniform float drift;
        void main() {
          vec3 p = position + drift * vec3(sin(time * 0.7 + phase), cos(time * 0.9 + phase), sin(time * 0.5 + phase));
          brightness = 0.55 + 0.45 * sin(time * 1.4 + phase);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = size * (0.7 + 0.3 * brightness);
        }`,
      fragmentShader: `varying float brightness; uniform vec3 color; uniform float amount;
        void main() {
          float alpha = pow(max(0.0, 1.0 - length(gl_PointCoord - 0.5) * 2.0), 1.4);
          gl_FragColor = vec4(color, alpha * brightness * amount);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }) as THREE.ShaderMaterial & { uniforms: GlintUniforms };
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    return points;
  }
  const starPositions = [];
  for (let i = 0; i < 44; i++)
    starPositions.push((rand() - 0.5) * 19, 3.1 + rand() * 1.4, -5.8);
  const stars = glints(starPositions, "#dce9ee", 3.2);
  const fireflyPositions = [];
  for (let i = 0; i < 16; i++)
    fireflyPositions.push(
      (i % 2 ? -1 : 1) * (5.7 + rand() * 1.7),
      0.5 + rand() * 1.6,
      -1 + rand() * 3,
    );
  const fireflies = glints(fireflyPositions, "#e3e88b", 5);
  const cloudMaterial = material("#f0ecdc");
  const clouds = [
    [-3.3, 1.3, 1],
    [3.5, 1.85, 0.62],
    [10.6, 1.3, 0.72],
  ].map(([x, y, size], i) => {
    const cloud = new THREE.Group();
    // Behind the whole sun/moon orbit; the projected gaps clear every treetop.
    cloud.position.set(x, y, -11);
    cloud.scale.setScalar(size);
    scene.add(cloud);
    for (const [px, py, pz, radius] of [
      [-0.85, 0, 0, 0.48],
      [-0.35, 0.13, 0, 0.62],
      [0.18, 0.3, -0.08, 0.68],
      [0.75, 0.08, 0, 0.52],
      [-0.32, -0.05, 0.28, 0.48],
      [0.38, -0.06, 0.3, 0.5],
      [1.03, -0.06, 0.05, 0.3],
    ]) {
      const puff = ball(
        "#f0ecdc",
        [px, py, pz],
        [radius, radius * 0.8, radius * 0.7],
        cloud,
      );
      puff.castShadow = puff.receiveShadow = false;
    }
    batchStatic(cloud);
    return { mesh: cloud, x, phase: i * 2 };
  });
  const windowLight = new THREE.PointLight("#ffc276", 0, 5);
  windowLight.position.set(0, 2.6, -2.1);
  scene.add(windowLight);
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
    const blend = (color: THREE.Color, day: THREE.ColorRepresentation, night: THREE.ColorRepresentation) =>
      color.set(day).lerp(mixedColor.set(night), nightAmount);
    blend(scene.background, "#d4ddc0", "#14212f");
    const sunset = Math.sin(nightAmount * Math.PI);
    scene.fog.color
      .copy(scene.background)
      .lerp(mixedColor.set("#d5a184"), sunset * 0.25);
    skyUniforms.skyHorizon.value.copy(scene.fog.color);
    blend(skyUniforms.skyTop.value, "#afcccf", "#0b142b");
    skyUniforms.sunset.value = sunset;
    ground.material.color.copy(scene.fog.color);
    blend(cloudMaterial.color, "#f0ecdc", "#17273e");
    for (const hill of hills) {
      blend(hill.material.color, hill.day, hill.night);
      hill.material.color.lerp(skyUniforms.skyHorizon.value, hill.haze);
    }
    blend(ambient.color, "#fff9e4", "#91b3dc");
    blend(ambient.groundColor, "#8e9c73", "#25394d");
    ambient.intensity = THREE.MathUtils.lerp(1.9, 0.95, nightAmount);
    blend(sun.color, "#fff4d7", "#9dc5ff");
    sun.intensity = THREE.MathUtils.lerp(2.7, 1.15, nightAmount);
    blend(fill.color, "#c9def0", "#a2bdec");
    fill.intensity = THREE.MathUtils.lerp(0.65, 0.35, nightAmount);
    rim.intensity = THREE.MathUtils.lerp(0.3, 0.65, nightAmount);
    material("#626f5d").emissive.set("#ffd48d");
    material("#626f5d").emissiveIntensity = 1.3 * nightAmount;
    material(palette.egg).emissive.set("#8499b3");
    material(palette.egg).emissiveIntensity = 0.2 * nightAmount;
    stars.visible = fireflies.visible = nightAmount > 0.001;
    stars.material.uniforms.amount.value = nightAmount;
    fireflies.material.uniforms.amount.value = nightAmount * 0.85;
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
  goldMaterial.emissiveIntensity = 0.3;
  material(palette.egg).roughness = 0.32;

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
  const ears: THREE.Group[] = [],
    eyes: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 0.28, 0.5, -0.03);
    head.add(ear);
    ears.push(ear);
    shape("cone", "wolf", [0, 0.25, 0], [0.2, 0.6, 0.18], ear, [
      0,
      0,
      -side * 0.18,
    ]);
    shape("cone", "#b6a29b", [0, 0.25, 0.118], [0.095, 0.36, 0.035], ear, [
      0,
      0,
      -side * 0.18,
    ]);
    const eye = new THREE.Group();
    eye.position.set(side * 0.155, 0.36, 0.32);
    head.add(eye);
    eyes.push(eye);
    ball("#f2ecdc", [0, 0, 0], [0.137, 0.177, 0.075], eye);
    ball("dark", [-side * 0.018, -0.03, 0.068], [0.047, 0.079, 0.035], eye);
    ball(
      "#fff9e6",
      [-side * 0.018 - 0.013, 0.003, 0.095],
      [0.016, 0.022, 0.012],
      eye,
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
  const tail = new THREE.Group();
  tail.position.set(0.23, 0.82, -0.12);
  torso.add(tail);
  bar([0, 0, 0], [0.64, -0.26, -0.12], 0.23, 0.24, "wolf", tail);
  ball("muzzle", [0.69, -0.28, -0.13], [0.15, 0.14, 0.15], tail);
  batchStatic(tail);
  batchStatic(torso, new Set([head, tail]));

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
  batchStatic(head, new Set([...ears, ...eyes]));
  const armLeft = bar([0, 0, 0], [0, 1, 0], 0.16, 0.16, "wolf");
  const armRight = bar([0, 0, 0], [0, 1, 0], 0.16, 0.16, "wolf");
  const forearmLeft = armLeft.clone(),
    forearmRight = armRight.clone();
  scene.add(forearmLeft, forearmRight);
  const sleeveLeft = ball("shirt", [-0.4, 1.6, 1.1], [0.21, 0.24, 0.22]);
  const sleeveRight = ball("shirt", [0.4, 1.6, 1.1], [0.21, 0.24, 0.22]);
  const pawLeft = ball("wolf", [0, 0, 0], [0.13, 0.14, 0.14]);
  const pawRight = ball("wolf", [0, 0, 0], [0.13, 0.14, 0.14]);
  const targetBasket = new THREE.Vector3();
  // Keep the catch dip out of the lane spring so arrival timing stays unchanged.
  const basketTravel = new THREE.Vector3(-1.45, 0.95, 1.5);
  const targetWolf = new THREE.Vector3();
  const basketVelocity = new THREE.Vector3(),
    wolfVelocity = new THREE.Vector3();
  const leftShoulder = new THREE.Vector3(),
    rightShoulder = new THREE.Vector3();
  const leftHand = new THREE.Vector3(),
    rightHand = new THREE.Vector3();
  const elbow = new THREE.Vector3(),
    armDirection = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  // Exact underdamped solution, stable even when a frame takes 100 ms.
  function spring(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    target: THREE.Vector3,
    dt: number,
    frequency = 44,
  ) {
    if (reducedMotion) {
      position.copy(target);
      velocity.set(0, 0, 0);
      return;
    }
    const damping = 0.78 * frequency,
      oscillation = frequency * Math.sqrt(1 - 0.78 ** 2);
    const decay = Math.exp(-damping * dt),
      c = Math.cos(oscillation * dt),
      sn = Math.sin(oscillation * dt);
    for (const axis of ["x", "y", "z"] satisfies ("x" | "y" | "z")[]) {
      const offset = position[axis] - target[axis];
      const v = velocity[axis];
      position[axis] =
        target[axis] +
        decay * (offset * c + ((v + damping * offset) * sn) / oscillation);
      velocity[axis] =
        decay *
        (v * c -
          ((damping * v + frequency * frequency * offset) * sn) / oscillation);
    }
  }
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
  const rabbitEars: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const earPivot = new THREE.Group();
    earPivot.position.set(side * 0.17, 1.53, -0.03);
    rabbit.add(earPivot);
    rabbitEars.push(earPivot);
    const ear = ball(
      "#dce0cd",
      [0, 0.37, 0],
      [0.115, 0.48, 0.11],
      earPivot,
    );
    ear.rotation.z = -side * 0.12;
    const inner = ball(
      "#cfa39b",
      [0, 0.39, 0.09],
      [0.055, 0.33, 0.035],
      earPivot,
    );
    inner.rotation.z = -side * 0.12;
    ball("cream", [side * 0.135, 1.36, 0.27], [0.1, 0.13, 0.045], rabbit);
    ball("dark", [side * 0.125, 1.35, 0.307], [0.035, 0.065, 0.025], rabbit);
    box("cream", [side * 0.045, 1.035, 0.355], [0.07, 0.12, 0.04], rabbit);
  }
  batchStatic(rabbit, new Set(rabbitEars));
  rabbit.visible = false;

  const eggMeshes = new Map<number, EggMesh>(),
    eggPool: [EggMesh[], EggMesh[]] = [[], []],
    eggFlights: EggFlight[] = [];
  const sparkleMaterial = new THREE.MeshBasicMaterial({
    color: "#fff2ba",
    depthWrite: false,
  });
  const sparklePieces = [
    geometry.box.clone().scale(0.12, 0.8, 0.08),
    geometry.box.clone().scale(0.55, 0.12, 0.08),
  ];
  const sparkleGeometry = mergeGeometries(sparklePieces);
  sparklePieces.forEach((piece) => piece.dispose());
  ownedGeometries.add(sparkleGeometry);
  function eggMesh(golden = false) {
    const pool = eggPool[Number(golden)];
    let mesh = pool.pop();
    if (!mesh) {
      const size = golden ? 0.19 : 0.155;
      mesh = shape(
        "egg",
        golden ? "gold" : "egg",
        [0, 0, 0],
        [size, size, size],
      );
      mesh.userData.size = size;
      mesh.userData.golden = golden;
      if (golden) {
        const sparkle = new THREE.Mesh(sparkleGeometry, sparkleMaterial);
        sparkle.position.set(1.4, 0.7, 0.5);
        mesh.add(sparkle);
      }
    }
    mesh.visible = true;
    mesh.scale.setScalar(mesh.userData.size!);
    mesh.rotation.set(0, 0, 0);
    return mesh;
  }
  function releaseEgg(mesh: EggMesh) {
    mesh.visible = false;
    eggPool[Number(mesh.userData.golden)].push(mesh);
  }
  function takeEgg(egg: Egg) {
    const mesh = eggMeshes.get(egg.id) || eggMesh(egg.golden);
    eggMeshes.delete(egg.id);
    eggPosition(mesh, egg.lane, egg.progress);
    return mesh;
  }
  const gift = eggMesh(true);
  gift.visible = false;
  gift.material = goldMaterial.clone();
  const giftGlow = glow(gift, "#ffd269", 5);
  giftGlow.material.opacity = 0;
  let encoreCelebrated = false, wasEncore = false;
  const previewEggs = [0, 1, 2, 3].map((lane, i) => ({
    mesh: eggMesh(i === 2),
    lane,
    offset: [0.38, 0.68, 0.72, 0.18][i],
  }));
  let catchBounce = 0,
    shakeAge = 1,
    earTwitch = 0,
    cheerAge = 2;
  let sceneTime = 0,
    blinkAt = 2.6;
  function moveArm(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.set(0.16, from.distanceTo(to), 0.16);
    mesh.quaternion.setFromUnitVectors(
      up,
      armDirection.copy(to).sub(from).normalize(),
    );
  }
  // Cartoon arms: the segments stretch to fit, so the elbow can always sit
  // where it reads best from this camera, in front of the body and a little
  // outward. A low carry bends a lot; a raised reach is nearly straight.
  function bentArm(
    upper: THREE.Object3D,
    lower: THREE.Object3D,
    shoulder: THREE.Vector3,
    hand: THREE.Vector3,
    side: number,
  ) {
    const lift = THREE.MathUtils.smoothstep(hand.y - shoulder.y, -0.9, 0.7);
    const bend = THREE.MathUtils.lerp(1, 0.25, lift);
    elbow.lerpVectors(shoulder, hand, THREE.MathUtils.lerp(0.5, 0.45, lift));
    elbow.z += 0.5 * bend;
    elbow.x += side * 0.18 * bend;
    elbow.y -= 0.14 * bend;
    moveArm(upper, shoulder, elbow);
    moveArm(lower, elbow, hand);
  }
  function eggPosition(mesh: EggMesh, lane: number, progress: number) {
    const { start, end } = LANES[lane];
    const radius = mesh.userData.size!;
    const dx = end[0] - start[0],
      dy = end[1] - start[1];
    const distance = Math.hypot(dx, dy) * progress;
    mesh.position.set(
      start[0] + dx * progress,
      start[1] + dy * progress + radius * 1.15,
      start[2],
    );
    if (progress > 1) mesh.position.y -= (progress - 1) ** 2 * 6.4;
    // Arc length / radius also doubles the roll rate of the faster golden eggs.
    const roll = (distance / radius) * (lane < 2 ? -1 : 1);
    mesh.rotation.set(
      reducedMotion ? 0 : Math.sin(roll * 0.7) * 0.09,
      0,
      reducedMotion ? 0 : roll,
    );
    if (mesh.children[0])
      mesh.children[0].scale.setScalar(
        reducedMotion ? 0.8 : 0.7 + Math.sin(sceneTime * 5) * 0.25,
      );
  }

  // One draw for all airborne flecks, with storage reused across rounds.
  const particleMesh = new THREE.InstancedMesh(
    geometry.box,
    material("#ffffff"),
    96,
  );
  particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particleMesh.frustumCulled = false;
  particleMesh.count = 0;
  scene.add(particleMesh);
  const particles = Array.from({ length: 96 }, () => ({
    active: false,
    origin: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    color: new THREE.Color(),
    age: 0,
    duration: 0,
    confetti: false,
    spin: 0,
  }));
  const instance = new THREE.Object3D();
  const confettiColors = [
    "#ffd078",
    "#bb7f77",
    "#9cbbb2",
    "#f5efd9",
    "#a6adce",
  ];
  function burst(pos: Triple, caught: boolean, golden = false, confetti = false) {
    if (reducedMotion) return;
    let count = confetti ? 36 : golden ? 10 : caught ? 4 : 7;
    for (const particle of particles) {
      if (particle.active) continue;
      particle.active = true;
      particle.origin.set(pos[0], pos[1] + 0.15, pos[2]);
      particle.velocity.set(
        (rand() - 0.5) * (confetti ? 3.8 : 2),
        1 + rand() * 1.5,
        (rand() - 0.5) * 1.6,
      );
      particle.age = 0;
      particle.duration = confetti ? 2.6 + rand() * 0.8 : 0.5 + rand() * 0.2;
      particle.confetti = confetti;
      particle.spin = (rand() - 0.5) * 12;
      particle.color.set(
        confetti
          ? confettiColors[count % confettiColors.length]
          : golden
            ? "#ffd078"
            : caught
              ? "#efd389"
              : count % 2
                ? "#fff6dc"
                : "#e5b148",
      );
      if (--count === 0) break;
    }
  }
  function paintGeometry(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
    const colors = new Float32Array(geo.attributes.position.count * 3);
    const tint = new THREE.Color(color);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }
  const splatParts = [
    paintGeometry(geometry.sphere.clone().scale(0.3, 0.022, 0.24), "#f4edd5"),
    paintGeometry(
      geometry.sphere
        .clone()
        .scale(0.12, 0.038, 0.11)
        .translate(0.04, 0.024, 0),
      "#dfa94b",
    ),
  ];
  const splatGeometry = mergeGeometries(splatParts);
  splatParts.forEach((piece) => piece.dispose());
  const splats = Array.from({ length: 8 }, () => {
    const mesh = new THREE.Mesh(
      splatGeometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        flatShading: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, age: 3 };
  });
  let nextSplat = 0;
  function splat(position: THREE.Vector3) {
    const spot = splats[nextSplat++ % splats.length];
    spot.age = 0;
    spot.mesh.visible = true;
    spot.mesh.material.opacity = 1;
    spot.mesh.position.set(position.x, 0.025, position.z);
    spot.mesh.rotation.y = rand() * Math.PI * 2;
    burst([position.x, 0.05, position.z], false);
  }
  const shadowGeometry = new THREE.CircleGeometry(1, 12);
  shadowGeometry.rotateX(-Math.PI / 2);
  const contactShadows = new THREE.InstancedMesh(
    shadowGeometry,
    new THREE.MeshBasicMaterial({
      color: "#54442e",
      transparent: true,
      opacity: 0.19,
      depthWrite: false,
    }),
    32,
  );
  contactShadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  contactShadows.frustumCulled = false;
  contactShadows.count = 0;
  scene.add(contactShadows);
  function eggShadow(lane: number, progress: number) {
    if (progress > 1 || contactShadows.count >= 32) return;
    const { start, end } = LANES[lane];
    instance.position.set(
      THREE.MathUtils.lerp(start[0], end[0], progress),
      THREE.MathUtils.lerp(start[1], end[1], progress) + 0.004,
      start[2],
    );
    instance.rotation.set(
      0,
      0,
      Math.atan((end[1] - start[1]) / (end[0] - start[0])),
    );
    instance.scale.set(0.19, 1, 0.12);
    instance.updateMatrix();
    contactShadows.setMatrixAt(contactShadows.count++, instance.matrix);
  }

  function resize() {
    const w = Math.max(1, mount.clientWidth),
      h = Math.max(1, mount.clientHeight);
    renderer.setSize(w, h, false);
    skyUniforms.skyHeight.value = renderer.domElement.height;
    const aspect = w / h;
    // On phones, keep all four chutes visible rather than cropping the play area.
    const width = Math.max(14.0, 10.5 * aspect);
    const height = width / aspect;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    camera.setViewOffset(w, h, 0, aspect < 1.2 ? h * 0.015 : -h * 0.035, w, h);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(mount);
  resize();

  return {
    setTheme(dark: boolean) {
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
    render(
      game: EggGame,
      dt: number,
      time: number,
      encoreTime: number | null = null,
    ) {
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.25)) : 0;
      if (themeElapsed < 1.5) {
        themeElapsed = Math.min(1.5, themeElapsed + dt);
        const ease = THREE.MathUtils.smoothstep(themeElapsed, 0, 1.5);
        nightAmount = THREE.MathUtils.lerp(nightStart, nightTarget, ease);
        orbit = THREE.MathUtils.lerp(orbitStart, orbitTarget, ease);
        paintDaylight();
      }
      const encore = encoreTime !== null;
      const movieTime = encoreTime ?? 0;
      if (wasEncore && !encore) {
        for (const particle of particles) particle.active = false;
        catchBounce = 0;
        encoreCelebrated = false;
      }
      wasEncore = encore;
      const idle = game.state === "ready";
      const motionDt = game.state === "paused" ? 0 : dt;
      const animate = !reducedMotion && (game.state !== "over" || encore);
      if (animate) sceneTime += motionDt;
      const smoothing = reducedMotion ? 1 : 1 - Math.exp(-motionDt * 17);
      stars.material.uniforms.time.value =
        fireflies.material.uniforms.time.value = sceneTime;
      fireflies.material.uniforms.drift.value = reducedMotion ? 0 : 0.23;
      for (const cloud of clouds)
        cloud.mesh.position.x =
          cloud.x +
          (reducedMotion
            ? 0
            : Math.sin(sceneTime * 0.045 + cloud.phase) * 0.3);
      goldMaterial.emissiveIntensity = reducedMotion
        ? 0.3
        : 0.3 + Math.sin(sceneTime * 3.2) * 0.09;

      const lane = LANES[game.lane];
      targetBasket.set(lane.end[0], lane.end[1] + 0.09, lane.end[2]);
      if (encore) targetBasket.set(0.45, 1.4, 2.8);
      const catchAge = movieTime - 5.4;
      const giftDip = encore && !reducedMotion && catchAge >= 0
        ? Math.sin(Math.min(1, catchAge / 0.65) * Math.PI * 2)
          * Math.exp(-catchAge * 4) * 0.42 : 0;
      spring(basketTravel, basketVelocity, targetBasket, motionDt);
      basket.position.copy(basketTravel);
      catchBounce = Math.max(0, catchBounce - motionDt * 4.5);
      const pop = reducedMotion ? 0 : Math.sin(catchBounce * Math.PI) * 0.12;
      basket.position.y -= pop * 1.5 + giftDip;
      const stretch = reducedMotion
        ? 0
        : Math.min(0.1, basketVelocity.length() * 0.002);
      basket.scale.set(
        1 + pop - stretch * 0.4 + Math.abs(giftDip) * 0.45,
        1 - pop + stretch - Math.abs(giftDip) * 0.35,
        1 + pop * 0.5 + Math.abs(giftDip) * 0.25,
      );
      basket.rotation.z =
        (encore ? 0 : game.lane < 2 ? -0.04 : 0.04) +
        (reducedMotion
          ? 0
          : THREE.MathUtils.clamp(-basketVelocity.x * 0.006, -0.13, 0.13) +
            pop * 0.3);
      targetWolf.set(game.lane < 2 ? -0.25 : 0.25, 0, 1.12);
      if (encore) targetWolf.set(-0.45, 0, 1.12);
      spring(wolf.position, wolfVelocity, targetWolf, motionDt, 38);
      const cheer =
        encore && movieTime > 5.4 && !reducedMotion
          ? Math.sin(Math.max(0, movieTime - 5.75) * 5) ** 2 * 0.24
          : 0;
      const breathe = cheer + (animate ? Math.sin(sceneTime * 2.5) * 0.025 : 0);
      torso.position.set(0, breathe, 0);
      torso.rotation.z = THREE.MathUtils.lerp(
        torso.rotation.z,
        encore ? -0.04 : -(game.lane < 2 ? -1 : 1) * 0.045,
        smoothing,
      );
      torso.rotation.y = THREE.MathUtils.lerp(torso.rotation.y,
        encore ? (movieTime < 5.4 ? 0.45 : 0.15) : 0, smoothing);
      let urgent: Egg | null = null;
      if (game.state === "playing") {
        for (const egg of game.eggs)
          if (!urgent || egg.progress > urgent.progress) urgent = egg;
      }
      const gazeLane = urgent ? urgent.lane : game.lane;
      const gazeX = urgent
        ? THREE.MathUtils.lerp(
            LANES[gazeLane].start[0],
            LANES[gazeLane].end[0],
            urgent.progress,
          )
        : LANES[gazeLane].end[0];
      const headYaw = encore
        ? (movieTime < 3.2 ? 0.85 : movieTime < 5.4 ? 0.35 : 0.1)
        : THREE.MathUtils.clamp(gazeX * 0.12, -0.4, 0.4);
      const headPitch =
        encore && movieTime > 3.2 && movieTime < 5.4
          ? -0.16
          : urgent
            ? gazeLane % 2
              ? 0.08
              : -0.09
            : 0;
      head.rotation.y = THREE.MathUtils.lerp(
        head.rotation.y,
        headYaw,
        smoothing,
      );
      head.rotation.x = THREE.MathUtils.lerp(
        head.rotation.x,
        headPitch,
        smoothing,
      );
      tail.rotation.y = animate ? Math.sin(sceneTime * 4.2) * 0.24 : 0;
      tail.rotation.z = animate ? Math.sin(sceneTime * 4.2 + 0.5) * 0.07 : 0;
      earTwitch = Math.max(0, earTwitch - motionDt * 3);
      for (let i = 0; i < ears.length; i++)
        ears[i].rotation.z = reducedMotion
          ? 0
          : Math.sin(earTwitch * Math.PI * 3 + i * 0.5) * earTwitch * 0.14;
      const blinkPhase = sceneTime - blinkAt;
      const blink =
        !reducedMotion && blinkPhase > 0 && blinkPhase < 0.16
          ? Math.sin((blinkPhase / 0.16) * Math.PI)
          : 0;
      for (const eye of eyes) eye.scale.y = 1 - blink * 0.93;
      if (blinkPhase >= 0.16) blinkAt = sceneTime + 2.8 + rand() * 2.2;

      rabbit.visible = gift.visible = encore && movieTime >= 0.8;
      if (encore) {
        const arrival = THREE.MathUtils.clamp((movieTime - 0.8) / 2.4, 0, 1);
        // Three parabolic hops end at the throw.
        const hop = arrival === 1 ? 0 : (arrival * 3) % 1;
        rabbit.position.set(
          6.8 - arrival * 5.1,
          reducedMotion ? 0 : 4 * hop * (1 - hop) * 0.38 + cheer * 0.6,
          2.4,
        );
        const landing =
          !reducedMotion && arrival > 0 && arrival < 1
            ? Math.exp(-hop * 20) * 0.1
            : 0;
        rabbit.scale.set(1 + landing, 1 - landing, 1 + landing * 0.5);
        rabbit.rotation.set(
          0,
          -0.65,
          !reducedMotion && movieTime > 5.4
            ? Math.sin((movieTime - 5.4) * 3) * 0.08
            : 0,
        );
        const toss = THREE.MathUtils.clamp((movieTime - 3.2) / 2.2, 0, 1);
        const windup = Math.sin(THREE.MathUtils.clamp((movieTime - 2.85) / 0.35, 0, 1) * Math.PI);
        rabbit.rotation.x = reducedMotion ? 0 : windup * 0.18;
        for (let i = 0; i < rabbitEars.length; i++) {
          rabbitEars[i].rotation.x = reducedMotion ? 0 :
            Math.sin(arrival * Math.PI * 6 - 0.7) * (arrival < 1 ? 0.22 : 0)
            + (movieTime > 5.4 ? Math.sin(catchAge * 10 - 0.8) * 0.32 : 0);
          rabbitEars[i].rotation.z = (i ? -1 : 1) * (movieTime >= 5.4 ? 0.2 : 0.05);
        }
        gift.scale.setScalar(0.36 + (!reducedMotion && catchAge >= 0
          ? Math.sin(Math.min(1, catchAge / 0.45) * Math.PI) * 0.13 : 0));
        gift.position.set(
          THREE.MathUtils.lerp(rabbit.position.x - 0.3, basket.position.x, toss),
          THREE.MathUtils.lerp(1.1 + rabbit.position.y, basket.position.y + 0.18, toss)
            + (reducedMotion ? 1.8 : 7) * toss * (1 - toss),
          THREE.MathUtils.lerp(2.65, basket.position.z, toss),
        );
        gift.rotation.set(0, 0, reducedMotion ? 0 : Math.sin(toss * Math.PI) * -0.65);
        const glowPulse = reducedMotion ? 0.25 : Math.sin(toss * Math.PI) ** 4;
        giftGlow.material.opacity = 0.2 + glowPulse * 0.65;
        gift.material.emissiveIntensity = 0.4 + glowPulse * 0.75;
        if (movieTime >= 5.4 && !encoreCelebrated) {
          encoreCelebrated = true;
          burst([basket.position.x, 2.1, basket.position.z], true, true, true);
          burst([rabbit.position.x, 1.7, rabbit.position.z], true, true, true);
        }
      } else encoreCelebrated = false;
      const zoom = encore && !reducedMotion ? 1.3 : 1;
      const nextZoom =
        reducedMotion || !encore
          ? 1
          : THREE.MathUtils.lerp(camera.zoom, zoom, 1 - Math.exp(-dt * 2.4));
      if (camera.zoom !== nextZoom) {
        camera.zoom = nextZoom;
        camera.updateProjectionMatrix();
      }
      wolf.updateWorldMatrix(true, true);
      leftShoulder.set(-0.36, 1.65, 0).applyMatrix4(torso.matrixWorld);
      rightShoulder.set(0.36, 1.65, 0).applyMatrix4(torso.matrixWorld);
      basket.updateWorldMatrix(true, false);
      leftHand.set(-0.32, 0.23, -0.13).applyMatrix4(basket.matrixWorld);
      rightHand.set(0.32, 0.23, -0.13).applyMatrix4(basket.matrixWorld);
      bentArm(armLeft, forearmLeft, leftShoulder, leftHand, -1);
      bentArm(armRight, forearmRight, rightShoulder, rightHand, 1);
      sleeveLeft.position.copy(leftShoulder);
      sleeveRight.position.copy(rightShoulder);
      pawLeft.position.copy(leftHand);
      pawRight.position.copy(rightHand);
      cheerAge += motionDt;
      for (let i = 0; i < hens.length; i++) {
        const hen = hens[i];
        hen.excitement = Math.max(0, hen.excitement - motionDt * 2.8);
        const lay = reducedMotion ? 0 : Math.sin(hen.excitement * Math.PI);
        const waveTime =
          encore && movieTime >= 5.4 ? (movieTime - 5.4) % 1.8 : cheerAge;
        const wave = THREE.MathUtils.clamp((waveTime - i * 0.12) / 0.42, 0, 1);
        const hop = reducedMotion ? 0 : 4 * wave * (1 - wave) * 0.18;
        const peckPhase = (sceneTime + i * 2.1) % 7;
        const peck =
          animate && peckPhase < 0.45
            ? Math.sin((peckPhase / 0.45) * Math.PI) * 0.17
            : 0;
        hen.mesh.position.y =
          hen.y + hop + (animate ? Math.sin(sceneTime * 2 + i * 2) * 0.014 : 0);
        hen.mesh.scale.set(1 + lay * 0.09, 1 - lay * 0.17, 1 + lay * 0.09);
        hen.mesh.rotation.x = peck;
        for (let j = 0; j < 2; j++)
          hen.mesh.userData.wings![j].rotation.z = reducedMotion
            ? (encore && movieTime >= 5.4 ? (j ? -1 : 1) * 0.65 : 0)
            : (j ? -1 : 1) * Math.sin(sceneTime * 26) * (lay * 0.24 + hop * 2);
      }

      contactShadows.count = 0;
      for (const preview of previewEggs) {
        preview.mesh.visible = idle && !encore;
        if (preview.mesh.visible) {
          const progress = reducedMotion
            ? preview.offset
            : (sceneTime * 0.055 + preview.offset) % 0.9;
          eggPosition(preview.mesh, preview.lane, progress);
          eggShadow(preview.lane, progress);
        }
      }
      const showEggs =
        !encore && (game.state === "playing" || game.state === "paused");
      for (const [id, mesh] of eggMeshes) {
        if (!showEggs || !game.eggs.some((egg) => egg.id === id)) {
          releaseEgg(mesh);
          eggMeshes.delete(id);
        }
      }
      if (showEggs)
        for (const egg of game.eggs) {
          if (!eggMeshes.has(egg.id))
            eggMeshes.set(egg.id, eggMesh(egg.golden));
          eggPosition(eggMeshes.get(egg.id)!, egg.lane, egg.progress);
          eggShadow(egg.lane, egg.progress);
        }
      contactShadows.instanceMatrix.needsUpdate = true;
      for (let i = eggFlights.length - 1; i >= 0; i--) {
        const flight = eggFlights[i];
        flight.age += motionDt;
        const mesh = flight.mesh;
        if (flight.caught) {
          const t = Math.min(1, flight.age / 0.3);
          mesh.position.copy(flight.origin).lerp(basket.position, t);
          mesh.position.y += Math.sin(t * Math.PI) * 0.64 - t * 0.2;
          mesh.rotation.z = flight.rotation + flight.direction * t * 2;
          mesh.scale.setScalar(
            mesh.userData.size! *
              (1 + Math.sin(t * Math.PI) * 0.2) *
              (1 - THREE.MathUtils.smoothstep(t, 0.7, 1) * 0.65),
          );
          if (t < 1) continue;
        } else {
          const t = Math.min(flight.age, flight.duration);
          const fall = t / flight.duration;
          mesh.position.set(
            flight.origin.x + flight.direction * t * 0.7,
            flight.origin.y - 0.6 * t - 3.6 * t * t,
            THREE.MathUtils.lerp(
              flight.origin.z,
              flight.front,
              THREE.MathUtils.smoothstep(fall, 0, 0.65),
            ),
          );
          mesh.rotation.set(
            t * 4,
            t * 2,
            flight.rotation + flight.direction * t * 7,
          );
          if (flight.age < flight.duration) continue;
          const bounce = Math.min(1, (flight.age - flight.duration) / 0.28);
          mesh.position.x += flight.direction * bounce * 0.15;
          mesh.position.y = 0.17 + 4 * bounce * (1 - bounce) * 0.18;
          mesh.rotation.z += flight.direction * bounce * 2;
          if (bounce < 1) continue;
          splat(mesh.position);
        }
        releaseEgg(mesh);
        eggFlights.splice(i, 1);
      }
      particleMesh.count = 0;
      for (const particle of particles) {
        if (!particle.active) continue;
        particle.age += motionDt;
        if (particle.age >= particle.duration) {
          particle.active = false;
          continue;
        }
        const t = particle.age;
        instance.position
          .copy(particle.origin)
          .addScaledVector(particle.velocity, t);
        instance.position.y = Math.max(
          0.045,
          instance.position.y - (particle.confetti ? 0.6 : 2.5) * t * t,
        );
        if (particle.confetti)
          instance.position.x += Math.sin(t * 4 + particle.spin) * t * 0.08;
        instance.rotation.set(
          t * particle.spin,
          t * particle.spin * 0.6,
          t * 2,
        );
        const fade =
          1 - THREE.MathUtils.smoothstep(t / particle.duration, 0.65, 1);
        instance.scale
          .set(
            particle.confetti ? 0.075 : 0.045,
            particle.confetti ? 0.025 : 0.05,
            0.035,
          )
          .multiplyScalar(fade);
        instance.updateMatrix();
        particleMesh.setMatrixAt(particleMesh.count, instance.matrix);
        particleMesh.setColorAt(particleMesh.count++, particle.color);
      }
      particleMesh.instanceMatrix.needsUpdate = true;
      if (particleMesh.instanceColor)
        particleMesh.instanceColor.needsUpdate = true;
      for (const spot of splats) {
        spot.age += motionDt;
        spot.mesh.visible = spot.age < 2.4;
        spot.mesh.material.opacity =
          1 - THREE.MathUtils.smoothstep(spot.age, 1.2, 2.4);
      }
      shakeAge += motionDt;
      const shake =
        !reducedMotion && shakeAge < 0.4
          ? Math.sin(shakeAge * 70) *
            Math.exp(-shakeAge * 13) *
            (1 - shakeAge / 0.4) *
            0.075
          : 0;
      camera.position.x =
        shake +
        (idle && !reducedMotion ? Math.sin(sceneTime * 0.55) * 0.035 : 0);
      camera.position.y =
        cameraHome.y +
        (idle && !reducedMotion ? Math.sin(sceneTime * 0.8) * 0.025 : 0);
      renderer.render(scene, camera);
    },
    event(event: GameEvent) {
      if (event.type === "spawn") {
        hens[event.egg.lane].excitement = 1;
        earTwitch = 1;
      }
      if (event.type === "catch") {
        catchBounce = 1;
        if (event.levelUp) cheerAge = 0;
        const mesh = takeEgg(event.egg);
        if (reducedMotion) releaseEgg(mesh);
        else {
          eggFlights.push({
            mesh,
            caught: true,
            age: 0,
            origin: mesh.position.clone(),
            rotation: mesh.rotation.z,
            direction: event.egg.lane < 2 ? -1 : 1,
          });
          burst(LANES[event.egg.lane].end, true, event.egg.golden);
        }
      }
      if (event.type === "miss") {
        shakeAge = 0;
        const mesh = takeEgg(event.egg),
          origin = mesh.position.clone();
        const direction = event.egg.lane < 2 ? 1 : -1;
        // Clear the lower rail while still above it, then fall in front of the chutes.
        const front = event.egg.lane % 2 === 0 ? 2.65 : 2.1;
        if (reducedMotion) {
          mesh.position.set(origin.x + direction * 0.5, 0.17, front);
          splat(mesh.position);
          releaseEgg(mesh);
        } else
          eggFlights.push({
            mesh,
            caught: false,
            age: 0,
            origin,
            direction,
            front,
            rotation: mesh.rotation.z,
            duration:
              (Math.sqrt(0.36 + 14.4 * Math.max(0, origin.y - 0.17)) - 0.6) /
              7.2,
          });
      }
      if (event.type === "start") {
        for (const mesh of eggMeshes.values()) releaseEgg(mesh);
        eggMeshes.clear();
        for (const flight of eggFlights) releaseEgg(flight.mesh);
        eggFlights.length = 0;
        for (const particle of particles) particle.active = false;
        for (const spot of splats) {
          spot.age = 3;
          spot.mesh.visible = false;
        }
        hens.forEach((hen) => {
          hen.excitement = 0;
        });
        rabbit.visible = gift.visible = false;
        giftGlow.material.opacity = 0;
        encoreCelebrated = wasEncore = false;
        particleMesh.count = 0;
        torso.position.set(0, 0, 0);
        torso.rotation.set(0, 0, 0);
        catchBounce = earTwitch = 0;
        cheerAge = 2;
        shakeAge = 1;
        basketVelocity.set(0, 0, 0);
        wolfVelocity.set(0, 0, 0);
        camera.position.copy(cameraHome);
        camera.zoom = 1;
        camera.updateProjectionMatrix();
      }
    },
    dispose() {
      resizeObserver.disconnect();
      scene.traverse((object: THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      }) => {
        if (object.geometry) ownedGeometries.add(object.geometry);
        if (object.material) {
          for (const mat of Array.isArray(object.material)
            ? object.material
            : [object.material])
            ownedMaterials.add(mat);
        }
      });
      for (const mat of materials.values()) ownedMaterials.add(mat);
      ownedGeometries.forEach((item) => item.dispose());
      ownedMaterials.forEach((item) => item.dispose());
      particleMesh.dispose();
      contactShadows.dispose();
      sun.shadow.dispose();
      signTexture.dispose();
      glowTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
