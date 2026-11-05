import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { useViewStore } from "../../stores/viewStore";
import { registerPart, unregisterPart } from "./registry";

function countTriangles(object) {
  let triangles = 0;

  object.traverse((child) => {
    const position = child.geometry?.attributes?.position;
    if (!child.isMesh || !position) return;
    triangles += child.geometry.index
      ? child.geometry.index.count / 3
      : position.count / 3;
  });

  return Math.round(triangles);
}

function meshNames(object) {
  const names = [];

  object.traverse((child) => {
    if (child.isMesh && child.name) names.push(child.name);
  });

  return names.join(" ");
}

export default function Part({ id, children, ...transform }) {
  const ref = useRef(null);
  const setPartStat = useViewStore((state) => state.setPartStat);

  useLayoutEffect(() => {
    const object = ref.current;
    if (!object) return;

    object.userData.partId = id;
    object.userData.homePosition = object.position.clone();
    object.userData.homeScale = object.scale.clone();
    object.userData.layoutPosition = object.position.clone();
    object.userData.layoutScale = object.scale.clone();
    object.userData.explodePosition = object.position.clone();
    object.userData.explodedCenter = new THREE.Vector3();
    object.userData.listPosition = object.position.clone();
    object.userData.listScale = object.scale.clone();
    object.userData.homeCenter = new THREE.Vector3();
    object.userData.centerOffset = new THREE.Vector3();
    object.userData.size = new THREE.Vector3();
    registerPart(id, object);
    setPartStat(id, {
      triangles: countTriangles(object),
      meshNames: meshNames(object),
    });

    return () => unregisterPart(id);
  }, [id, setPartStat]);

  return (
    <group ref={ref} {...transform}>
      {children}
    </group>
  );
}
