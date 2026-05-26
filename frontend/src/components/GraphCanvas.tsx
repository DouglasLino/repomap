import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from "cytoscape";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "primereact/sidebar";
import { BranchSelector } from "./BranchSelector";
import { HistoryControls } from "./HistoryControls";
import { UtilityMenu } from "./UtilityMenu";
import { ZoomControls } from "./ZoomControls";
import type { GraphNode, GraphResponse } from "../types/graph";

interface GraphCanvasProps {
  graph: GraphResponse | null;
}

type GraphOrientation = "horizontal" | "vertical";
type Point = { x: number; y: number };
interface HistoryEvent {
  commitIds: string[];
  timestamp: number;
}

const branchWidth = 136;
const branchBaseHeight = 42;
const branchHalfWidth = branchWidth / 2;
const branchHalfHeight = branchBaseHeight / 2;
const branchLabelMaxChars = 15;
const commitMessageOffset = 20;
const branchColumnGap = 205;
const branchRowGap = 112;
const commitGap = 106;
const minGraphZoom = 0.2;
const maxGraphZoom = 2.2;
const zoomStepPercent = 10;
const historyMovementDuration = 360;

const branchPalette = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#4f46e5"
];

function colorForBranch(branch: string | null | undefined, branches: string[]): string {
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

function defaultBranchEndpoints(orientation: GraphOrientation) {
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

function endpointValue(point: Point): string {
  return `${point.x}px ${point.y}px`;
}

function endpointPoint(value: string | undefined, fallback: Point): Point {
  const coordinates = value?.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!coordinates || coordinates.length < 2) {
    return fallback;
  }
  return { x: coordinates[0], y: coordinates[1] };
}

function pointOnBranchBorder(pointer: Point, center: Point, halfHeight: number): Point {
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

function historyEventsForGraph(graph: GraphResponse | null): HistoryEvent[] {
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

function absoluteEndpoint(nodePosition: Point, endpoint: Point): Point {
  return {
    x: nodePosition.x + endpoint.x,
    y: nodePosition.y + endpoint.y
  };
}

function controlPointFromCurveHandle(source: Point, target: Point, handle: Point): Point {
  return {
    x: 2 * handle.x - (source.x + target.x) / 2,
    y: 2 * handle.y - (source.y + target.y) / 2
  };
}

function controlPointData(source: Point, target: Point, pointer: Point) {
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

function expandedRowsOffset(
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

function commitPositionForIndex(
  branchPosition: Point,
  branchHeight: number,
  index: number,
  orientation: GraphOrientation
): Point {
  return orientation === "horizontal"
    ? { x: branchPosition.x + 166 + index * 164, y: branchPosition.y }
    : { x: branchPosition.x, y: branchPosition.y + branchHeight / 2 + 77 + index * commitGap };
}

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

function toElements(
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
    const sourceEndpoint = isBranchRelation
      ? defaultRelationSourceEndpoint(parentDistance, orientation, sourceHalfHeight)
      : defaultEndpoints.source;
    const targetEndpoint = isBranchRelation
      ? defaultRelationTargetEndpoint(orientation, targetHalfHeight)
      : defaultEndpoints.target;

    return {
      data: {
        ...edge,
        color: colorForBranch(edge.branch, colorBranches),
        branchCurveDistance: orientation === "vertical"
          ? 34 + parentDistance * 58
          : -(34 + parentDistance * 58),
        branchCurveWeight: 0.5,
        branchSourceEndpoint: endpointValue(sourceEndpoint),
        branchTargetEndpoint: endpointValue(targetEndpoint)
      },
      classes: `${edge.type}${
        collapsedCommitNodeIds.has(edge.source) || collapsedCommitNodeIds.has(edge.target)
          ? " commits-collapsed"
          : ""
      }`
    };
  });

  return [...nodes, ...commitMessages, ...edges];
}

export function GraphCanvas({ graph }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [orientation, setOrientation] = useState<GraphOrientation>("vertical");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [historyMode, setHistoryMode] = useState(false);
  const [historyStep, setHistoryStep] = useState(0);
  const commitsBeforeHistoryRef = useRef<string[]>([]);
  const shouldFitHistoryRef = useRef(false);
  const wasHistoryModeRef = useRef(false);

  const allBranches = useMemo(
    () => graph?.nodes.filter((node) => node.type === "branch").map((node) => node.branch ?? node.label) ?? [],
    [graph]
  );
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [expandedCommitBranches, setExpandedCommitBranches] = useState<string[]>([]);
  const compactCommitMode = allBranches.length > 4;

  useEffect(() => {
    setSelectedBranches(allBranches);
    setExpandedCommitBranches(allBranches.length > 4 ? [] : allBranches);
  }, [allBranches]);

  const branches = selectedBranches.length ? selectedBranches : allBranches;
  const visibleGraph = useMemo(() => {
    if (!graph) {
      return null;
    }
    const visibleBranches = new Set(branches);
    const nodes = graph.nodes.filter((node) => node.branch && visibleBranches.has(node.branch));
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
    return { ...graph, nodes, edges };
  }, [branches, graph]);
  const historyEvents = useMemo(() => historyEventsForGraph(visibleGraph), [visibleGraph]);
  const historyGraph = useMemo(() => {
    if (!visibleGraph || !historyMode || historyEvents.length === 0) {
      return visibleGraph;
    }

    const shownCommitIds = new Set(
      historyEvents.slice(0, historyStep).flatMap((event) => event.commitIds)
    );
    const shownBranches = new Set(
      visibleGraph.nodes
        .filter((node) => node.type === "commit" && shownCommitIds.has(node.id))
        .map((node) => node.branch ?? "")
    );
    const nodes = visibleGraph.nodes.filter((node) => (
      node.type === "commit"
        ? shownCommitIds.has(node.id)
        : shownBranches.has(node.branch ?? "")
    ));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = visibleGraph.edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );

    return { ...visibleGraph, nodes, edges };
  }, [historyEvents, historyMode, historyStep, visibleGraph]);
  const displayedGraph = useMemo(() => {
    if (!historyGraph) {
      return null;
    }

    const displayedNodes = historyGraph.nodes.filter((node) => (
      node.type === "branch"
      || expandedCommitBranches.includes(node.branch ?? "")
    ));
    const displayedNodeIds = new Set(displayedNodes.map((node) => node.id));
    const displayedEdges = historyGraph.edges.filter(
      (edge) => displayedNodeIds.has(edge.source) && displayedNodeIds.has(edge.target)
    );

    return { nodes: displayedNodes, edges: displayedEdges };
  }, [expandedCommitBranches, historyGraph]);

  useEffect(() => {
    setHistoryStep((current) => Math.min(current, historyEvents.length));
  }, [historyEvents.length]);

  useEffect(() => {
    if (!containerRef.current || !visibleGraph || !graph) {
      return;
    }

    cyRef.current?.destroy();

    const cy = cytoscape({
      container: containerRef.current,
      elements: toElements(
        graph,
        allBranches,
        allBranches,
        orientation,
        compactCommitMode ? new Set(allBranches) : new Set()
      ),
      minZoom: minGraphZoom,
      maxZoom: maxGraphZoom,
      wheelSensitivity: 0.18,
      style: [
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
      ],
      layout: {
        name: "preset",
        fit: true,
        padding: 48
      }
    });

    const selectedNodeIds = new Set<string>();
    let selectionTimeout: number | undefined;
    let branchTapTimeout: number | undefined;
    let pendingBranchNodeId: string | null = null;
    cy.nodes(".branch").forEach((branchNode) => {
      branchNode.data("trackedX", branchNode.position("x"));
      branchNode.data("trackedY", branchNode.position("y"));
    });
    const syncSelectedNodes = () => {
      cy.$("node.branch, node.commit").unselect();
      selectedNodeIds.forEach((nodeId) => {
        cy.getElementById(nodeId).select();
      });
    };
    const selectNode = (node: NodeSingular, addToSelection: boolean) => {
      if (!addToSelection) {
        selectedNodeIds.clear();
        selectedNodeIds.add(node.id());
        setSelectedNode(node.data() as GraphNode);
      } else if (selectedNodeIds.has(node.id())) {
        selectedNodeIds.delete(node.id());
        setSelectedNode(null);
      } else {
        selectedNodeIds.add(node.id());
        setSelectedNode(null);
      }

      window.clearTimeout(selectionTimeout);
      selectionTimeout = window.setTimeout(syncSelectedNodes);
    };

    cy.on("tap", "node.branch, node.commit", (event) => {
      const node = event.target;
      const addToSelection = Boolean(
        (event.originalEvent as MouseEvent | undefined)?.shiftKey
      );

      if (!compactCommitMode || !node.hasClass("branch") || addToSelection) {
        selectNode(node, addToSelection);
        return;
      }

      if (pendingBranchNodeId === node.id()) {
        window.clearTimeout(branchTapTimeout);
        pendingBranchNodeId = null;
        selectNode(node, false);
        setSelectedNode(null);

        const branch = node.data("branch") as string;
        setExpandedCommitBranches((current) => (
          current.includes(branch)
            ? current.filter((currentBranch) => currentBranch !== branch)
            : [...current, branch]
        ));
        return;
      }

      window.clearTimeout(branchTapTimeout);
      pendingBranchNodeId = node.id();
      branchTapTimeout = window.setTimeout(() => {
        pendingBranchNodeId = null;
        selectNode(node, false);
      }, 280);
    });

    cy.on("tap", "edge.branch_assumed, edge.branch_possible", (event) => {
      const edge = event.target;
      const defaults = defaultBranchEndpoints(orientation);
      const endpoints = {
        source: endpointPoint(edge.data("branchSourceEndpoint"), defaults.source),
        target: endpointPoint(edge.data("branchTargetEndpoint"), defaults.target)
      };
      const sourceNode = edge.source();
      const targetNode = edge.target();
      const curvePosition = edge.midpoint();

      cy.nodes(".edge-handle").remove();
      cy.edges(".endpoint-editing").removeClass("endpoint-editing");
      edge.addClass("endpoint-editing");

      cy.add([
        {
          group: "nodes",
          data: {
            id: `endpoint-source:${edge.id()}`,
            edgeId: edge.id(),
            branchNodeId: sourceNode.id(),
            endpointRole: "source",
            borderOffsetX: endpoints.source.x,
            borderOffsetY: endpoints.source.y
          },
          position: {
            x: sourceNode.position("x") + endpoints.source.x,
            y: sourceNode.position("y") + endpoints.source.y
          },
          classes: "edge-handle edge-endpoint-handle"
        },
        {
          group: "nodes",
          data: {
            id: `endpoint-target:${edge.id()}`,
            edgeId: edge.id(),
            branchNodeId: targetNode.id(),
            endpointRole: "target",
            borderOffsetX: endpoints.target.x,
            borderOffsetY: endpoints.target.y
          },
          position: {
            x: targetNode.position("x") + endpoints.target.x,
            y: targetNode.position("y") + endpoints.target.y
          },
          classes: "edge-handle edge-endpoint-handle"
        },
        {
          group: "nodes",
          data: {
            id: `curve:${edge.id()}`,
            edgeId: edge.id(),
            endpointRole: "curve"
          },
          position: curvePosition,
          classes: "edge-handle edge-curve-handle"
        }
      ]);
    });

    cy.on("drag", "node.edge-endpoint-handle", (event) => {
      const handle = event.target;
      const branchNode = cy.getElementById(handle.data("branchNodeId"));
      const edge = cy.getElementById(handle.data("edgeId"));
      const branchPosition = branchNode.position();
      const branchNodeHalfHeight = Number(branchNode.data("branchHeight") ?? branchBaseHeight) / 2;
      const borderPoint = pointOnBranchBorder(
        handle.position(),
        branchPosition,
        branchNodeHalfHeight
      );

      handle.position({
        x: branchPosition.x + borderPoint.x,
        y: branchPosition.y + borderPoint.y
      });
      handle.data("borderOffsetX", borderPoint.x);
      handle.data("borderOffsetY", borderPoint.y);

      const endpointProperty = handle.data("endpointRole") === "source"
        ? "branchSourceEndpoint"
        : "branchTargetEndpoint";
      edge.data(endpointProperty, endpointValue(borderPoint));

      const curveHandle = cy.getElementById(`curve:${edge.id()}`);
      if (curveHandle.nonempty()) {
        const defaults = defaultBranchEndpoints(orientation);
        const sourcePoint = endpointPoint(edge.data("branchSourceEndpoint"), defaults.source);
        const targetPoint = endpointPoint(edge.data("branchTargetEndpoint"), defaults.target);
        curveHandle.position(edge.midpoint());
      }
    });

    cy.on("drag", "node.edge-curve-handle", (event) => {
      const handle = event.target;
      const edge = cy.getElementById(handle.data("edgeId"));
      const defaults = defaultBranchEndpoints(orientation);
      const sourcePoint = endpointPoint(edge.data("branchSourceEndpoint"), defaults.source);
      const targetPoint = endpointPoint(edge.data("branchTargetEndpoint"), defaults.target);
      const sourcePosition = absoluteEndpoint(edge.source().position(), sourcePoint);
      const targetPosition = absoluteEndpoint(edge.target().position(), targetPoint);
      const curveControl = controlPointFromCurveHandle(
        sourcePosition,
        targetPosition,
        handle.position()
      );
      const curve = controlPointData(sourcePosition, targetPosition, curveControl);

      edge.data("branchCurveDistance", curve.distance);
      edge.data("branchCurveWeight", curve.weight);
    });

    cy.on("dragfree", "node.edge-curve-handle", (event) => {
      const handle = event.target;
      const edge = cy.getElementById(handle.data("edgeId"));
      handle.position(edge.midpoint());
    });

    cy.on("position", "node.branch", (event) => {
      const branchNode = event.target;
      const branchPosition = branchNode.position();
      const previousPosition = {
        x: Number(branchNode.data("trackedX") ?? branchPosition.x),
        y: Number(branchNode.data("trackedY") ?? branchPosition.y)
      };
      const movement = {
        x: branchPosition.x - previousPosition.x,
        y: branchPosition.y - previousPosition.y
      };
      branchNode.data("trackedX", branchPosition.x);
      branchNode.data("trackedY", branchPosition.y);

      if (movement.x !== 0 || movement.y !== 0) {
        const branch = branchNode.data("branch") as string;
        cy.nodes(".commit")
          .filter((commitNode) => (
            commitNode.data("branch") === branch && !commitNode.selected()
          ))
          .forEach((commitNode) => {
            commitNode.position({
              x: commitNode.position("x") + movement.x,
              y: commitNode.position("y") + movement.y
            });
          });
      }

      cy.nodes(".edge-handle")
        .filter((handle) => handle.data("branchNodeId") === branchNode.id())
        .forEach((handle) => {
          handle.position({
            x: branchPosition.x + Number(handle.data("borderOffsetX")),
            y: branchPosition.y + Number(handle.data("borderOffsetY"))
          });
        });

      cy.edges(".endpoint-editing").forEach((edge) => {
        if (edge.source().id() !== branchNode.id() && edge.target().id() !== branchNode.id()) {
          return;
        }
        const curveHandle = cy.getElementById(`curve:${edge.id()}`);
        if (curveHandle.empty()) {
          return;
        }
        curveHandle.position(edge.midpoint());
      });
    });

    cy.on("position", "node.commit", (event) => {
      const commitNode = event.target;
      const messageNode = cy.getElementById(`message:${commitNode.id()}`);
      if (messageNode.nonempty()) {
        messageNode.position({
          x: commitNode.position("x"),
          y: commitNode.position("y") + commitMessageOffset
        });
      }
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        window.clearTimeout(branchTapTimeout);
        pendingBranchNodeId = null;
        selectedNodeIds.clear();
        cy.elements().unselect();
        setSelectedNode(null);
        cy.nodes(".edge-handle").remove();
        cy.edges(".endpoint-editing").removeClass("endpoint-editing");
      }
    });

    cy.on("zoom", () => {
      setZoomLevel(cy.zoom());
    });

    cy.ready(() => {
      cy.fit(undefined, 48);
      setZoomLevel(cy.zoom());
    });

    cyRef.current = cy;

    return () => {
      window.clearTimeout(selectionTimeout);
      window.clearTimeout(branchTapTimeout);
      cy.destroy();
      cyRef.current = null;
    };
  }, [allBranches, compactCommitMode, graph, orientation]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graph) {
      return;
    }

    const visibleBranches = new Set(branches);
    const expandedBranches = new Set(expandedCommitBranches);
    const historyNodeIds = new Set(historyGraph?.nodes.map((node) => node.id) ?? []);
    const historyEdgeIds = new Set(historyGraph?.edges.map((edge) => edge.id) ?? []);
    const originalBranchTargets = new Map(
      graph.edges
        .filter((edge) => edge.type === "branch_commit")
        .map((edge) => [edge.id, edge.target])
    );
    const animateCommitsForBranches = (commitIds: Set<string>) => {
      cy.nodes(".branch").forEach((branchNode) => {
        const branch = branchNode.data("branch") as string;
        if (!visibleBranches.has(branch)) {
          return;
        }

        const orderedCommits = graph.nodes
          .filter((node) => (
            node.type === "commit"
            && node.branch === branch
            && commitIds.has(node.id)
          ))
          .sort((left, right) => {
            const leftDate = left.date ? new Date(left.date).getTime() : 0;
            const rightDate = right.date ? new Date(right.date).getTime() : 0;
            return rightDate - leftDate;
          });
        const branchHeight = Number(branchNode.data("branchHeight") ?? branchBaseHeight);

        orderedCommits.forEach((commit, index) => {
          const commitNode = cy.getElementById(commit.id);
          commitNode.stop(true, false);
          commitNode.animate(
            {
              position: commitPositionForIndex(
                branchNode.position(),
                branchHeight,
                index,
                orientation
              )
            },
            {
              duration: historyMovementDuration,
              easing: "ease-in-out-cubic"
            }
          );
        });
      });
    };
    cy.nodes(".edge-handle").remove();
    cy.edges(".endpoint-editing").removeClass("endpoint-editing");
    cy.nodes(".branch").forEach((branchNode) => {
      const branch = branchNode.data("branch") as string;
      const currentOffset = Number(branchNode.data("expandedRowsOffset") ?? 0);
      const nextOffset = expandedRowsOffset(
        branch,
        graph,
        allBranches,
        expandedBranches,
        orientation
      );
      const offsetDifference = nextOffset - currentOffset;

      if (offsetDifference !== 0) {
        branchNode.position({
          x: branchNode.position("x"),
          y: branchNode.position("y") + offsetDifference
        });
      }
      branchNode.data("expandedRowsOffset", nextOffset);
    });
    cy.elements().removeClass("branch-hidden");
    cy.elements().removeClass("commits-collapsed");
    cy.elements().removeClass("history-hidden");
    cy.nodes()
      .filter((node) => {
        const branch = node.data("branch") as string | undefined;
        return Boolean(branch && !visibleBranches.has(branch));
      })
      .addClass("branch-hidden");
    cy.edges()
      .filter((edge) => {
        const sourceBranch = edge.source().data("branch") as string | undefined;
        const targetBranch = edge.target().data("branch") as string | undefined;
        return Boolean(
          (sourceBranch && !visibleBranches.has(sourceBranch))
          || (targetBranch && !visibleBranches.has(targetBranch))
        );
      })
      .addClass("branch-hidden");

    cy.nodes()
      .filter((node) => {
        const branch = node.data("branch") as string | undefined;
        const isCommitContent = node.hasClass("commit") || node.hasClass("commit-message");
        return Boolean(
          isCommitContent
          && branch
          && visibleBranches.has(branch)
          && !expandedBranches.has(branch)
        );
      })
      .addClass("commits-collapsed");
    cy.edges()
      .filter((edge) => {
        const source = edge.source();
        const target = edge.target();
        return [source, target].some((node) => {
          const branch = node.data("branch") as string | undefined;
          return Boolean(
            node.hasClass("commit")
            && branch
            && visibleBranches.has(branch)
            && !expandedBranches.has(branch)
          );
        });
      })
      .addClass("commits-collapsed");

    if (historyMode) {
      cy.nodes()
        .filter((node) => {
          if (node.hasClass("commit-message")) {
            return !historyNodeIds.has(node.data("commitNodeId") as string);
          }

          return !node.hasClass("edge-handle") && !historyNodeIds.has(node.id());
        })
        .addClass("history-hidden");
      cy.edges()
        .filter((edge) => !historyEdgeIds.has(edge.id()))
        .addClass("history-hidden");

      cy.nodes(".branch").forEach((branchNode) => {
        const branch = branchNode.data("branch") as string;
        const latestVisibleCommit = graph.nodes
          .filter((node) => (
            node.type === "commit"
            && node.branch === branch
            && historyNodeIds.has(node.id)
          ))
          .sort((left, right) => {
            const leftDate = left.date ? new Date(left.date).getTime() : 0;
            const rightDate = right.date ? new Date(right.date).getTime() : 0;
            return rightDate - leftDate;
          })[0];
        const branchHead = cy.edges(".branch_commit")
          .filter((edge) => edge.data("branch") === branch)
          .first();

        if (latestVisibleCommit && branchHead.nonempty()) {
          branchHead.move({ target: latestVisibleCommit.id });
          branchHead.removeClass("history-hidden");
        }
      });

      animateCommitsForBranches(historyNodeIds);
    } else {
      cy.edges(".branch_commit").forEach((edge) => {
        const originalTarget = originalBranchTargets.get(edge.id());
        if (originalTarget) {
          edge.move({ target: originalTarget });
        }
      });

      if (wasHistoryModeRef.current) {
        animateCommitsForBranches(new Set(
          graph.nodes.filter((node) => node.type === "commit").map((node) => node.id)
        ));
      }
    }

    setSelectedNode((current) => (
      current?.branch && (
        !visibleBranches.has(current.branch)
        || (
          current.type === "commit"
          && !expandedBranches.has(current.branch)
        )
        || (historyMode && !historyNodeIds.has(current.id))
      ) ? null : current
    ));
    wasHistoryModeRef.current = historyMode;
  }, [allBranches, branches, compactCommitMode, expandedCommitBranches, graph, historyGraph, historyMode, orientation]);

  useEffect(() => {
    if (!historyMode || !shouldFitHistoryRef.current) {
      return;
    }

    shouldFitHistoryRef.current = false;
    window.requestAnimationFrame(() => fitGraph(true));
  }, [displayedGraph, historyMode]);

  function changeZoom(direction: 1 | -1) {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    const currentPercent = Math.round(cy.zoom() * 100);
    const nextPercent = direction === 1
      ? Math.ceil((currentPercent + 1) / zoomStepPercent) * zoomStepPercent
      : Math.floor((currentPercent - 1) / zoomStepPercent) * zoomStepPercent;
    const nextZoom = Math.max(
      minGraphZoom,
      Math.min(maxGraphZoom, nextPercent / 100)
    );

    cy.zoom({
      level: nextZoom,
      renderedPosition: {
        x: cy.width() / 2,
        y: cy.height() / 2
      }
    });
  }

  function fitGraph(animate = false) {
    const cy = cyRef.current;
    const container = containerRef.current;
    if (!cy || !container) {
      return;
    }

    const visibleElements = cy.elements().filter((element) => element.visible());
    if (visibleElements.empty()) {
      return;
    }

    const bounds = visibleElements.boundingBox({
      includeNodes: true,
      includeEdges: true,
      includeLabels: true
    });
    const containerBounds = container.getBoundingClientRect();
    const visibleLeft = Math.max(containerBounds.left, 0);
    const visibleTop = Math.max(containerBounds.top, 0);
    const visibleRight = Math.min(containerBounds.right, window.innerWidth);
    const visibleBottom = Math.min(containerBounds.bottom, window.innerHeight);
    const visibleWidth = Math.max(1, visibleRight - visibleLeft);
    const visibleHeight = Math.max(1, visibleBottom - visibleTop);
    const padding = 48;
    const nextZoom = Math.max(
      minGraphZoom,
      Math.min(
        maxGraphZoom,
        (visibleWidth - padding * 2) / Math.max(bounds.w, 1),
        (visibleHeight - padding * 2) / Math.max(bounds.h, 1)
      )
    );
    const visibleCenter = {
      x: visibleLeft - containerBounds.left + visibleWidth / 2,
      y: visibleTop - containerBounds.top + visibleHeight / 2
    };
    const graphCenter = {
      x: bounds.x1 + bounds.w / 2,
      y: bounds.y1 + bounds.h / 2
    };

    const nextPan = {
      x: visibleCenter.x - graphCenter.x * nextZoom,
      y: visibleCenter.y - graphCenter.y * nextZoom
    };

    if (animate) {
      cy.animate(
        {
          zoom: nextZoom,
          pan: nextPan
        },
        {
          duration: 650,
          easing: "ease-in-out-cubic"
        }
      );
      return;
    }

    cy.zoom(nextZoom);
    cy.pan(nextPan);
  }

  function toggleHistoryMode() {
    if (!historyMode) {
      commitsBeforeHistoryRef.current = expandedCommitBranches;
      shouldFitHistoryRef.current = true;
      setExpandedCommitBranches(allBranches);
      setHistoryStep(historyEvents.length);
      setHistoryMode(true);
      return;
    }

    setExpandedCommitBranches(commitsBeforeHistoryRef.current);
    setHistoryMode(false);
  }

  function changeHistoryStep(direction: -1 | 1) {
    setHistoryStep((current) => Math.max(
      0,
      Math.min(historyEvents.length, current + direction)
    ));
  }

  if (!graph || !visibleGraph) {
    return (
      <section className="graph-empty">
        <i className="pi pi-share-alt" />
        <h2>Ingresa un repositorio para graficar ramas y commits.</h2>
      </section>
    );
  }

  return (
    <>
    {historyMode ? <div className="history-backdrop" aria-hidden="true" /> : null}
    <section className={`graph-shell${historyMode ? " graph-shell-history" : ""}`}>
      <div className="graph-toolbar">
        <div>
          <strong>{graph.repository}</strong>
          <span>{displayedGraph?.nodes.length ?? 0} nodos · {displayedGraph?.edges.length ?? 0} relaciones</span>
        </div>
        <BranchSelector
          branches={allBranches}
          selectedBranches={branches}
          branchColor={(branch) => colorForBranch(branch, allBranches)}
          onSelectionChange={setSelectedBranches}
        />
      </div>

      <div className="graph-workspace">
        <UtilityMenu
          horizontalLayout={orientation === "vertical"}
          commitsExpanded={allBranches.every((branch) => expandedCommitBranches.includes(branch))}
          historyMode={historyMode}
          onToggleLayout={() => setOrientation((current) => (
            current === "horizontal" ? "vertical" : "horizontal"
          ))}
          onToggleCommits={() => setExpandedCommitBranches((current) => (
            allBranches.every((branch) => current.includes(branch)) ? [] : allBranches
          ))}
          onToggleHistory={toggleHistoryMode}
        />
        <div ref={containerRef} className="graph-canvas" />
        {historyMode ? (
          <HistoryControls
            canGoPrevious={historyStep > 0}
            canGoNext={historyStep < historyEvents.length}
            onPrevious={() => changeHistoryStep(-1)}
            onNext={() => changeHistoryStep(1)}
          />
        ) : null}
        <ZoomControls
          zoomPercent={Math.round(zoomLevel * 100)}
          canZoomIn={zoomLevel < maxGraphZoom}
          canZoomOut={zoomLevel > minGraphZoom}
          onZoomIn={() => changeZoom(1)}
          onZoomOut={() => changeZoom(-1)}
          onFitGraph={() => fitGraph(true)}
        />
      </div>

      <Sidebar
        visible={Boolean(selectedNode)}
        position="right"
        onHide={() => setSelectedNode(null)}
        header={selectedNode?.type === "branch" ? "Branch" : "Commit"}
      >
        {selectedNode ? (
          <div className="node-details">
            <h3>{selectedNode.label}</h3>
            <p><strong>Tipo:</strong> {selectedNode.type}</p>
            {selectedNode.branch ? <p><strong>Branch:</strong> {selectedNode.branch}</p> : null}
            {selectedNode.author ? <p><strong>Autor:</strong> {selectedNode.author}</p> : null}
            {selectedNode.date ? <p><strong>Fecha:</strong> {new Date(selectedNode.date).toLocaleString()}</p> : null}
            {selectedNode.message ? <p><strong>Mensaje:</strong> {selectedNode.message}</p> : null}
            {selectedNode.url ? (
              <a href={selectedNode.url} target="_blank" rel="noreferrer">
                Ver en GitHub
              </a>
            ) : null}
          </div>
        ) : null}
      </Sidebar>
    </section>
    </>
  );
}
