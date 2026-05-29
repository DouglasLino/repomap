import { useEffect, useState } from "react";
import { Message } from "primereact/message";
import { RepositoryForm } from "./components/RepositoryForm";
import { RepoFlowCanvas } from "./components/flow/RepoFlowCanvas";
import { fetchRepositoryGraph } from "./services/api";
import type { GraphNode, GraphResponse } from "./types/graph";

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

function NodeDetailsPanel({
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

export function App() {
  const [repoUrl, setRepoUrl] = useState("https://github.com/DouglasLino/testDiagramView");
  const [maxCommits, setMaxCommits] = useState(3);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    setSelectedNode(null);
  }, [graph]);

  async function handleGraph() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchRepositoryGraph({
        repo_url: repoUrl,
        max_commits: maxCommits
      });
      setGraph(response);
    } catch (unknownError) {
      const message = unknownError instanceof Error
        ? unknownError.message
        : "No se pudo graficar el repositorio";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <span className="eyebrow">GitHub Graph Visualizer</span>
          <h1>repoMap</h1>
        </div>
        <RepositoryForm
          repoUrl={repoUrl}
          maxCommits={maxCommits}
          loading={loading}
          onRepoUrlChange={setRepoUrl}
          onMaxCommitsChange={setMaxCommits}
          onSubmit={handleGraph}
        />
      </header>

      {error ? (
        <Message severity="error" text={error} className="error-message" />
      ) : null}

      <RepoFlowCanvas graph={graph} onNodeSelect={setSelectedNode} />

      {selectedNode ? (
        <NodeDetailsPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      ) : null}
    </main>
  );
}
