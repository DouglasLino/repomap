/** Renders the fixed visual reference for graph nodes and edge meanings. */
export function GraphLegend() {
  return (
    <aside className="graph-legend" aria-label="Leyenda del diagrama">
      <div className="graph-legend-item">
        <span className="graph-legend-branch" aria-hidden="true" />
        <span><strong>Rama</strong> representa una rama Git.</span>
      </div>
      <div className="graph-legend-item">
        <span className="graph-legend-commit" aria-hidden="true" />
        <span><strong>Commit</strong> representa un commit Git.</span>
      </div>
      <div className="graph-legend-item">
        <span className="graph-legend-line graph-legend-line-solid" aria-hidden="true" />
        <span><strong>Relación de rama</strong> confirmada por el historial Git.</span>
      </div>
      <div className="graph-legend-item">
        <span className="graph-legend-line graph-legend-line-dashed" aria-hidden="true" />
        <span><strong>Posible origen de rama</strong> inferido por historial compartido.</span>
      </div>
    </aside>
  );
}
