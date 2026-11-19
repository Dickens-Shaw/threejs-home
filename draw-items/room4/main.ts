import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  configureCutawayGamingRoomRenderer,
  createCutawayGamingRoomModel,
} from "../src/createCutawayGamingRoom";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("missing #app");

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
configureCutawayGamingRoomRenderer(renderer);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMappingExposure = 0.92;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#000000");

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 80);
camera.position.set(0.35, 5.6, 7.4);
camera.lookAt(0.1, 1.05, -0.35);

const model = createCutawayGamingRoomModel({
  castShadow: true,
  receiveShadow: true,
  qualityPriority: "balanced",
});
scene.add(model);
paintJourneyWordmark(model);

const hemi = new THREE.HemisphereLight("#d7e4ff", "#3a2430", 0.28);
scene.add(hemi);

const key = new THREE.DirectionalLight("#fff0dc", 0.42);
key.position.set(1.2, 5.4, 3.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 16;
key.shadow.camera.left = -5;
key.shadow.camera.right = 5;
key.shadow.camera.top = 5;
key.shadow.camera.bottom = -5;
scene.add(key);

const blue = new THREE.PointLight("#6f8cff", 36, 7, 2);
blue.position.set(-1.15, 2.05, 0.15);
scene.add(blue);

const magenta = new THREE.PointLight("#ff3d86", 34, 7, 2);
magenta.position.set(1.35, 1.7, -0.2);
scene.add(magenta);

const lamp = new THREE.PointLight("#fff6df", 1.1, 2.4, 2);
lamp.position.set(-1.55, 1.42, -1.15);
scene.add(lamp);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.1, 1.05, -0.35);
controls.enableDamping = true;
controls.maxDistance = 14;
controls.update();

function paintJourneyWordmark(root: THREE.Object3D) {
  const screen = root.getObjectByName("TV screen");
  if (!(screen instanceof THREE.Mesh)) return;
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f3f3f3";
  ctx.font = "600 54px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("◆  three.js journey", canvas.width / 2, 250);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const source = screen.material;
  const material = (Array.isArray(source) ? source[0] : source).clone();
  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.map = texture;
    material.emissiveMap = texture;
    material.color.set("#ffffff");
    material.emissive.set("#d8d8d8");
    material.emissiveIntensity = 0.45;
    material.roughness = 0.32;
    material.needsUpdate = true;
    screen.material = material;
  }
}

function frame() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
