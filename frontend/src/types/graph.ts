export type GraphNodeType = "branch" | "commit";
export type GraphEdgeType =
  | "branch_commit"
  | "parent"
  | "merge"
  | "pull_request_merge"
  | "branch_assumed"
  | "branch_possible";

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  branch?: string | null;
  sha?: string | null;
  commitIndex?: number;
  parentShas?: string[];
  author?: string | null;
  date?: string | null;
  message?: string | null;
  url?: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  branch?: string | null;
}

export interface GraphResponse {
  repository: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphRequest {
  repo_url: string;
  max_commits: number;
  github_token?: string;
}
