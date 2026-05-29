import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getStraightPath,
  Position,
  useReactFlow,
  type EdgeProps
} from "@xyflow/react";
import { branchNodeHeight, branchNodeWidth } from "../layout/flowLayout";
import type { EdgeAnchorSide, RepoFlowEdge } from "../types";

type Point = { x: number; y: number };

function orthogonalPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  curveOffset: number
): string {
  const midX = sourceX + (targetX - sourceX) / 2 + curveOffset;
  return `M ${sourceX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${targetX} ${targetY}`;
}

function orthogonalBusPath(sourceX: number, sourceY: number, targetX: number, targetY: number, busY: number): string {
  return `M ${sourceX} ${sourceY} L ${sourceX} ${busY} L ${targetX} ${busY} L ${targetX} ${targetY}`;
}

function orthogonalControlPoint(sourceX: number, sourceY: number, targetX: number, targetY: number, curveOffset: number) {
  return {
    x: sourceX + (targetX - sourceX) / 2 + curveOffset,
    y: sourceY + (targetY - sourceY) / 2
  };
}

function curvedControlPoint(sourceX: number, sourceY: number, targetX: number, targetY: number, curveOffset: number) {
  const midX = sourceX + (targetX - sourceX) / 2;
  const midY = sourceY + (targetY - sourceY) / 2;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;

  return {
    x: midX + (-dy / length) * curveOffset,
    y: midY + (dx / length) * curveOffset
  };
}

function quadraticPoint(source: Point, control: Point, target: Point, t: number) {
  const startWeight = (1 - t) * (1 - t);
  const controlWeight = 2 * (1 - t) * t;
  const endWeight = t * t;

  return {
    x: startWeight * source.x + controlWeight * control.x + endWeight * target.x,
    y: startWeight * source.y + controlWeight * control.y + endWeight * target.y
  };
}

function cubicPoint(source: Point, controlA: Point, controlB: Point, target: Point, t: number) {
  const startWeight = (1 - t) * (1 - t) * (1 - t);
  const controlAWeight = 3 * (1 - t) * (1 - t) * t;
  const controlBWeight = 3 * (1 - t) * t * t;
  const endWeight = t * t * t;

  return {
    x: startWeight * source.x + controlAWeight * controlA.x + controlBWeight * controlB.x + endWeight * target.x,
    y: startWeight * source.y + controlAWeight * controlA.y + controlBWeight * controlB.y + endWeight * target.y
  };
}

function targetTangentControl(targetX: number, targetY: number, targetPosition: Position) {
  const tangentLength = 34;

  if (targetPosition === Position.Top) {
    return { x: targetX, y: targetY - tangentLength };
  }
  if (targetPosition === Position.Bottom) {
    return { x: targetX, y: targetY + tangentLength };
  }
  if (targetPosition === Position.Left) {
    return { x: targetX - tangentLength, y: targetY };
  }
  return { x: targetX + tangentLength, y: targetY };
}

function curvedPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  targetPosition: Position,
  curveOffset: number
): string {
  const control = curvedControlPoint(sourceX, sourceY, targetX, targetY, curveOffset);
  const targetControl = targetTangentControl(targetX, targetY, targetPosition);

  return `M ${sourceX} ${sourceY} C ${control.x} ${control.y} ${targetControl.x} ${targetControl.y} ${targetX} ${targetY}`;
}

function curveOffsetDelta(source: Point, target: Point, pointerDelta: Point) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const normal = { x: -dy / length, y: dx / length };

  return pointerDelta.x * normal.x + pointerDelta.y * normal.y;
}

function arrowAngle(targetPosition: Position): number {
  if (targetPosition === Position.Left) {
    return 0;
  }
  if (targetPosition === Position.Right) {
    return 180;
  }
  if (targetPosition === Position.Bottom) {
    return -90;
  }
  return 90;
}

