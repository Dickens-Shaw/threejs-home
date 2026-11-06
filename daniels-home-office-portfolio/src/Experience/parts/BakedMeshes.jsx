import Part from "./Part";

export default function BakedMeshes({ shells, objects, ...props }) {
  return (
    <group {...props}>
      {shells.map((shell) => (
        <Part
          key={shell.id}
          id={shell.id}
          position={shell.position}
          rotation={shell.rotation}
        >
          <mesh geometry={shell.geometry} material={shell.material} />
        </Part>
      ))}
      {objects.map((object) => (
        <Part key={object.id} id={object.id}>
          {object.meshes.map((mesh, index) => (
            <mesh
              key={`${object.id}-${index}`}
              geometry={mesh.geometry}
              material={mesh.material}
              position={mesh.position}
              rotation={mesh.rotation}
            />
          ))}
        </Part>
      ))}
    </group>
  );
}
