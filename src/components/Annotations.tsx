import { Fragment } from "react";
import { useViewer } from "../state/state";
import { Html } from "@react-three/drei";

export const Annotations = () => {
  const annotations = useViewer((s) => s.annotations);
  const selectedId = useViewer((s) => s.selectedId);
  const setSelectedId = useViewer((s) => s.setSelectedId);
  return (
    <>
      {annotations.map((a) => {
        return (
          <Fragment key={a.id}>
            <Html
              position={a.position}
              className={`text-white rounded-xl !-translate-x-1/2 !-translate-y-[125%] ${
                selectedId === a.id ? "bg-[red]" : "bg-[blue]"
              }`}
            >
              <p className="p-2">{a.title}</p>
            </Html>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(a.id);
              }}
              scale={0.1}
              position={a.position}
            >
              <boxGeometry />
              <meshBasicMaterial color={selectedId === a.id ? "red" : "blue"} />
            </mesh>
          </Fragment>
        );
      })}
    </>
  );
};
