import type { RepositoryProvider } from "../types/graph";

export interface RepositoryRef {
  provider: RepositoryProvider;
  owner: string;
  repo: string;
  fullName: string;
  projectPath: string;
}

export interface RepositoryBranch {
  name: string;
}

export interface RepositoryCommit {
  sha: string;
  parentShas: string[];
  author: string | null;
  date: string | null;
  message: string;
  url: string | null;
}

export class RepositoryClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryClientError";
  }
}
