import { useEffect, useState } from "react";
import { Message } from "primereact/message";
import { RepositoryForm } from "./components/RepositoryForm";
import { RepoFlowCanvas } from "./components/flow/RepoFlowCanvas";
import {
  fetchRepositoryBranches,
  fetchRepositoryGraph,
  refreshRepositoryGraph
} from "./services/api";
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
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  
  useEffect(() => {
    setSelectedNode(null);
  }, [graph]);

  async function handleGraph() {
    setLoading(true);
    setError(null);
    setSyncMessage(null);

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

  async function handleRefresh(branches: string[]) {
  if (!graph) {
    return;
  }

  setLoading(true);
  setError(null);
  setSyncMessage(null);

  try {
    const response = await refreshRepositoryGraph(
      {
        repo_url: repoUrl,
        max_commits: maxCommits
      },
      branches
    );

    const currentBranches = new Set(
      graph.nodes
        .filter((node) => node.type === "branch")
        .map((node) => node.branch ?? node.label)
    );

    const newBranches = response.nodes
      .filter((node) => node.type === "branch")
      .map((node) => node.branch ?? node.label)
      .filter((branch) => !currentBranches.has(branch));

    const currentCommits = graph.nodes.filter(
      (node) => node.type === "commit"
    ).length;

    const newCommits = response.nodes.filter(
      (node) => node.type === "commit"
    ).length;

    const addedCommits = Math.max(
      0,
      newCommits - currentCommits
    );

    setGraph(response);

    if (newBranches.length === 0 && addedCommits === 0) {
      setSyncMessage(
        "Repositorio sincronizado. No se detectaron cambios."
      );
        }  else if (newBranches.length > 0 && addedCommits === 0) {
      setSyncMessage(
        `Repositorio sincronizado. Se detectaron ${newBranches.length} ramas nuevas.`
      );
    } else if (newBranches.length === 0 && addedCommits > 0) {
      setSyncMessage(
        `Repositorio sincronizado. Se detectaron ${addedCommits} commits nuevos.`
      );
    } else {
      setSyncMessage(
        `Repositorio sincronizado. Se detectaron ${newBranches.length} ramas nuevas y ${addedCommits} commits nuevos.`
      );
    }
  } catch (unknownError) {
    const message = unknownError instanceof Error
      ? unknownError.message
      : "No se pudo sincronizar el repositorio";

    setError(message);
  } finally {
    setLoading(false);
  }
}

  async function handleBranchSelection(branches: string[]) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchRepositoryBranches(
        {
          repo_url: repoUrl,
          max_commits: maxCommits
        },
        branches
      );
      setGraph(response);
    } catch (unknownError) {
      const message = unknownError instanceof Error
        ? unknownError.message
        : "No se pudo cargar la rama seleccionada";
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

      {syncMessage ? (
        <Message severity="success" text={syncMessage} className="success-message" />
      ) : null}

      <RepoFlowCanvas
        graph={graph}
        onNodeSelect={setSelectedNode}
        onBranchesRequest={handleBranchSelection}
        onRefresh={handleRefresh}
        refreshing={loading}
      />

      {selectedNode ? (
        <NodeDetailsPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      ) : null}
    </main>
  );
}
