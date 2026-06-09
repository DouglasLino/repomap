import type { GraphResponse } from "../../../types/graph";

function environmentBranchRank(branch: string): number | null {
  const name = branch.toLowerCase();
  if (/(^|[/_-])release([/_-]|$)/.test(name)) {
    return -1;
  }
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

export function isEnvironmentBranch(branch: string): boolean {
  return environmentBranchRank(branch) !== null;
}

function branchGroup(branch: string): string {
  const separatorIndex = branch.indexOf("/");
  return (separatorIndex > 0 ? branch.slice(0, separatorIndex) : branch).trim().toLowerCase();
}

function projectEnvironmentRank(branch: string): number {
  const name = branch.toLowerCase();
  const lastSegment = branch.split("/").pop()?.toLowerCase() ?? "";

  if (/(^|[/_-])release([/_-]|$)/.test(name)) {
    return 99;
  }

  if (/^(dev|develop)([-_].*)?$/.test(lastSegment)) {
    return 100;
  }

  if (/^(development)([-_].*)?$/.test(lastSegment)) {
    return 101;
  }

  if (/^(qa|quality[-_]?assurance|test|testing)([-_].*)?$/.test(lastSegment)) {
    return 102;
  }

  if (/^(staging|stage)([-_].*)?$/.test(lastSegment)) {
    return 103;
  }

  if (/^(main)([-_].*)?$/.test(lastSegment)) {
    return 104;
  }

  if (/^(prod|production)([-_].*)?$/.test(lastSegment)) {
    return 105;
  }

  if (/^(master)([-_].*)?$/.test(lastSegment)) {
    return 106;
  }

  return 0;
}

/** Orders project branches from graph evidence while avoiding inferred cycles. */
function branchRelationOrder(graph: GraphResponse | null | undefined, branches: string[], fallbackOrder: string[]): string[] {
  if (!graph || branches.length < 2) {
    return fallbackOrder;
  }

  const branchSet = new Set(branches);
  const fallbackIndex = new Map(fallbackOrder.map((branch, index) => [branch, index]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(branches.map((branch) => [branch, new Set<string>()]));
  const incomingCount = new Map(branches.map((branch) => [branch, 0]));

  function hasPath(fromBranch: string, toBranch: string, visited = new Set<string>()): boolean {
    if (fromBranch === toBranch) {
      return true;
    }
    if (visited.has(fromBranch)) {
      return false;
    }

    visited.add(fromBranch);
    return Array.from(outgoing.get(fromBranch) ?? [])
      .some((childBranch) => hasPath(childBranch, toBranch, visited));
  }

  function addConstraint(parentBranch: string | null | undefined, childBranch: string | null | undefined) {
    if (!parentBranch || !childBranch || parentBranch === childBranch) {
      return;
    }
    if (!branchSet.has(parentBranch) || !branchSet.has(childBranch)) {
      return;
    }
    if (branchGroup(parentBranch) !== branchGroup(childBranch)) {
      return;
    }
    if (projectEnvironmentRank(parentBranch) > projectEnvironmentRank(childBranch)) {
      return;
    }

    const children = outgoing.get(parentBranch);
    if (!children || children.has(childBranch)) {
      return;
    }
    if (hasPath(childBranch, parentBranch)) {
      return;
    }

    children.add(childBranch);
    incomingCount.set(childBranch, (incomingCount.get(childBranch) ?? 0) + 1);
  }

  ["pull_request_merge", "merge", "branch_assumed", "branch_possible"].forEach((edgeType) => {
    graph.edges
      .filter((edge) => edge.type === edgeType)
      .forEach((edge) => {
        const sourceBranch = nodeById.get(edge.source)?.branch;
        const targetBranch = nodeById.get(edge.target)?.branch;
        addConstraint(sourceBranch, targetBranch);
      });
  });

  const ordered: string[] = [];
  const queue = branches
    .filter((branch) => (incomingCount.get(branch) ?? 0) === 0)
    .sort((left, right) => (fallbackIndex.get(left) ?? 0) - (fallbackIndex.get(right) ?? 0));

  while (queue.length > 0) {
    const current = queue.shift() as string;
    ordered.push(current);

    Array.from(outgoing.get(current) ?? [])
      .sort((left, right) => (fallbackIndex.get(left) ?? 0) - (fallbackIndex.get(right) ?? 0))
      .forEach((child) => {
        const nextIncoming = (incomingCount.get(child) ?? 0) - 1;
        incomingCount.set(child, nextIncoming);
        if (nextIncoming === 0) {
          queue.push(child);
          queue.sort((left, right) => (fallbackIndex.get(left) ?? 0) - (fallbackIndex.get(right) ?? 0));
        }
      });
  }

  if (ordered.length === branches.length) {
    return ordered;
  }

  const orderedSet = new Set(ordered);
  return [
    ...ordered,
    ...fallbackOrder.filter((branch) => !orderedSet.has(branch))
  ];
}

/** Orders project branches using graph evidence first and naming conventions as fallback. */
export function groupedBranches(branches: string[], graph?: GraphResponse): string[] {
  const fallbackOrder = branches
    .filter((branch) => !isEnvironmentBranch(branch))
    .sort((left, right) => {
      const leftGroup = branchGroup(left);
      const rightGroup = branchGroup(right);

      if (leftGroup !== rightGroup) {
        return leftGroup.localeCompare(rightGroup);
      }

      const leftRank = projectEnvironmentRank(left);
      const rightRank = projectEnvironmentRank(right);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.localeCompare(right);
    });

  return branchRelationOrder(graph, fallbackOrder, fallbackOrder);
}

/** Orders standalone environment branches that are not scoped under a project prefix. */
export function environmentBranches(branches: string[]): string[] {
  return branches
    .filter(isEnvironmentBranch)
    .sort((left, right) => (
      (environmentBranchRank(left) ?? 0) - (environmentBranchRank(right) ?? 0)
    ));
}

/** Returns the branch sequence used by the horizontal layout mode. */
export function horizontalBranches(branches: string[], graph?: GraphResponse): string[] {
  return [
    ...groupedBranches(branches, graph),
    ...environmentBranches(branches)
  ];
}

function groupedBranchGroups(branches: string[], graph?: GraphResponse): string[] {
  return Array.from(new Set(groupedBranches(branches, graph).map(branchGroup)));
}

export function groupedBranchColumn(branch: string, branches: string[], graph?: GraphResponse): number {
  const grouped = groupedBranches(branches, graph);
  const group = branchGroup(branch);
  let offset = 0;

  for (const currentGroup of groupedBranchGroups(branches, graph)) {
    if (currentGroup === group) {
      return offset + Math.max(0, grouped.filter((current) => branchGroup(current) === group).indexOf(branch));
    }

    offset += grouped.filter((current) => branchGroup(current) === currentGroup).length;
  }

  return Math.max(0, grouped.indexOf(branch));
}

export function groupedBranchRow(branch: string, branches: string[], graph?: GraphResponse): number {
  return Math.max(0, groupedBranchGroups(branches, graph).indexOf(branchGroup(branch)));
}
