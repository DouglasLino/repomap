import type { ElementDefinition, StylesheetStyle } from "cytoscape";
import type { GraphNode, GraphResponse } from "../types/graph";

export type GraphOrientation = "horizontal" | "vertical";
export type ConnectionStyle = "straight" | "taxi" | "curved";
export type Point = { x: number; y: number };
type TaxiDirection = "downward" | "upward" | "rightward" | "leftward";

export interface HistoryEvent {
  commitIds: string[];
  timestamp: number;
}

export const branchWidth = 136;
export const branchBaseHeight = 42;
const branchHalfWidth = branchWidth / 2;
const branchHalfHeight = branchBaseHeight / 2;
const branchLabelMaxChars = 15;
export const commitMessageOffset = 20;
const branchColumnGap = 205;
const branchRowGap = 112;
const commitGap = 106;
export const minGraphZoom = 0.2;
export const maxGraphZoom = 2.2;
export const zoomStepPercent = 10;
export const historyMovementDuration = 360;
export const maxVisibleBranches = 5;

const branchPalette = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#4f46e5"
];

export function colorForBranch(branch: string | null | undefined, branches: string[]): string {
  if (!branch) {
    return "#64748b";
  }
  const index = Math.max(0, branches.indexOf(branch));
  return branchPalette[index % branchPalette.length];
}

function branchVisual(label: string) {
  if (label.length <= branchLabelMaxChars) {
    return { label, height: branchBaseHeight };
  }

  const pieces = label.split("/").flatMap((piece, index, segments) => {
    const suffix = index < segments.length - 1 ? "/" : "";
    const value = `${piece}${suffix}`;
    const chunks: string[] = [];

    for (let start = 0; start < value.length; start += branchLabelMaxChars) {
      chunks.push(value.slice(start, start + branchLabelMaxChars));
    }

    return chunks;
  });
  const lines: string[] = [];

  pieces.forEach((piece) => {
    const lastLine = lines[lines.length - 1];
    if (lastLine && lastLine.length + piece.length <= branchLabelMaxChars) {
      lines[lines.length - 1] = `${lastLine}${piece}`;
    } else {
      lines.push(piece);
    }
  });

  return {
    label: lines.join("\n"),
    height: Math.max(branchBaseHeight, 22 + lines.length * 18)
  };
}

export function defaultBranchEndpoints(orientation: GraphOrientation) {
  return orientation === "vertical"
    ? {
        source: { x: 0, y: -branchHalfHeight },
        target: { x: 0, y: -branchHalfHeight }
      }
    : {
        source: { x: -branchHalfWidth, y: 0 },
        target: { x: branchHalfWidth, y: 0 }
      };
}

function defaultRelationSourceEndpoint(
  parentDistance: number,
  orientation: GraphOrientation,
  sourceHalfHeight: number
): Point {
  if (orientation === "horizontal") {
    return { x: -branchHalfWidth, y: 0 };
  }

  if (parentDistance === 1) {
    return { x: -branchHalfWidth, y: 0 };
  }

  return {
    x: Math.min(38, -50 + (parentDistance - 2) * 34),
    y: -sourceHalfHeight
  };
}

function defaultRelationTargetEndpoint(orientation: GraphOrientation, targetHalfHeight: number): Point {
  return orientation === "horizontal"
    ? { x: -branchHalfWidth, y: 0 }
    : { x: 0, y: -targetHalfHeight };
}

function orthogonalRelationEndpoints(
  sourcePosition: Point,
  targetPosition: Point,
  sourceHalfHeight: number,
  targetHalfHeight: number
) {
  const deltaX = targetPosition.x - sourcePosition.x;
  const deltaY = targetPosition.y - sourcePosition.y;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const direction = deltaX >= 0 ? 1 : -1;
    return {
      source: { x: direction * branchHalfWidth, y: 0 },
      target: { x: -direction * branchHalfWidth, y: 0 }
    };
  }

  const direction = deltaY >= 0 ? 1 : -1;
  return {
    source: { x: 0, y: direction * sourceHalfHeight },
    target: { x: 0, y: -direction * targetHalfHeight }
  };
}

export function endpointValue(point: Point): string {
  return `${point.x}px ${point.y}px`;
}

export function endpointPoint(value: string | undefined, fallback: Point): Point {
  const coordinates = value?.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!coordinates || coordinates.length < 2) {
    return fallback;
  }
  return { x: coordinates[0], y: coordinates[1] };
}

