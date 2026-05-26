import { Button } from "primereact/button";

interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitGraph: () => void;
}

export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onFitGraph
}: ZoomControlsProps) {
  return (
    <div className="zoom-controls" aria-label="Zoom del grafo">
      <Button
        type="button"
        icon="pi pi-minus"
        text
        aria-label="Alejar grafo"
        title="Alejar"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      />
      <button
        type="button"
        className="zoom-level"
        aria-label="Ajustar y centrar el diagrama"
        title="Doble clic para ajustar y centrar"
        onDoubleClick={onFitGraph}
      >
        <span aria-live="polite">{zoomPercent}%</span>
      </button>
      <Button
        type="button"
        icon="pi pi-plus"
        text
        aria-label="Acercar grafo"
        title="Acercar"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      />
    </div>
  );
}
