import type { GraphRequest, GraphResponse } from "../types/graph";
import {
  buildRepositoryGraph,
  loadRepositoryBranches,
  refreshRepositoryBranches
} from "./graphBuilder";

export async function fetchRepositoryGraph(payload: GraphRequest): Promise<GraphResponse> {
  return buildRepositoryGraph(
    payload.repo_url,
    payload.max_commits,
    payload.access_token,
    payload.provider
  );
}

export async function fetchRepositoryBranches(
  payload: GraphRequest,
  branches: string[]
): Promise<GraphResponse> {
  return loadRepositoryBranches(
    payload.repo_url,
    payload.max_commits,
    branches,
    payload.access_token,
    payload.provider
  );
}

export async function refreshRepositoryGraph(
  payload: GraphRequest,
  branches: string[]
): Promise<GraphResponse> {
  return refreshRepositoryBranches(
    payload.repo_url,
    payload.max_commits,
    branches,
    payload.access_token,
    payload.provider
  );
}
