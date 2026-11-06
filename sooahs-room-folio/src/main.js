import gsap from "gsap";
import { Howl } from "howler";

import * as THREE from "three";
import { OrbitControls } from "./utils/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { createAssetViews } from "./asset-views.js";
import { assemblePiano } from "./assemblePiano.js";
import { assembleCatalog } from "./assembleCatalog.js";
import { attachContactShadows } from "./contactShadows.js";
import smokeVertexShader from "./shaders/smoke/vertex.glsl";
import smokeFragmentShader from "./shaders/smoke/fragment.glsl";
import themeVertexShader from "./shaders/theme/vertex.glsl";
import themeFragmentShader from "./shaders/theme/fragment.glsl";

const WOODEN_SIGN = [
  "Hanging_Plank_1",
  "Hanging_Plank_2",
  "My_Work_Button",
  "About_Button",
  "Contact_Button",
];

const pianoKeyMap = {
  C1_Key: "Key_24",
  "C#1_Key": "Key_23",
  D1_Key: "Key_22",
  "D#1_Key": "Key_21",
  E1_Key: "Key_20",
  F1_Key: "Key_19",
  "F#1_Key": "Key_18",
  G1_Key: "Key_17",
  "G#1_Key": "Key_16",
  A1_Key: "Key_15",
  "A#1_Key": "Key_14",
  B1_Key: "Key_13",
  C2_Key: "Key_12",
  "C#2_Key": "Key_11",
  D2_Key: "Key_10",
  "D#2_Key": "Key_9",
  E2_Key: "Key_8",
  F2_Key: "Key_7",
  "F#2_Key": "Key_6",
  G2_Key: "Key_5",
  "G#2_Key": "Key_4",
  A2_Key: "Key_3",
  "A#2_Key": "Key_2",
  B2_Key: "Key_1",
};

const pianoSounds = {};

Object.values(pianoKeyMap).forEach((soundKey) => {
  pianoSounds[soundKey] = new Howl({
    src: [`/audio/sfx/piano/${soundKey}.ogg`],
    preload: true,
    volume: 0.5,
  });
});

const buttonSounds = {
  click: new Howl({
    src: ["/audio/sfx/click/bubble.ogg"],
    preload: true,
    volume: 0.5,
  }),
};

const socialLinks = {
  GitHub: "https://github.com/andrewwoan/sooahkimsfolio",
  YouTube: "https://youtu.be/AB6sulUMRGE",
  Twitter: "https://www.twitter.com/",
};

const useOriginalMeshObjects = ["Bulb", "Cactus", "Kirby"];

const canvas = document.querySelector("#experience-canvas");
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#D9CAD1");

const camera = new THREE.PerspectiveCamera(
  35,
  sizes.width / sizes.height,
  0.1,
  200
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});

renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const controls = new OrbitControls(camera, renderer.domElement);
controls.minDistance = 5;
controls.maxDistance = 45;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI / 2;
controls.minAzimuthAngle = 0;
controls.maxAzimuthAngle = Math.PI / 2;
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.update();

if (window.innerWidth < 768) {
  camera.position.set(
    29.567116827654726,
    14.018476147584705,
    31.37040363900147
  );
  controls.target.set(
    -0.08206262548844094,
    3.3119233527087255,
    -0.7433922282864018
  );
} else {
  camera.position.set(17.49173098423395, 9.108969527553887, 17.850992894238058);
  controls.target.set(
    0.4624746759408973,
    1.9719940043010387,
    -0.8300979125494505
  );
}

