import { useVideoTexture } from "@react-three/drei";
import { useGLTFWithKTX2 } from "../../utils/useGLTFWithKTX2";
import { convertMaterialsToBasic } from "../../utils/convertToBasic";
import Part from "../../parts/Part";

const MAC_POSITION = [-0.861, 0.815 - 0.02, 0.684];
const MAC_ROTATION = [0, 0.523, 0];
const COMPUTER_POSITION = [-0.302, 0.955 - 0.02, 0.647];
const COMPUTER_ROTATION = [0, -0.053, 0];
const FIRST_POSITION = [-0.231, -0.14 - 0.02, 0.652];
const FIRST_ROTATION = [Math.PI, 0, Math.PI];

export default function Model(props) {
  const { nodes, materials } = useGLTFWithKTX2(
    "/models/Dark Room/Dark_First.glb"
  );
  const newMaterials = convertMaterialsToBasic(materials);

  const videoTexture = useVideoTexture("/videos/devwork.mp4", {
    crossOrigin: "anonymous",
    muted: true,
    loop: true,
    playsInline: true,
    start: true,
  });

  return (
    <group {...props} dispose={null}>
      <Part id="dark-mac-screen" position={MAC_POSITION} rotation={MAC_ROTATION}>
        <mesh geometry={nodes.Mac_Screen.geometry}>
          <meshBasicMaterial
            map={videoTexture}
            color="#8a8a8a"
            toneMapped={false}
          />
        </mesh>
      </Part>
      <Part
        id="dark-computer-screen"
        position={COMPUTER_POSITION}
        rotation={COMPUTER_ROTATION}
      >
        <mesh geometry={nodes.Computer_Screen.geometry}>
          <meshBasicMaterial
            map={videoTexture}
            color="#8a8a8a"
            toneMapped={false}
          />
        </mesh>
      </Part>
      <Part id="dark-first" position={FIRST_POSITION} rotation={FIRST_ROTATION}>
        <mesh
          geometry={nodes.First_Baked.geometry}
          material={newMaterials.first_real_realfdsa_Baked}
        />
      </Part>
    </group>
  );
}
