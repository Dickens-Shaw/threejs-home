import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import * as THREE from "three";
import { PARTS, partsByTheme } from "./catalog";
import { getPart, hasPart } from "./registry";
import {
  buildThemeLayout,
  explodeBounds,
  frameBounds,
  listBounds,
  measureObject,
} from "./layout";
import { cameraPositions, zoomFor } from "../camera";
import { useViewStore } from "../../stores/viewStore";
import { useToggleRoomStore } from "../../stores/toggleRoomStore";
import { useResponsiveStore } from "../../stores/useResponsiveStore";

const center = new THREE.Vector3();
const liveBox = new THREE.Box3();

function themeReady(theme) {
  return partsByTheme(theme).every((part) => hasPart(part.id));
}

function worldToLocalPosition(object, world) {
  const parent = object.parent;
  if (!parent) return world.clone();
  parent.updateWorldMatrix(true, false);
  return parent.worldToLocal(world.clone());
}

export default function ExplodeRig() {
  const mode = useViewStore((state) => state.mode);
  const selectedId = useViewStore((state) => state.selectedId);
  const hoveredId = useViewStore((state) => state.hoveredId);
  const hidden = useViewStore((state) => state.hidden);
  const frameToken = useViewStore((state) => state.frameToken);
  const layoutsReady = useViewStore((state) => state.layoutsReady);
  const setSelectedId = useViewStore((state) => state.setSelectedId);
  const isDarkRoom = useToggleRoomStore((state) => state.isDarkRoom);
  const isMobile = useResponsiveStore((state) => state.isMobile);
  const { camera, size, gl } = useThree();
  const built = useRef(false);
  const layouts = useRef({ dark: null, light: null });
  const savedView = useRef({ dark: null, light: null });
  const previousMode = useRef("assembled");
  const previousTheme = useRef("dark");
  const didInit = useRef(false);
  const runId = useRef(0);
  const layoutTween = useRef(null);
  const cameraTween = useRef(null);
  const leaders = useMemo(() => {
    const movable = PARTS.filter((part) => !part.anchor).length;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(movable * 2 * 3), 3)
    );
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    lines.frustumCulled = false;
    lines.visible = false;
    lines.renderOrder = 4;
    lines.raycast = () => {};
    return lines;
  }, []);
  const helper = useMemo(() => {
    const box = new THREE.BoxHelper(new THREE.Object3D(), 0xffffff);
    box.material.depthTest = false;
    box.material.toneMapped = false;
    box.visible = false;
    box.renderOrder = 5;
    box.raycast = () => {};
    return box;
  }, []);

  const theme = isDarkRoom ? "dark" : "light";

  const build = () => {
    const meta = {};

    for (const room of ["dark", "light"]) {
      const entries = partsByTheme(room).map((part) => {
        const object = getPart(part.id);
        const measured = measureObject(object);
        return {
          part,
          object,
          homePosition: object.position.clone(),
          homeScale: object.scale.clone(),
          ...measured,
        };
      });
      const layout = buildThemeLayout(entries);

      for (const entry of entries) {
        const data = entry.object.userData;
        data.homePosition.copy(entry.homePosition);
        data.homeScale.copy(entry.homeScale);
        data.homeCenter.copy(entry.homeCenter);
        data.centerOffset.copy(entry.centerOffset);
        data.size.copy(entry.size);
        data.explodedCenter.copy(entry.explodedCenter);
        data.explodePosition.copy(
          entry.part.anchor
            ? entry.homePosition
            : worldToLocalPosition(entry.object, entry.explodePosition)
        );
        data.listPosition.copy(
          worldToLocalPosition(entry.object, entry.listPosition)
        );
        data.listScale.copy(entry.listScale);
      }

      layouts.current[room] = { ...layout, entries };
      meta[room] = {
        anchorName: "结构壳体",
        columns: layout.columns,
        rows: layout.rows,
        listY: layout.listY,
        referenceId: layout.reference?.part.id ?? null,
      };
    }

    return meta;
  };

  const viewFor = (nextMode, nextTheme) => {
    const layout = layouts.current[nextTheme];
    if (!layout) return null;

    if (nextMode === "list") {
      return frameBounds(
        listBounds(layout.columns, layout.rows, layout.listY),
        camera.quaternion,
        size
      );
    }

    if (nextMode === "exploded") {
      return frameBounds(
        explodeBounds(layout.entries, layout.reference?.part.id ?? null),
        camera.quaternion,
        size
      );
    }

    const saved = savedView.current[nextTheme];
    if (saved) return saved;

    const fallback = cameraPositions[nextTheme].position;
    return {
      position: new THREE.Vector3(fallback[0], fallback[1], fallback[2]),
      zoom: zoomFor(isMobile).default,
    };
  };

  const tweenCamera = (view) => {
    if (!view) return;
    cameraTween.current?.kill();
    const timeline = gsap.timeline();
    cameraTween.current = timeline;
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
      camera,
      {
        zoom: view.zoom,
        duration: 0.9,
        ease: "power2.inOut",
        onUpdate: () => {
          camera.updateProjectionMatrix();
        },
      },
      0
    );
  };

  const play = (nextMode, nextTheme) => {
    const run = ++runId.current;
    layoutTween.current?.kill();
    const timeline = gsap.timeline({
      onComplete: () => {
        if (run !== runId.current) return;
        for (const part of PARTS) {
          const object = getPart(part.id);
          const target = targetsFor(part, nextMode, nextTheme);
          if (!object || !target) continue;
          object.userData.layoutPosition.copy(target.position);
          object.userData.layoutScale.copy(target.scale);
          object.position.copy(target.position);
          object.scale.copy(target.scale);
        }
      },
    });
    layoutTween.current = timeline;

    for (const part of PARTS) {
      const object = getPart(part.id);
      const target = targetsFor(part, nextMode, nextTheme);
      if (!object || !target) continue;
      timeline.to(
        object.userData.layoutPosition,
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
        object.userData.layoutScale,
        {
          x: target.scale.x,
          y: target.scale.y,
          z: target.scale.z,
          duration: 0.9,
          ease: "power2.inOut",
        },
        0
      );
    }

    tweenCamera(viewFor(nextMode, nextTheme));
  };

  const playRef = useRef(play);
  playRef.current = play;

  useEffect(() => {
    if (!layoutsReady) return;

    if (!didInit.current) {
      didInit.current = true;
      previousMode.current = mode;
      previousTheme.current = theme;
      if (mode === "assembled") return;
      savedView.current[theme] = {
        position: camera.position.clone(),
        zoom: camera.zoom,
      };
      playRef.current(mode, theme);
      return;
    }

    const fromMode = previousMode.current;
    const fromTheme = previousTheme.current;
    if (fromMode === mode && fromTheme === theme) return;

    if (fromMode === "assembled" && mode !== "assembled") {
      savedView.current[fromTheme] = {
        position: camera.position.clone(),
        zoom: camera.zoom,
      };
    }

    previousMode.current = mode;
    previousTheme.current = theme;

    if (mode === "assembled" && fromMode === "assembled") return;
    playRef.current(mode, theme);
  }, [camera, layoutsReady, mode, theme]);

  const frameRef = useRef(() => {});
  frameRef.current = () => {
    const object = selectedId ? getPart(selectedId) : null;
    if (!object?.visible) return;
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    tweenCamera(frameBounds(box, camera.quaternion, size));
  };

  useEffect(() => {
    if (!frameToken) return;
    frameRef.current();
  }, [frameToken]);

  useEffect(() => {
    const dom = gl.domElement;
    const pick = { x: 0, y: 0, moved: false, tracking: false };

    const onDown = (event) => {
      if (event.button !== 0) return;
      pick.x = event.clientX;
      pick.y = event.clientY;
      pick.moved = false;
      pick.tracking = true;
    };

    const onMove = (event) => {
      if (!pick.tracking || pick.moved) return;
      if (Math.hypot(event.clientX - pick.x, event.clientY - pick.y) > 5) {
        pick.moved = true;
      }
    };

    const onUp = (event) => {
      if (!pick.tracking || event.button !== 0) return;
      const moved = pick.moved;
      pick.tracking = false;
      if (moved || event.target !== dom) return;

      const rect = dom.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const roots = PARTS.map((part) => getPart(part.id)).filter(
        (object) => object?.visible
      );
      const hits = raycaster.intersectObjects(roots, true);
      if (!hits.length) {
        setSelectedId(null);
        return;
      }

      let current = hits[0].object;
      let partId = null;
      while (current) {
        if (current.userData?.partId) {
          partId = current.userData.partId;
          break;
        }
        current = current.parent;
      }

      if (!partId) {
        setSelectedId(null);
        return;
      }

      const part = PARTS.find((item) => item.id === partId);
      const wantDark = part?.theme === "dark";
      if (wantDark !== useToggleRoomStore.getState().isDarkRoom) {
        useToggleRoomStore.getState().setDarkRoom(wantDark);
      }
      setSelectedId(partId);
    };

    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [camera, gl, setSelectedId]);

  useEffect(
    () => () => {
      layoutTween.current?.kill();
      cameraTween.current?.kill();
    },
    []
  );

  useFrame(() => {
    if (!built.current && themeReady("dark") && themeReady("light")) {
      const meta = build();
      built.current = true;
      useViewStore.setState({ layoutsReady: true, layoutMeta: meta });
    }

    const active = isDarkRoom ? "dark" : "light";

    for (const part of PARTS) {
      const object = getPart(part.id);
      const data = object?.userData;
      if (!object || !data?.layoutPosition || !data.layoutScale) continue;

      object.position.copy(data.layoutPosition);
      object.scale.copy(data.layoutScale);
      const showAll = mode === "assembled" && !layoutTween.current?.isActive();
      const themeVisible = showAll || part.theme === active;
      object.visible = themeVisible && !hidden[part.id];
    }

    const showLeaders = mode === "exploded" && built.current;
    leaders.visible = showLeaders;
    leaders.material.color.set(isDarkRoom ? "#ffffff" : "#111111");
    if (showLeaders) {
      const positions = leaders.geometry.attributes.position.array;
      let cursor = 0;
      let count = 0;

      for (const part of PARTS) {
        if (part.anchor || part.theme !== active) continue;
        const object = getPart(part.id);
        const data = object?.userData;
        if (!object || !data?.homeCenter) continue;

        positions[cursor++] = data.homeCenter.x;
        positions[cursor++] = data.homeCenter.y;
        positions[cursor++] = data.homeCenter.z;

        if (!object.visible) {
          positions[cursor++] = data.homeCenter.x;
          positions[cursor++] = data.homeCenter.y;
          positions[cursor++] = data.homeCenter.z;
        } else {
          object.updateWorldMatrix(true, true);
          liveBox.setFromObject(object).getCenter(center);
          positions[cursor++] = center.x;
          positions[cursor++] = center.y;
          positions[cursor++] = center.z;
        }

        count += 1;
      }

      leaders.geometry.setDrawRange(0, count * 2);
      leaders.geometry.attributes.position.needsUpdate = true;
    }

    const outlinedId = hoveredId || selectedId;
    const outlined = outlinedId ? getPart(outlinedId) : null;
    if (!outlined?.visible) {
      helper.visible = false;
      return;
    }

    helper.visible = true;
    helper.material.color.set(isDarkRoom ? "#ffffff" : "#111111");
    outlined.updateWorldMatrix(true, true);
    helper.setFromObject(outlined);
  }, 1);

  return (
    <>
      <primitive object={leaders} />
      <primitive object={helper} />
    </>
  );
}

function targetsFor(part, nextMode, nextTheme) {
  const object = getPart(part.id);
  const data = object?.userData;
  if (!data?.homePosition || !data.explodePosition || !data.listPosition) {
    return null;
  }

  if (part.theme !== nextTheme && nextMode !== "assembled") {
    return { position: data.homePosition, scale: data.homeScale };
  }

  if (nextMode === "exploded") {
    return { position: data.explodePosition, scale: data.homeScale };
  }

  if (nextMode === "list") {
    return { position: data.listPosition, scale: data.listScale };
  }

  return { position: data.homePosition, scale: data.homeScale };
}
