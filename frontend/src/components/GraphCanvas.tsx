import cytoscape, { type Core, type NodeSingular } from "cytoscape";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Sidebar } from "primereact/sidebar";
import { BranchSelector } from "./BranchSelector";
import { HistoryControls } from "./HistoryControls";
import { UtilityMenu } from "./UtilityMenu";
import { ZoomControls } from "./ZoomControls";
import {
  absoluteEndpoint,
  branchBaseHeight,
  branchWidth,
  colorForBranch,
  commitMessageOffset,
  commitPositionForIndex,
  controlPointData,
  controlPointFromCurveHandle,
  defaultBranchEndpoints,
  endpointPoint,
  endpointValue,
  expandedRowsOffset,
  graphStyles,
  historyEventsForGraph,
  historyMovementDuration,
  initialVisibleBranches,
  maxGraphZoom,
  minGraphZoom,
  pointOnBranchBorder,
  toElements,
  zoomStepPercent,
  type ConnectionStyle,
  type GraphOrientation
} from "./graphCanvasModel";
import type { GraphNode, GraphResponse } from "../types/graph";

interface GraphCanvasProps {
  graph: GraphResponse | null;
}

export function GraphCanvas({ graph }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const branchOverlayRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [orientation, setOrientation] = useState<GraphOrientation>("vertical");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [historyMode, setHistoryMode] = useState(false);
  const [historyStep, setHistoryStep] = useState(0);
  const [connectionStyle, setConnectionStyle] = useState<ConnectionStyle>("curved");
  const [branchOverlaySize, setBranchOverlaySize] = useState({ width: 0, height: 0 });
  const commitsBeforeHistoryRef = useRef<string[]>([]);
  const shouldFitHistoryRef = useRef(false);
  const shouldFitInitialGraphRef = useRef(false);
  const shouldFitBranchSelectionRef = useRef(false);
  const wasHistoryModeRef = useRef(false);

  const allBranches = useMemo(
    () => graph?.nodes.filter((node) => node.type === "branch").map((node) => node.branch ?? node.label) ?? [],
    [graph]
  );
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [expandedCommitBranches, setExpandedCommitBranches] = useState<string[]>([]);
  const compactCommitMode = allBranches.length > 4;

  useEffect(() => {
    setSelectedBranches(initialVisibleBranches(allBranches));
    setExpandedCommitBranches(allBranches);
  }, [allBranches]);

  const branches = selectedBranches.length ? selectedBranches : initialVisibleBranches(allBranches);
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
    const overlay = branchOverlayRef.current;
    if (!overlay) {
      return;
    }

    const updateSize = () => {
      setBranchOverlaySize({
        width: overlay.offsetWidth,
        height: overlay.offsetHeight
      });
    };
    const observer = new ResizeObserver(updateSize);

    updateSize();
    observer.observe(overlay);
    return () => observer.disconnect();
  }, [graph]);

  useEffect(() => {
    if (!containerRef.current || !visibleGraph || !graph) {
      return;
    }

    shouldFitInitialGraphRef.current = true;
    cyRef.current?.destroy();

    const cy = cytoscape({
      container: containerRef.current,
      elements: toElements(
        graph,
        allBranches,
        allBranches,
        orientation,
        new Set()
      ),
      minZoom: minGraphZoom,
      maxZoom: maxGraphZoom,
      wheelSensitivity: 0.18,
      style: graphStyles,
      layout: {
        name: "preset",
        fit: false,
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
      const sourceEndpointKey = connectionStyle === "taxi" ? "taxiSourceEndpoint" : "branchSourceEndpoint";
      const targetEndpointKey = connectionStyle === "taxi" ? "taxiTargetEndpoint" : "branchTargetEndpoint";
      const endpoints = {
        source: endpointPoint(edge.data(sourceEndpointKey), endpointPoint(edge.data("branchSourceEndpoint"), defaults.source)),
        target: endpointPoint(edge.data(targetEndpointKey), endpointPoint(edge.data("branchTargetEndpoint"), defaults.target))
      };
      const sourceNode = edge.source();
      const targetNode = edge.target();
      const sourceEndpointPosition = absoluteEndpoint(sourceNode.position(), endpoints.source);
      const targetEndpointPosition = absoluteEndpoint(targetNode.position(), endpoints.target);
      const taxiTurn = Number.parseFloat(edge.data("taxiTurn") ?? "0");
      const taxiDirection = edge.data("taxiDirection") as string | undefined;
      const curvePosition = connectionStyle === "taxi" && Number.isFinite(taxiTurn)
        ? {
            x: taxiDirection === "leftward" || taxiDirection === "rightward"
              ? sourceEndpointPosition.x + (taxiDirection === "leftward" ? -taxiTurn : taxiTurn)
              : (sourceEndpointPosition.x + targetEndpointPosition.x) / 2,
            y: taxiDirection === "upward" || taxiDirection === "downward"
              ? sourceEndpointPosition.y + (taxiDirection === "upward" ? -taxiTurn : taxiTurn)
              : (sourceEndpointPosition.y + targetEndpointPosition.y) / 2
          }
        : edge.midpoint();

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
      const branchNodeHalfWidth = branchWidth / 2;
      const rawBorderPoint = pointOnBranchBorder(
        handle.position(),
        branchPosition,
        branchNodeHalfHeight
      );
      const snapToOrthogonalSide = connectionStyle === "taxi";
      const borderPoint = snapToOrthogonalSide
        ? (
            Math.abs(rawBorderPoint.x) / branchNodeHalfWidth >= Math.abs(rawBorderPoint.y) / branchNodeHalfHeight
              ? { x: rawBorderPoint.x >= 0 ? branchNodeHalfWidth : -branchNodeHalfWidth, y: 0 }
              : { x: 0, y: rawBorderPoint.y >= 0 ? branchNodeHalfHeight : -branchNodeHalfHeight }
          )
        : rawBorderPoint;

      handle.position({
        x: branchPosition.x + borderPoint.x,
        y: branchPosition.y + borderPoint.y
      });
      handle.data("borderOffsetX", borderPoint.x);
      handle.data("borderOffsetY", borderPoint.y);

      const endpointProperty = handle.data("endpointRole") === "source"
        ? (connectionStyle === "taxi" ? "taxiSourceEndpoint" : "branchSourceEndpoint")
        : (connectionStyle === "taxi" ? "taxiTargetEndpoint" : "branchTargetEndpoint");
      edge.data(endpointProperty, endpointValue(borderPoint));

      const curveHandle = cy.getElementById(`curve:${edge.id()}`);
      if (curveHandle.nonempty()) {
        const defaults = defaultBranchEndpoints(orientation);
        const sourcePoint = endpointPoint(
          edge.data(connectionStyle === "taxi" ? "taxiSourceEndpoint" : "branchSourceEndpoint"),
          defaults.source
        );
        const targetPoint = endpointPoint(
          edge.data(connectionStyle === "taxi" ? "taxiTargetEndpoint" : "branchTargetEndpoint"),
          defaults.target
        );
        curveHandle.position(edge.midpoint());
      }
    });

    cy.on("drag", "node.edge-curve-handle", (event) => {
      const handle = event.target;
      const edge = cy.getElementById(handle.data("edgeId"));
      const defaults = defaultBranchEndpoints(orientation);
      const sourcePoint = endpointPoint(
        edge.data(connectionStyle === "taxi" ? "taxiSourceEndpoint" : "branchSourceEndpoint"),
        defaults.source
      );
      const targetPoint = endpointPoint(
        edge.data(connectionStyle === "taxi" ? "taxiTargetEndpoint" : "branchTargetEndpoint"),
        defaults.target
      );
      const sourcePosition = absoluteEndpoint(edge.source().position(), sourcePoint);
      const targetPosition = absoluteEndpoint(edge.target().position(), targetPoint);

      if (connectionStyle === "taxi") {
        const taxiDirection = edge.data("taxiDirection") as string | undefined;
        const reference = taxiDirection === "leftward" || taxiDirection === "rightward"
          ? sourcePosition.x
          : sourcePosition.y;
        const handleAxis = taxiDirection === "leftward" || taxiDirection === "rightward"
          ? handle.position("x")
          : handle.position("y");
        const nextTurn = Math.max(24, Math.abs(handleAxis - reference));

        edge.data("taxiTurn", `${nextTurn}px`);
        return;
      }

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
      if (connectionStyle === "taxi") {
        return;
      }

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
      setZoomLevel(cy.zoom());
    });

    applyConnectionStyle(cy, connectionStyle);
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
    if (!cy) {
      return;
    }

    applyConnectionStyle(cy, connectionStyle);
  }, [connectionStyle]);

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

    const commitsReadyForInitialFit = allBranches.every((branch) => expandedBranches.has(branch));
    if (!historyMode && shouldFitInitialGraphRef.current && commitsReadyForInitialFit) {
      shouldFitInitialGraphRef.current = false;
      window.requestAnimationFrame(() => fitGraph(true));
    }

    if (shouldFitBranchSelectionRef.current) {
      shouldFitBranchSelectionRef.current = false;
      window.requestAnimationFrame(() => fitGraph(true));
    }
  }, [allBranches, branches, compactCommitMode, expandedCommitBranches, graph, historyGraph, historyMode, orientation]);

  useEffect(() => {
    if (!historyMode || !shouldFitHistoryRef.current) {
      return;
    }

    shouldFitHistoryRef.current = false;
    window.requestAnimationFrame(() => fitGraph(true));
  }, [displayedGraph, historyMode]);

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

  function applyConnectionStyle(cy: Core, style: ConnectionStyle) {
    cy.nodes(".edge-handle").remove();
    cy.edges(".endpoint-editing").removeClass("endpoint-editing");
    cy.edges()
      .removeClass("connection-straight connection-taxi connection-curved")
      .addClass(`connection-${style}`);
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

    exitHistoryMode();
  }

  function exitHistoryMode() {
    setExpandedCommitBranches(commitsBeforeHistoryRef.current);
    setHistoryMode(false);
  }

  function changeHistoryStep(direction: -1 | 1) {
    setHistoryStep((current) => Math.max(
      0,
      Math.min(historyEvents.length, current + direction)
    ));
  }

  function changeBranchSelection(nextBranches: string[]) {
    shouldFitBranchSelectionRef.current = true;
    setSelectedBranches(nextBranches);
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
    {historyMode ? (
      <button
        type="button"
        className="history-backdrop"
        aria-label="Salir del historial Git"
        onClick={exitHistoryMode}
      />
    ) : null}
    <section
      className={`graph-shell${historyMode ? " graph-shell-history" : ""}`}
      style={{
        "--branch-overlay-width": `${branchOverlaySize.width}px`,
        "--branch-overlay-height": `${branchOverlaySize.height}px`
      } as CSSProperties}
    >
      <div className="graph-branch-overlay" ref={branchOverlayRef}>
        <BranchSelector
          branches={allBranches}
          selectedBranches={branches}
          branchColor={(branch) => colorForBranch(branch, allBranches)}
          onSelectionChange={changeBranchSelection}
        />
      </div>
      <div className="graph-toolbar">
        <div className="graph-summary">
          <strong>{graph.repository}</strong>
          <span>{displayedGraph?.nodes.length ?? 0} nodos · {displayedGraph?.edges.length ?? 0} relaciones</span>
        </div>
      </div>

      <div className="graph-workspace">
        <UtilityMenu
          horizontalLayout={orientation === "vertical"}
          commitsExpanded={allBranches.every((branch) => expandedCommitBranches.includes(branch))}
          historyMode={historyMode}
          connectionStyle={connectionStyle}
          onToggleLayout={() => setOrientation((current) => (
            current === "horizontal" ? "vertical" : "horizontal"
          ))}
          onToggleCommits={() => setExpandedCommitBranches((current) => (
            allBranches.every((branch) => current.includes(branch)) ? [] : allBranches
          ))}
          onToggleHistory={toggleHistoryMode}
          onConnectionStyleChange={setConnectionStyle}
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