export function pointOnBranchBorder(pointer: Point, center: Point, halfHeight: number): Point {
  const deltaX = pointer.x - center.x;
  const deltaY = pointer.y - center.y;

  if (deltaX === 0 && deltaY === 0) {
    return { x: 0, y: -halfHeight };
  }

  const ratio = Math.min(
    branchHalfWidth / Math.max(Math.abs(deltaX), 0.001),
    halfHeight / Math.max(Math.abs(deltaY), 0.001)
  );

  return {
    x: deltaX * ratio,
    y: deltaY * ratio
  };
}

function commitMessageLabel(message: string | null | undefined): string {
  if (!message) {
    return "Sin mensaje";
  }
  return message.length > 24 ? `${message.slice(0, 21)}...` : message;
}

function commitHashLabel(label: string): string {
  return label.slice(0, 4);
}

function commitIdentity(node: GraphNode): string {
  return node.id.slice(node.id.lastIndexOf(":") + 1);
}

export function historyEventsForGraph(graph: GraphResponse | null): HistoryEvent[] {
  if (!graph) {
    return [];
  }

  const events = new Map<string, HistoryEvent>();

  graph.nodes.filter((node) => node.type === "commit").forEach((node) => {
    const identity = commitIdentity(node);
    const timestamp = node.date ? new Date(node.date).getTime() : 0;
    const event = events.get(identity);

    if (event) {
      event.commitIds.push(node.id);
      return;
    }

    events.set(identity, {
      commitIds: [node.id],
      timestamp: Number.isFinite(timestamp) ? timestamp : 0
    });
  });

  return Array.from(events.values()).sort((left, right) => left.timestamp - right.timestamp);
}

export function absoluteEndpoint(nodePosition: Point, endpoint: Point): Point {
  return {
    x: nodePosition.x + endpoint.x,
    y: nodePosition.y + endpoint.y
  };
}

export function controlPointFromCurveHandle(source: Point, target: Point, handle: Point): Point {
  return {
    x: 2 * handle.x - (source.x + target.x) / 2,
    y: 2 * handle.y - (source.y + target.y) / 2
  };
}

export function controlPointData(source: Point, target: Point, pointer: Point) {
  const lineX = target.x - source.x;
  const lineY = target.y - source.y;
  const lengthSquared = lineX * lineX + lineY * lineY || 1;
  const length = Math.sqrt(lengthSquared);
  const pointerX = pointer.x - source.x;
  const pointerY = pointer.y - source.y;

  return {
    weight: (pointerX * lineX + pointerY * lineY) / lengthSquared,
    distance: (pointerY * lineX - pointerX * lineY) / length
  };
}