window.addEventListener("resize", () => {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;
  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

const textureLoader = new THREE.TextureLoader();

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("/draco/");

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

const environmentMap = new THREE.CubeTextureLoader()
  .setPath("textures/skybox/")
  .load(["px.webp", "nx.webp", "py.webp", "ny.webp", "pz.webp", "nz.webp"]);

const textureMap = {
  First: {
    day: "/textures/room/day/first_texture_set_day.webp",
    night: "/textures/room/night/first_texture_set_night.webp",
  },
  Second: {
    day: "/textures/room/day/second_texture_set_day.webp",
    night: "/textures/room/night/second_texture_set_night.webp",
  },
  Third: {
    day: "/textures/room/day/third_texture_set_day.webp",
    night: "/textures/room/night/third_texture_set_night.webp",
  },
  Fourth: {
    day: "/textures/room/day/fourth_texture_set_day.webp",
    night: "/textures/room/night/fourth_texture_set_night.webp",
  },
};

const loadedTextures = {
  day: {},
  night: {},
};

Object.entries(textureMap).forEach(([key, paths]) => {
  const dayTexture = textureLoader.load(paths.day);
  dayTexture.flipY = false;
  dayTexture.colorSpace = THREE.SRGBColorSpace;
  dayTexture.minFilter = THREE.LinearFilter;
  dayTexture.magFilter = THREE.LinearFilter;
  loadedTextures.day[key] = dayTexture;

  const nightTexture = textureLoader.load(paths.night);
  nightTexture.flipY = false;
  nightTexture.colorSpace = THREE.SRGBColorSpace;
  nightTexture.minFilter = THREE.LinearFilter;
  nightTexture.magFilter = THREE.LinearFilter;
  loadedTextures.night[key] = nightTexture;
});

const glassMaterial = new THREE.MeshPhysicalMaterial({
  transmission: 1,
  opacity: 1,
  color: 0xfbfbfb,
  metalness: 0,
  roughness: 0,
  ior: 3,
  thickness: 0.01,
  specularIntensity: 1,
  envMap: environmentMap,
  envMapIntensity: 1,
  depthWrite: false,
  specularColor: 0xfbfbfb,
});

const whiteMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
});

const createMaterialForTextureSet = (textureSet) => {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uDayTexture1: { value: loadedTextures.day.First },
      uNightTexture1: { value: loadedTextures.night.First },
      uDayTexture2: { value: loadedTextures.day.Second },
      uNightTexture2: { value: loadedTextures.night.Second },
      uDayTexture3: { value: loadedTextures.day.Third },
      uNightTexture3: { value: loadedTextures.night.Third },
      uDayTexture4: { value: loadedTextures.day.Fourth },
      uNightTexture4: { value: loadedTextures.night.Fourth },
      uMixRatio: { value: 0 },
      uTextureSet: { value: textureSet },
    },
    vertexShader: themeVertexShader,
    fragmentShader: themeFragmentShader,
  });

  Object.entries(material.uniforms).forEach(([, uniform]) => {
    if (uniform.value instanceof THREE.Texture) {
      uniform.value.minFilter = THREE.LinearFilter;
      uniform.value.magFilter = THREE.LinearFilter;
    }
  });

  return material;
};

const roomMaterials = {
  First: createMaterialForTextureSet(1),
  Second: createMaterialForTextureSet(2),
  Third: createMaterialForTextureSet(3),
  Fourth: createMaterialForTextureSet(4),
};

const smokeGeometry = new THREE.PlaneGeometry(1, 1, 16, 64);
smokeGeometry.translate(0, 0.5, 0);
smokeGeometry.scale(0.33, 1, 0.33);

const perlinTexture = textureLoader.load("/shaders/perlin.png");
perlinTexture.wrapS = THREE.RepeatWrapping;
perlinTexture.wrapT = THREE.RepeatWrapping;

const smokeMaterial = new THREE.ShaderMaterial({
  vertexShader: smokeVertexShader,
  fragmentShader: smokeFragmentShader,
  uniforms: {
    uTime: new THREE.Uniform(0),
    uPerlinTexture: new THREE.Uniform(perlinTexture),
  },
  side: THREE.DoubleSide,
  transparent: true,
  depthWrite: false,
});

const smoke = new THREE.Mesh(smokeGeometry, smokeMaterial);
smoke.position.y = 1.83;
scene.add(smoke);

