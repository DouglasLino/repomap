import { useEffect, useRef, useState } from "react";
import { Message } from "primereact/message";
import { NodeDetailsPanel } from "./components/NodeDetailsPanel";
import { RepositoryForm } from "./components/RepositoryForm";
import { RepoFlowCanvas } from "./components/flow/RepoFlowCanvas";
import {
  fetchRepositoryBranches,
  fetchRepositoryGraph,
  refreshRepositoryGraph
} from "./services/api";
import type { GraphNode, GraphResponse, RepositoryProvider } from "./types/graph";

const defaultRepoUrls: Record<RepositoryProvider, string> = {
  github: "https://github.com/DouglasLino/testDiagramView",
  gitlab: "https://gitlab.com/DouglasLino/testdiagramview"
};

export function App() {
  const [provider, setProvider] = useState<RepositoryProvider>("github");
  const [repoUrl, setRepoUrl] = useState(defaultRepoUrls.github);
  const [accessToken, setAccessToken] = useState("");
  const [maxCommits, setMaxCommits] = useState(3);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const commitLimitRequestRef = useRef(0);

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
        max_commits: maxCommits,
        provider,
        access_token: accessToken
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

  async function handleMaxCommitsChange(nextMaxCommits: number) {
    const normalizedMaxCommits = Math.max(1, Math.min(500, nextMaxCommits));
    setMaxCommits(normalizedMaxCommits);

    if (!graph) {
      return;
    }

    const loadedBranches = Array.from(new Set(
      graph.nodes
        .filter((node) => node.type === "commit" && node.branch)
        .map((node) => node.branch as string)
    ));

    if (loadedBranches.length === 0) {
      return;
    }

    const requestId = commitLimitRequestRef.current + 1;
    commitLimitRequestRef.current = requestId;
    setLoading(true);
    setError(null);
    setSyncMessage(null);

    try {
      const response = await fetchRepositoryBranches(
        {
          repo_url: repoUrl,
          max_commits: normalizedMaxCommits,
          provider,
          access_token: accessToken
        },
        loadedBranches
      );

      if (commitLimitRequestRef.current === requestId) {
        setGraph(response);
      }
    } catch (unknownError) {
      if (commitLimitRequestRef.current !== requestId) {
        return;
      }

      const message = unknownError instanceof Error
        ? unknownError.message
        : "No se pudo actualizar el limite de commits";
      setError(message);
    } finally {
      if (commitLimitRequestRef.current === requestId) {
        setLoading(false);
      }
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
          max_commits: maxCommits,
          provider,
          access_token: accessToken
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
      } else if (newBranches.length > 0 && addedCommits === 0) {
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
          max_commits: maxCommits,
          provider,
          access_token: accessToken
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
    <main className={`app app-provider-${provider}`}>
      <header className="topbar">
        <div>
          <span className="eyebrow">{provider === "gitlab" ? "GitLab" : "GitHub"} Graph Visualizer</span>
          <h1>repoMap</h1>
        </div>
        <RepositoryForm
          provider={provider}
          repoUrl={repoUrl}
          accessToken={accessToken}
          maxCommits={maxCommits}
          loading={loading}
          onProviderChange={(nextProvider) => {
            const previousProvider = provider;
            setProvider(nextProvider);
            setRepoUrl((currentRepoUrl) =>
              currentRepoUrl === defaultRepoUrls[previousProvider]
                ? defaultRepoUrls[nextProvider]
                : currentRepoUrl
            );
            setGraph(null);
            setError(null);
            setSyncMessage(null);
            setSelectedNode(null);
          }}
          onRepoUrlChange={setRepoUrl}
          onAccessTokenChange={setAccessToken}
          onMaxCommitsChange={handleMaxCommitsChange}
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