function branchGroup(branch: string): string {
  const separatorIndex = branch.indexOf("/");
  return separatorIndex > 0 ? branch.slice(0, separatorIndex) : branch;
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

function groupedBranches(branches: string[]): string[] {
  return branches.filter((branch) => !isEnvironmentBranch(branch));
}

function branchGroupIndex(branch: string, branches: string[]): number {
  const groups = Array.from(new Set(groupedBranches(branches).map((current) => branchGroup(current))));
  return Math.max(0, groups.indexOf(branchGroup(branch)));
}

function branchColumnIndex(branch: string, branches: string[]): number {
  return Math.max(
    0,
    groupedBranches(branches)
      .filter((current) => branchGroup(current) === branchGroup(branch))
      .indexOf(branch)
  );
}

function environmentBranches(branches: string[]): string[] {
  return branches
    .filter(isEnvironmentBranch)
    .sort((left, right) => (
      (environmentBranchRank(left) ?? 0) - (environmentBranchRank(right) ?? 0)
      || left.localeCompare(right)
    ));
}

export function initialVisibleBranches(branches: string[]): string[] {
  const priority = (branch: string): number => {
    const name = branch.toLowerCase();
    if (/^(main|master)([-_].*)?$/.test(name)) {
      return 0;
    }
    if (/^(development|develop|dev)([-_].*)?$/.test(name)) {
      return 1;
    }
    if (/^(qa|quality[-_]?assurance|test|testing)([-_].*)?$/.test(name)) {
      return 2;
    }
    if (/^(staging|stage)([-_].*)?$/.test(name)) {
      return 3;
    }
    if (/^(production|prod)([-_].*)?$/.test(name)) {
      return 4;
    }
    return 5;
  };

  return branches
    .map((branch, index) => ({ branch, index }))
    .sort((left, right) => priority(left.branch) - priority(right.branch) || left.index - right.index)
    .slice(0, maxVisibleBranches)
    .map(({ branch }) => branch);
}

export function expandedRowsOffset(
  branch: string,
  graph: GraphResponse,
  branches: string[],
  expandedBranches: Set<string>,
  orientation: GraphOrientation
): number {
  if (orientation !== "vertical" || isEnvironmentBranch(branch)) {
    return 0;
  }

  const branchRow = branchGroupIndex(branch, branches);
  const precedingGroups = new Set(
    groupedBranches(branches).filter((current) => branchGroupIndex(current, branches) < branchRow)
      .map((current) => branchGroup(current))
  );

  return Array.from(precedingGroups).reduce((offset, group) => {
    const expandedInGroup = groupedBranches(branches).filter((current) => (
      branchGroup(current) === group && expandedBranches.has(current)
    ));
    const commitDepth = Math.max(
      0,
      ...expandedInGroup.map((current) => graph.nodes.filter((node) => (
        node.type === "commit" && node.branch === current
      )).length)
    );
    return offset + commitDepth * commitGap;
  }, 0);
}

export function commitPositionForIndex(
  branchPosition: Point,
  branchHeight: number,
  index: number,
  orientation: GraphOrientation
): Point {
  return orientation === "horizontal"
    ? { x: branchPosition.x + 166 + index * 164, y: branchPosition.y }
    : { x: branchPosition.x, y: branchPosition.y + branchHeight / 2 + 77 + index * commitGap };
}

export const graphStyles: StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      color: "#0f172a",
      label: "data(label)",
      "font-size": 11,
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 8,
      "overlay-opacity": 0
    }
  },
  {
    selector: "node.branch",
    style: {
      width: branchWidth,
      height: "data(branchHeight)",
      shape: "round-rectangle",
      color: "#ffffff",
      label: "data(displayLabel)",
      "font-size": 13,
      "font-weight": 700,
      "text-valign": "center",
      "text-margin-y": 0,
      "text-wrap": "wrap",
      "text-max-width": `${branchWidth - 18}px`,
      "text-justification": "center"
    }
  },
  {
    selector: "node.commit",
    style: {
      width: 42,
      height: 42,
      "border-width": 3,
      "border-color": "#ffffff",
      color: "#ffffff",
      "font-size": 11,
      "font-weight": 700,
      "text-valign": "center",
      "text-halign": "center",
      "text-margin-y": 0
    }
  },
  {
    selector: "node.commit-message",
    style: {
      width: 1,
      height: 1,
      "background-opacity": 0,
      "border-width": 0,
      color: "#334155",
      label: "data(label)",
      "font-size": 11,
      "text-max-width": "136px",
      "text-wrap": "ellipsis",
      "text-valign": "center",
      "text-halign": "center",
      "events": "no",
      "overlay-opacity": 0
    }
  },
  {
    selector: "node.edge-handle",
    style: {
      width: 13,
      height: 13,
      shape: "ellipse",
      "background-color": "#ffffff",
      "border-width": 3,
      "border-color": "#0f172a",
      label: "",
      "z-index": 999,
      "overlay-opacity": 0
    }
  },
  {
    selector: "node.edge-curve-handle",
    style: {
      "background-color": "#2563eb",
      "border-color": "#ffffff",
      width: 15,
      height: 15
    }
  },
  {
    selector: "edge",
    style: {
      width: 2,
      "line-color": "data(color)",
      "target-arrow-color": "data(color)",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      "control-point-step-size": 56,
      opacity: 0.78
    }
  },
  {
    selector: "edge.branch_commit",
    style: {
      "line-style": "solid",
      width: 2.5
    }
  },
  {
    selector: "edge.merge",
    style: {
      width: 3.5,
      "line-style": "solid"
    }
  },
  {
    selector: "edge.pull_request_merge",
    style: {
      width: 3.5,
      "line-style": "solid",
      "curve-style": "bezier",
      opacity: 0.9
    }
  },
  {
    selector: "edge.branch_assumed, edge.branch_possible",
    style: {
      width: 3,
      "curve-style": "unbundled-bezier",
      "control-point-distances": "data(branchCurveDistance)",
      "control-point-weights": "data(branchCurveWeight)",
      "source-endpoint": "data(branchSourceEndpoint)",
      "target-endpoint": "data(branchTargetEndpoint)",
      opacity: 0.9
    }
  },
  {
    selector: "edge.endpoint-editing",
    style: {
      "overlay-opacity": 0.12,
      "overlay-color": "#2563eb",
      "overlay-padding": 5
    }
  },
  {
    selector: "edge.branch_possible",
    style: {
      "line-style": "dashed"
    }
  },
  {
    selector: "edge.connection-straight",
    style: {
      "curve-style": "straight"
    }
  },
  {
    selector: "edge.connection-taxi",
    style: {
      "curve-style": "taxi",
      "edge-distances": "intersection",
      "taxi-turn": "data(taxiTurn)",
      "taxi-turn-min-distance": 24
    }
  },
  {
    selector: "edge.connection-taxi.branch_commit",
    style: {
      "source-endpoint": "outside-to-node",
      "target-endpoint": "outside-to-node"
    }
  },
  {
    selector: "edge.connection-taxi.branch_assumed, edge.connection-taxi.branch_possible",
    style: {
      "source-endpoint": "data(taxiSourceEndpoint)",
      "target-endpoint": "data(taxiTargetEndpoint)"
    }
  },
  {
    selector: "edge.connection-taxi.taxi-downward",
    style: {
      "taxi-direction": "downward"
    }
  },
  {
    selector: "edge.connection-taxi.taxi-upward",
    style: {
      "taxi-direction": "upward"
    }
  },
  {
    selector: "edge.connection-taxi.taxi-rightward",
    style: {
      "taxi-direction": "rightward"
    }
  },
  {
    selector: "edge.connection-taxi.taxi-leftward",
    style: {
      "taxi-direction": "leftward"
    }
  },
  {
    selector: ".branch-hidden, .commits-collapsed, .history-hidden",
    style: {
      display: "none"
    }
  },
  {
    selector: ":selected",
    style: {
      "border-width": 5,
      "border-color": "#0f172a"
    }
  }
];

