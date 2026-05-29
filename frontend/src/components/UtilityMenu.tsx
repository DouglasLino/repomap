import { Button } from "primereact/button";
import { useState } from "react";
import type { ConnectionStyle } from "./flow/types";

interface UtilityMenuProps {
  horizontalLayout: boolean;
  commitsExpanded: boolean;
  historyMode: boolean;
  connectionStyle: ConnectionStyle;
  onToggleLayout: () => void;
  onToggleCommits: () => void;
  onToggleHistory: () => void;
  onConnectionStyleChange: (style: ConnectionStyle) => void;
}

const utilityItems = [
  { icon: "pi pi-pencil", label: "Modo canvas", id: "utility-canvas-tooltip" },
  { icon: "pi pi-sliders-h", label: "Opciones de visualización", id: "utility-settings-tooltip" },
  { icon: "pi pi-download", label: "Exportar diagrama", id: "utility-export-tooltip" }
];

const connectionOptions: Array<{
  id: ConnectionStyle;
  label: string;
  previewClass: string;
}> = [
  { id: "straight", label: "Linea recta", previewClass: "connection-preview-straight" },
  { id: "taxi", label: "Ortogonal", previewClass: "connection-preview-taxi" },
  { id: "curved", label: "Curvado", previewClass: "connection-preview-curved" }
];

export function UtilityMenu({
  horizontalLayout,
  commitsExpanded,
  historyMode,
  connectionStyle,
  onToggleLayout,
  onToggleCommits,
  onToggleHistory,
  onConnectionStyleChange
}: UtilityMenuProps) {
  const [orientationAnimating, setOrientationAnimating] = useState(false);
  const [orientationHoverEnabled, setOrientationHoverEnabled] = useState(true);
  const [commitsAnimating, setCommitsAnimating] = useState(false);
  const [commitsHoverEnabled, setCommitsHoverEnabled] = useState(true);
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false);
  const orientationLabel = horizontalLayout
    ? "Vista horizontal activa. Cambiar a vertical"
    : "Vista vertical activa. Cambiar a horizontal";
  const commitsLabel = commitsExpanded ? "Ocultar todos los commits" : "Mostrar todos los commits";
  const historyLabel = historyMode ? "Salir del historial Git" : "Visualizar historial Git";
  const connectionLabel = "Cambiar estilo de conexiones";

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
      <div className={`utility-item connection-style-item${connectionMenuOpen ? " is-open" : ""}`}>
        <Button
          type="button"
          icon="pi pi-share-alt"
          className={`utility-button connection-style-button${connectionMenuOpen ? " utility-button-active" : ""}`}
          rounded
          text
          aria-label={connectionLabel}
          aria-describedby={connectionMenuOpen ? undefined : "utility-connection-style-tooltip"}
          aria-expanded={connectionMenuOpen}
          onClick={() => setConnectionMenuOpen((current) => !current)}
        />
        {connectionMenuOpen ? null : (
          <span id="utility-connection-style-tooltip" className="utility-tooltip" role="tooltip">
            {connectionLabel}
          </span>
        )}
        <div className="connection-radial-menu" aria-label="Estilos de conexiones">
          {connectionOptions.map((option) => (
            <div
              key={option.id}
              className={`connection-style-option-wrap connection-style-option-wrap-${option.id}`}
            >
              <Button
                type="button"
                rounded
                text
                className={`utility-button connection-style-option${
                  connectionStyle === option.id ? " utility-button-active" : ""
                }`}
                aria-label={option.label}
                aria-describedby={`connection-style-${option.id}-tooltip`}
                aria-pressed={connectionStyle === option.id}
                onClick={() => {
                  onConnectionStyleChange(option.id);
                  setConnectionMenuOpen(false);
                }}
              >
                <svg className={`connection-preview ${option.previewClass}`} viewBox="0 0 24 24" aria-hidden="true">
                  {option.id === "straight" ? (
                    <path d="M5 16 L19 8" />
                  ) : null}
                  {option.id === "taxi" ? (
                    <path d="M5 17 H13 V7 H19" />
                  ) : null}
                  {option.id === "curved" ? (
                    <path d="M5 16 C8 7 16 7 19 14" />
                  ) : null}
                </svg>
              </Button>
              <span id={`connection-style-${option.id}-tooltip`} className="utility-tooltip" role="tooltip">
                {option.label}
              </span>
            </div>
          ))}
        </div>
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