function vectorAngle(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

function lineTargetPoint(targetX: number, targetY: number, targetPosition: Position) {
  const arrowBodyLength = 9;

  if (targetPosition === Position.Top) {
    return { x: targetX, y: targetY - arrowBodyLength };
  }
  if (targetPosition === Position.Bottom) {
    return { x: targetX, y: targetY + arrowBodyLength };
  }
  if (targetPosition === Position.Left) {
    return { x: targetX - arrowBodyLength, y: targetY };
  }
  return { x: targetX + arrowBodyLength, y: targetY };
}

function taxiBusY(sourceY: number, targetY: number, laneIndex = 0, curveOffset = 0): number {
  const laneHeight = 54 + laneIndex * 28;

  return Math.min(sourceY, targetY) - laneHeight + curveOffset;
}

function pointBeforeTarget(from: Point, target: Point, distance: number): Point {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;

  return {
    x: target.x - (dx / length) * distance,
    y: target.y - (dy / length) * distance
  };
}

function orthogonalLastPoint(sourceX: number, sourceY: number, targetX: number, targetY: number, curveOffset: number) {
  return {
    x: sourceX + (targetX - sourceX) / 2 + curveOffset,
    y: targetY
  };
}

function edgeLineTargetPoint(
  source: Point,
  target: Point,
  targetPosition: Position,
  style: string,
  curveOffset: number
) {
  const arrowBodyLength = 9;

  if (style === "straight") {
    return pointBeforeTarget(source, target, arrowBodyLength);
  }

  if (style === "taxi") {
    return pointBeforeTarget(
      orthogonalLastPoint(source.x, source.y, target.x, target.y, curveOffset),
      target,
      arrowBodyLength
    );
  }

  return lineTargetPoint(target.x, target.y, targetPosition);
}

function closestSide(pointer: { x: number; y: number }, nodePosition: { x: number; y: number }): EdgeAnchorSide {
  const center = {
    x: nodePosition.x + branchNodeWidth / 2,
    y: nodePosition.y + branchNodeHeight / 2
  };
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;

  if (Math.abs(dx) / branchNodeWidth >= Math.abs(dy) / branchNodeHeight) {
    return dx >= 0 ? "right" : "left";
  }

  return dy >= 0 ? "bottom" : "top";
}

export function RepoEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  selected,
  data
}: EdgeProps<RepoFlowEdge>) {
  const reactFlow = useReactFlow();
  const style = data?.connectionStyle ?? "curved";
  const isCommitEdge = data?.graphType === "branch_commit" || data?.graphType === "parent" || data?.graphType === "merge";
  const effectiveStyle = isCommitEdge ? "straight" : style;
  const curveOffset = data?.curveOffset ?? 0;
  const shouldUseTaxiBus = effectiveStyle === "taxi"
    && sourcePosition === Position.Top
    && targetPosition === Position.Top;
  const busY = shouldUseTaxiBus ? taxiBusY(sourceY, targetY, data?.taxiLaneIndex ?? 0, curveOffset) : null;
  const taxiPreviousPoint = busY === null
    ? orthogonalLastPoint(sourceX, sourceY, targetX, targetY, curveOffset)
    : { x: targetX, y: busY };
  const lineTarget = effectiveStyle === "straight"
    ? pointBeforeTarget({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, 9)
    : effectiveStyle === "taxi"
      ? pointBeforeTarget(taxiPreviousPoint, { x: targetX, y: targetY }, 9)
      : lineTargetPoint(targetX, targetY, targetPosition);
  const [edgePath, labelX, labelY] = effectiveStyle === "straight"
    ? getStraightPath({ sourceX, sourceY, targetX: lineTarget.x, targetY: lineTarget.y })
    : effectiveStyle === "taxi"
      ? busY === null
        ? [
            orthogonalPath(sourceX, sourceY, lineTarget.x, lineTarget.y, curveOffset),
            orthogonalControlPoint(sourceX, sourceY, lineTarget.x, lineTarget.y, curveOffset).x,
            orthogonalControlPoint(sourceX, sourceY, lineTarget.x, lineTarget.y, curveOffset).y
          ]
        : [
            orthogonalBusPath(sourceX, sourceY, lineTarget.x, lineTarget.y, busY),
            sourceX + (lineTarget.x - sourceX) / 2,
            busY
          ]
      : curveOffset !== 0
        ? [
            curvedPath(sourceX, sourceY, lineTarget.x, lineTarget.y, targetPosition, curveOffset),
            cubicPoint(
              { x: sourceX, y: sourceY },
              curvedControlPoint(sourceX, sourceY, lineTarget.x, lineTarget.y, curveOffset),
              targetTangentControl(lineTarget.x, lineTarget.y, targetPosition),
              lineTarget,
              0.5
            ).x,
            cubicPoint(
              { x: sourceX, y: sourceY },
              curvedControlPoint(sourceX, sourceY, lineTarget.x, lineTarget.y, curveOffset),
              targetTangentControl(lineTarget.x, lineTarget.y, targetPosition),
              lineTarget,
              0.5
            ).y
          ]
        : getBezierPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX: lineTarget.x,
            targetY: lineTarget.y,
            targetPosition
          });
  const stroke = data?.color ?? "#2563eb";
  const className = [
    "repo-flow-edge",
    selected ? "repo-flow-edge-selected" : "",
    data?.graphType === "branch_possible" ? "repo-flow-edge-dashed" : "",
    data?.exiting ? "repo-flow-edge-exiting" : ""
  ].filter(Boolean).join(" ");
  const control = { x: labelX, y: labelY };
  const arrowRotation = effectiveStyle === "straight"
    ? vectorAngle({ x: sourceX, y: sourceY }, { x: targetX, y: targetY })
    : effectiveStyle === "taxi"
      ? vectorAngle(taxiPreviousPoint, { x: targetX, y: targetY })
      : arrowAngle(targetPosition);
  const canEditCurve = !isCommitEdge && effectiveStyle !== "straight";

  function startCurveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startPointer = { x: event.clientX, y: event.clientY };
    const startOffset = curveOffset;

    function handleMove(moveEvent: PointerEvent) {
      const pointerDelta = {
        x: moveEvent.clientX - startPointer.x,
        y: moveEvent.clientY - startPointer.y
      };
      const delta = effectiveStyle === "taxi"
        ? shouldUseTaxiBus ? pointerDelta.y : pointerDelta.x
        : curveOffsetDelta(
            { x: sourceX, y: sourceY },
            lineTarget,
            pointerDelta
          );
      data?.onCurveChange?.(id, startOffset + delta);
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function startAnchorDrag(role: "source" | "target", nodeId: string, event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    function handleMove(moveEvent: PointerEvent) {
      const node = reactFlow.getNode(nodeId);
      if (!node) {
        return;
      }

      const pointer = reactFlow.screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      data?.onAnchorChange?.(id, role, closestSide(pointer, node.position));
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        interactionWidth={24}
        className={className}
        style={{ stroke, strokeLinecap: "round", strokeLinejoin: "round" }}
      />
      <polygon
        className="repo-flow-edge-arrow"
        points="0,0 -11,-5.5 -8.5,0 -11,5.5"
        transform={`translate(${targetX}, ${targetY}) rotate(${arrowRotation})`}
        fill={stroke}
        stroke={stroke}
        strokeWidth={1}
      />
      {selected ? (
        <EdgeLabelRenderer>
          {canEditCurve ? (
            <button
              type="button"
              className="repo-flow-edge-edit repo-flow-edge-curve-edit"
              style={{ transform: `translate(-50%, -50%) translate(${control.x}px, ${control.y}px)` }}
              aria-label="Mover curva de flecha"
              onPointerDown={startCurveDrag}
            />
          ) : null}
          {data?.editableAnchors ? (
            <>
              <button
                type="button"
                className="repo-flow-edge-edit repo-flow-edge-anchor-edit"
                style={{ transform: `translate(-50%, -50%) translate(${sourceX}px, ${sourceY}px)` }}
                aria-label="Mover anclaje de origen"
                onPointerDown={(event) => startAnchorDrag("source", source, event)}
              />
              <button
                type="button"
                className="repo-flow-edge-edit repo-flow-edge-anchor-edit"
                style={{ transform: `translate(-50%, -50%) translate(${targetX}px, ${targetY}px)` }}
                aria-label="Mover anclaje de destino"
                onPointerDown={(event) => startAnchorDrag("target", target, event)}
              />
            </>
          ) : null}
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