function positionForNode(
  node: GraphNode,
  graph: GraphResponse,
  branches: string[],
  orientation: GraphOrientation
) {
  const branch = node.branch ?? node.label;
  const lane = Math.max(0, branches.indexOf(branch));
  let branchPosition: Point;

  if (orientation === "horizontal") {
    branchPosition = { x: 394 - lane * 46, y: 104 + lane * 96 };
  } else if (isEnvironmentBranch(branch)) {
    const environment = environmentBranches(branches);
    const environmentIndex = Math.max(0, environment.indexOf(branch));
    const groups = new Set(groupedBranches(branches).map((current) => branchGroup(current)));
    const widestGroup = Math.max(
      1,
      ...Array.from(groups).map((group) => (
        groupedBranches(branches).filter((current) => branchGroup(current) === group).length
      ))
    );
    branchPosition = {
      x: 225 + widestGroup * branchColumnGap + 80 + environmentIndex * 180,
      y: 125 + (environment.length - environmentIndex - 1) * 40
    };
  } else {
    const environmentRowsHeight = environmentBranches(branches).length * 40;
    branchPosition = {
      x: 225 + branchColumnIndex(branch, branches) * branchColumnGap,
      y: 193 + environmentRowsHeight + branchGroupIndex(branch, branches) * branchRowGap
    };
  }
  const branchHeight = branchVisual(
    graph.nodes.find((candidate) => (
      candidate.type === "branch" && candidate.branch === node.branch
    ))?.label ?? node.branch ?? ""
  ).height;

  if (node.type === "branch") {
    return branchPosition;
  }

  const laneCommits = graph.nodes
    .filter((candidate) => candidate.type === "commit" && (candidate.branch ?? "") === (node.branch ?? ""))
    .sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
  const index = Math.max(0, laneCommits.findIndex((candidate) => candidate.id === node.id));

  return commitPositionForIndex(branchPosition, branchHeight, index, orientation);
}

function directionBetween(source: Point, target: Point): TaxiDirection {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0 ? "rightward" : "leftward";
  }

  return deltaY >= 0 ? "downward" : "upward";
}

function taxiTurnForEdge(
  laneIndex: number,
  parentDistance: number,
  isBranchRelation: boolean,
  orientation: GraphOrientation
): string {
  const relationBase = isBranchRelation ? 74 + parentDistance * 14 : 38;
  const laneGap = isBranchRelation ? 28 : 20;
  const distance = relationBase + laneIndex * laneGap;

  if (orientation === "vertical") {
    return `${distance}px`;
  }

  return `${distance}px`;
}

