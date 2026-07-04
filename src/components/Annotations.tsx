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
              center
              position={a.position}
              style={{
                background: selectedId === a.id ? "red" : "blue",
                color: "white",
                transform: "translate(-50%, -125%)",
              }}
            >
              <p>{a.title}</p>
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
