import type { GraphNode, GraphResponse } from "../../../types/graph";
export { initialVisibleBranches } from "../../../services/branchSelection";
import type {
  ConnectionStyle,
  EdgeAnchorSide,
  EdgeEditState,
  FlowOrientation,
  RepoFlowEdge,
  RepoFlowNode
} from "../types";

export const branchNodeWidth = 156;
export const branchNodeHeight = 42;
export const commitNodeSize = 42;
const commitNodeWidth = 136;

const branchPalette = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#4f46e5"
];

const horizontalBranchStartX = 340;
const horizontalBranchStepX = 34;
const horizontalBranchStartY = 60;
const horizontalBranchGapY = 86;
const horizontalCommitGapX = 122;
const horizontalCommitCircleInset = (commitNodeWidth - commitNodeSize) / 2;

export function colorForBranch(branch: string | null | undefined, branches: string[]): string {
  if (!branch) {
    return "#64748b";
  }

  return branchPalette[Math.max(0, branches.indexOf(branch)) % branchPalette.length];
}

function environmentBranchRank(branch: string): number | null {
  const name = branch.toLowerCase();
  if (name.includes("/")) {
    return null;
  }
  if (/^(development|develop|dev)([-_].*)?$/.test(name)) {
    return 0;
  }
  if (/^(qa|quality[-_]?assurance)([-_].*)?$/.test(name)) {
    return 1;
  }
  if (/^(staging|stage)([-_].*)?$/.test(name)) {
    return 2;
  }
  if (/^(main|master)([-_].*)?$/.test(name)) {
    return 3;
  }
  return null;
}

function isEnvironmentBranch(branch: string): boolean {
  return environmentBranchRank(branch) !== null;
}

function branchGroup(branch: string): string {
  const separatorIndex = branch.indexOf("/");
  return (separatorIndex > 0 ? branch.slice(0, separatorIndex) : branch).trim().toLowerCase();
}

function projectEnvironmentRank(branch: string): number {
  const lastSegment = branch.split("/").pop()?.toLowerCase() ?? "";

  if (/^(dev|develop)([-_].*)?$/.test(lastSegment)) {
    return 100;
  }

  if (/^(development)([-_].*)?$/.test(lastSegment)) {
    return 101;
  }

  if (/^(qa|quality[-_]?assurance|test|testing)([-_].*)?$/.test(lastSegment)) {
    return 102;
  }

  if (/^(staging|stage)([-_].*)?$/.test(lastSegment)) {
    return 103;
  }

  if (/^(main)([-_].*)?$/.test(lastSegment)) {
    return 104;
  }

  if (/^(prod|production)([-_].*)?$/.test(lastSegment)) {
    return 105;
  }

  if (/^(master)([-_].*)?$/.test(lastSegment)) {
    return 106;
  }

  return 0;
}