export function toElements(
  graph: GraphResponse,
  branches: string[],
  colorBranches: string[],
  orientation: GraphOrientation,
  collapsedCommitBranches: Set<string> = new Set()
): ElementDefinition[] {
  const defaultEndpoints = defaultBranchEndpoints(orientation);
  const collapsedCommitNodeIds = new Set(
    graph.nodes
      .filter((node) => node.type === "commit" && collapsedCommitBranches.has(node.branch ?? ""))
      .map((node) => node.id)
  );
  const branchHeights = new Map(
    graph.nodes
      .filter((node) => node.type === "branch")
      .map((node) => [node.id, branchVisual(node.label).height])
  );
  const nodes: ElementDefinition[] = graph.nodes.map((node) => {
    const visual = node.type === "branch" ? branchVisual(node.label) : null;

    return {
      data: {
        ...node,
        label: node.type === "commit" ? commitHashLabel(node.label) : node.label,
        displayLabel: visual?.label ?? node.label,
        branchHeight: visual?.height ?? branchBaseHeight,
        color: colorForBranch(node.branch, colorBranches)
      },
      position: positionForNode(node, graph, branches, orientation),
      classes: `${node.type}${collapsedCommitNodeIds.has(node.id) ? " commits-collapsed" : ""}`
    };
  });
  const commitMessages: ElementDefinition[] = graph.nodes
    .filter((node) => node.type === "commit")
    .map((node) => {
      const commitPosition = positionForNode(node, graph, branches, orientation);
      return {
        data: {
          id: `message:${node.id}`,
          commitNodeId: node.id,
          branch: node.branch,
          label: commitMessageLabel(node.message)
        },
        position: {
          x: commitPosition.x,
          y: commitPosition.y + commitMessageOffset
        },
        selectable: false,
        grabbable: false,
        classes: `commit-message${collapsedCommitBranches.has(node.branch ?? "") ? " commits-collapsed" : ""}`
      };
    });

  const taxiLaneIndexes = new Map<string, number>();
  const edges: ElementDefinition[] = graph.edges.map((edge) => {
    const childLane = Math.max(0, branches.indexOf(edge.branch ?? ""));
    const isBranchRelation = edge.type === "branch_assumed" || edge.type === "branch_possible";
    const sourceBranchName = edge.source.startsWith("branch:")
      ? edge.source.slice("branch:".length)
      : "";
    const sourceLane = branches.indexOf(sourceBranchName);
    const parentDistance = isBranchRelation && sourceLane >= 0
      ? Math.max(1, Math.abs(sourceLane - childLane))
      : 1;
    const sourceHalfHeight = (branchHeights.get(edge.source) ?? branchBaseHeight) / 2;
    const targetHalfHeight = (branchHeights.get(edge.target) ?? branchBaseHeight) / 2;
    const sourceNode = graph.nodes.find((node) => node.id === edge.source);
    const targetNode = graph.nodes.find((node) => node.id === edge.target);
    const sourcePosition = sourceNode
      ? positionForNode(sourceNode, graph, branches, orientation)
      : { x: 0, y: 0 };
    const targetPosition = targetNode
      ? positionForNode(targetNode, graph, branches, orientation)
      : { x: 0, y: 0 };
    const taxiDirection = directionBetween(sourcePosition, targetPosition);
    const taxiEndpoints = orthogonalRelationEndpoints(
      sourcePosition,
      targetPosition,
      sourceHalfHeight,
      targetHalfHeight
    );
    const sourceEndpoint = isBranchRelation
      ? defaultRelationSourceEndpoint(parentDistance, orientation, sourceHalfHeight)
      : defaultEndpoints.source;
    const targetEndpoint = isBranchRelation
      ? defaultRelationTargetEndpoint(orientation, targetHalfHeight)
      : defaultEndpoints.target;
    const taxiLaneKey = `${orientation}:${taxiDirection}:${isBranchRelation ? "relation" : "commit"}`;
    const taxiLaneIndex = taxiLaneIndexes.get(taxiLaneKey) ?? 0;
    taxiLaneIndexes.set(taxiLaneKey, taxiLaneIndex + 1);

    return {
      data: {
        ...edge,
        color: colorForBranch(edge.branch, colorBranches),
        branchCurveDistance: orientation === "vertical"
          ? 34 + parentDistance * 58
          : -(34 + parentDistance * 58),
        branchCurveWeight: 0.5,
        branchSourceEndpoint: endpointValue(sourceEndpoint),
        branchTargetEndpoint: endpointValue(targetEndpoint),
        taxiSourceEndpoint: endpointValue(isBranchRelation ? taxiEndpoints.source : sourceEndpoint),
        taxiTargetEndpoint: endpointValue(isBranchRelation ? taxiEndpoints.target : targetEndpoint),
        taxiDirection,
        taxiTurn: taxiTurnForEdge(taxiLaneIndex, parentDistance, isBranchRelation, orientation)
      },
      classes: `${edge.type} taxi-${taxiDirection}${
        collapsedCommitNodeIds.has(edge.source) || collapsedCommitNodeIds.has(edge.target)
          ? " commits-collapsed"
          : ""
      }`
    };
  });

  return [...nodes, ...commitMessages, ...edges];
}
