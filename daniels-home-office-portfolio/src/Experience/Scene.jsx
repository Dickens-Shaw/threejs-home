import { Suspense, useRef } from "react";
import * as THREE from "three";

import DarkRoomFirst from "./models/dark/Dark_First";
import DarkRoomSecond from "./models/dark/Dark_Second";
import DarkRoomThird from "./models/dark/Dark_Third";
import DarkRoomFourth from "./models/dark/Dark_Fourth";
import LightRoomFirst from "./models/light/Light_First";
import LightRoomSecond from "./models/light/Light_Second";
import LightComputer from "./models/light/LightComputer";
import LightRoomThird from "./models/light/Light_Third";
import LightRoomFourth from "./models/light/Light_Fourth";

import { useFrame } from "@react-three/fiber";
import ExplodeRig from "./parts/ExplodeRig";
import { useViewStore } from "../stores/viewStore";

const LIGHT_ROOM_OFFSET = new THREE.Vector3(24.79, 0, 0.173);

const Scene = ({ pointerRef }) => {
  const darkGroupRef = useRef();
  const lightGroupRef = useRef();
  const groupRotationRef = useRef(0);
  const mode = useViewStore((state) => state.mode);
  const layoutsReady = useViewStore((state) => state.layoutsReady);
  const lightRoomInverse = [
    -LIGHT_ROOM_OFFSET.x,
    -LIGHT_ROOM_OFFSET.y,
    -LIGHT_ROOM_OFFSET.z,
  ];

  useFrame(() => {
    if (!darkGroupRef.current || !lightGroupRef.current) return;

    if (!layoutsReady || mode !== "assembled") {
      groupRotationRef.current = 0;
      darkGroupRef.current.rotation.y = 0;
      lightGroupRef.current.rotation.y = 0;
      return;
    }

    const targetRotation = pointerRef.current.x * Math.PI * 0.032;

    groupRotationRef.current = THREE.MathUtils.lerp(
      groupRotationRef.current,
      targetRotation,
      0.1
    );

    darkGroupRef.current.rotation.y = groupRotationRef.current;
    lightGroupRef.current.rotation.y = groupRotationRef.current;
  });

  return (
    <Suspense>
      <group ref={darkGroupRef}>
        <DarkRoomFirst />
        <DarkRoomSecond />
        <DarkRoomThird />
        <DarkRoomFourth />
      </group>

      <group ref={lightGroupRef} position={LIGHT_ROOM_OFFSET}>
        <LightRoomFirst position={lightRoomInverse} />
        <LightRoomSecond position={lightRoomInverse} />
        <LightComputer position={lightRoomInverse} />
        <LightRoomThird position={lightRoomInverse} />
        <LightRoomFourth position={lightRoomInverse} />
      </group>
      <ExplodeRig />
    </Suspense>
  );
};

export default Scene;
