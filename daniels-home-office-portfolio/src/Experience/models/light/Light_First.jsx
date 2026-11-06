import { useGLTF } from "@react-three/drei";
import { useRoomVideo } from "../../utils/useRoomVideo";
import Part from "../../parts/Part";

const IPHONE_POSITION = [23.994, 0.734, -1.338];
const IPHONE_ROTATION = [0, -1.193, Math.PI / 2];

export default function Model(props) {
  const { nodes } = useGLTF("/models/Light Room/Light_First.glb");
  const videoTexture = useRoomVideo("/videos/designwork.mp4");

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
    </group>
  );
}

useGLTF.preload("/models/Light Room/Light_First.glb");
