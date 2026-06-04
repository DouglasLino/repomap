import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type XYPosition,
} from "@xyflow/react";
import { BranchSelector } from "../BranchSelector";
import { HistoryControls } from "../HistoryControls";
import { UtilityMenu } from "../UtilityMenu";
import { ZoomControls } from "../ZoomControls";
import type { GraphNode, GraphResponse } from "../../types/graph";
import { RepoEdge } from "./edges/RepoEdge";
import { BranchNode } from "./nodes/BranchNode";
import { CommitNode } from "./nodes/CommitNode";
import { buildHistoryEvents, visibleHistorySets } from "./history/flowHistory";
import {
  branchNodeHeight,
  branchNodeWidth,
  buildFlowElements,
  colorForBranch,
  commitNodeSize,
  initialVisibleBranches,
} from "./layout/flowLayout";
import type {
  ConnectionStyle,
  EdgeAnchorSide,
  EdgeEditState,
  FlowOrientation,
  RepoFlowEdge,
  RepoFlowNode,
} from "./types";
import { Button } from "primereact/button";

const nodeTypes: NodeTypes = {
  branch: BranchNode,
  commit: CommitNode,
};

const edgeTypes: EdgeTypes = {
  "repo-edge": RepoEdge,
};

interface RepoFlowCanvasProps {
  graph: GraphResponse | null;
  onNodeSelect?: (node: GraphNode) => void;
  onBranchesRequest?: (branches: string[]) => Promise<void>;
  onRefresh?: (branches: string[]) => void;
  refreshing?: boolean;
}

type NodePositionMap = Record<string, XYPosition>;
type FitBounds = { x: number; y: number; width: number; height: number };
type HistoryRenderSets = {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  fadingNodeIds: Set<string>;
  fadingEdgeIds: Set<string>;
};

const commitNodeWidth = 136;
const commitNodeHeight = 70;
const exportMinWidth = 1920;
const exportMinHeight = 1080;

type ExportBounds = { minX: number; minY: number; maxX: number; maxY: number };
type CanvasPoint = { x: number; y: number };
type ExportTransform = { x: number; y: number; scale: number };
type ExportEdge = Pick<RepoFlowEdge, "source" | "target"> & {
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: Partial<RepoFlowEdge["data"]>;
};

const exportReportPadding = 88;
const exportHeaderHeight = 156;
const exportFooterHeight = 168;
const exportTargetAreaRatio = 0.76;
const exportMaxScale = 2.35;

function GraphLegend() {
  return (
    <aside className="graph-legend" aria-label="Leyenda del diagrama">
      <div className="graph-legend-item">
        <span className="graph-legend-branch" aria-hidden="true" />
        <span><strong>Rama</strong> representa una rama Git.</span>
      </div>
      <div className="graph-legend-item">
        <span className="graph-legend-commit" aria-hidden="true" />
        <span><strong>Commit</strong> representa un commit Git.</span>
      </div>
      <div className="graph-legend-item">
        <span className="graph-legend-line graph-legend-line-solid" aria-hidden="true" />
        <span><strong>Relación de rama</strong> confirmada por el historial Git.</span>
      </div>
      <div className="graph-legend-item">
        <span className="graph-legend-line graph-legend-line-dashed" aria-hidden="true" />
        <span><strong>Posible origen de rama</strong> inferido por historial compartido.</span>
      </div>
    </aside>
  );
}

function repositoryFileName(repository: string): string {
  return repository.split("/").pop()?.replace(/[^a-z0-9_-]+/gi, "-") || "repositorio";
}

function formatDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function exportTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = formatDatePart(date.getMonth() + 1);
  const day = formatDatePart(date.getDate());
  const hours = formatDatePart(date.getHours());
  const minutes = formatDatePart(date.getMinutes());

  return {
    file: `${year}-${month}-${day}_${hours}-${minutes}`,
    label: `${year}/${month}/${day} ${hours}:${minutes}`
  };
}

function nodeExportSize(node: RepoFlowNode) {
  return node.type === "branch"
    ? { width: branchNodeWidth, height: branchNodeHeight }
    : { width: commitNodeWidth, height: commitNodeHeight };
}