const videoElement = document.createElement("video");
videoElement.src = "/textures/video/Screen.mp4";
videoElement.loop = true;
videoElement.muted = true;
videoElement.playsInline = true;
videoElement.autoplay = true;
videoElement.play();

const videoTexture = new THREE.VideoTexture(videoElement);
videoTexture.colorSpace = THREE.SRGBColorSpace;
videoTexture.flipY = false;

let fish;
let coffeeMesh;
let hourHand;
let minuteHand;
let chairTop;
const xAxisFans = [];
const yAxisFans = [];

const raycasterObjects = [];
const hitboxToObjectMap = new Map();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let currentIntersects = [];
let currentHoveredObject = null;

const isWoodenSign = (name) =>
  WOODEN_SIGN.some((part) => name.includes(part));

const assetViews = createAssetViews({
  scene,
  camera,
  controls,
  isHidden: isWoodenSign,
  onBeforeLayout() {
    if (!currentHoveredObject) return;
    playHoverAnimation(currentHoveredObject, false);
    currentHoveredObject = null;
  },
});

const shouldUseOriginalMesh = (objectName) =>
  useOriginalMeshObjects.some((meshName) => objectName.includes(meshName));

const rememberTransform = (object) => {
  if (!object.userData.initialScale) {
    object.userData.initialScale = object.scale.clone();
  }
  if (!object.userData.initialPosition) {
    object.userData.initialPosition = object.position.clone();
  }
  if (!object.userData.initialRotation) {
    object.userData.initialRotation = object.rotation.clone();
  }
};

function createStaticHitbox(originalObject) {
  rememberTransform(originalObject);

  if (shouldUseOriginalMesh(originalObject.name)) {
    originalObject.userData.originalObject = originalObject;
    return originalObject;
  }

  const box = new THREE.Box3().setFromObject(originalObject);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(size.x * 1.1, size.y * 1.75, size.z * 1.1),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      visible: false,
    })
  );

  hitbox.position.copy(center);
  hitbox.name = `${originalObject.name}_Hitbox`;
  hitbox.userData.originalObject = originalObject;
  originalObject.userData.hitbox = hitbox;
  originalObject.userData.homeHitboxPosition = hitbox.position.clone();

  if (originalObject.name.includes("Headphones")) {
    hitbox.rotation.set(0, Math.PI / 4, 0);
  }

  return hitbox;
}

loader.load("/models/Room_Portfolio.glb", (glb) => {
  const meshes = [];

  glb.scene.traverse((child) => {
    if (!child.isMesh) return;
    meshes.push(child);

    if (child.name.includes("Fish_Fourth")) {
      fish = child;
      child.position.x += 0.04;
      child.position.z -= 0.03;
      child.userData.initialPosition = child.position.clone();
    }

    if (child.name.includes("Chair_Top")) {
      chairTop = child;
      child.userData.initialRotation = child.rotation.clone();
    }

    if (child.name.includes("Hour_Hand")) {
      hourHand = child;
    }

    if (child.name.includes("Minute_Hand")) {
      minuteHand = child;
    }

    if (child.name.includes("Coffee")) {
      coffeeMesh = child;
      smoke.position.set(
        child.position.x,
        child.position.y + 0.2,
        child.position.z
      );
    }

    if (child.name.includes("Hover") || child.name.includes("Key")) {
      rememberTransform(child);
    }

    if (child.name.includes("Water")) {
      child.material = new THREE.MeshBasicMaterial({
        color: 0x558bc8,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      });
    } else if (child.name.includes("Glass")) {
      child.material = glassMaterial;
    } else if (child.name.includes("Bubble")) {
      child.material = whiteMaterial;
    } else if (child.name.includes("Screen")) {
      child.material = new THREE.MeshBasicMaterial({
        map: videoTexture,
        transparent: true,
        opacity: 0.9,
      });
    } else {
      Object.keys(textureMap).forEach((key) => {
        if (!child.name.includes(key)) return;

        child.material = roomMaterials[key];

        if (!child.name.includes("Fan")) return;

        if (child.name.includes("Fan_2") || child.name.includes("Fan_4")) {
          xAxisFans.push(child);
        } else {
          yAxisFans.push(child);
        }
      });
    }

    if (child.name.includes("Raycaster")) {
      const raycastObject = createStaticHitbox(child);

      if (raycastObject !== child) {
        scene.add(raycastObject);
      }

      raycasterObjects.push(raycastObject);
      hitboxToObjectMap.set(raycastObject, child);
    }
  });

  const piano = assemblePiano(glb.scene);
  const catalog = assembleCatalog(glb.scene);
  if (fish) fish.userData.initialPosition = fish.position.clone();
  catalog.groups.forEach((group) => {
    const hitbox = createStaticHitbox(group);
    if (hitbox === group) return;
    scene.add(hitbox);
    raycasterObjects.push(hitbox);
    hitboxToObjectMap.set(hitbox, group);
  });
  const listed = meshes
    .filter((mesh) => !(piano && piano.keys.has(mesh)) && !catalog.consumed.has(mesh))
    .concat(piano ? [piano.group] : [], catalog.groups);

  scene.add(glb.scene);
  attachContactShadows({
    root: glb.scene,
    textures: loadedTextures,
    materials: roomMaterials,
  });
  assetViews.setMeshes(listed);
});

