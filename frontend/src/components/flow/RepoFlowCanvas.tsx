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
import { exportDiagramImage } from "./export/exportDiagram";
import { GraphLegend } from "./GraphLegend";
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
    if (!graph) {
      return;
    }

    exportDiagramImage(graph, nodes, edges);
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
