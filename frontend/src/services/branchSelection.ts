export const maxInitialBranches = 5;

function initialBranchPriority(branch: string): number {
  const name = branch.toLowerCase();
  if (/^(main|master)([-_].*)?$/.test(name)) {
    return 0;
  }
  if (/^(development|develop|dev)([-_].*)?$/.test(name)) {
    return 1;
  }
  if (/^(qa|quality[-_]?assurance|test|testing)([-_].*)?$/.test(name)) {
    return 2;
  }
  if (/^(staging|stage)([-_].*)?$/.test(name)) {
    return 3;
  }
  if (/^(production|prod)([-_].*)?$/.test(name)) {
    return 4;
  }
  return 5;
}

export function initialVisibleBranches(branches: string[]): string[] {
  return branches
    .map((branch, index) => ({ branch, index }))
    .sort((left, right) => (
      initialBranchPriority(left.branch) - initialBranchPriority(right.branch)
      || left.index - right.index
    ))
    .slice(0, maxInitialBranches)
    .map(({ branch }) => branch);
}
