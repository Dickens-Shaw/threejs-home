import { useMemo } from "react";
import { useGLTF, useVideoTexture } from "@react-three/drei";
import { convertMaterialsToBasic } from "../../utils/convertToBasic";
import Part from "../../parts/Part";
import {
  DESK_POSITION,
  DESK_ROTATION,
  createDeskShadow,
} from "../../parts/deskShadow";

const IPHONE_POSITION = [23.994, 0.734, -1.338];
const IPHONE_ROTATION = [0, -1.193, Math.PI / 2];

export default function Model(props) {
  const { nodes, materials } = useGLTF("/models/Light Room/Light_First.glb");
  const deskShadow = useMemo(
    () =>
      createDeskShadow(
        nodes.Light_First_Baked.geometry,
        materials.REAL_first_Baked.map
      ),
    [nodes.Light_First_Baked.geometry, materials.REAL_first_Baked.map]
  );
  const newMaterials = convertMaterialsToBasic(materials);
  if (deskShadow.cleanedMap) {
    newMaterials.REAL_first_Baked.map = deskShadow.cleanedMap;
  }

  const videoTexture = useVideoTexture("/videos/designwork.mp4", {
    crossOrigin: "anonymous",
    muted: true,
    loop: true,
    playsInline: true,
    start: true,
  });

  return (
    <group {...props} dispose={null}>
      <Part
        id="light-iphone-screen"
        position={IPHONE_POSITION}
        rotation={IPHONE_ROTATION}
      >
        <mesh geometry={nodes.iPhone_Screen.geometry}>
          <meshBasicMaterial
            map={videoTexture}
            color="#f6f6f6"
            toneMapped={false}
          />
        </mesh>
      </Part>
      <Part id="light-first" position={DESK_POSITION} rotation={DESK_ROTATION}>
        <mesh
          geometry={nodes.Light_First_Baked.geometry}
          material={newMaterials.REAL_first_Baked}
        />
      </Part>
    </group>
  );
}

useGLTF.preload("/models/Light Room/Light_First.glb");