function handleRaycasterInteraction() {
  if (currentIntersects.length === 0) return;

  const hitbox = currentIntersects[0].object;
  const object = hitboxToObjectMap.get(hitbox) || hitbox;
  if (!object) return;
  assetViews.selectByMesh(object);

  if (object.name.includes("Button")) {
    buttonSounds.click.play();
  }

  Object.entries(pianoKeyMap).forEach(([keyName, soundKey]) => {
    if (!object.name.includes(keyName)) return;

    pianoSounds[soundKey].play();

    gsap.to(object.rotation, {
      x: object.userData.initialRotation.x + Math.PI / 42,
      duration: 0.4,
      ease: "back.out(2)",
      onComplete: () => {
        gsap.to(object.rotation, {
          x: object.userData.initialRotation.x,
          duration: 0.25,
          ease: "back.out(2)",
        });
      },
    });
  });

  Object.entries(socialLinks).forEach(([key, url]) => {
    if (assetViews.getMode() !== "assembled" || assetViews.isApplying()) return;
    if (!object.name.includes(key)) return;

    const newWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (newWindow) newWindow.opener = null;
  });
}

function playHoverAnimation(objectHitbox, isHovering) {
  if (assetViews.getMode() !== "assembled" || assetViews.isApplying()) return;

  const object = hitboxToObjectMap.get(objectHitbox);
  if (!object) return;

  let scale = 1.4;
  gsap.killTweensOf(object.scale);
  gsap.killTweensOf(object.rotation);
  gsap.killTweensOf(object.position);

  if (object.name.includes("Coffee")) {
    gsap.killTweensOf(smoke.scale);
    gsap.to(smoke.scale, {
      x: isHovering ? 1.4 : 1,
      y: isHovering ? 1.4 : 1,
      z: isHovering ? 1.4 : 1,
      duration: isHovering ? 0.5 : 0.3,
      ease: "back.out(2)",
    });
  }

  if (object.name.includes("Fish")) {
    scale = 1.2;
  }

  if (isHovering) {
    gsap.to(object.scale, {
      x: object.userData.initialScale.x * scale,
      y: object.userData.initialScale.y * scale,
      z: object.userData.initialScale.z * scale,
      duration: 0.5,
      ease: "back.out(2)",
    });

    if (
      object.name.includes("GitHub") ||
      object.name.includes("YouTube") ||
      object.name.includes("Twitter")
    ) {
      gsap.to(object.rotation, {
        x: object.userData.initialRotation.x + Math.PI / 10,
        duration: 0.5,
        ease: "back.out(2)",
      });
    }

    if (object.name.includes("Boba") || object.name.includes("Name_Letter")) {
      gsap.to(object.position, {
        y: object.userData.initialPosition.y + 0.2,
        duration: 0.5,
        ease: "back.out(2)",
      });
    }
    return;
  }

  gsap.to(object.scale, {
    x: object.userData.initialScale.x,
    y: object.userData.initialScale.y,
    z: object.userData.initialScale.z,
    duration: 0.3,
    ease: "back.out(2)",
  });

  if (
    object.name.includes("GitHub") ||
    object.name.includes("YouTube") ||
    object.name.includes("Twitter")
  ) {
    gsap.to(object.rotation, {
      x: object.userData.initialRotation.x,
      duration: 0.3,
      ease: "back.out(2)",
    });
  }

  if (object.name.includes("Boba") || object.name.includes("Name_Letter")) {
    gsap.to(object.position, {
      y: object.userData.initialPosition.y,
      duration: 0.3,
      ease: "back.out(2)",
    });
  }
}

