import { useEffect, useState } from "react";
import { useMeasurement } from "../state/measurementState";
import { LoaderCircle } from "lucide-react";

export const ToastNotification = () => {
  const buildingGraph = useMeasurement((s) => s.buildingGraph);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (buildingGraph) {
      setShowToast(true);
    }
  }, [buildingGraph]);

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div
        className={`fixed bottom-5 right-5 z-50 flex items-center w-full max-w-xs p-4 text-gray-600 bg-white rounded-xl shadow-xl border border-gray-100 transition-all duration-350 ease-out
          ${showToast ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-4 scale-90 pointer-events-none"}`}
      >
        <div
          className={`inline-flex items-center justify-center flex-shrink-0 w-8 h-8 rounded-lg
            ${buildingGraph ? `text-gray-600 bg-gray-50` : `text-green-600 bg-green-50`}`}
        >
          {buildingGraph ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
        </div>
        <div className="ml-3 text-sm font-semibold">
          {buildingGraph ? `Building Graph...` : `Graph Built`}
        </div>

        {/* Manual Close Button */}
        {!buildingGraph && (
          <button
            onClick={() => setShowToast(false)}
            className="ml-auto -mx-1.5 -my-1.5 bg-white text-gray-400 hover:text-gray-900 rounded-lg p-1.5 hover:bg-gray-100 inline-flex items-center justify-center h-8 w-8"
          >
            <span className="sr-only">Close</span>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 14 14">
              <path
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
