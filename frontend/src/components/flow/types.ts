import type { Edge, Node } from "@xyflow/react";
import type { GraphEdgeType, GraphNode } from "../../types/graph";

export type FlowOrientation = "vertical" | "horizontal";
export type ConnectionStyle = "curved" | "straight" | "taxi";
export type EdgeAnchorSide = "top" | "right" | "bottom" | "left";

export interface EdgeEditState {
  sourceSide?: EdgeAnchorSide;
  targetSide?: EdgeAnchorSide;
  curveOffset?: number;
}

export interface RepoNodeData extends Record<string, unknown> {
  graphNode: GraphNode;
  label: string;
  branch: string;
  color: string;
  message?: string | null;
}

export interface RepoEdgeData extends Record<string, unknown> {
  graphType: GraphEdgeType;
  branch: string;
  color: string;
  connectionStyle: ConnectionStyle;
  orientation: FlowOrientation;
  curveOffset: number;
  taxiLaneIndex?: number;
  editableAnchors: boolean;
  exiting?: boolean;
  onCurveChange?: (edgeId: string, curveOffset: number) => void;
  onAnchorChange?: (edgeId: string, role: "source" | "target", side: EdgeAnchorSide) => void;
}

export type RepoFlowNode = Node<RepoNodeData, "branch" | "commit">;
export type RepoFlowEdge = Edge<RepoEdgeData, "repo-edge">;
