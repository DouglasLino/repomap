import type { RepositoryProvider } from "../types/graph";
import {
  getGitHubBranches,
  getGitHubBranchCommits,
  parseGitHubRepoUrl
} from "./github";
import {
  getGitLabBranches,
  getGitLabBranchCommits,
  parseGitLabRepoUrl
} from "./gitlab";
import type { RepositoryBranch, RepositoryCommit, RepositoryRef } from "./repositoryTypes";

export function parseRepositoryUrl(
  repoUrl: string,
  provider: RepositoryProvider = "github"
): RepositoryRef {
  return provider === "gitlab"
    ? parseGitLabRepoUrl(repoUrl)
    : parseGitHubRepoUrl(repoUrl);
}

export function getBranches(
  repo: RepositoryRef,
  limit = 100,
  token?: string
): Promise<RepositoryBranch[]> {
  return repo.provider === "gitlab"
    ? getGitLabBranches(repo, limit, token)
    : getGitHubBranches(repo, limit, token);
}

export function getBranchCommits(
  repo: RepositoryRef,
  branchName: string,
  perPage: number,
  token?: string
): Promise<RepositoryCommit[]> {
  return repo.provider === "gitlab"
    ? getGitLabBranchCommits(repo, branchName, perPage, token)
    : getGitHubBranchCommits(repo, branchName, perPage, token);
}

export type { RepositoryBranch, RepositoryCommit, RepositoryRef };
