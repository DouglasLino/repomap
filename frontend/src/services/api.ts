import type { GraphRequest, GraphResponse } from "../types/graph";
import { buildRepositoryGraph } from "./graphBuilder";

export async function fetchRepositoryGraph(payload: GraphRequest): Promise<GraphResponse> {
  return buildRepositoryGraph(payload.repo_url, payload.max_commits);
}
