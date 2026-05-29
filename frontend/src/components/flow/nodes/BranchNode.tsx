import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { RepoFlowNode } from "../types";

function branchLabelLines(label: string): string[] {
  const separators = ["/", " ", "-", "_", "."];
  const separator = separators.find((current) => label.includes(current));

  if (!separator) {
    return [label];
  }

  const separatorIndex = label.indexOf(separator);
  return [
    label.slice(0, separatorIndex + separator.length),
    label.slice(separatorIndex + separator.length)
  ].filter(Boolean);
}

export function BranchNode({ data, selected }: NodeProps<RepoFlowNode>) {
  const labelLines = branchLabelLines(data.label);

  return (
    <div
      className={`repo-flow-node repo-flow-branch${selected ? " repo-flow-node-selected" : ""}`}
      style={{ backgroundColor: data.color }}
    >
      <Handle type="source" position={Position.Top} id="source-top" className="repo-flow-handle" />
      <Handle type="source" position={Position.Right} id="source-right" className="repo-flow-handle" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" className="repo-flow-handle" />
      <Handle type="source" position={Position.Left} id="source-left" className="repo-flow-handle" />
      <Handle type="target" position={Position.Top} id="target-top" className="repo-flow-handle" />
      <Handle type="target" position={Position.Right} id="target-right" className="repo-flow-handle" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" className="repo-flow-handle" />
      <Handle type="target" position={Position.Left} id="target-left" className="repo-flow-handle" />
      <span>
        {labelLines.map((line, index) => (
          <span className="repo-flow-branch-line" key={`${line}-${index}`}>
            {line}
          </span>
        ))}
      </span>
    </div>
  );
}
