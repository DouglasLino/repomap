import type { GraphNode } from "../types/graph";

function selectedNodeTitle(node: GraphNode): string {
  return node.type === "branch" ? "Branch" : "Commit";
}

function selectedNodeTypeLabel(node: GraphNode): string {
  return node.type === "branch" ? "branch" : "commit";
}

function formatNodeDate(date: string | null | undefined): string | null {
  if (!date) {
    return null;
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleString();
}

/** Shows metadata for the selected branch or commit without owning graph state. */
export function NodeDetailsPanel({
  node,
  onClose
}: {
  node: GraphNode;
  onClose: () => void;
}) {
  const formattedDate = formatNodeDate(node.date);

  return (
    <div className="node-details-backdrop" onClick={onClose}>
      <aside
        className="node-details-drawer"
        aria-label={`Detalle de ${selectedNodeTitle(node)}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="node-details-heading">
          <span>{selectedNodeTitle(node)}</span>
          <button type="button" className="node-details-close" aria-label="Cerrar detalle" onClick={onClose}>
            <i className="pi pi-times" />
          </button>
        </div>

        <div className="node-details">
          <h3>{node.branch ?? node.label}</h3>
          <p><strong>Tipo:</strong> {selectedNodeTypeLabel(node)}</p>
          {node.branch ? <p><strong>Branch:</strong> {node.branch}</p> : null}
          {node.type === "commit" ? <p><strong>Commit:</strong> {node.label}</p> : null}
          {node.author ? <p><strong>Autor:</strong> {node.author}</p> : null}
          {formattedDate ? <p><strong>Fecha:</strong> {formattedDate}</p> : null}
          {node.message ? <p><strong>Mensaje:</strong> {node.message}</p> : null}
          {node.url ? (
            <p>
              <a href={node.url} target="_blank" rel="noreferrer">
                Ver en GitHub
              </a>
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