const isUiTarget = (event) =>
  Boolean(event.target.closest?.(".toggle-buttons, .view-switch, .asset-panel"));

window.addEventListener("mousemove", (event) => {
  pointer.x = (event.clientX / sizes.width) * 2 - 1;
  pointer.y = -(event.clientY / sizes.height) * 2 + 1;
});

window.addEventListener("click", (event) => {
  if (isUiTarget(event)) return;
  handleRaycasterInteraction();
});

window.addEventListener(
  "touchstart",
  (event) => {
    if (!event.touches[0]) return;
    pointer.x = (event.touches[0].clientX / sizes.width) * 2 - 1;
    pointer.y = -(event.touches[0].clientY / sizes.height) * 2 + 1;
  },
  { passive: true }
);

window.addEventListener("touchend", (event) => {
  if (isUiTarget(event)) return;
  handleRaycasterInteraction();
});

const themeToggleButton = document.querySelector(".theme-toggle-button");
const muteToggleButton = document.querySelector(".mute-toggle-button");
const sunSvg = document.querySelector(".sun-svg");
const moonSvg = document.querySelector(".moon-svg");
const soundOffSvg = document.querySelector(".sound-off-svg");
const soundOnSvg = document.querySelector(".sound-on-svg");

let isMuted = false;

const updateMuteState = (muted) => {
  buttonSounds.click.mute(muted);
  Object.values(pianoSounds).forEach((sound) => {
    sound.mute(muted);
  });
};

const handleMuteToggle = (event) => {
  event.preventDefault();
  isMuted = !isMuted;
  updateMuteState(isMuted);
  buttonSounds.click.play();
  soundOnSvg.style.display = isMuted ? "none" : "block";
  soundOffSvg.style.display = isMuted ? "block" : "none";

  gsap.to(muteToggleButton, {
    rotate: -45,
    scale: 5,
    duration: 0.5,
    ease: "back.out(2)",
    onComplete: () => {
      gsap.to(muteToggleButton, {
        rotate: 0,
        scale: 1,
        duration: 0.5,
        ease: "back.out(2)",
        onComplete: () => {
          gsap.set(muteToggleButton, { clearProps: "all" });
        },
      });
    },
  });
};

muteToggleButton.addEventListener("click", handleMuteToggle);

let isNightMode = false;