function graphExportBounds(nodes: RepoFlowNode[], edges: ExportEdge[] = []): ExportBounds | null {
  if (nodes.length === 0) {
    return null;
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const bounds = nodes.reduce<ExportBounds>((currentBounds, node) => {
    const size = nodeExportSize(node);
    return {
      minX: Math.min(currentBounds.minX, node.position.x),
      minY: Math.min(currentBounds.minY, node.position.y),
      maxX: Math.max(currentBounds.maxX, node.position.x + size.width),
      maxY: Math.max(currentBounds.maxY, node.position.y + size.height)
    };
  }, {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  });

  function includePoint(point: CanvasPoint) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }

  edges.forEach((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      return;
    }

    const sourcePoint = exportHandlePoint(source, edge.sourceHandle, { x: 0, y: 0, scale: 1 });
    const targetPoint = exportHandlePoint(target, edge.targetHandle, { x: 0, y: 0, scale: 1 });
    includePoint(sourcePoint);
    includePoint(targetPoint);

    if (edge.data?.graphType !== "parent" && edge.data?.graphType !== "merge" && edge.data?.graphType !== "branch_commit") {
      includePoint({
        x: sourcePoint.x + (targetPoint.x - sourcePoint.x) / 2 - (targetPoint.y - sourcePoint.y) * 0.12,
        y: sourcePoint.y + (targetPoint.y - sourcePoint.y) / 2 + (targetPoint.x - sourcePoint.x) * 0.12
      });
    }
  });

  return bounds;
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/([/_\-\s])/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const nextLine = `${line}${word}`;
    if (line && context.measureText(nextLine).width > maxWidth) {
      lines.push(line.trim());
      line = word.trimStart();
      return;
    }
    line = nextLine;
  });

  if (line.trim()) {
    lines.push(line.trim());
  }

  return lines.length > 0 ? lines.slice(0, 3) : [text];
}

function edgeSide(handleId: string | null | undefined): EdgeAnchorSide {
  const side = handleId?.split("-").pop();
  return (side as EdgeAnchorSide | undefined) ?? "bottom";
}

function exportHandlePoint(node: RepoFlowNode, handleId: string | null | undefined, transform: ExportTransform): CanvasPoint {
  const side = edgeSide(handleId);
  const size = nodeExportSize(node);
  const circleInset = node.type === "commit" ? (commitNodeWidth - commitNodeSize) / 2 : 0;
  const visualX = node.position.x * transform.scale + transform.x + (node.type === "commit" ? circleInset * transform.scale : 0);
  const visualY = node.position.y * transform.scale + transform.y;
  const width = node.type === "commit" ? commitNodeSize : size.width;
  const height = node.type === "commit" ? commitNodeSize : size.height;
  const scaledWidth = width * transform.scale;
  const scaledHeight = height * transform.scale;

  if (side === "top") {
    return { x: visualX + scaledWidth / 2, y: visualY };
  }
  if (side === "right") {
    return { x: visualX + scaledWidth, y: visualY + scaledHeight / 2 };
  }
  if (side === "left") {
    return { x: visualX, y: visualY + scaledHeight / 2 };
  }
  return { x: visualX + scaledWidth / 2, y: visualY + scaledHeight };
}

function drawArrow(context: CanvasRenderingContext2D, from: CanvasPoint, to: CanvasPoint, color: string, scale = 1) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = 12 * scale;
  const spread = Math.PI / 6;

  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - length * Math.cos(angle - spread), to.y - length * Math.sin(angle - spread));
  context.lineTo(to.x - length * Math.cos(angle + spread), to.y - length * Math.sin(angle + spread));
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawExportEdge(
  context: CanvasRenderingContext2D,
  edge: ExportEdge,
  nodeById: Map<string, RepoFlowNode>,
  transform: ExportTransform
) {
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  if (!source || !target) {
    return;
  }

  const color = edge.data?.color ?? "#2563eb";
  const sourcePoint = exportHandlePoint(source, edge.sourceHandle, transform);
  const targetPoint = exportHandlePoint(target, edge.targetHandle, transform);
  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const arrowTarget = {
    x: targetPoint.x - (dx / distance) * 9 * transform.scale,
    y: targetPoint.y - (dy / distance) * 9 * transform.scale
  };
  const control = {
    x: sourcePoint.x + dx / 2 - dy * 0.12,
    y: sourcePoint.y + dy / 2 + dx * 0.12
  };

  context.save();
  context.strokeStyle = color;
  context.lineWidth = 3 * transform.scale;
  context.globalAlpha = 0.88;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(edge.data?.graphType === "branch_possible" ? [10 * transform.scale, 8 * transform.scale] : []);
  context.beginPath();
  context.moveTo(sourcePoint.x, sourcePoint.y);
  if (edge.data?.graphType === "parent" || edge.data?.graphType === "merge" || edge.data?.graphType === "branch_commit") {
    context.lineTo(arrowTarget.x, arrowTarget.y);
  } else {
    context.quadraticCurveTo(control.x, control.y, arrowTarget.x, arrowTarget.y);
  }
  context.stroke();
  context.setLineDash([]);
  drawArrow(context, sourcePoint, targetPoint, color, transform.scale);
  context.restore();
}

