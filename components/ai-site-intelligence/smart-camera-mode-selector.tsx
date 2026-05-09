import { cn } from "@/lib/utils";
import { SMART_CAMERA_MODES, type SmartCameraMode } from "@/lib/ai/site-intelligence";

export function SmartCameraModeSelector({
  value,
  onChange
}: {
  value: SmartCameraMode;
  onChange: (mode: SmartCameraMode) => void;
}) {
  const selectedMode = SMART_CAMERA_MODES.find((mode) => mode.key === value) ?? SMART_CAMERA_MODES[0];

  return (
    <div className="field field-full smart-camera-mode">
      <span>Smart camera mode</span>
      <div className="smart-camera-actions">
        {SMART_CAMERA_MODES.map((mode) => (
          <button
            className={cn("smart-camera-button", value === mode.key && "active")}
            key={mode.key}
            onClick={() => onChange(mode.key)}
            type="button"
          >
            {mode.label}
          </button>
        ))}
      </div>
      <p className="field-hint">{selectedMode.helper}</p>
    </div>
  );
}
