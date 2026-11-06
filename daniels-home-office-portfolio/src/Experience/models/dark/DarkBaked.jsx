import { useMemo } from "react";
import * as THREE from "three";
import { useGLTFWithKTX2 } from "../../utils/useGLTFWithKTX2";
import { useRoomVideo } from "../../utils/useRoomVideo";
import { convertMaterialsToBasic } from "../../utils/convertToBasic";
import { assembleRoom } from "../../parts/assembleRoom";
import { ensurePart } from "../../parts/catalog";
import BakedMeshes from "../../parts/BakedMeshes";

const FIRST_POSITION = [-0.231, -0.14 - 0.02, 0.652];
const FIRST_ROTATION = [Math.PI, 0, Math.PI];
const SECOND_POSITION = [0.053, 0 - 0.02, 0.341];
const SECOND_ROTATION = [Math.PI, 0, Math.PI];
const THIRD_POSITION = [-0.819, 0.746 - 0.02, 1.115];
const THIRD_ROTATION = [Math.PI / 2, 0, 0.47];
const FOURTH_POSITION = [-0.356, 0 - 0.02, 1.362];
const FOURTH_ROTATION = [Math.PI, 0, Math.PI];
const MAC_POSITION = [-0.861, 0.815 - 0.02, 0.684];
const MAC_ROTATION = [0, 0.523, 0];
const COMPUTER_POSITION = [-0.302, 0.955 - 0.02, 0.647];
const COMPUTER_ROTATION = [0, -0.053, 0];
const CHAIR_POSITION = [-0.373, 0.735 - 0.02, 1.304];
const CHAIR_ROTATION = [Math.PI, -0.121, Math.PI];

function attachScreen(room, id, label, mesh) {
  let object = room.objects.find((item) => item.id === id);
  if (!object) {
    object = {
      id,
      label,
      kind: "家具",
      file: "Dark_First.glb",
      chunk: "first",
      triangles: 0,
      meshes: [],
    };
    room.objects.push(object);
  }
  if (!object.meshes.some((item) => item.geometry === mesh.geometry)) {
    object.meshes.push(mesh);
  }
  ensurePart({
    id,
    theme: "dark",
    label,
    kind: "家具",
    file: "Dark_First.glb",
    chunk: "first",
  });
}

export default function DarkBaked() {
  const first = useGLTFWithKTX2("/models/Dark Room/Dark_First.glb");
  const second = useGLTFWithKTX2("/models/Dark Room/Dark_Second.glb");
  const third = useGLTFWithKTX2("/models/Dark Room/Dark_Third.glb");
  const fourth = useGLTFWithKTX2("/models/Dark Room/Dark_Fourth.glb");
  const video = useRoomVideo("/videos/devwork.mp4");
  const screenMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: video,
        color: "#8a8a8a",
        toneMapped: false,
      }),
    [video]
  );

  const materials = {
    first: convertMaterialsToBasic(first.materials),
    second: convertMaterialsToBasic(second.materials),
    third: convertMaterialsToBasic(third.materials),
    fourth: convertMaterialsToBasic(fourth.materials),
  };

  const room = useMemo(
    () =>
      assembleRoom("dark", [
        {
          shellId: "dark-first",
          geometry: first.nodes.First_Baked.geometry,
          material: materials.first.first_real_realfdsa_Baked,
          position: FIRST_POSITION,
          rotation: FIRST_ROTATION,
          file: "Dark_First.glb",
          chunk: "first",
        },
        {
          shellId: "dark-second",
          geometry: second.nodes.Second_Baked.geometry,
          material: materials.second.Second_Real_Texture_Set_Baked,
          position: SECOND_POSITION,
          rotation: SECOND_ROTATION,
          file: "Dark_Second.glb",
          chunk: "second",
        },
        {
          shellId: "dark-third",
          geometry: third.nodes.Third_Baked.geometry,
          material: materials.third.Third_Real_Real_Texture_Set_Baked,
          position: THIRD_POSITION,
          rotation: THIRD_ROTATION,
          file: "Dark_Third.glb",
          chunk: "third",
        },
        {
          shellId: "dark-fourth",
          geometry: fourth.nodes.Fourth_Baked.geometry,
          material: materials.fourth.Fourth_Real_Real_Texture_Set_Baked,
          position: FOURTH_POSITION,
          rotation: FOURTH_ROTATION,
          file: "Dark_Fourth.glb",
          chunk: "fourth",
        },
      ]),
    [
      first.nodes.Mac_Screen.geometry,
      first.nodes.Computer_Screen.geometry,
      screenMaterial,
      first.nodes.First_Baked.geometry,
      second.nodes.Second_Baked.geometry,
      third.nodes.Third_Baked.geometry,
      fourth.nodes.Fourth_Baked.geometry,
      materials.first.first_real_realfdsa_Baked,
      materials.second.Second_Real_Texture_Set_Baked,
      materials.third.Third_Real_Real_Texture_Set_Baked,
      materials.fourth.Fourth_Real_Real_Texture_Set_Baked,
    ]
  );

  attachScreen(room, "dark-laptop", "笔记本", {
    geometry: first.nodes.Mac_Screen.geometry,
    material: screenMaterial,
    position: MAC_POSITION,
    rotation: MAC_ROTATION,
  });
  attachScreen(room, "dark-monitor", "显示器", {
    geometry: first.nodes.Computer_Screen.geometry,
    material: screenMaterial,
    position: COMPUTER_POSITION,
    rotation: COMPUTER_ROTATION,
  });
  attachScreen(room, "dark-chair", "椅子", {
    geometry: fourth.nodes.Chair_Top_Fourth_Baked.geometry,
    material: materials.fourth.Fourth_Real_Real_Texture_Set_Baked,
    position: CHAIR_POSITION,
    rotation: CHAIR_ROTATION,
  });

  return <BakedMeshes shells={room.shells} objects={room.objects} />;
}
