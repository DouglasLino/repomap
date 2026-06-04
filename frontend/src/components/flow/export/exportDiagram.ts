import type { GraphResponse } from "../../../types/graph";
import {
  branchNodeHeight,
  branchNodeWidth,
  commitNodeSize
} from "../layout/flowLayout";
import type {
  ConnectionStyle,
  EdgeAnchorSide,
  RepoFlowEdge,
  RepoFlowNode
} from "../types";

const commitNodeWidth = 136;
const commitNodeHeight = 70;
const exportMinWidth = 1920;
const exportMinHeight = 1080;
const exportReportPadding = 88;
const exportHeaderHeight = 156;
const exportFooterHeight = 168;
const exportTargetAreaRatio = 0.76;
const exportMaxScale = 2.35;

type ExportBounds = { minX: number; minY: number; maxX: number; maxY: number };
type CanvasPoint = { x: number; y: number };
type ExportTransform = { x: number; y: number; scale: number };
type ExportEdge = Pick<RepoFlowEdge, "source" | "target"> & {
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: Partial<RepoFlowEdge["data"]>;
};

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

function edgeSide(handleId: string | null | undefined): EdgeAnchorSide {
  const side = handleId?.split("-").pop();
  return (side as EdgeAnchorSide | undefined) ?? "bottom";
}

function isExportCommitEdge(edge: ExportEdge): boolean {
  return edge.data?.graphType === "branch_commit"
    || edge.data?.graphType === "parent"
    || edge.data?.graphType === "merge";
}

function exportEffectiveConnectionStyle(edge: ExportEdge): ConnectionStyle {
  return isExportCommitEdge(edge) ? "straight" : edge.data?.connectionStyle ?? "curved";
}

function pointBeforeTarget(from: CanvasPoint, target: CanvasPoint, distance: number): CanvasPoint {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;

  return {
    x: target.x - (dx / length) * distance,
    y: target.y - (dy / length) * distance
  };
}

function exportLineTargetPoint(source: CanvasPoint, target: CanvasPoint, targetSide: EdgeAnchorSide, scale: number): CanvasPoint {
  const arrowBodyLength = 9 * scale;

  if (targetSide === "top") {
    return { x: target.x, y: target.y - arrowBodyLength };
  }
  if (targetSide === "bottom") {
    return { x: target.x, y: target.y + arrowBodyLength };
  }
  if (targetSide === "left") {
    return { x: target.x - arrowBodyLength, y: target.y };
  }
  if (targetSide === "right") {
    return { x: target.x + arrowBodyLength, y: target.y };
  }

  return pointBeforeTarget(source, target, arrowBodyLength);
}

function exportOrthogonalLastPoint(source: CanvasPoint, target: CanvasPoint, curveOffset: number): CanvasPoint {
  return {
    x: source.x + (target.x - source.x) / 2 + curveOffset,
    y: target.y
  };
}

function exportTaxiBusY(sourceY: number, targetY: number, laneIndex = 0, curveOffset = 0): number {
  const laneHeight = 54 + laneIndex * 28;

  return Math.min(sourceY, targetY) - laneHeight + curveOffset;
}

function exportTargetTangentControl(target: CanvasPoint, targetSide: EdgeAnchorSide, scale: number): CanvasPoint {
  const tangentLength = 34 * scale;

  if (targetSide === "top") {
    return { x: target.x, y: target.y - tangentLength };
  }
  if (targetSide === "bottom") {
    return { x: target.x, y: target.y + tangentLength };
  }
  if (targetSide === "left") {
    return { x: target.x - tangentLength, y: target.y };
  }
  return { x: target.x + tangentLength, y: target.y };
}

function exportSourceTangentControl(source: CanvasPoint, sourceSide: EdgeAnchorSide, scale: number): CanvasPoint {
  const tangentLength = 54 * scale;

  if (sourceSide === "top") {
    return { x: source.x, y: source.y - tangentLength };
  }
  if (sourceSide === "bottom") {
    return { x: source.x, y: source.y + tangentLength };
  }
  if (sourceSide === "left") {
    return { x: source.x - tangentLength, y: source.y };
  }
  return { x: source.x + tangentLength, y: source.y };
}

