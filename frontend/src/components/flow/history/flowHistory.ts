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

export function buildHistoryEvents(graph: GraphResponse | null): HistoryEvent[] {
  if (!graph) {
    return [];
  }

  const events = new Map<string, HistoryEvent>();
  graph.nodes.filter((node) => node.type === "commit").forEach((node) => {
    const identity = commitIdentity(node.id);
    const timestamp = node.date ? new Date(node.date).getTime() : 0;
    const existing = events.get(identity);
    if (existing) {
      existing.commitIds.push(node.id);
      return;
    }
    events.set(identity, {
      commitIds: [node.id],
      timestamp: Number.isFinite(timestamp) ? timestamp : 0
    });
  });

  return Array.from(events.values()).sort((left, right) => left.timestamp - right.timestamp);
}

export function visibleHistorySets(graph: GraphResponse, events: HistoryEvent[], step: number) {
  const activeCommitShas = new Set(
    events.slice(0, step).flatMap((event) => event.commitIds.map(commitIdentity))
  );
  const commitNodes = graph.nodes.filter((node) => node.type === "commit");
  const commitsByBranchAndSha = new Map(
    commitNodes.map((node) => [`${node.branch}:${commitSha(node)}`, node])
  );
  const branchHeads = graph.edges
    .filter((edge) => edge.type === "branch_commit")
    .map((edge) => graph.nodes.find((node) => node.id === edge.target))
    .filter((node): node is GraphNode => Boolean(node));
  const commitIds = new Set<string>();

  branchHeads.forEach((currentHead) => {
    const branch = currentHead.branch ?? "";
    let historicalHead: GraphNode | undefined = currentHead;

    while (historicalHead && !activeCommitShas.has(commitSha(historicalHead))) {
      const firstParentSha: string | undefined = historicalHead.parentShas?.[0];
      historicalHead = firstParentSha
        ? commitsByBranchAndSha.get(`${branch}:${firstParentSha}`)
        : undefined;
    }

    const pending = historicalHead ? [historicalHead] : [];
    while (pending.length > 0) {
      const commit = pending.pop() as GraphNode;
      const sha = commitSha(commit);
      if (commitIds.has(commit.id) || !activeCommitShas.has(sha)) {
        continue;
      }

      commitIds.add(commit.id);
      (commit.parentShas ?? []).forEach((parentSha) => {
        const parent = commitsByBranchAndSha.get(`${branch}:${parentSha}`);
        if (parent) {
          pending.push(parent);
        }
      });
    }
  });

  const branchIds = graph.nodes
    .filter((node) => node.type === "branch")
    .map((node) => node.id);
  const nodeIds = new Set([...commitIds, ...branchIds]);
  const edgeIds = new Set(
    graph.edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => edge.id)
  );

  return { nodeIds, edgeIds };
}
