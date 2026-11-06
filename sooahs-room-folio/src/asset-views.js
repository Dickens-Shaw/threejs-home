import gsap from "gsap";
import * as THREE from "three";

const LIST_CELL = 2.6;
const LIST_FIT = 1.75;
const LIST_Y = 1.2;

const TITLE_RULES = [
  [/^Piano/, "电子琴"],
  [/^Clock/, "时钟"],
  [/^Pegboard/, "洞洞板"],
  [/^Window/, "窗户"],
  [/^Shelf/, "层架"],
  [/^Monitor/, "显示器"],
  [/^Computer_Fourth/, "电脑"],
  [/^Keyboard_Fourth/, "键盘"],
  [/^Chair_Fourth/, "办公椅"],
  [/^Cabinet/, "抽屉柜"],
  [/^Stool/, "木凳"],
  [/^Desk/, "书桌"],
  [/^Name_Sign/, "名字牌"],
  [/^Rug/, "地毯"],
  [/^Fish_Bowl$/, "鱼缸"],
  [/^String_Lights/, "串灯"],
  [/^(First|Second|Third|Fourth)$/, "房间主体"],
  [/^Screen$/, "屏幕"],
  [/^Computer_Glass$/, "电脑玻璃"],
  [/^Fish_Bowl_Glass$/, "鱼缸"],
  [/^Fish_Bowl_Water$/, "鱼缸水"],
  [/^Hour_Hand/, "时针"],
  [/^Minute_Hand/, "分针"],
  [/^Chair_Top/, "椅背"],
  [/^Coffee_Mug/, "咖啡杯"],
  [/^Computer_Fan_(\d+)/, "电脑风扇 $1"],
  [/^Keyboard_(\d+)/, "键盘 $1"],
  [/^([A-G]#?\d)_Key/, "琴键 $1"],
  [/^About_Button/, "About 木牌"],
  [/^Contact_Button/, "Contact 木牌"],
  [/^My_Work_Button/, "My Work 木牌"],
  [/^Hanging_Plank_(\d+)/, "挂牌 $1"],
  [/^Name_Letter_(\d+)/, "名字字母 $1"],
  [/^Name_Platform/, "名字底座"],
  [/^GitHub/, "GitHub"],
  [/^YouTube/, "YouTube"],
  [/^Twitter/, "Twitter"],
  [/^Kirby/, "Kirby"],
  [/^MrRabbit_Son/, "兔子小孩"],
  [/^MrRabbit/, "兔子"],
  [/^Poro/, "Poro"],
  [/^Cactus/, "仙人掌"],
  [/^Lamp/, "台灯"],
  [/^Microphone/, "麦克风"],
  [/^Headphones/, "耳机"],
  [/^Mouth/, "嘴巴"],
  [/^Fish_/, "鱼"],
  [/^Flower_Basket/, "花篮"],
  [/^Flower_(\d+)/, "花 $1"],
  [/^Egg_(\d+)/, "蛋 $1"],
  [/^Box_(\d+)/, "盒子 $1"],
  [/^Book_(\d+)/, "书 $1"],
  [/^Bulb_(\d+)/, "灯泡 $1"],
  [/^Pencil_Holder/, "笔筒"],
  [/^Pencil_(\d+)/, "铅笔 $1"],
  [/^Slipper_(\d+)/, "拖鞋 $1"],
  [/^Frame_(\d+)/, "相框 $1"],
  [/^Rock_(\d+)/, "石头 $1"],
  [/^Seaweed_(\d+)/, "水草 $1"],
  [/^Boba/, "珍珠奶茶玩偶"],
];

export function assetLabel(name) {
  for (const [pattern, title] of TITLE_RULES) {
    const match = name.match(pattern);
    if (match) return title.replace(/\$(\d)/g, (_, index) => match[index] || "");
  }

  return name
    .replace(/_(Raycaster|Pointer|Hover)/g, "")
    .replace(/_(First|Second|Third|Fourth)/g, "")
    .replace(/_+/g, " ")
    .trim();
}

const MODEL_FILE = "Room_Portfolio.glb";

const GROUPS = [
  { id: "First", title: "第一块" },
  { id: "Second", title: "第二块" },
  { id: "Third", title: "第三块" },
  { id: "Fourth", title: "第四块" },
  { id: "other", title: "其他" },
];

function textureSet(name) {
  if (name === "First" || name.includes("_First") || name.endsWith("First")) return "First";
  if (name === "Second" || name.includes("_Second") || name.endsWith("Second")) return "Second";
  if (name === "Third" || name.includes("_Third") || name.endsWith("Third")) return "Third";
  if (name === "Fourth" || name.includes("_Fourth") || name.endsWith("Fourth")) return "Fourth";
  return "other";
}

function assetKind(name) {
  if (/^(First|Second|Third|Fourth)$/.test(name)) return "结构";
  if (/^Piano/.test(name)) return "钢琴";
  if (/^Clock/.test(name)) return "时钟";
  if (/^Monitor|^Screen/.test(name)) return "屏幕";
  if (/^Fish_Bowl$/.test(name)) return "玻璃";
  if (/Water/.test(name)) return "水体";
  if (/Glass|Bubble/.test(name)) return "玻璃";
  if (/Keyboard/.test(name)) return "键盘";
  if (/Key/.test(name)) return "钢琴";
  if (/Button|Hanging_Plank/.test(name)) return "木牌";
  if (/Hour_Hand|Minute_Hand/.test(name)) return "时钟";
  if (/Chair|Coffee|Fan|Lamp|Headphones|Microphone|Book|Box|Pencil|Slipper|Frame|Name_Platform|Name_Sign|Window|Cabinet|Stool|Desk|Computer_Fourth|Pegboard|Shelf/.test(name)) {
    return "家具";
  }
  return "装饰";
}

function triangleCount(object) {
  let count = 0;
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry || child.userData.contactShadow) return;
    const index = child.geometry.getIndex();
    if (index) {
      count += index.count / 3;
      return;
    }
    const position = child.geometry.getAttribute("position");
    if (position) count += position.count / 3;
  });
  return Math.round(count);
}