function offsetControlPoint(point: CanvasPoint, source: CanvasPoint, target: CanvasPoint, curveOffset: number): CanvasPoint {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;

  return {
    x: point.x + (-dy / length) * curveOffset,
    y: point.y + (dx / length) * curveOffset
  };
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

/** Calculates the full export bounds, including curved and orthogonal edge control points. */
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

    const style = exportEffectiveConnectionStyle(edge);
    const curveOffset = edge.data?.curveOffset ?? 0;
    const sourceSide = edgeSide(edge.sourceHandle);
    const targetSide = edgeSide(edge.targetHandle);

    if (style === "taxi") {
      if (sourceSide === "top" && targetSide === "top") {
        const busY = exportTaxiBusY(sourcePoint.y, targetPoint.y, edge.data?.taxiLaneIndex ?? 0, curveOffset);
        includePoint({ x: sourcePoint.x, y: busY });
        includePoint({ x: targetPoint.x, y: busY });
        return;
      }

      const elbow = sourcePoint.x + (targetPoint.x - sourcePoint.x) / 2 + curveOffset;
      includePoint({ x: elbow, y: sourcePoint.y });
      includePoint({ x: elbow, y: targetPoint.y });
      return;
    }

    if (style === "curved") {
      includePoint(offsetControlPoint(exportSourceTangentControl(sourcePoint, sourceSide, 1), sourcePoint, targetPoint, curveOffset));
      includePoint(offsetControlPoint(exportTargetTangentControl(targetPoint, targetSide, 1), sourcePoint, targetPoint, curveOffset));
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
  const sourceSide = edgeSide(edge.sourceHandle);
  const targetSide = edgeSide(edge.targetHandle);
  const style = exportEffectiveConnectionStyle(edge);
  const curveOffset = (edge.data?.curveOffset ?? 0) * transform.scale;
  const shouldUseTaxiBus = style === "taxi"
    && edgeSide(edge.sourceHandle) === "top"
    && targetSide === "top";
  const busY = shouldUseTaxiBus
    ? exportTaxiBusY(sourcePoint.y, targetPoint.y, edge.data?.taxiLaneIndex ?? 0, curveOffset)
    : null;
  const taxiPreviousPoint = busY === null
    ? exportOrthogonalLastPoint(sourcePoint, targetPoint, curveOffset)
    : { x: targetPoint.x, y: busY };
  const lineTarget = style === "straight"
    ? pointBeforeTarget(sourcePoint, targetPoint, 9 * transform.scale)
    : style === "taxi"
      ? pointBeforeTarget(taxiPreviousPoint, targetPoint, 9 * transform.scale)
      : exportLineTargetPoint(sourcePoint, targetPoint, targetSide, transform.scale);
  const sourceControl = offsetControlPoint(
    exportSourceTangentControl(sourcePoint, sourceSide, transform.scale),
    sourcePoint,
    lineTarget,
    curveOffset
  );
  const targetControl = offsetControlPoint(
    exportTargetTangentControl(lineTarget, targetSide, transform.scale),
    sourcePoint,
    lineTarget,
    curveOffset
  );
  const arrowSource = style === "taxi"
    ? taxiPreviousPoint
    : style === "curved"
      ? targetControl
      : sourcePoint;

  context.save();
  context.strokeStyle = color;
  context.lineWidth = 3 * transform.scale;
  context.globalAlpha = 0.88;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(edge.data?.graphType === "branch_possible" ? [10 * transform.scale, 8 * transform.scale] : []);
  context.beginPath();
  context.moveTo(sourcePoint.x, sourcePoint.y);
  if (style === "straight") {
    context.lineTo(lineTarget.x, lineTarget.y);
  } else if (style === "taxi") {
    if (busY === null) {
      const elbowX = sourcePoint.x + (lineTarget.x - sourcePoint.x) / 2 + curveOffset;
      context.lineTo(elbowX, sourcePoint.y);
      context.lineTo(elbowX, lineTarget.y);
      context.lineTo(lineTarget.x, lineTarget.y);
    } else {
      context.lineTo(sourcePoint.x, busY);
      context.lineTo(lineTarget.x, busY);
      context.lineTo(lineTarget.x, lineTarget.y);
    }
  } else {
    context.bezierCurveTo(sourceControl.x, sourceControl.y, targetControl.x, targetControl.y, lineTarget.x, lineTarget.y);
  }
  context.stroke();
  context.setLineDash([]);
  drawArrow(context, arrowSource, targetPoint, color, transform.scale);
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

/** Exports the currently rendered graph state into a report-style PNG document. */
export function exportDiagramImage(graph: GraphResponse, nodes: RepoFlowNode[], edges: ExportEdge[]): void {
  const bounds = graphExportBounds(nodes, edges);
  if (!bounds) {
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
