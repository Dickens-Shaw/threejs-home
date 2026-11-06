import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useRoomVideo } from "../../utils/useRoomVideo";
import { convertMaterialsToBasic } from "../../utils/convertToBasic";
import Part from "../../parts/Part";
import {
  DESKTOP_POSITION,
  DESKTOP_ROTATION,
  SECOND_POSITION,
  SECOND_ROTATION,
  buildLightComputer,
} from "../../parts/lightComputer";
import {
  DESK_POSITION,
  DESK_ROTATION,
  createDeskShadow,
} from "../../parts/deskShadow";

export default function LightComputer(props) {
  const baked = useGLTF("/models/Light Room/Light_Second.glb");
  const screen = useGLTF("/models/Light Room/Light_First.glb");
  const pieces = useMemo(
    () =>
      buildLightComputer(
        baked.nodes.Light_Second_Baked.geometry,
        screen.nodes.Desktop_Screen.geometry
      ),
    [baked.nodes.Light_Second_Baked.geometry, screen.nodes.Desktop_Screen.geometry]
  );
  const deskShadow = useMemo(
    () =>
      createDeskShadow(
        screen.nodes.Light_First_Baked.geometry,
        screen.materials.REAL_first_Baked.map
      ),
    [screen.nodes.Light_First_Baked.geometry, screen.materials.REAL_first_Baked.map]
  );
  const material = useMemo(
    () => convertMaterialsToBasic(baked.materials).actual_second_bro_Baked,
    [baked.materials]
  );
  const videoTexture = useRoomVideo("/videos/designwork.mp4");

  return (
    <group {...props} dispose={null}>
      <Part id="light-computer">
        <mesh
          name="monitor-shell"
          geometry={pieces.monitor}
          material={material}
          position={SECOND_POSITION}
          rotation={SECOND_ROTATION}
        />
        {deskShadow.geometry && (
          <mesh
            name="monitor-shadow"
            geometry={deskShadow.geometry}
            position={DESK_POSITION}
            rotation={DESK_ROTATION}
          >
            <meshBasicMaterial
              map={deskShadow.sourceMap}
              polygonOffset
              polygonOffsetFactor={-2}
              polygonOffsetUnits={-2}
            />
          </mesh>
        )}
        <mesh
          name="desktop-screen"
          geometry={screen.nodes.Desktop_Screen.geometry}
          position={DESKTOP_POSITION}
          rotation={DESKTOP_ROTATION}
        >
          <meshBasicMaterial
            map={videoTexture}
            color="#f6f6f6"
            toneMapped={false}
          />
        </mesh>
      </Part>
    </group>
  );
}

useGLTF.preload("/models/Light Room/Light_Second.glb");
useGLTF.preload("/models/Light Room/Light_First.glb");
