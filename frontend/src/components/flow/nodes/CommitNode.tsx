import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { RepoFlowNode } from "../types";

export function CommitNode({ data, selected }: NodeProps<RepoFlowNode>) {
  return (
    <div className={`repo-flow-commit-wrap${selected ? " repo-flow-node-selected" : ""}`}>
      <div className="repo-flow-node repo-flow-commit" style={{ backgroundColor: data.color }}>
        <Handle type="target" position={Position.Top} id="target-top" className="repo-flow-handle" />
        <Handle type="target" position={Position.Left} id="target-left" className="repo-flow-handle" />
        <Handle type="source" position={Position.Right} id="source-right" className="repo-flow-handle" />
        <Handle type="source" position={Position.Bottom} id="source-bottom" className="repo-flow-handle" />
        {data.label}
      </div>
      <span className="repo-flow-commit-message">{data.message}</span>
    </div>
  );
}
