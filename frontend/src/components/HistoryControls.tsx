import { Button } from "primereact/button";

interface HistoryControlsProps {
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function HistoryControls({
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext
}: HistoryControlsProps) {
  return (
    <div className="history-controls" aria-label="Navegacion del historial Git">
      <Button
        type="button"
        icon="pi pi-arrow-left"
        rounded
        disabled={!canGoPrevious}
        aria-label="Ver estado anterior"
        title="Ver estado anterior"
        onClick={onPrevious}
      />
      <Button
        type="button"
        icon="pi pi-arrow-right"
        rounded
        disabled={!canGoNext}
        aria-label="Ver estado siguiente"
        title="Ver estado siguiente"
        onClick={onNext}
      />
    </div>
  );
}
