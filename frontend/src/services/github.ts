export interface RepositoryRef {
  owner: string;
  repo: string;
  fullName: string;
}

export interface GitHubBranch {
  name: string;
}

export interface GitHubCommit {
  sha: string;
  html_url?: string;
  commit?: {
    author?: {
      name?: string;
      date?: string;
    } | null;
    message?: string;
  };
  parents?: Array<{ sha?: string }>;
}

export class GitHubClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubClientError";
  }
}

export function parseGitHubRepoUrl(repoUrl: string): RepositoryRef {
  let url: URL;

  try {
    url = new URL(repoUrl);
  } catch {
    throw new GitHubClientError("La URL debe tener formato https://github.com/owner/repo");
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    throw new GitHubClientError("La URL debe pertenecer a github.com");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new GitHubClientError("La URL debe tener formato https://github.com/owner/repo");
  }

  const repo = parts[1].replace(/\.git$/, "");
  return {
    owner: parts[0],
    repo,
    fullName: `${parts[0]}/${repo}`
  };
}

async function githubGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`https://api.github.com${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (response.status === 404) {
    throw new GitHubClientError("Repositorio no encontrado o privado");
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new GitHubClientError(
      remaining === "0"
        ? "Se alcanzo el limite de solicitudes anonimas de GitHub. Intenta nuevamente mas tarde."
        : "GitHub rechazo la solicitud por limite de uso."
    );
  }
  if (!response.ok) {
    throw new GitHubClientError(`GitHub respondio con status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getBranches(repo: RepositoryRef, limit = 100): Promise<GitHubBranch[]> {
  const branches = await githubGet<GitHubBranch[]>(
    `/repos/${repo.owner}/${repo.repo}/branches`,
    { per_page: limit }
  );

  if (!Array.isArray(branches)) {
    throw new GitHubClientError("Respuesta inesperada al consultar ramas");
  }
  return branches;
}

export async function getBranchCommits(
  repo: RepositoryRef,
  branchName: string,
  perPage: number
): Promise<GitHubCommit[]> {
  const commits = await githubGet<GitHubCommit[]>(
    `/repos/${repo.owner}/${repo.repo}/commits`,
    { sha: branchName, per_page: perPage }
  );

  if (!Array.isArray(commits)) {
    throw new GitHubClientError("Respuesta inesperada al consultar commits");
  }
  return commits;
}