function branchRelationOrder(graph: GraphResponse | null | undefined, branches: string[], fallbackOrder: string[]): string[] {
  if (!graph || branches.length < 2) {
    return fallbackOrder;
  }

  const branchSet = new Set(branches);
  const fallbackIndex = new Map(fallbackOrder.map((branch, index) => [branch, index]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(branches.map((branch) => [branch, new Set<string>()]));
  const incomingCount = new Map(branches.map((branch) => [branch, 0]));

  function hasPath(fromBranch: string, toBranch: string, visited = new Set<string>()): boolean {
    if (fromBranch === toBranch) {
      return true;
    }
    if (visited.has(fromBranch)) {
      return false;
    }

    visited.add(fromBranch);
    return Array.from(outgoing.get(fromBranch) ?? [])
      .some((childBranch) => hasPath(childBranch, toBranch, visited));
  }

  function addConstraint(parentBranch: string | null | undefined, childBranch: string | null | undefined) {
    if (!parentBranch || !childBranch || parentBranch === childBranch) {
      return;
    }
    if (!branchSet.has(parentBranch) || !branchSet.has(childBranch)) {
      return;
    }
    if (branchGroup(parentBranch) !== branchGroup(childBranch)) {
      return;
    }

    const children = outgoing.get(parentBranch);
    if (!children || children.has(childBranch)) {
      return;
    }
    if (hasPath(childBranch, parentBranch)) {
      return;
    }

    children.add(childBranch);
    incomingCount.set(childBranch, (incomingCount.get(childBranch) ?? 0) + 1);
  }

  ["pull_request_merge", "merge", "branch_assumed", "branch_possible"].forEach((edgeType) => {
    graph.edges
      .filter((edge) => edge.type === edgeType)
      .forEach((edge) => {
        const sourceBranch = nodeById.get(edge.source)?.branch;
        const targetBranch = nodeById.get(edge.target)?.branch;
        addConstraint(sourceBranch, targetBranch);
      });
  });

  const ordered: string[] = [];
  const queue = branches
    .filter((branch) => (incomingCount.get(branch) ?? 0) === 0)
    .sort((left, right) => (fallbackIndex.get(left) ?? 0) - (fallbackIndex.get(right) ?? 0));

  while (queue.length > 0) {
    const current = queue.shift() as string;
    ordered.push(current);

    Array.from(outgoing.get(current) ?? [])
      .sort((left, right) => (fallbackIndex.get(left) ?? 0) - (fallbackIndex.get(right) ?? 0))
      .forEach((child) => {
        const nextIncoming = (incomingCount.get(child) ?? 0) - 1;
        incomingCount.set(child, nextIncoming);
        if (nextIncoming === 0) {
          queue.push(child);
          queue.sort((left, right) => (fallbackIndex.get(left) ?? 0) - (fallbackIndex.get(right) ?? 0));
        }
      });
  }

  if (ordered.length === branches.length) {
    return ordered;
  }

  const orderedSet = new Set(ordered);
  return [
    ...ordered,
    ...fallbackOrder.filter((branch) => !orderedSet.has(branch))
  ];
}

function groupedBranches(branches: string[], graph?: GraphResponse): string[] {
  const fallbackOrder = branches
    .filter((branch) => !isEnvironmentBranch(branch))
    .sort((left, right) => {
      const leftGroup = branchGroup(left);
      const rightGroup = branchGroup(right);

      if (leftGroup !== rightGroup) {
        return leftGroup.localeCompare(rightGroup);
      }

      const leftRank = projectEnvironmentRank(left);
      const rightRank = projectEnvironmentRank(right);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.localeCompare(right);
    });

  return branchRelationOrder(graph, fallbackOrder, fallbackOrder);
}

function environmentBranches(branches: string[]): string[] {
  return branches
    .filter(isEnvironmentBranch)
    .sort((left, right) => (
      (environmentBranchRank(left) ?? 0) - (environmentBranchRank(right) ?? 0)
    ));
}

function horizontalBranches(branches: string[], graph?: GraphResponse): string[] {
  return [
    ...groupedBranches(branches, graph),
    ...environmentBranches(branches)
  ];
}

function groupedBranchGroups(branches: string[], graph?: GraphResponse): string[] {
  return Array.from(new Set(groupedBranches(branches, graph).map(branchGroup)));
}

function groupedBranchColumn(branch: string, branches: string[], graph?: GraphResponse): number {
  const grouped = groupedBranches(branches, graph);
  const group = branchGroup(branch);
  let offset = 0;

  for (const currentGroup of groupedBranchGroups(branches, graph)) {
    if (currentGroup === group) {
      return offset + Math.max(0, grouped.filter((current) => branchGroup(current) === group).indexOf(branch));
    }

    offset += grouped.filter((current) => branchGroup(current) === currentGroup).length;
  }

  return Math.max(0, grouped.indexOf(branch));
}

function groupedBranchRow(branch: string, branches: string[], graph?: GraphResponse): number {
  return Math.max(0, groupedBranchGroups(branches, graph).indexOf(branchGroup(branch)));
}

function shortCommitLabel(label: string): string {
  return label.slice(0, 4);
}

function commitMessage(message: string | null | undefined): string {
  if (!message) {
    return "Sin mensaje";
  }
  return message.length > 24 ? `${message.slice(0, 21)}...` : message;
}

function commitTimestamp(node: GraphNode): number {
  const timestamp = node.date ? new Date(node.date).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestVisibleCommit(branch: string, nodes: RepoFlowNode[]): RepoFlowNode | null {
  const commits = nodes
    .filter((node) => node.type === "commit" && node.data.branch === branch)
    .sort((left, right) => commitTimestamp(right.data.graphNode) - commitTimestamp(left.data.graphNode));

  return commits[0] ?? null;
}

function oppositeSide(side: EdgeAnchorSide): EdgeAnchorSide {
  if (side === "left") {
    return "right";
  }
  if (side === "right") {
    return "left";
  }
  if (side === "top") {
    return "bottom";
  }
  return "top";
}

function preferredSourceSide(source: GraphNode | undefined, target: GraphNode | undefined): EdgeAnchorSide {
  if (!source || !target) {
    return "right";
  }

  const sourceBranch = source.branch ?? source.label;
  const targetBranch = target.branch ?? target.label;
  if (source.type === "branch" && target.type === "commit") {
    return "bottom";
  }
  if (source.type === "commit" && target.type === "commit") {
    return "bottom";
  }

  return targetBranch >= sourceBranch ? "right" : "left";
}

function defaultEdgeSides(
  edgeType: string,
  source: GraphNode | undefined,
  target: GraphNode | undefined,
  orientation: FlowOrientation
) {
  if (orientation === "horizontal") {
    if (edgeType === "branch_commit" || edgeType === "parent" || edgeType === "merge") {
      return { sourceSide: "right" as EdgeAnchorSide, targetSide: "left" as EdgeAnchorSide };
    }
    if (source?.type === "branch" && target?.type === "branch") {
      return { sourceSide: "left" as EdgeAnchorSide, targetSide: "left" as EdgeAnchorSide };
    }
  }

  if (edgeType === "branch_commit") {
    return { sourceSide: "bottom" as EdgeAnchorSide, targetSide: "top" as EdgeAnchorSide };
  }
  if (edgeType === "parent" || edgeType === "merge") {
    return { sourceSide: "bottom" as EdgeAnchorSide, targetSide: "top" as EdgeAnchorSide };
  }
  if (source?.type === "branch" && target?.type === "branch") {
    return { sourceSide: "top" as EdgeAnchorSide, targetSide: "top" as EdgeAnchorSide };
  }
  if (edgeType === "pull_request_merge") {
    return { sourceSide: "right" as EdgeAnchorSide, targetSide: "left" as EdgeAnchorSide };
  }

  const sourceSide = preferredSourceSide(source, target);
  return { sourceSide, targetSide: oppositeSide(sourceSide) };
}

function branchPosition(branch: string, branches: string[], orientation: FlowOrientation, graph?: GraphResponse) {
  const branchColumnGap = 185;

  if (orientation === "horizontal") {
    const ordered = horizontalBranches(branches, graph);
    const lane = Math.max(0, ordered.indexOf(branch));
    return {
      x: horizontalBranchStartX - lane * horizontalBranchStepX,
      y: horizontalBranchStartY + lane * horizontalBranchGapY
    };
  }

  if (isEnvironmentBranch(branch)) {
    const environment = environmentBranches(branches);
    const environmentIndex = Math.max(0, environment.indexOf(branch));
    const grouped = groupedBranches(branches, graph);
    return {
      x: 210 + Math.max(1, grouped.length) * branchColumnGap + 70 + environmentIndex * 165,
      y: 125 + (environment.length - environmentIndex - 1) * 40
    };
  }

  const environmentRowsHeight = environmentBranches(branches).length * 40;
  const column = groupedBranchColumn(branch, branches, graph);
  const row = groupedBranchRow(branch, branches, graph);
  return {
    x: 210 + column * branchColumnGap,
    y: 185 + environmentRowsHeight + row * 180
  };
}

function commitPosition(
  node: GraphNode,
  graph: GraphResponse,
  branches: string[],
  orientation: FlowOrientation,
  visibleNodeIds?: Set<string>
) {
  const branch = node.branch ?? "";
  const base = branchPosition(branch, branches, orientation, graph);
  const commits = graph.nodes
    .filter((candidate) => (
      candidate.type === "commit"
      && candidate.branch === branch
      && (!visibleNodeIds || visibleNodeIds.has(candidate.id))
    ))
    .sort((left, right) => {
      const leftTime = left.date ? new Date(left.date).getTime() : 0;
      const rightTime = right.date ? new Date(right.date).getTime() : 0;
      return rightTime - leftTime;
    });
  const index = Math.max(0, commits.findIndex((candidate) => candidate.id === node.id));

  return orientation === "horizontal"
    ? {
        x: base.x + branchNodeWidth + 44 - horizontalCommitCircleInset + index * horizontalCommitGapX,
        y: base.y + (branchNodeHeight - commitNodeSize) / 2
      }
    : {
        x: base.x + branchNodeWidth / 2 - commitNodeWidth / 2,
        y: base.y + 77 + index * 106
      };
}

export function buildFlowElements({
  graph,
  visibleBranches,
  expandedCommitBranches,
  orientation,
  connectionStyle,
  edgeEdits,
  onCurveChange,
  onAnchorChange,
  visibleNodeIds,
  visibleEdgeIds,
  fadingNodeIds,
  fadingEdgeIds
}: {
  graph: GraphResponse;
  visibleBranches: string[];
  expandedCommitBranches: string[];
  orientation: FlowOrientation;
  connectionStyle: ConnectionStyle;
  edgeEdits: Record<string, EdgeEditState>;
  onCurveChange: (edgeId: string, curveOffset: number) => void;
  onAnchorChange: (edgeId: string, role: "source" | "target", side: EdgeAnchorSide) => void;
  visibleNodeIds?: Set<string>;
  visibleEdgeIds?: Set<string>;
  fadingNodeIds?: Set<string>;
  fadingEdgeIds?: Set<string>;
}): { nodes: RepoFlowNode[]; edges: RepoFlowEdge[] } {
  const branchSet = new Set(visibleBranches);
  const expandedBranchSet = new Set(expandedCommitBranches);
  const nodes = graph.nodes
    .filter((node) => {
      const branch = node.branch ?? "";
      if (!branchSet.has(branch)) {
        return false;
      }
      if (visibleNodeIds && !visibleNodeIds.has(node.id)) {
        return false;
      }
      return node.type === "branch" || expandedBranchSet.has(branch);
    })
    .map<RepoFlowNode>((node) => {
      const branch = node.branch ?? node.label;
      const position = node.type === "branch"
        ? branchPosition(branch, visibleBranches, orientation, graph)
        : commitPosition(node, graph, visibleBranches, orientation, visibleNodeIds);

      return {
        id: node.id,
        type: node.type,
        position,
        className: fadingNodeIds?.has(node.id) ? "repo-flow-node-exiting" : undefined,
        data: {
          graphNode: node,
          label: node.type === "commit" ? shortCommitLabel(node.label) : node.label,
          branch,
          color: colorForBranch(branch, visibleBranches),
          message: node.type === "commit" ? commitMessage(node.message) : null
        },
        draggable: true
      };
    });

  const renderedNodeIds = new Set(nodes.map((node) => node.id));
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const flowNodeById = new Map(nodes.map((node) => [node.id, node]));
  const branchHeadEdgeIds = new Set(
    visibleNodeIds
      ? nodes
          .filter((node) => node.type === "branch")
          .map((node) => {
            const commit = latestVisibleCommit(node.data.branch, nodes);
            return commit ? `${node.id}->${commit.id}` : null;
          })
          .filter((edgeId): edgeId is string => Boolean(edgeId))
      : []
  );
  const renderedGraphEdges = graph.edges
    .filter((edge) => (
      renderedNodeIds.has(edge.source)
      && renderedNodeIds.has(edge.target)
      && (!visibleEdgeIds || visibleEdgeIds.has(edge.id))
      && (!visibleNodeIds || edge.type !== "branch_commit" || !branchHeadEdgeIds.has(`${edge.source}->${edge.target}`))
    ));
  const taxiLaneIndexes = new Map<string, number>();

  renderedGraphEdges
    .map((edge) => {
      const source = graphNodeById.get(edge.source);
      const target = graphNodeById.get(edge.target);
      const sides = defaultEdgeSides(edge.type, source, target, orientation);
      const sourceSide = edgeEdits[edge.id]?.sourceSide ?? sides.sourceSide;
      const targetSide = edgeEdits[edge.id]?.targetSide ?? sides.targetSide;
      const sourceNode = flowNodeById.get(edge.source);
      const targetNode = flowNodeById.get(edge.target);

      return {
        edge,
        sourceSide,
        targetSide,
        span: sourceNode && targetNode ? Math.abs(sourceNode.position.x - targetNode.position.x) : 0
      };
    })
    .filter(({ sourceSide, targetSide }) => sourceSide === "top" && targetSide === "top")
    .sort((left, right) => left.span - right.span)
    .forEach(({ edge }, index) => {
      taxiLaneIndexes.set(edge.id, index);
    });

  const edges = renderedGraphEdges
    .map<RepoFlowEdge>((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: `source-${edgeEdits[edge.id]?.sourceSide ?? defaultEdgeSides(
        edge.type,
        graph.nodes.find((node) => node.id === edge.source),
        graph.nodes.find((node) => node.id === edge.target),
        orientation
      ).sourceSide}`,
      targetHandle: `target-${edgeEdits[edge.id]?.targetSide ?? defaultEdgeSides(
        edge.type,
        graph.nodes.find((node) => node.id === edge.source),
        graph.nodes.find((node) => node.id === edge.target),
        orientation
      ).targetSide}`,
      type: "repo-edge",
      animated: false,
      selectable: true,
      data: {
        graphType: edge.type,
        branch: edge.branch ?? "",
        color: colorForBranch(edge.branch, visibleBranches),
        connectionStyle,
        orientation,
        curveOffset: edgeEdits[edge.id]?.curveOffset ?? 0,
        taxiLaneIndex: taxiLaneIndexes.get(edge.id),
        editableAnchors: edge.type === "branch_assumed" || edge.type === "branch_possible",
        exiting: fadingEdgeIds?.has(edge.id),
        onCurveChange,
        onAnchorChange
      }
    }));

  if (visibleNodeIds) {
    nodes
      .filter((node) => node.type === "branch")
      .forEach((branchNode) => {
        const commit = latestVisibleCommit(branchNode.data.branch, nodes);
        if (!commit) {
          return;
        }

        const id = `history-branch-head:${branchNode.id}:${commit.id}`;
        const sides = defaultEdgeSides("branch_commit", branchNode.data.graphNode, commit.data.graphNode, orientation);
        edges.push({
          id,
          source: branchNode.id,
          target: commit.id,
          sourceHandle: `source-${edgeEdits[id]?.sourceSide ?? sides.sourceSide}`,
          targetHandle: `target-${edgeEdits[id]?.targetSide ?? sides.targetSide}`,
          type: "repo-edge",
          animated: false,
          selectable: true,
          data: {
            graphType: "branch_commit",
            branch: branchNode.data.branch,
            color: colorForBranch(branchNode.data.branch, visibleBranches),
            connectionStyle,
            orientation,
            curveOffset: edgeEdits[id]?.curveOffset ?? 0,
            taxiLaneIndex: undefined,
            editableAnchors: false,
            exiting: false,
            onCurveChange,
            onAnchorChange
          }
        });
      });
  }

  return { nodes, edges };
}