const handleThemeToggle = (event) => {
  event.preventDefault();
  const isDark = document.body.classList.contains("dark-theme");
  document.body.classList.remove(isDark ? "dark-theme" : "light-theme");
  document.body.classList.add(isDark ? "light-theme" : "dark-theme");

  isNightMode = !isNightMode;
  buttonSounds.click.play();
  sunSvg.style.display = isNightMode ? "none" : "block";
  moonSvg.style.display = isNightMode ? "block" : "none";

  gsap.to(themeToggleButton, {
    rotate: 45,
    scale: 5,
    duration: 0.5,
    ease: "back.out(2)",
    onComplete: () => {
      gsap.to(themeToggleButton, {
        rotate: 0,
        scale: 1,
        duration: 0.5,
        ease: "back.out(2)",
        onComplete: () => {
          gsap.set(themeToggleButton, { clearProps: "all" });
        },
      });
    },
  });

  Object.values(roomMaterials).forEach((material) => {
    gsap.to(material.uniforms.uMixRatio, {
      value: isNightMode ? 1 : 0,
      duration: 1.5,
      ease: "power2.inOut",
    });
  });
};

themeToggleButton.addEventListener("click", handleThemeToggle);

const clock = new THREE.Clock();

const updateClockHands = () => {
  if (!hourHand || !minuteHand) return;

  const now = new Date();
  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const minuteAngle = (minutes + seconds / 60) * ((Math.PI * 2) / 60);
  const hourAngle = (hours + minutes / 60) * ((Math.PI * 2) / 12);

  minuteHand.rotation.x = -minuteAngle;
  hourHand.rotation.x = -hourAngle;
};

const render = (timestamp) => {
  smokeMaterial.uniforms.uTime.value = clock.getElapsedTime();
  controls.update();
  updateClockHands();

  xAxisFans.forEach((fan) => {
    fan.rotation.x -= 0.04;
  });

  yAxisFans.forEach((fan) => {
    fan.rotation.y -= 0.04;
  });

  if (chairTop) {
    const time = timestamp * 0.001;
    const baseAmplitude = Math.PI / 8;
    const rotationOffset =
      baseAmplitude *
      Math.sin(time * 0.5) *
      (1 - Math.abs(Math.sin(time * 0.5)) * 0.3);

    chairTop.rotation.y = chairTop.userData.initialRotation.y + rotationOffset;
  }

  if (fish && !assetViews.isApplying()) {
    const time = timestamp * 0.0015;
    const amplitude = 0.12;
    const position =
      amplitude * Math.sin(time) * (1 - Math.abs(Math.sin(time)) * 0.1);

    fish.position.y = fish.userData.initialPosition.y + position;
  }

  assetViews.update(timestamp);

  if (coffeeMesh) {
    coffeeMesh.getWorldPosition(smoke.position);
    smoke.position.y += 0.2 * coffeeMesh.scale.y;
    smoke.visible = coffeeMesh.visible;
  }

  const layoutActive = assetViews.getMode() !== "assembled" || assetViews.isApplying();
  raycaster.setFromCamera(pointer, camera);
  currentIntersects = raycaster.intersectObjects(
    layoutActive ? assetViews.pickables() : raycasterObjects
  );

  if (layoutActive) {
    document.body.style.cursor = currentIntersects.length > 0 ? "pointer" : "default";
    renderer.render(scene, camera);
    window.requestAnimationFrame(render);
    return;
  }

  if (currentIntersects.length > 0) {
    const currentIntersectObject = currentIntersects[0].object;

    if (currentIntersectObject.name.includes("Hover")) {
      if (currentIntersectObject !== currentHoveredObject) {
        if (currentHoveredObject) {
          playHoverAnimation(currentHoveredObject, false);
        }

        currentHoveredObject = currentIntersectObject;
        playHoverAnimation(currentIntersectObject, true);
      }
    } else if (currentHoveredObject) {
      playHoverAnimation(currentHoveredObject, false);
      currentHoveredObject = null;
    }

    document.body.style.cursor = currentIntersectObject.name.includes("Pointer")
      ? "pointer"
      : "default";
  } else {
    if (currentHoveredObject) {
      playHoverAnimation(currentHoveredObject, false);
      currentHoveredObject = null;
    }
    document.body.style.cursor = "default";
  }

  renderer.render(scene, camera);
  window.requestAnimationFrame(render);
};

render();
