import {
  RepositoryClientError,
  type RepositoryBranch,
  type RepositoryCommit,
  type RepositoryRef
} from "./repositoryTypes";

interface GitHubCommitResponse {
  sha?: string;
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

export function parseGitHubRepoUrl(repoUrl: string): RepositoryRef {
  let url: URL;

  try {
    url = new URL(repoUrl);
  } catch {
    throw new RepositoryClientError("La URL debe tener formato https://github.com/owner/repo");
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    throw new RepositoryClientError("La URL debe pertenecer a github.com");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new RepositoryClientError("La URL debe tener formato https://github.com/owner/repo");
  }

  const repo = parts[1].replace(/\.git$/, "");
  return {
    provider: "github",
    owner: parts[0],
    repo,
    fullName: `${parts[0]}/${repo}`,
    projectPath: `${parts[0]}/${repo}`
  };
}

function githubHeaders(githubToken?: string): HeadersInit {
  const token = githubToken?.trim();
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function githubGet<T>(
  path: string,
  params: Record<string, string | number>,
  githubToken?: string
): Promise<T> {
  const url = new URL(`https://api.github.com${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url, {
    headers: githubHeaders(githubToken)
  });

  if (response.status === 404) {
    throw new RepositoryClientError("Repositorio no encontrado o privado");
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new RepositoryClientError(
      remaining === "0"
        ? "Se alcanzo el limite de solicitudes anonimas de GitHub. Intenta nuevamente mas tarde."
        : "GitHub rechazo la solicitud por limite de uso."
    );
  }
  if (!response.ok) {
    throw new RepositoryClientError(`GitHub respondio con status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function normalizeGitHubCommit(commit: GitHubCommitResponse): RepositoryCommit | null {
  if (!commit.sha) {
    return null;
  }

  return {
    sha: commit.sha,
    parentShas: (commit.parents ?? []).flatMap((parent) => parent.sha ? [parent.sha] : []),
    author: commit.commit?.author?.name ?? null,
    date: commit.commit?.author?.date ?? null,
    message: commit.commit?.message?.split("\n")[0] ?? "",
    url: commit.html_url ?? null
  };
}

export async function getGitHubBranches(
  repo: RepositoryRef,
  limit = 100,
  githubToken?: string
): Promise<RepositoryBranch[]> {
  const branches = await githubGet<RepositoryBranch[]>(
    `/repos/${repo.owner}/${repo.repo}/branches`,
    { per_page: limit },
    githubToken
  );

  if (!Array.isArray(branches)) {
    throw new RepositoryClientError("Respuesta inesperada al consultar ramas");
  }
  return branches;
}

export async function getGitHubBranchCommits(
  repo: RepositoryRef,
  branchName: string,
  perPage: number,
  githubToken?: string
): Promise<RepositoryCommit[]> {
  const commits = await githubGet<GitHubCommitResponse[]>(
    `/repos/${repo.owner}/${repo.repo}/commits`,
    { sha: branchName, per_page: perPage },
    githubToken
  );

  if (!Array.isArray(commits)) {
    throw new RepositoryClientError("Respuesta inesperada al consultar commits");
  }
  return commits.flatMap((commit) => normalizeGitHubCommit(commit) ?? []);
}
