import { Button } from "primereact/button";
import { useState } from "react";

interface UtilityMenuProps {
  horizontalLayout: boolean;
  commitsExpanded: boolean;
  historyMode: boolean;
  onToggleLayout: () => void;
  onToggleCommits: () => void;
  onToggleHistory: () => void;
}

const utilityItems = [
  { icon: "pi pi-pencil", label: "Modo canvas", id: "utility-canvas-tooltip" },
  { icon: "pi pi-sliders-h", label: "Opciones de visualización", id: "utility-settings-tooltip" },
  { icon: "pi pi-download", label: "Exportar diagrama", id: "utility-export-tooltip" }
];

export function UtilityMenu({
  horizontalLayout,
  commitsExpanded,
  historyMode,
  onToggleLayout,
  onToggleCommits,
  onToggleHistory
}: UtilityMenuProps) {
  const [orientationAnimating, setOrientationAnimating] = useState(false);
  const [orientationHoverEnabled, setOrientationHoverEnabled] = useState(true);
  const [commitsAnimating, setCommitsAnimating] = useState(false);
  const [commitsHoverEnabled, setCommitsHoverEnabled] = useState(true);
  const orientationLabel = horizontalLayout
    ? "Vista horizontal activa. Cambiar a vertical"
    : "Vista vertical activa. Cambiar a horizontal";
  const commitsLabel = commitsExpanded ? "Ocultar todos los commits" : "Mostrar todos los commits";
  const historyLabel = historyMode ? "Salir del historial Git" : "Visualizar historial Git";

  function handleToggleLayout() {
    setOrientationHoverEnabled(false);
    setOrientationAnimating(true);
    onToggleLayout();
  }

  function handleToggleCommits() {
    setCommitsHoverEnabled(false);
    setCommitsAnimating(true);
    onToggleCommits();
  }

  return (
    <nav className="utility-menu" aria-label="Herramientas del grafo">
      <div className="utility-item">
        <Button
          type="button"
          icon="pi pi-sync"
          className={`utility-button utility-button-active orientation-button${
            orientationAnimating ? " is-click-animating" : ""
          }${orientationHoverEnabled ? " allow-hover-animation" : ""
          }`}
          rounded
          text
          aria-label={orientationLabel}
          aria-describedby="utility-orientation-tooltip"
          onAnimationEnd={(event) => {
            if (event.animationName === "orientation-click-spin") {
              setOrientationAnimating(false);
            }
          }}
          onMouseLeave={() => setOrientationHoverEnabled(true)}
          onClick={handleToggleLayout}
        />
        <span id="utility-orientation-tooltip" className="utility-tooltip" role="tooltip">
          {orientationLabel}
        </span>
      </div>
      <div className="utility-item">
        <Button
          type="button"
          icon={commitsExpanded ? "pi pi-eye-slash" : "pi pi-eye"}
          className={`utility-button commits-button${commitsExpanded ? " utility-button-active" : ""}${
            commitsAnimating ? " is-click-animating" : ""
          }${commitsHoverEnabled ? " allow-hover-animation" : ""}`}
          rounded
          text
          aria-label={commitsLabel}
          aria-describedby="utility-commits-tooltip"
          onAnimationEnd={(event) => {
            if (event.animationName === "commits-click-blink") {
              setCommitsAnimating(false);
            }
          }}
          onMouseLeave={() => setCommitsHoverEnabled(true)}
          onClick={handleToggleCommits}
        />
        <span id="utility-commits-tooltip" className="utility-tooltip" role="tooltip">
          {commitsLabel}
        </span>
      </div>
      <div className="utility-item">
        <Button
          type="button"
          icon="pi pi-history"
          className={`utility-button history-button${historyMode ? " utility-button-active" : ""}`}
          rounded
          text
          aria-pressed={historyMode}
          aria-label={historyLabel}
          aria-describedby="utility-history-tooltip"
          onClick={onToggleHistory}
        />
        <span id="utility-history-tooltip" className="utility-tooltip" role="tooltip">
          {historyLabel}
        </span>
      </div>
      {utilityItems.map((item) => (
        <div key={item.id} className="utility-item">
          <Button
            type="button"
            icon={item.icon}
            className="utility-button"
            rounded
            text
            aria-label={item.label}
            aria-describedby={item.id}
          />
          <span id={item.id} className="utility-tooltip" role="tooltip">
            {item.label}
          </span>
        </div>
      ))}
    </nav>
  );
}