function drawCenteredText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const lines = wrapCanvasText(context, text, maxWidth);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    context.fillText(line, x, startY + index * lineHeight);
  });
}

function drawExportNode(context: CanvasRenderingContext2D, node: RepoFlowNode, transform: ExportTransform) {
  const x = node.position.x;
  const y = node.position.y;
  const color = node.data.color;

  context.save();
  context.translate(transform.x, transform.y);
  context.scale(transform.scale, transform.scale);
  context.textAlign = "center";
  context.textBaseline = "middle";

  if (node.type === "branch") {
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(x, y, branchNodeWidth, branchNodeHeight, 7);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "700 16px Inter, Arial, sans-serif";
    drawCenteredText(context, node.data.label, x + branchNodeWidth / 2, y + branchNodeHeight / 2, branchNodeWidth - 20, 17);
    context.restore();
    return;
  }

  const circleX = x + (commitNodeWidth - commitNodeSize) / 2 + commitNodeSize / 2;
  const circleY = y + commitNodeSize / 2;
  context.fillStyle = color;
  context.beginPath();
  context.arc(circleX, circleY, commitNodeSize / 2, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "700 15px Inter, Arial, sans-serif";
  context.fillText(node.data.label, circleX, circleY);
  context.fillStyle = "#334155";
  context.font = "13px Inter, Arial, sans-serif";
  context.fillText(node.data.message ?? "", x + commitNodeWidth / 2, y + commitNodeSize + 20);
  context.restore();
}

function drawLegendTextLine(
  context: CanvasRenderingContext2D,
  title: string,
  description: string,
  x: number,
  y: number,
  maxWidth: number
) {
  const words = description.split(" ");
  const lines: Array<Array<{ text: string; bold: boolean }>> = [[]];

  context.font = "700 12px Inter, Arial, sans-serif";
  let lineWidth = context.measureText(title).width;
  lines[0].push({ text: title, bold: true });

  context.font = "12px Inter, Arial, sans-serif";
  words.forEach((word, index) => {
    const text = `${index === 0 ? " " : ""}${word}`;
    const width = context.measureText(text).width;
    if (lineWidth + width > maxWidth && lines[lines.length - 1].length > 0) {
      lines.push([{ text: word, bold: false }]);
      lineWidth = context.measureText(word).width;
      return;
    }

    lines[lines.length - 1].push({ text, bold: false });
    lineWidth += width;
  });

  lines.forEach((line, lineIndex) => {
    let cursorX = x;
    line.forEach((segment) => {
      context.font = segment.bold ? "700 12px Inter, Arial, sans-serif" : "12px Inter, Arial, sans-serif";
      context.fillStyle = segment.bold ? "#0f172a" : "#334155";
      context.fillText(segment.text, cursorX, y + lineIndex * 15.5);
      cursorX += context.measureText(segment.text).width;
    });
  });
}

function drawExportLegend(context: CanvasRenderingContext2D, x: number, y: number) {
  const legendWidth = 310;
  const legendHeight = 150;
  const paddingX = 14;
  const paddingY = 12;
  const iconColumnWidth = 48;
  const columnGap = 10;
  const textX = x + paddingX + iconColumnWidth + columnGap;
  const iconX = x + paddingX;
  const textWidth = legendWidth - paddingX * 2 - iconColumnWidth - columnGap;

  context.save();
  context.fillStyle = "rgba(255, 255, 255, 0.88)";
  context.strokeStyle = "#dbe4ef";
  context.lineWidth = 1;
  context.shadowColor = "rgba(15, 23, 42, 0.12)";
  context.shadowBlur = 20;
  context.shadowOffsetY = 7;
  context.beginPath();
  context.roundRect(x, y, legendWidth, legendHeight, 8);
  context.fill();
  context.shadowColor = "transparent";
  context.stroke();

  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.font = "12px Inter, Arial, sans-serif";
  context.fillStyle = "#334155";

  const rows = [
    { title: "Rama", description: "representa una rama Git.", type: "branch" },
    { title: "Commit", description: "representa un commit Git.", type: "commit" },
    { title: "Relación de rama", description: "confirmada por el historial Git.", type: "solid" },
    { title: "Posible origen de rama", description: "inferido por historial compartido.", type: "dashed" }
  ];

  rows.forEach((row, index) => {
    const rowTop = y + paddingY + index * 34;
    const iconCenterY = rowTop + 12;
    if (row.type === "branch") {
      context.fillStyle = "#2563eb";
      context.beginPath();
      context.roundRect(iconX, iconCenterY - 9, 34, 18, 5);
      context.fill();
      context.strokeStyle = "rgba(255, 255, 255, 0.28)";
      context.lineWidth = 1;
      context.stroke();
    } else if (row.type === "commit") {
      context.fillStyle = "#7c3aed";
      context.beginPath();
      context.arc(iconX + 17, iconCenterY, 11, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 3;
      context.stroke();
      context.strokeStyle = "rgba(15, 23, 42, 0.08)";
      context.lineWidth = 1;
      context.stroke();
    } else {
      context.strokeStyle = row.type === "solid" ? "#2563eb" : "#64748b";
      context.fillStyle = context.strokeStyle;
      context.lineWidth = 3;
      context.setLineDash(row.type === "dashed" ? [8, 7] : []);
      context.beginPath();
      context.moveTo(iconX, iconCenterY);
      context.lineTo(iconX + 32, iconCenterY);
      context.stroke();
      context.setLineDash([]);
      drawArrow(context, { x: iconX + 28, y: iconCenterY }, { x: iconX + 44, y: iconCenterY }, context.strokeStyle);
    }
    drawLegendTextLine(context, row.title, row.description, textX, rowTop + 11, textWidth);
  });
  context.restore();
}

function RepoFlowCanvasInner({
  graph,
  onNodeSelect,
  onBranchesRequest,
  onRefresh,
  refreshing = false,
}: RepoFlowCanvasProps) {
  const reactFlow = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const branchOverlayRef = useRef<HTMLDivElement | null>(null);
  const [orientation, setOrientation] = useState<FlowOrientation>("vertical");
  const [connectionStyle, setConnectionStyle] =
    useState<ConnectionStyle>("curved");
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [expandedCommitBranches, setExpandedCommitBranches] = useState<
    string[]
  >([]);
  const [historyMode, setHistoryMode] = useState(false);
  const [historyStep, setHistoryStep] = useState(0);
  const [draggingNode, setDraggingNode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [edgeEdits, setEdgeEdits] = useState<Record<string, EdgeEditState>>({});
  const [nodePositions, setNodePositions] = useState<NodePositionMap>({});
  const [flowNodes, setFlowNodes] = useState<RepoFlowNode[]>([]);
  const [historyRenderSets, setHistoryRenderSets] =
    useState<HistoryRenderSets | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [branchOverlaySize, setBranchOverlaySize] = useState({
    width: 0,
    height: 0,
  });
  const commitsBeforeHistoryRef = useRef<string[]>([]);
  const shouldFitRef = useRef(false);
  const branchDragRef = useRef<{
    branchNodeId: string;
    branch: string;
    lastPosition: XYPosition;
  } | null>(null);

  const EMPTY_BRANCHES: string[] = [];

  const allBranches = useMemo(
    () =>
      graph?.nodes
        .filter((node) => node.type === "branch")
        .map((node) => node.branch ?? node.label) ?? EMPTY_BRANCHES,
    [graph],
  );
  const initializedRepositoryRef = useRef<string | null>(null);

  useEffect(() => {
    if (!graph) {
      return;
    }

    if (initializedRepositoryRef.current !== graph.repository) {
      setSelectedBranches(initialVisibleBranches(allBranches));
      setExpandedCommitBranches(allBranches);

      initializedRepositoryRef.current = graph.repository;
      shouldFitRef.current = true;
      return;
    }

    setSelectedBranches((current) => {
      const availableBranches = new Set(allBranches);
      const availableSelection = current.filter((branch) => availableBranches.has(branch));
      return availableSelection.length > 0
        ? availableSelection
        : initialVisibleBranches(allBranches);
    });

    setExpandedCommitBranches(allBranches);
  }, [allBranches]);

  useEffect(() => {
    const overlay = branchOverlayRef.current;
    if (!overlay) {
      return;
    }

    const updateSize = () => {
      setBranchOverlaySize({
        width: overlay.offsetWidth,
        height: overlay.offsetHeight,
      });
    };
    const observer = new ResizeObserver(updateSize);
    updateSize();
    observer.observe(overlay);
    return () => observer.disconnect();
  }, [graph]);

  const branches = useMemo(
    () =>
      selectedBranches.length
        ? selectedBranches
        : initialVisibleBranches(allBranches),
    [allBranches, selectedBranches],
  );
  const historyEvents = useMemo(() => buildHistoryEvents(graph), [graph]);
  const historySets = useMemo(() => {
    if (!graph || !historyMode) {
      return null;
    }
    return visibleHistorySets(graph, historyEvents, historyStep);
  }, [graph, historyEvents, historyMode, historyStep]);

  useEffect(() => {
    if (!historyMode || !historySets) {
      setHistoryRenderSets(null);
      return;
    }

    setHistoryRenderSets((current) => {
      if (!current) {
        return {
          nodeIds: historySets.nodeIds,
          edgeIds: historySets.edgeIds,
          fadingNodeIds: new Set(),
          fadingEdgeIds: new Set(),
        };
      }

      const removedNodeIds = new Set(
        [...current.nodeIds].filter(
          (nodeId) => !historySets.nodeIds.has(nodeId),
        ),
      );
      const removedEdgeIds = new Set(
        [...current.edgeIds].filter(
          (edgeId) => !historySets.edgeIds.has(edgeId),
        ),
      );

      if (removedNodeIds.size === 0 && removedEdgeIds.size === 0) {
        return {
          nodeIds: historySets.nodeIds,
          edgeIds: historySets.edgeIds,
          fadingNodeIds: new Set(),
          fadingEdgeIds: new Set(),
        };
      }

      return {
        nodeIds: new Set([...historySets.nodeIds, ...removedNodeIds]),
        edgeIds: new Set([...historySets.edgeIds, ...removedEdgeIds]),
        fadingNodeIds: removedNodeIds,
        fadingEdgeIds: removedEdgeIds,
      };
    });

    const timeout = window.setTimeout(() => {
      setHistoryRenderSets({
        nodeIds: historySets.nodeIds,
        edgeIds: historySets.edgeIds,
        fadingNodeIds: new Set(),
        fadingEdgeIds: new Set(),
      });
    }, 260);

    return () => window.clearTimeout(timeout);
  }, [historyMode, historySets]);

  const baseElements = useMemo(() => {
    if (!graph) {
      return { nodes: [], edges: [] };
    }
    return buildFlowElements({
      graph,
      visibleBranches: branches,
      expandedCommitBranches,
      orientation,
      connectionStyle,
      edgeEdits: {},
      onCurveChange: changeEdgeCurve,
      onAnchorChange: changeEdgeAnchor,
      visibleNodeIds: historyRenderSets?.nodeIds,
      visibleEdgeIds: historyRenderSets?.edgeIds,
      fadingNodeIds: historyRenderSets?.fadingNodeIds,
      fadingEdgeIds: historyRenderSets?.fadingEdgeIds,
    });
  }, [
    branches,
    connectionStyle,
    expandedCommitBranches,
    graph,
    historyRenderSets,
    orientation,
  ]);

  useEffect(() => {
    setFlowNodes(
      baseElements.nodes.map((node) => ({
        ...node,
        position: nodePositions[node.id] ?? node.position,
      })),
    );
  }, [baseElements.nodes, nodePositions]);

  const nodes = flowNodes;

  const edges = useMemo(
    () =>
      baseElements.edges.map((edge) => {
        const edit = edgeEdits[edge.id];

        return {
          ...edge,
          sourceHandle: edit?.sourceSide
            ? `source-${edit.sourceSide}`
            : edge.sourceHandle,
          targetHandle: edit?.targetSide
            ? `target-${edit.targetSide}`
            : edge.targetHandle,
          data: {
            ...edge.data,
            curveOffset: edit?.curveOffset ?? 0,
            onCurveChange: changeEdgeCurve,
            onAnchorChange: changeEdgeAnchor,
          },
        };
      }),
    [baseElements.edges, edgeEdits],
  );

  useEffect(() => {
    if (historyMode) {
      return;
    }
    shouldFitRef.current = true;
  }, [branches, expandedCommitBranches, orientation]);

  useEffect(() => {
    if (!shouldFitRef.current || nodes.length === 0) {
      return;
    }

    shouldFitRef.current = false;
    window.requestAnimationFrame(() => {
      fitGraphToContent();
    });
  }, [connectionStyle, edges, nodes, reactFlow]);

  function taxiBusY(
    sourceY: number,
    targetY: number,
    laneIndex = 0,
    curveOffset = 0,
  ): number {
    const laneHeight = 54 + laneIndex * 28;

    return Math.min(sourceY, targetY) - laneHeight + curveOffset;
  }

  function nodeSize(node: RepoFlowNode) {
    return node.type === "branch"
      ? { width: branchNodeWidth, height: branchNodeHeight }
      : { width: commitNodeWidth, height: commitNodeHeight };
  }

  function handleSide(handleId: string | null | undefined): EdgeAnchorSide {
    const parts = handleId?.split("-");
    return (parts?.[parts.length - 1] as EdgeAnchorSide | undefined) ?? "top";
  }

  function handlePoint(
    node: RepoFlowNode,
    handleId: string | null | undefined,
  ) {
    const side = handleSide(handleId);
    const size = nodeSize(node);
    const centerX = node.position.x + size.width / 2;
    const centerY =
      node.position.y +
      (node.type === "commit" ? commitNodeSize / 2 : size.height / 2);

    if (side === "top") {
      return { x: centerX, y: node.position.y };
    }
    if (side === "bottom") {
      return {
        x: centerX,
        y:
          node.position.y +
          (node.type === "commit" ? commitNodeSize : size.height),
      };
    }
    if (side === "left") {
      return { x: node.position.x, y: centerY };
    }
    return { x: node.position.x + size.width, y: centerY };
  }

  function contentBounds(): FitBounds | null {
    if (nodes.length === 0) {
      return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));

    function includePoint(point: XYPosition) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    nodes.forEach((node) => {
      const size = nodeSize(node);
      includePoint(node.position);
      includePoint({
        x: node.position.x + size.width,
        y: node.position.y + size.height,
      });
    });

    if (connectionStyle === "taxi") {
      edges.forEach((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        if (!sourceNode || !targetNode) {
          return;
        }

        const source = handlePoint(sourceNode, edge.sourceHandle);
        const target = handlePoint(targetNode, edge.targetHandle);
        includePoint(source);
        includePoint(target);

        if (
          handleSide(edge.sourceHandle) === "top" &&
          handleSide(edge.targetHandle) === "top"
        ) {
          const busY = taxiBusY(
            source.y,
            target.y,
            edge.data?.taxiLaneIndex ?? 0,
            edge.data?.curveOffset ?? 0,
          );
          includePoint({ x: source.x, y: busY });
          includePoint({ x: target.x, y: busY });
        }
      });
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  function fitGraphToContent() {
    const bounds = connectionStyle === "taxi" ? contentBounds() : null;
    if (bounds) {
      reactFlow.fitBounds(bounds, { duration: 650, padding: 0.14 });
      return;
    }

    reactFlow.fitView({ duration: 650, padding: 0.18 });
  }

  useEffect(() => {
    if (!historyMode) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        exitHistoryMode();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [historyMode]);

  function fitGraph() {
    fitGraphToContent();
  }

  function exportDiagram() {
    const bounds = graphExportBounds(nodes, edges);
    if (!graph || !bounds) {
      return;
    }

    const graphWidth = bounds.maxX - bounds.minX;
    const graphHeight = bounds.maxY - bounds.minY;
    const minUsableWidth = exportMinWidth - exportReportPadding * 2;
    const minUsableHeight = exportMinHeight - exportHeaderHeight - exportFooterHeight;
    const graphArea = Math.max(graphWidth * graphHeight, 1);
    const targetArea = minUsableWidth * minUsableHeight * exportTargetAreaRatio;
    const scaleToTargetArea = Math.sqrt(targetArea / graphArea);
    const scaleToFitMinimumCanvas = Math.min(
      minUsableWidth / Math.max(graphWidth, 1),
      minUsableHeight / Math.max(graphHeight, 1)
    );
    const graphScale = Math.max(
      1,
      Math.min(
        exportMaxScale,
        scaleToTargetArea,
        scaleToFitMinimumCanvas >= 1 ? scaleToFitMinimumCanvas : exportMaxScale
      )
    );
    const scaledGraphWidth = graphWidth * graphScale;
    const scaledGraphHeight = graphHeight * graphScale;
    const canvasWidth = Math.max(exportMinWidth, Math.ceil(scaledGraphWidth + exportReportPadding * 2));
    const canvasHeight = Math.max(
      exportMinHeight,
      Math.ceil(scaledGraphHeight + exportHeaderHeight + exportFooterHeight)
    );
    const transform = {
      x: (canvasWidth - scaledGraphWidth) / 2 - bounds.minX * graphScale,
      y: exportHeaderHeight + (canvasHeight - exportHeaderHeight - exportFooterHeight - scaledGraphHeight) / 2 - bounds.minY * graphScale,
      scale: graphScale
    };
    const visibleBranchCount = nodes.filter((node) => node.type === "branch").length;
    const visibleCommitCount = nodes.filter((node) => node.type === "commit").length;
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.fillStyle = "#111827";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 34px Inter, Arial, sans-serif";
    context.fillText(`Diagrama ${graph.repository}`, canvasWidth / 2, 58);
    context.font = "500 19px Inter, Arial, sans-serif";
    context.fillStyle = "#334155";
    context.fillText(`Ramas visibles: ${visibleBranchCount} | Commits visibles: ${visibleCommitCount}`, canvasWidth / 2, 103);

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    edges.forEach((edge) => drawExportEdge(context, edge, nodeById, transform));
    nodes.forEach((node) => drawExportNode(context, node, transform));

    const timestamp = exportTimestamp();
    context.fillStyle = "#111827";
    context.textAlign = "left";
    context.font = "16px Inter, Arial, sans-serif";
    context.fillText(`Fecha: ${timestamp.label}`, 52, canvasHeight - 54);

    drawExportLegend(context, canvasWidth - 362, canvasHeight - 192);

    const link = document.createElement("a");
    link.download = `diagrama_${repositoryFileName(graph.repository)}_${timestamp.file}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function changeZoom(direction: 1 | -1) {
    const currentZoom = reactFlow.getZoom();
    const nextZoom = Math.max(
      0.2,
      Math.min(2.2, currentZoom + direction * 0.1),
    );
    reactFlow.zoomTo(nextZoom, { duration: 220 });
  }

  function toggleHistoryMode() {
    if (!historyMode) {
      commitsBeforeHistoryRef.current = expandedCommitBranches;
      setExpandedCommitBranches(allBranches);
      setHistoryStep(historyEvents.length);
      setHistoryMode(true);
      shouldFitRef.current = true;
      return;
    }

    exitHistoryMode();
  }

  function exitHistoryMode() {
    setExpandedCommitBranches(commitsBeforeHistoryRef.current);
    setHistoryMode(false);
    shouldFitRef.current = true;
  }

  function changeHistoryStep(direction: -1 | 1) {
    setHistoryStep((current) =>
      Math.max(0, Math.min(historyEvents.length, current + direction)),
    );
  }

  function changeBranchSelection(nextBranches: string[]) {
    const addedBranches = nextBranches.filter((branch) => !branches.includes(branch));
    setSelectedBranches(nextBranches);
    shouldFitRef.current = true;

    if (addedBranches.length > 0) {
      void onBranchesRequest?.(addedBranches);
    }
  }

  function changeOrientation() {
    setNodePositions({});
    setOrientation((current) =>
      current === "vertical" ? "horizontal" : "vertical",
    );
    shouldFitRef.current = true;
  }

  function changeConnectionStyle(style: ConnectionStyle) {
    setConnectionStyle(style);
    shouldFitRef.current = true;
  }

  function changeEdgeCurve(edgeId: string, curveOffset: number) {
    const nextOffset = Math.round(curveOffset);

    setEdgeEdits((current) => {
      if (current[edgeId]?.curveOffset === nextOffset) {
        return current;
      }

      return {
        ...current,
        [edgeId]: {
          ...current[edgeId],
          curveOffset: nextOffset,
        },
      };
    });
  }

  function changeEdgeAnchor(
    edgeId: string,
    role: "source" | "target",
    side: EdgeAnchorSide,
  ) {
    const key = role === "source" ? "sourceSide" : "targetSide";

    setEdgeEdits((current) => {
      if (current[edgeId]?.[key] === side) {
        return current;
      }

      return {
        ...current,
        [edgeId]: {
          ...current[edgeId],
          [key]: side,
        },
      };
    });
  }

  function clearSelectedEdge() {
    setSelectedEdgeId(null);
  }

  function selectNode(_: React.MouseEvent, node: RepoFlowNode) {
    clearSelectedEdge();
    onNodeSelect?.(node.data.graphNode);
  }

  function changeNodePositions(changes: NodeChange[]) {
    setFlowNodes((current) => {
      let next = applyNodeChanges(changes, current) as RepoFlowNode[];

      for (const change of changes) {
        if (
          change.type !== "position" ||
          !change.position ||
          change.dragging !== true
        ) {
          continue;
        }

        const draggedNode = next.find((node) => node.id === change.id);
        if (!draggedNode || draggedNode.type !== "branch") {
          continue;
        }

        const dragState = branchDragRef.current;
        if (!dragState || dragState.branchNodeId !== draggedNode.id) {
          continue;
        }

        const delta = {
          x: change.position.x - dragState.lastPosition.x,
          y: change.position.y - dragState.lastPosition.y,
        };

        if (delta.x === 0 && delta.y === 0) {
          continue;
        }

        next = next.map((node) =>
          node.type === "commit" && node.data.branch === dragState.branch
            ? {
                ...node,
                position: {
                  x: node.position.x + delta.x,
                  y: node.position.y + delta.y,
                },
              }
            : node,
        );

        window.requestAnimationFrame(() => {
          next
            .filter((node) => node.id === draggedNode.id || node.data.branch === dragState.branch)
            .forEach((node) => updateNodeInternals(node.id));
        });

        branchDragRef.current = {
          ...dragState,
          lastPosition: change.position,
        };
      }

      return next;
    });
  }

  function startNodeDrag(_: React.MouseEvent, node: RepoFlowNode) {
    setDraggingNode(true);

    if (node.type !== "branch") {
      branchDragRef.current = null;
      return;
    }

    branchDragRef.current = {
      branchNodeId: node.id,
      branch: node.data.branch,
      lastPosition: node.position,
    };
  }

  function persistCurrentNodePositions() {
    setDraggingNode(false);
    branchDragRef.current = null;
    setNodePositions((current) => {
      const next = { ...current };
      let changed = false;

      for (const node of reactFlow.getNodes()) {
        const currentPosition = current[node.id];
        if (
          currentPosition?.x === node.position.x &&
          currentPosition.y === node.position.y
        ) {
          continue;
        }

        next[node.id] = node.position;
        changed = true;
      }

      return changed ? next : current;
    });
  }

  if (!graph) {
    return (
      <section className="graph-empty">
        <i className="pi pi-share-alt" />
        <h2>Ingresa un repositorio para graficar ramas y commits.</h2>
      </section>
    );
  }

  return (
    <>
      {historyMode ? (
        <button
          type="button"
          className="history-backdrop"
          aria-label="Salir del historial Git"
          onClick={exitHistoryMode}
        />
      ) : null}
      <section
        className={`graph-shell${historyMode ? " graph-shell-history" : ""}${draggingNode ? " graph-shell-dragging" : ""}`}
        style={
          {
            "--branch-overlay-width": `${branchOverlaySize.width}px`,
            "--branch-overlay-height": `${branchOverlaySize.height}px`,
          } as CSSProperties
        }
      >
        <div className="graph-branch-overlay" ref={branchOverlayRef}>
          <div className="graph-branch-actions">
            <Button
              type="button"
              text
              className="branch-trigger branch-refresh-trigger"
              icon={`pi pi-refresh${refreshing ? " pi-spin" : ""}`}
              onClick={() => onRefresh?.(branches)}
              disabled={refreshing}
            >
              {refreshing ? "Actualizando..." : "Actualizar"}
            </Button>

            <BranchSelector
              branches={allBranches}
              selectedBranches={branches}
              branchColor={(branch) => colorForBranch(branch, allBranches)}
              onSelectionChange={changeBranchSelection}
            />
          </div>
        </div>

        <div className="graph-toolbar">
          <div className="graph-summary">
            <strong>{graph.repository}</strong>
            <span>
              {nodes.length} nodos · {edges.length} relaciones
            </span>
          </div>
        </div>

        <div className="graph-workspace repo-flow-workspace">
          <UtilityMenu
            horizontalLayout={orientation === "vertical"}
            commitsExpanded={allBranches.every((branch) =>
              expandedCommitBranches.includes(branch),
            )}
            historyMode={historyMode}
            connectionStyle={connectionStyle}
            onToggleLayout={changeOrientation}
            onToggleCommits={() =>
              setExpandedCommitBranches((current) =>
                allBranches.every((branch) => current.includes(branch))
                  ? []
                  : allBranches,
              )
            }
            onToggleHistory={toggleHistoryMode}
            onExportDiagram={exportDiagram}
            onConnectionStyleChange={changeConnectionStyle}
          />
          <ReactFlow
            nodes={nodes}
            edges={edges.map((edge) => ({
              ...edge,
              selected: edge.id === selectedEdgeId,
            }))}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={0.2}
            maxZoom={2.2}
            nodesDraggable
            selectionOnDrag={false}
            panOnDrag
            multiSelectionKeyCode="Shift"
            onlyRenderVisibleElements
            onNodesChange={changeNodePositions}
            onNodeDragStart={startNodeDrag}
            onNodeDragStop={persistCurrentNodePositions}
            onEdgeClick={(event, edge) => {
              event.stopPropagation();
              setSelectedEdgeId(edge.id);
            }}
            onNodeClick={selectNode}
            onPaneClick={clearSelectedEdge}
            onMove={(_, viewport) => setZoomLevel(viewport.zoom)}
            className="repo-flow-canvas"
          >
            <Background
              variant={BackgroundVariant.Lines}
              gap={28}
              color="rgba(15, 23, 42, 0.08)"
            />
          </ReactFlow>
          {historyMode ? (
            <HistoryControls
              canGoPrevious={historyStep > 0}
              canGoNext={historyStep < historyEvents.length}
              onPrevious={() => changeHistoryStep(-1)}
              onNext={() => changeHistoryStep(1)}
            />
          ) : null}
          <GraphLegend />
          <ZoomControls
            zoomPercent={Math.round(zoomLevel * 100)}
            canZoomIn={zoomLevel < 2.2}
            canZoomOut={zoomLevel > 0.2}
            onZoomIn={() => changeZoom(1)}
            onZoomOut={() => changeZoom(-1)}
            onFitGraph={fitGraph}
          />
        </div>
      </section>
    </>
  );
}

export function RepoFlowCanvas(props: RepoFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <RepoFlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
