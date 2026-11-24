import {
  RepositoryClientError,
  type RepositoryBranch,
  type RepositoryCommit,
  type RepositoryRef
} from "./repositoryTypes";

interface GitLabCommitResponse {
  id?: string;
  short_id?: string;
  web_url?: string;
  author_name?: string;
  committed_date?: string;
  message?: string;
  title?: string;
  parent_ids?: string[];
}

export function parseGitLabRepoUrl(repoUrl: string): RepositoryRef {
  let url: URL;

  try {
    url = new URL(repoUrl);
  } catch {
    throw new RepositoryClientError("La URL debe tener formato https://gitlab.com/group/repo");
  }

  if (url.hostname.toLowerCase() !== "gitlab.com") {
    throw new RepositoryClientError("La URL debe pertenecer a gitlab.com");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new RepositoryClientError("La URL debe tener formato https://gitlab.com/group/repo");
  }

  const normalizedParts = parts.map((part, index) =>
    index === parts.length - 1 ? part.replace(/\.git$/, "") : part
  );
  const repo = normalizedParts[normalizedParts.length - 1];
  const projectPath = normalizedParts.join("/");

  return {
    provider: "gitlab",
    owner: normalizedParts[0],
    repo,
    fullName: projectPath,
    projectPath
  };
}

function gitlabHeaders(gitlabToken?: string): HeadersInit {
  const token = gitlabToken?.trim();
  return token ? { "PRIVATE-TOKEN": token } : {};
}

async function gitlabErrorMessage(response: Response): Promise<string | null> {
  try {
    const payload = await response.clone().json() as { message?: unknown; error_description?: unknown; error?: unknown };
    const message = payload.message ?? payload.error_description ?? payload.error;
    if (Array.isArray(message)) {
      return message.join(", ");
    }
    if (message && typeof message === "object") {
      return JSON.stringify(message);
    }
    return typeof message === "string" ? message : null;
  } catch {
    try {
      const text = await response.clone().text();
      return text.trim() || null;
    } catch {
      return null;
    }
  }
}

async function gitlabGet<T>(
  path: string,
  params: Record<string, string | number>,
  gitlabToken?: string
): Promise<T> {
  const url = new URL(`https://gitlab.com/api/v4${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url, {
    headers: gitlabHeaders(gitlabToken)
  });

  const detail = response.ok ? null : await gitlabErrorMessage(response);

  if (response.status === 404) {
    throw new RepositoryClientError(
      detail
        ? `Repositorio no encontrado, privado o sin acceso del token. GitLab: ${detail}`
        : "Repositorio no encontrado, privado o sin acceso del token."
    );
  }
  if (response.status === 401) {
    throw new RepositoryClientError(
      detail
        ? `GitLab rechazo el token proporcionado. GitLab: ${detail}`
        : "GitLab rechazo el token proporcionado."
    );
  }
  if (response.status === 403) {
    throw new RepositoryClientError(
      detail
        ? `GitLab rechazo la solicitud. El token es valido, pero no tiene acceso suficiente a este proyecto o le falta scope read_api/read_repository. GitLab: ${detail}`
        : "GitLab rechazo la solicitud. El token es valido, pero no tiene acceso suficiente a este proyecto o le falta scope read_api/read_repository."
    );
  }
  if (response.status === 429) {
    throw new RepositoryClientError("GitLab rechazo la solicitud por limite de uso. Intenta nuevamente mas tarde.");
  }
  if (!response.ok) {
    throw new RepositoryClientError(
      detail
        ? `GitLab respondio con status ${response.status}. GitLab: ${detail}`
        : `GitLab respondio con status ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

function normalizeGitLabCommit(commit: GitLabCommitResponse): RepositoryCommit | null {
  const sha = commit.id ?? commit.short_id;
  if (!sha) {
    return null;
  }

  return {
    sha,
    parentShas: commit.parent_ids ?? [],
    author: commit.author_name ?? null,
    date: commit.committed_date ?? null,
    message: (commit.title ?? commit.message)?.split("\n")[0] ?? "",
    url: commit.web_url ?? null
  };
}

export async function getGitLabBranches(
  repo: RepositoryRef,
  limit = 100,
  gitlabToken?: string
): Promise<RepositoryBranch[]> {
  const branches = await gitlabGet<RepositoryBranch[]>(
    `/projects/${encodeURIComponent(repo.projectPath)}/repository/branches`,
    { per_page: limit },
    gitlabToken
  );

  if (!Array.isArray(branches)) {
    throw new RepositoryClientError("Respuesta inesperada al consultar ramas");
  }
  return branches;
}

export async function getGitLabBranchCommits(
  repo: RepositoryRef,
  branchName: string,
  perPage: number,
  gitlabToken?: string
): Promise<RepositoryCommit[]> {
  const commits = await gitlabGet<GitLabCommitResponse[]>(
    `/projects/${encodeURIComponent(repo.projectPath)}/repository/commits`,
    { ref_name: branchName, per_page: perPage },
    gitlabToken
  );

  if (!Array.isArray(commits)) {
    throw new RepositoryClientError("Respuesta inesperada al consultar commits");
  }
  return commits.flatMap((commit) => normalizeGitLabCommit(commit) ?? []);
}
