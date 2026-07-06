import { Fragment } from "react";
import { useViewer } from "../state/state";
import { Html } from "@react-three/drei";
import { MapPin } from "lucide-react";

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
              className={`relative rounded-xl !-translate-x-1/2 !-translate-y-[150%] text-white ${
                selectedId === a.id ? "bg-blue-600" : "bg-black"
              }`}
            >
              <p
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(a.id);
                }}
                className="whitespace-nowrap p-2"
              >
                <MapPin />
              </p>
              <div
                className={`absolute left-1/2 top-full -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 ${
                  selectedId === a.id ? "bg-blue-600" : "bg-black"
                }`}
              />
            </Html>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(a.id);
              }}
              scale={0.05}
              position={a.position}
            >
              <sphereGeometry />
              <meshBasicMaterial
                color={selectedId === a.id ? "blue" : "black"}
              />
            </mesh>
          </Fragment>
        );
      })}
    </>
  );
};
