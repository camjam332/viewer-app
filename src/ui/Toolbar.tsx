import { useMemo, useState, type RefObject } from "react";
import { useViewer, type Tool } from "../state/state";
import { ModelPicker } from "./ModelPicker";
import { useMeasurement } from "../state/measurementState";
import { ControlSlider } from "./ControlSlider";
import { useAero } from "../state/aeroState";
import { handleExport } from "../utils/model_utils";
import type { Group } from "three";
import type { UploadKind } from "../utils/uploadFileType";

type ToolbarParams = {
  modelRef: RefObject<Group | null>;
  // Gate in front of switching models - decides whether the switch needs
  // confirmation (floater cleanup, a manual orientation edit, an
  // in-progress measurement, or uploaded-model annotations would be
  // discarded) and only then applies it. Toolbar no longer writes
  // modelUrl/uploadedModelUrl to the store directly for this reason.
  requestModelChange: (change: {
    url: string;
    isUpload: boolean;
    upload?: UploadKind;
  }) => void;
  onUnsupportedFile?: (filename: string) => void;
};

export const Toolbar = ({
  modelRef,
  requestModelChange,
  onUnsupportedFile,
}: ToolbarParams) => {
  const setTool = useViewer((s) => s.setTool);
  const setIsWireframe = useViewer((s) => s.setIsWireframe);
  const setEditTexture = useViewer((s) => s.setEditTexture);
  const setShowAero = useViewer((s) => s.setShowAero);
  const setFocusedId = useViewer((s) => s.setFocusedId);
  const setResetCamera = useViewer((s) => s.setResetCamera);
  const setMeasurementMode = useMeasurement((s) => s.setMeasurementMode);
  const setConfig = useAero((s) => s.setConfig);
  const setShowTransformControls = useViewer((s) => s.setShowTransformControls);
  const setTransformControlsMode = useViewer((s) => s.setTransformControlsMode);
  const setMeshDeformation = useViewer((s) => s.setMeshDeformation);
  const setCameraControlMode = useViewer((s) => s.setCameraControlMode);
  const setLodEnabled = useViewer((s) => s.setLodEnabled);

  const clearPoints = useMeasurement((s) => s.clearPoints);

  const showAero = useViewer((s) => s.showAero);
  const isWireframe = useViewer((s) => s.isWireframe);
  const editTexture = useViewer((s) => s.editTexture);
  const models = useViewer((s) => s.models);
  const modelUrl = useViewer((s) => s.modelUrl);
  const points = useMeasurement((s) => s.points);
  const measurementMode = useMeasurement((s) => s.mode);
  const surfaceDistance = useMeasurement((s) => s.surfaceDistance);
  const buildingGraph = useMeasurement((s) => s.buildingGraph);
  const uploadedModelUrl = useViewer((s) => s.uploadedModelUrl);
  const uploadedModelKind = useViewer((s) => s.uploadedModelKind);
  const config = useAero((s) => s.config);
  const showTransformControls = useViewer((s) => s.showTransformControls);
  const meshDeformation = useViewer((s) => s.meshDeformation);
  const cameraControlMode = useViewer((s) => s.cameraControlMode);
  const lodEnabled = useViewer((s) => s.lodEnabled);
  const isBuildingLod = useViewer((s) => s.isBuildingLod);

  const selectedModel = models.find((m) => m.modelUrl === modelUrl);
  // Mirrors App.tsx's isSplatModel derivation - an uploaded file has no
  // entry in `models` to look `kind` up from, so its kind has to come from
  // uploadedModelKind (captured at upload time) instead.
  const isSplatModel = uploadedModelUrl
    ? uploadedModelKind === "splat"
    : selectedModel?.kind === "splat";

  const [isOpen, setIsOpen] = useState(false);

  const distance = useMemo(() => {
    if (points.length === 2) {
      if (measurementMode === "linear") {
        return points[0].distanceTo(points[1]);
      } else {
        if (!surfaceDistance) return;
        return surfaceDistance;
      }
    }
    return null;
  }, [measurementMode, points, surfaceDistance]);

  return (
    <div
      className="flex flex-wrap z-20 items-center justify-center gap-2 bg-black/70 backdrop-blur rounded-lg p-2
                md:w-auto md:justify-start md:flex-nowrap md:items-start"
    >
      <button
        aria-label={isOpen ? "Collapse toolbar" : "Expand toolbar"}
        aria-expanded={isOpen}
        className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? "✕" : "☰"}
      </button>
      {isOpen && (
        <div className="flex flex-wrap items-center justify-center gap-2 md:flex-col md:items-stretch md:justify-start">
          <select
            className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
            onChange={(e) => setTool(e.target.value as Tool)}
          >
            <option
              className="rounded bg-black/70 text-white px-2 py-1"
              value="orbit"
            >
              Orbit
            </option>
            <option
              className="rounded bg-black/70 text-white px-2 py-1"
              value="measure"
            >
              Measure
            </option>
            <option
              className="rounded bg-black/70 text-white px-2 py-1"
              value="annotate"
            >
              Annotate
            </option>
          </select>
          <ModelPicker
            models={models}
            modelUrl={modelUrl}
            setModelUrl={(url) => requestModelChange({ url, isUpload: false })}
            uploadedModelUrl={uploadedModelUrl}
            onUploadModel={(url, upload) =>
              requestModelChange({ url, isUpload: true, upload })
            }
            onUnsupportedFile={onUnsupportedFile}
          />
          {!isSplatModel && (
            <div className="flex items-center gap-2">
              <label className="text-white select-none ms-2 text-sm font-medium text-heading">
                Wireframe
              </label>
              <input
                type="checkbox"
                checked={isWireframe}
                onChange={() => setIsWireframe()}
                className="w-4 h-4 border border-default-medium rounded-xs bg-neutral-secondary-medium"
              />
              <label className="text-white select-none ms-2 text-sm font-medium text-heading">
                Show Aeros
              </label>
              <input
                type="checkbox"
                checked={showAero}
                onChange={() => setShowAero()}
                className="w-4 h-4 border border-default-medium rounded-xs bg-neutral-secondary-medium"
              />
              {showAero && (
                <div>
                  <ControlSlider
                    label="Flow Direction (°)"
                    min={-180}
                    max={180}
                    step={1}
                    value={config.flowYawDeg}
                    onChange={(v) => setConfig({ flowYawDeg: v })}
                  />
                  <ControlSlider
                    label="Trail length"
                    min={10}
                    max={150}
                    step={5}
                    value={config.trailLength}
                    onChange={(v) =>
                      setConfig((c) => ({ ...c, trailLength: v }))
                    }
                  />
                </div>
              )}
            </div>
          )}
          {!isSplatModel && (
            <div className="flex items-center gap-2">
              <label className="text-white select-none ms-2 text-sm font-medium text-heading">
                Edit Texture
              </label>
              <input
                type="checkbox"
                checked={editTexture}
                onChange={() => setEditTexture()}
                className="w-4 h-4 border border-default-medium rounded-xs bg-neutral-secondary-medium"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-white select-none ms-2 text-sm font-medium text-heading">
              Show Transform Controls
            </label>
            <input
              type="checkbox"
              checked={showTransformControls}
              onChange={() => setShowTransformControls()}
              className="w-4 h-4 border border-default-medium rounded-xs bg-neutral-secondary-medium"
            />
            {showTransformControls && (
              <select
                className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
                onChange={(e) =>
                  setTransformControlsMode(
                    e.target.value as "translate" | "rotate" | "scale",
                  )
                }
              >
                <option
                  className="rounded bg-black/70 text-white px-2 py-1"
                  value="translate"
                >
                  Translate
                </option>
                <option
                  className="rounded bg-black/70 text-white px-2 py-1"
                  value="rotate"
                >
                  Rotate
                </option>
                <option
                  className="rounded bg-black/70 text-white px-2 py-1"
                  value="scale"
                >
                  Scale
                </option>
              </select>
            )}
          </div>
          {!isSplatModel && (
            <div className="flex items-center gap-2">
              <label className="text-white select-none ms-2 text-sm font-medium text-heading">
                Deform Mesh
              </label>
              <input
                type="checkbox"
                checked={meshDeformation}
                onChange={() => setMeshDeformation()}
                className="w-4 h-4 border border-default-medium rounded-xs bg-neutral-secondary-medium"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-white select-none ms-2 text-sm font-medium text-heading">
              Fly Controls
            </label>
            <input
              type="checkbox"
              checked={cameraControlMode === "fly"}
              onChange={() =>
                setCameraControlMode(
                  cameraControlMode === "fly" ? "orbit" : "fly",
                )
              }
              className="w-4 h-4 border border-default-medium rounded-xs bg-neutral-secondary-medium"
            />
          </div>
          {isSplatModel && (
            <div className="flex items-center gap-2">
              <label className="text-white select-none ms-2 text-sm font-medium text-heading">
                {isBuildingLod ? "Building LOD…" : "Enable LOD"}
              </label>
              <input
                type="checkbox"
                checked={lodEnabled}
                disabled={isBuildingLod}
                onChange={() => setLodEnabled()}
                className="w-4 h-4 border border-default-medium rounded-xs bg-neutral-secondary-medium disabled:opacity-50"
              />
            </div>
          )}
          {cameraControlMode === "orbit" && (
            <button
              className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
              onClick={() => {
                setFocusedId(null);
                setResetCamera(true);
              }}
            >
              Reset Camera
            </button>
          )}
          {!isSplatModel && (
            <button
              className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
              onClick={() => handleExport(modelRef)}
            >
              Export Model
            </button>
          )}
          {points.length > 0 && isSplatModel ? (
            <select
              onChange={(e) =>
                setMeasurementMode(e.target.value as "linear" | "geodesic")
              }
              className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
            >
              <option
                value="linear"
                className="rounded bg-black/70 text-white px-2 py-1"
              >
                Linear
              </option>
              {buildingGraph ? null : (
                <option
                  value="geodesic"
                  className="rounded bg-black/70 text-white px-2 py-1"
                >
                  Geodesic
                </option>
              )}
            </select>
          ) : (
            <select
              onChange={(e) =>
                setMeasurementMode(e.target.value as "linear" | "geodesic")
              }
              className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
            >
              <option
                value="linear"
                className="rounded bg-black/70 text-white px-2 py-1"
              >
                Linear
              </option>
            </select>
          )}
          {points.length > 0 && (
            <button
              className="rounded text-white bg-white/10 hover:bg-white/20 px-3 py-1"
              onClick={() => {
                clearPoints();
                setMeasurementMode("linear");
              }}
            >
              Clear Points
            </button>
          )}
          {distance && (
            <p className="bg-black/70 text-white px-3 rounded">
              {measurementMode === "linear"
                ? `Straight: ${distance.toFixed(2)}m`
                : surfaceDistance && `Surface: ${surfaceDistance.toFixed(2)}m`}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
