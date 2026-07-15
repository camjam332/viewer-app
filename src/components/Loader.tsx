import { useProgress } from "@react-three/drei";

export const Loader = () => {
  const { progress, active } = useProgress();

  return (
    <>
      {active ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-black/80 p-4 text-center text-white backdrop-blur">
            <h1 className="text-lg font-semibold md:text-xl">Loading Mesh…</h1>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white/70 transition-[width] duration-150"
                style={{ width: `${progress.toFixed(0)}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-white/70">{progress.toFixed(0)}%</p>
          </div>
        </div>
      ) : null}
    </>
  );
};
