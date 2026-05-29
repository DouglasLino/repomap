import type { GraphResponse } from "../../../types/graph";

interface HistoryEvent {
  commitIds: string[];
  timestamp: number;
}

function commitIdentity(id: string): string {
  return id.slice(id.lastIndexOf(":") + 1);
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
  const commitIds = new Set(events.slice(0, step).flatMap((event) => event.commitIds));
  const branchIds = new Set(
    graph.nodes
      .filter((node) => node.type === "commit" && commitIds.has(node.id))
      .map((node) => `branch:${node.branch}`)
  );
  const nodeIds = new Set([...commitIds, ...branchIds]);
  const edgeIds = new Set(
    graph.edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => edge.id)
  );

  return { nodeIds, edgeIds };
}

