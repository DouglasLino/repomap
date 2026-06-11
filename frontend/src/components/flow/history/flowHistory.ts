import type { GraphNode, GraphResponse } from "../../../types/graph";

interface HistoryEvent {
  commitIds: string[];
  timestamp: number;
}

function commitIdentity(id: string): string {
  return id.slice(id.lastIndexOf(":") + 1);
}

function commitSha(node: GraphNode): string {
  return node.sha ?? commitIdentity(node.id);
}

function commitOrder(node: GraphNode): number {
  return node.commitIndex ?? Number.POSITIVE_INFINITY;
}

function commitTimestamp(node: GraphNode): number {
  const timestamp = node.date ? new Date(node.date).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function visibleBranchSet(visibleBranches: string[]): Set<string> | null {
  return visibleBranches.length > 0 ? new Set(visibleBranches) : null;
}

function isRootCommit(node: GraphNode): boolean {
  return (node.parentShas ?? []).length === 0;
}

function eventIdentity(node: GraphNode): string {
  return isRootCommit(node) ? commitSha(node) : node.id;
}

function commitNodes(graph: GraphResponse): GraphNode[] {
  return graph.nodes.filter((node) => node.type === "commit");
}

function commitNodeById(graph: GraphResponse): Map<string, GraphNode> {
  return new Map(commitNodes(graph).map((node) => [node.id, node]));
}

function branchCommitBySha(graph: GraphResponse): Map<string, GraphNode> {
  return new Map(commitNodes(graph).map((node) => [`${node.branch ?? ""}:${commitSha(node)}`, node]));
}

function branchCommits(graph: GraphResponse): Map<string, GraphNode[]> {
  const grouped = new Map<string, GraphNode[]>();

  commitNodes(graph)
    .sort((left, right) => commitOrder(left) - commitOrder(right))
    .forEach((node) => {
      const branch = node.branch ?? "";
      grouped.set(branch, [...(grouped.get(branch) ?? []), node]);
    });

  return grouped;
}

function firstParentShasBeforeMerge(
  mergeCommit: GraphNode,
  targetBranch: string,
  byBranchSha: Map<string, GraphNode>
): Set<string> {
  const shas = new Set<string>();
  let currentSha = mergeCommit.parentShas?.[0];

  while (currentSha && !shas.has(currentSha)) {
    shas.add(currentSha);
    const currentCommit = byBranchSha.get(`${targetBranch}:${currentSha}`);
    currentSha = currentCommit?.parentShas?.[0];
  }

  return shas;
}

function introducedShasFrom(
  sourceCommit: GraphNode,
  targetBranch: string,
  existingTargetShas: Set<string>,
  byBranchSha: Map<string, GraphNode>
): Set<string> {
  const introduced = new Set<string>();
  const pending = [sourceCommit];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop() as GraphNode;
    const sha = commitSha(current);
    if (visited.has(sha) || existingTargetShas.has(sha)) {
      continue;
    }

    visited.add(sha);
    introduced.add(sha);
    (current.parentShas ?? []).forEach((parentSha) => {
      const parent = byBranchSha.get(`${current.branch ?? ""}:${parentSha}`);
      if (parent) {
        pending.push(parent);
      }
    });
  }

  return introduced;
}

function integrationGates(graph: GraphResponse): Map<string, string> {
  const byId = commitNodeById(graph);
  const byBranchSha = branchCommitBySha(graph);
  const commitsByBranch = branchCommits(graph);
  const gates = new Map<string, string>();

  graph.edges
    .filter((edge) => edge.type === "pull_request_merge")
    .forEach((edge) => {
      const sourceCommit = byId.get(edge.source);
      const mergeCommit = byId.get(edge.target);
      const targetBranch = mergeCommit?.branch ?? "";
      const targetCommits = commitsByBranch.get(targetBranch) ?? [];

      if (!sourceCommit || !mergeCommit) {
        return;
      }

      const existingTargetShas = firstParentShasBeforeMerge(mergeCommit, targetBranch, byBranchSha);
      const sourceShas = introducedShasFrom(sourceCommit, targetBranch, existingTargetShas, byBranchSha);
      targetCommits.forEach((candidate) => {
        if (
          candidate.id !== mergeCommit.id
          && !isRootCommit(candidate)
          && sourceShas.has(commitSha(candidate))
        ) {
          gates.set(candidate.id, mergeCommit.id);
        }
      });
    });

  return gates;
}

export function buildHistoryEvents(graph: GraphResponse | null, visibleBranches: string[] = []): HistoryEvent[] {
  if (!graph) {
    return [];
  }

  const branchSet = visibleBranchSet(visibleBranches);
  const gates = integrationGates(graph);
  const byId = commitNodeById(graph);
  const events = new Map<string, HistoryEvent>();

  commitNodes(graph)
    .filter((node) => !branchSet || branchSet.has(node.branch ?? ""))
    .forEach((node) => {
      const gateId = gates.get(node.id);
      const gateCommit = byId.get(gateId ?? "");
      const timestamp = gateCommit ? commitTimestamp(gateCommit) : commitTimestamp(node);
      const identity = `${timestamp}:${gateId ?? eventIdentity(node)}`;
      const existing = events.get(identity);

      if (existing) {
        existing.commitIds.push(node.id);
        return;
      }

      events.set(identity, {
        commitIds: [node.id],
        timestamp
      });
    });

  return Array.from(events.values()).sort((left, right) => left.timestamp - right.timestamp);
}

export function visibleHistorySets(
  graph: GraphResponse,
  events: HistoryEvent[],
  step: number,
  visibleBranches: string[] = []
) {
  const activeCommitIds = new Set(events.slice(0, step).flatMap((event) => event.commitIds));
  const branchSet = visibleBranchSet(visibleBranches);
  const gates = integrationGates(graph);
  const commitIds = new Set<string>();

  commitNodes(graph)
    .filter((node) => !branchSet || branchSet.has(node.branch ?? ""))
    .forEach((node) => {
      const gateId = gates.get(node.id);
      if (!activeCommitIds.has(node.id)) {
        return;
      }
      if (gateId && !activeCommitIds.has(gateId)) {
        return;
      }

      commitIds.add(node.id);
    });

  const branchIds = graph.nodes
    .filter((node) => node.type === "branch" && (!branchSet || branchSet.has(node.branch ?? node.label)))
    .map((node) => node.id);
  const nodeIds = new Set([...commitIds, ...branchIds]);
  const edgeIds = new Set(
    graph.edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => edge.id)
  );

  return { nodeIds, edgeIds };
}
