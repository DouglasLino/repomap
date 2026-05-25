import { useState } from "react";
import { isAxiosError } from "axios";
import { Message } from "primereact/message";
import { RepositoryForm } from "./components/RepositoryForm";
import { GraphCanvas } from "./components/GraphCanvas";
import { fetchRepositoryGraph } from "./services/api";
import type { GraphResponse } from "./types/graph";

export function App() {
  const [repoUrl, setRepoUrl] = useState("https://github.com/facebook/react");
  const [maxCommits, setMaxCommits] = useState(5);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const message = isAxiosError(unknownError)
        ? unknownError.response?.data?.detail ?? unknownError.message
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

      <GraphCanvas graph={graph} />
    </main>
  );
}
