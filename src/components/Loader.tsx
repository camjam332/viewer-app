import { useProgress } from "@react-three/drei";
import { LoaderCircle } from "lucide-react";

export const Loader = () => {
  const { progress, active } = useProgress();

  return (
    <>
      {active ? (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-2">
          <h1>Loading {progress.toFixed(0)}%</h1>
          <LoaderCircle className="animate-spin w-16 h-16 text-gray-500" />
        </div>
      ) : null}
    </>
  );
};
