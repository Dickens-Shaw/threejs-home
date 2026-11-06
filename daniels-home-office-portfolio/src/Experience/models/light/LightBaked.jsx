import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { convertMaterialsToBasic } from "../../utils/convertToBasic";
import { assembleRoom } from "../../parts/assembleRoom";
import BakedMeshes from "../../parts/BakedMeshes";
import {
  SECOND_POSITION,
  SECOND_ROTATION,
  buildLightComputer,
} from "../../parts/lightComputer";
import {
  DESK_POSITION,
  DESK_ROTATION,
  createDeskShadow,
} from "../../parts/deskShadow";

const THIRD_POSITION = [24.79, -0.201, 0.173];
const THIRD_ROTATION = [0, 0, 0];

export default function LightBaked(props) {
  const first = useGLTF("/models/Light Room/Light_First.glb");
  const second = useGLTF("/models/Light Room/Light_Second.glb");
  const third = useGLTF("/models/Light Room/Light_Third.glb");

  const deskShadow = useMemo(
    () =>
      createDeskShadow(
        first.nodes.Light_First_Baked.geometry,
        first.materials.REAL_first_Baked.map
      ),
    [first.nodes.Light_First_Baked.geometry, first.materials.REAL_first_Baked.map]
  );
  const computer = useMemo(
    () =>
      buildLightComputer(
        second.nodes.Light_Second_Baked.geometry,
        first.nodes.Desktop_Screen.geometry
      ),
    [second.nodes.Light_Second_Baked.geometry, first.nodes.Desktop_Screen.geometry]
  );

  const materials = {
    first: convertMaterialsToBasic(first.materials),
    second: convertMaterialsToBasic(second.materials),
    third: convertMaterialsToBasic(third.materials),
  };
  if (deskShadow.cleanedMap) {
    materials.first.REAL_first_Baked.map = deskShadow.cleanedMap;
  }

  const room = useMemo(
    () =>
      assembleRoom("light", [
        {
          shellId: "light-first",
          geometry: first.nodes.Light_First_Baked.geometry,
          material: materials.first.REAL_first_Baked,
          position: DESK_POSITION,
          rotation: DESK_ROTATION,
          file: "Light_First.glb",
          chunk: "first",
        },
        {
          shellId: "light-second",
          geometry: computer.rest,
          material: materials.second.actual_second_bro_Baked,
          position: SECOND_POSITION,
          rotation: SECOND_ROTATION,
          file: "Light_Second.glb",
          chunk: "second",
        },
        {
          shellId: "light-third",
          geometry: third.nodes.Light_Third_Baked.geometry,
          material: materials.third.REAL_third_Baked,
          position: THIRD_POSITION,
          rotation: THIRD_ROTATION,
          file: "Light_Third.glb",
          chunk: "third",
        },
      ]),
    [
      first.nodes.Light_First_Baked.geometry,
      third.nodes.Light_Third_Baked.geometry,
      computer.rest,
      materials.first.REAL_first_Baked,
      materials.second.actual_second_bro_Baked,
      materials.third.REAL_third_Baked,
    ]
  );

  return <BakedMeshes {...props} shells={room.shells} objects={room.objects} />;
}