function detailLine(asset) {
  const faces = asset.triangles ? `${asset.triangles.toLocaleString("en-US")} 面` : "";
  return [asset.kind, asset.anchor ? "不位移" : "", MODEL_FILE, faces].filter(Boolean).join(" · ");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char];
  });
}

function fishBob(timestamp) {
  const time = timestamp * 0.0015;
  const amplitude = 0.12;
  return amplitude * Math.sin(time) * (1 - Math.abs(Math.sin(time)) * 0.1);
}

export function createAssetViews({ scene, camera, controls, isHidden, onBeforeLayout }) {
  const assets = [];
  const byMesh = new Map();
  const helper = new THREE.BoxHelper(
    new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01)),
    0x6c3f7c
  );
  helper.visible = false;
  scene.add(helper);

  const savedLimits = {
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
    minPolarAngle: controls.minPolarAngle,
    maxPolarAngle: controls.maxPolarAngle,
    minAzimuthAngle: controls.minAzimuthAngle,
    maxAzimuthAngle: controls.maxAzimuthAngle,
  };

  let mode = "assembled";
  let ready = false;
  let applying = false;
  let selected = null;
  let assembledCamera = null;
  let activeTimeline = null;
  let leaders = null;

  const panel = document.querySelector(".asset-panel");
  const list = document.querySelector(".asset-list");
  const search = document.querySelector(".asset-search");
  const summary = document.querySelector(".asset-summary");
  const hint = document.querySelector(".asset-hint");
  const buttons = [...document.querySelectorAll(".view-button")];

  function relaxLimits(nextMode) {
    controls.minDistance = 0.5;
    controls.maxDistance = 300;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = nextMode === "exploded" ? Math.PI * 0.42 : Math.PI / 2;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
  }

  function restoreLimits() {
    controls.minDistance = savedLimits.minDistance;
    controls.maxDistance = savedLimits.maxDistance;
    controls.minPolarAngle = savedLimits.minPolarAngle;
    controls.maxPolarAngle = savedLimits.maxPolarAngle;
    controls.minAzimuthAngle = savedLimits.minAzimuthAngle;
    controls.maxAzimuthAngle = savedLimits.maxAzimuthAngle;
  }

  function measure(mesh) {
    mesh.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) {
      return {
        homeSize: new THREE.Vector3(0.2, 0.2, 0.2),
        centerOffset: new THREE.Vector3(),
      };
    }

    const homeSize = box.getSize(new THREE.Vector3());
    const centerOffset = box.getCenter(new THREE.Vector3()).sub(mesh.position);
    return { homeSize, centerOffset };
  }

  function isShell(asset) {
    return asset.label.startsWith("房间主体");
  }

  function isFirstShell(asset) {
    return asset.mesh.name === "First" || asset.label === "房间主体 First";
  }

  function buildLayouts() {
    const first = assets.find((asset) => isFirstShell(asset));
    const focus = first ? first.homeCenter.clone() : new THREE.Vector3();
    const roomRadius = first
      ? Math.max(first.homeSize.x, first.homeSize.y, first.homeSize.z) * 0.5
      : 2;
    const push = Math.max(roomRadius * 0.95, 0.8);
    const lift = Math.max(roomRadius * 0.18, 0.15);
    const movable = [];

    assets.forEach((asset, index) => {
      if (isShell(asset)) {
        asset.explodePosition = asset.homePosition.clone();
        asset.explodedCenter = asset.homeCenter.clone();
        return;
      }

      const direction = asset.homeCenter.clone().sub(focus);
      direction.y *= 0.2;
      if (direction.lengthSq() < 1e-4) {
        const angle = (index / Math.max(assets.length, 1)) * Math.PI * 2;
        direction.set(Math.cos(angle), 0.15, Math.sin(angle));
      }
      direction.normalize();

      asset.explodedCenter = asset.homeCenter.clone().addScaledVector(direction, push);
      asset.explodedCenter.y = Math.max(asset.explodedCenter.y + lift, asset.homeCenter.y);
      asset.explodeRadius = Math.min(
        Math.max(Math.max(asset.homeSize.x, asset.homeSize.y, asset.homeSize.z) * 0.28, 0.08),
        roomRadius * 0.28
      );
      movable.push(asset);
    });

    for (let iteration = 0; iteration < 24; iteration += 1) {
      for (let i = 0; i < movable.length; i += 1) {
        for (let j = i + 1; j < movable.length; j += 1) {
          const a = movable[i];
          const b = movable[j];
          const diff = b.explodedCenter.clone().sub(a.explodedCenter);
          let distance = diff.length();
          const minDistance = a.explodeRadius + b.explodeRadius + 0.08;

          if (distance >= minDistance) continue;

          if (distance < 1e-5) {
            diff.set(((i * 3) % 5) - 2, 0.35, ((j * 5) % 5) - 2);
            distance = diff.length();
          }

          diff.multiplyScalar(1 / distance);
          const gap = (minDistance - distance) * 0.5;
          a.explodedCenter.addScaledVector(diff, -gap);
          b.explodedCenter.addScaledVector(diff, gap);
          a.explodedCenter.y = Math.max(a.explodedCenter.y, a.homeCenter.y);
          b.explodedCenter.y = Math.max(b.explodedCenter.y, b.homeCenter.y);
        }
      }
    }

    movable.forEach((asset) => {
      asset.explodePosition = asset.explodedCenter.clone().sub(asset.centerOffset);
    });

    const columns = Math.max(1, Math.ceil(Math.sqrt(assets.length)));
    const originX = -((columns - 1) * LIST_CELL) / 2;

    assets.forEach((asset, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const maxDim = Math.max(asset.homeSize.x, asset.homeSize.y, asset.homeSize.z, 0.001);
      const fitted = LIST_FIT / maxDim;
      asset.listScale = asset.homeScale.clone().multiplyScalar(fitted);
      const rows = Math.ceil(assets.length / columns);
      const originZ = -((rows - 1) * LIST_CELL) / 2;
      const targetCenter = new THREE.Vector3(
        originX + column * LIST_CELL,
        LIST_Y,
        originZ + row * LIST_CELL
      );
      asset.listPosition = targetCenter.sub(asset.centerOffset.clone().multiplyScalar(fitted));
      asset.listColumns = columns;
      asset.listRows = rows;
    });
  }

  function targetsFor(nextMode, asset) {
    if (nextMode === "exploded") {
      return { position: asset.explodePosition, scale: asset.homeScale };
    }
    if (nextMode === "list") {
      return { position: asset.listPosition, scale: asset.listScale };
    }
    return { position: asset.homePosition, scale: asset.homeScale };
  }

  function boundsFor(nextMode) {
    const box = new THREE.Box3();
    if (nextMode === "list" && assets.length > 0) {
      const columns = assets[0].listColumns;
      const rows = assets[0].listRows;
      const width = (columns - 1) * LIST_CELL + LIST_FIT;
      const depth = (rows - 1) * LIST_CELL + LIST_FIT;
      box.set(
        new THREE.Vector3(-width / 2, LIST_Y - LIST_FIT / 2, -depth / 2),
        new THREE.Vector3(width / 2, LIST_Y + LIST_FIT / 2, depth / 2)
      );
      return box;
    }

    assets.forEach((asset) => {
      if (nextMode === "exploded" && isShell(asset) && !isFirstShell(asset)) return;

      const center = nextMode === "exploded" && asset.explodedCenter
        ? asset.explodedCenter
        : asset.homeCenter;
      const half = asset.homeSize.clone().multiplyScalar(0.5);
      box.expandByPoint(center.clone().sub(half));
      box.expandByPoint(center.clone().add(half));
    });
    return box;
  }

  function frameOf(box, elevated) {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center.clone();
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const radius = sphere.radius > 0 ? sphere.radius : 4;
    const distance = Math.max((radius * 1.35) / Math.sin(fov / 2), 6);
    const direction = elevated
      ? new THREE.Vector3(1, 0.92, 1)
      : camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.7, 1);
    direction.normalize();
    const position = center.clone().add(direction.multiplyScalar(distance));
    if (elevated) position.y = Math.max(position.y, box.max.y * 0.5 + distance * 0.2);
    return { target: center, position };
  }

  function commitLayout() {
    assets.forEach((asset) => {
      asset.mesh.position.copy(asset.layoutPosition);
      asset.mesh.scale.copy(asset.layoutScale);
      syncHitbox(asset);
    });
  }

  function syncHitbox(asset) {
    const hitbox = asset.mesh.userData.hitbox;
    if (!hitbox) return;

    const delta = asset.mesh.position.clone().sub(asset.homePosition);
    hitbox.position.copy(asset.mesh.userData.homeHitboxPosition).add(delta);
    const base = asset.homeScale.x || 1;
    hitbox.scale.setScalar(asset.mesh.scale.x / base);
    hitbox.visible = asset.mesh.visible;
  }

  function resetHitboxes() {
    assets.forEach((asset) => {
      const hitbox = asset.mesh.userData.hitbox;
      if (!hitbox) return;
      hitbox.position.copy(asset.mesh.userData.homeHitboxPosition);
      hitbox.scale.set(1, 1, 1);
      hitbox.visible = asset.mesh.visible;
    });
  }

  function createLeaders() {
    if (leaders) {
      scene.remove(leaders);
      leaders.geometry.dispose();
      leaders.material.dispose();
    }

    const movable = assets.filter((asset) => !isShell(asset));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(movable.length * 6), 3)
    );
    leaders = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xb7adc2,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      })
    );
    leaders.frustumCulled = false;
    leaders.raycast = () => {};
    leaders.visible = false;
    leaders.userData.assets = movable;
    scene.add(leaders);
  }

  function updateLeaders() {
    if (!leaders) return;
    const show = mode === "exploded";
    leaders.visible = show;
    if (!show) return;

    const positions = leaders.geometry.attributes.position.array;
    leaders.userData.assets.forEach((asset, index) => {
      const offset = index * 6;
      const home = asset.homeCenter;
      positions[offset] = home.x;
      positions[offset + 1] = home.y;
      positions[offset + 2] = home.z;
      if (!asset.mesh.visible) {
        positions[offset + 3] = home.x;
        positions[offset + 4] = home.y;
        positions[offset + 5] = home.z;
        return;
      }
      const current = asset.mesh.position;
      positions[offset + 3] = current.x + asset.centerOffset.x;
      positions[offset + 4] = current.y + asset.centerOffset.y;
      positions[offset + 5] = current.z + asset.centerOffset.z;
    });
    leaders.geometry.attributes.position.needsUpdate = true;
  }

  function paintSelection() {
    list.querySelectorAll(".asset-row").forEach((row) => {
      row.classList.toggle("is-selected", row.dataset.id === selected?.mesh.uuid);
    });
    const selectedRow = list.querySelector(".asset-row.is-selected");
    selectedRow?.scrollIntoView({ block: "nearest" });
  }

  function renderRows() {
    const query = search.value.trim().toLowerCase();
    const matches = (asset) => {
      if (!query) return true;
      const group = GROUPS.find((item) => item.id === asset.set);
      const haystack = [asset.label, asset.mesh.name, asset.kind, detailLine(asset), group?.title]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    };

    const shownCount = assets.filter(matches).length;
    summary.textContent = `${assets.length} 个资产。房间主体留在原位，其余在爆炸视图里分开。`;
    hint.hidden = shownCount > 0;
    list.innerHTML = GROUPS.map((group) => {
      const items = assets.filter((asset) => asset.set === group.id);
      const visible = items.filter(matches);
      if (!visible.length) return "";
      const rows = visible
        .map((asset) => {
          const index = items.indexOf(asset) + 1;
          const hidden = !asset.mesh.visible;
          return `<li class="asset-row${asset === selected ? " is-selected" : ""}${hidden ? " is-hidden" : ""}" data-id="${asset.mesh.uuid}">
            <button type="button" class="asset-eye" data-eye aria-label="${hidden ? "显示" : "隐藏"}"></button>
            <button type="button" class="asset-select" data-select title="${escapeHtml(asset.mesh.name)}">
              <span class="asset-index">${String(index).padStart(2, "0")}</span>
              <span class="asset-copy">
                <strong>${escapeHtml(asset.label)}</strong>
                <small>${escapeHtml(detailLine(asset))}</small>
              </span>
            </button>
          </li>`;
        })
        .join("");
      return `<section class="asset-group">
        <h3>${group.title}<span>${query ? visible.length : items.length}</span></h3>
        <ul>${rows}</ul>
      </section>`;
    }).join("");
  }

  function select(asset, { frame = false } = {}) {
    selected = asset;
    paintSelection();
    if (!asset) {
      helper.visible = false;
      return;
    }
    if (frame && asset.mesh.visible) {
      asset.mesh.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(asset.mesh);
      if (!box.isEmpty()) {
        const view = frameOf(box);
        gsap.killTweensOf(camera.position);
        gsap.killTweensOf(controls.target);
        gsap.to(camera.position, {
          x: view.position.x,
          y: view.position.y,
          z: view.position.z,
          duration: 0.7,
          ease: "power2.inOut",
        });
        gsap.to(controls.target, {
          x: view.target.x,
          y: view.target.y,
          z: view.target.z,
          duration: 0.7,
          ease: "power2.inOut",
        });
      }
    }
  }

  function setVisible(asset, visible) {
    asset.mesh.visible = visible;
    const hitbox = asset.mesh.userData.hitbox;
    if (hitbox) hitbox.visible = visible;
    asset.mesh.userData.boundHitboxes?.forEach((extra) => {
      extra.visible = visible;
    });
    const row = list.querySelector(`[data-id="${asset.mesh.uuid}"]`);
    row?.classList.toggle("is-hidden", !visible);
    const eye = row?.querySelector("[data-eye]");
    if (eye) eye.setAttribute("aria-label", visible ? "隐藏" : "显示");
    if (selected === asset && !visible) helper.visible = false;
  }

  function applyMode(nextMode) {
    if (mode === "assembled" && nextMode !== "assembled") {
      onBeforeLayout?.();
      assembledCamera = {
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
    }

    mode = nextMode;
    applying = true;
    assets.forEach((asset) => {
      gsap.killTweensOf(asset.mesh.position);
      gsap.killTweensOf(asset.mesh.scale);
    });
    if (nextMode !== "assembled") relaxLimits(nextMode);

    const view =
      nextMode === "assembled" && assembledCamera
        ? assembledCamera
        : frameOf(boundsFor(nextMode), nextMode === "exploded");

    activeTimeline?.kill();
    const timeline = gsap.timeline({
      onComplete: () => {
        if (activeTimeline !== timeline) return;
        commitLayout();
        if (mode === "assembled") {
          applying = false;
          restoreLimits();
          resetHitboxes();
        }
      },
    });
    activeTimeline = timeline;

    assets.forEach((asset) => {
      const target = targetsFor(nextMode, asset);
      timeline.to(
        asset.layoutPosition,
        {
          x: target.position.x,
          y: target.position.y,
          z: target.position.z,
          duration: 0.9,
          ease: "power2.inOut",
        },
        0
      );
      timeline.to(
        asset.layoutScale,
        {
          x: target.scale.x,
          y: target.scale.y,
          z: target.scale.z,
          duration: 0.9,
          ease: "power2.inOut",
        },
        0
      );
    });

    timeline.to(
      camera.position,
      {
        x: view.position.x,
        y: view.position.y,
        z: view.position.z,
        duration: 0.9,
        ease: "power2.inOut",
      },
      0
    );
    timeline.to(
      controls.target,
      {
        x: view.target.x,
        y: view.target.y,
        z: view.target.z,
        duration: 0.9,
        ease: "power2.inOut",
      },
      0
    );
  }

  function updateButtons() {
    buttons.forEach((button) => {
      const active = button.dataset.view === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    panel.hidden = mode === "assembled";
  }

  function setMode(nextMode) {
    if (!ready) {
      mode = nextMode;
      updateButtons();
      return;
    }
    if (nextMode === mode) return;
    applyMode(nextMode);
    updateButtons();
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.view);
    });
  });

  search.addEventListener("input", renderRows);

  list.addEventListener("click", (event) => {
    const row = event.target.closest(".asset-row");
    if (!row) return;
    const asset = assets.find((item) => item.mesh.uuid === row.dataset.id);
    if (!asset) return;
    if (event.target.closest("[data-eye]")) {
      setVisible(asset, !asset.mesh.visible);
      return;
    }
    select(asset);
  });

  list.addEventListener("dblclick", (event) => {
    const row = event.target.closest(".asset-row");
    if (!row || event.target.closest("[data-eye]")) return;
    const asset = assets.find((item) => item.mesh.uuid === row.dataset.id);
    if (asset) select(asset, { frame: true });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || document.activeElement === search) return;
    select(null);
  });

  return {
    setMeshes(meshes) {
      meshes.forEach((mesh) => {
        const { homeSize, centerOffset } = measure(mesh);
        const asset = {
          mesh,
          label: assetLabel(mesh.name),
          homePosition: mesh.position.clone(),
          homeScale: mesh.scale.clone(),
          homeSize,
          centerOffset,
          homeCenter: mesh.position.clone().add(centerOffset),
          set: textureSet(mesh.name),
          kind: assetKind(mesh.name),
          anchor: mesh.name === "First" || mesh.name === "Second" || mesh.name === "Third" || mesh.name === "Fourth",
          triangles: triangleCount(mesh),
          layoutPosition: mesh.position.clone(),
          layoutScale: mesh.scale.clone(),
          explodePosition: mesh.position.clone(),
          listPosition: mesh.position.clone(),
          listScale: mesh.scale.clone(),
          listColumns: 1,
          listRows: 1,
        };
        assets.push(asset);
        byMesh.set(mesh, asset);
        if (isHidden(mesh.name)) setVisible(asset, false);
      });

      assets.sort((a, b) => {
        if (a.anchor !== b.anchor) return a.anchor ? -1 : 1;
        return a.label.localeCompare(b.label, "zh", { numeric: true });
      });
      buildLayouts();
      createLeaders();
      ready = true;
      renderRows();
      if (mode !== "assembled") {
        const pending = mode;
        mode = "assembled";
        applyMode(pending);
      }
    },
    update(timestamp) {
      if (applying) {
        assets.forEach((asset) => {
          const bob = asset.mesh.name.includes("Fish_Fourth") ? fishBob(timestamp) : 0;
          asset.mesh.position.set(
            asset.layoutPosition.x,
            asset.layoutPosition.y + bob,
            asset.layoutPosition.z
          );
          asset.mesh.scale.copy(asset.layoutScale);
          syncHitbox(asset);
        });
      }

      updateLeaders();

      if (selected?.mesh.visible) {
        helper.setFromObject(selected.mesh);
        helper.visible = true;
      } else {
        helper.visible = false;
      }
    },
    selectByMesh(mesh) {
      let current = mesh;
      while (current) {
        const asset = byMesh.get(current);
        if (asset) {
          select(asset);
          return asset;
        }
        current = current.parent;
      }
      return null;
    },
    pickables() {
      return assets.filter((asset) => asset.mesh.visible).map((asset) => asset.mesh);
    },
    getMode() {
      return mode;
    },
    isApplying() {
      return applying;
    },
  };
}
