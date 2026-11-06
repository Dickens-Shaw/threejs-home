import { useGLTFWithKTX2 } from "../../utils/useGLTFWithKTX2";
import { useRoomVideo } from "../../utils/useRoomVideo";
import Part from "../../parts/Part";

const MAC_POSITION = [-0.861, 0.815 - 0.02, 0.684];
const MAC_ROTATION = [0, 0.523, 0];
const COMPUTER_POSITION = [-0.302, 0.955 - 0.02, 0.647];
const COMPUTER_ROTATION = [0, -0.053, 0];

export default function Model(props) {
  const { nodes } = useGLTFWithKTX2("/models/Dark Room/Dark_First.glb");
  const videoTexture = useRoomVideo("/videos/devwork.mp4");

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
    </group>
  );
}
