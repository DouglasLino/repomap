import type { GraphEdge, GraphEdgeType, GraphNode, GraphResponse } from "../types/graph";
import {
  getBranches,
  getBranchCommits,
  parseGitHubRepoUrl,
  type RepositoryRef,
  type GitHubBranch,
  type GitHubCommit
} from "./github";
import { initialVisibleBranches } from "./branchSelection";

interface RepositoryGraphCache {
  repo: RepositoryRef;
  branches: GitHubBranch[];
  commitsByBranch: Map<string, GitHubCommit[]>;
  commitLimitsByBranch: Map<string, number>;
  relationshipCommitsByBranch: Map<string, GitHubCommit[]>;
  relationshipCommitLimitsByBranch: Map<string, number>;
  maxCommits: number;
}

const graphCaches = new Map<string, RepositoryGraphCache>();
const relationshipHistoryCommitLimit = 100;

function commitId(branchName: string, sha: string): string {
  return `commit:${branchName}:${sha}`;
}

function commitNode(commit: GitHubCommit, branchName: string, commitIndex: number): GraphNode {
  return {
    id: commitId(branchName, commit.sha),
    label: commit.sha.slice(0, 4),
    type: "commit",
    branch: branchName,
    sha: commit.sha,
    commitIndex,
    parentShas: (commit.parents ?? []).flatMap((parent) => parent.sha ? [parent.sha] : []),
    author: commit.commit?.author?.name ?? null,
    date: commit.commit?.author?.date ?? null,
    message: commit.commit?.message?.split("\n")[0] ?? "",
    url: commit.html_url ?? null
  };
}

function branchNode(branchName: string): GraphNode {
  return {
    id: `branch:${branchName}`,
    label: branchName,
    type: "branch",
    branch: branchName
  };
}

function branchPriority(branch: GitHubBranch): [number, string] {
  const name = branch.name.toLowerCase();
  if (["development", "develop", "dev"].includes(name)) {
    return [1, name];
  }
  if (name === "qa") {
    return [2, name];
  }
  if (["main", "master"].includes(name)) {
    return [3, name];
  }
  return [0, name];
}

function compareBranches(left: GitHubBranch, right: GitHubBranch): number {
  const [leftPriority, leftName] = branchPriority(left);
  const [rightPriority, rightName] = branchPriority(right);
  return leftPriority - rightPriority || leftName.localeCompare(rightName);
}

function isPrimaryEnvironmentBranch(branchName: string): boolean {
  return ["development", "develop", "dev", "qa"].includes(branchName.toLowerCase());
}

function branchProject(branchName: string): string {
  const separatorIndex = branchName.indexOf("/");
  return separatorIndex > 0 ? branchName.slice(0, separatorIndex).toLowerCase() : "";
}

function lastBranchSegment(branchName: string): string {
  return branchName.split("/").pop()?.toLowerCase() ?? branchName.toLowerCase();
}

function isBaseBranch(branchName: string): boolean {
  return [
    "main",
    "master",
    "development",
    "dev",
    "qa",
    "staging",
    "prod",
    "production"
  ].includes(lastBranchSegment(branchName));
}

function isChildBranch(branchName: string): boolean {
  return branchName
    .toLowerCase()
    .split("/")
    .some((segment) => ["feature", "bugfix", "hotfix", "release", "task", "fix"].includes(segment));
}

function mergeDestinationRank(branchName: string): number {
  if (isBaseBranch(branchName)) {
    return 0;
  }
  if (isChildBranch(branchName)) {
    return 2;
  }
  return 1;
}

function addEdge(edges: Map<string, GraphEdge>, edge: GraphEdge): void {
  if (!edges.has(edge.id)) {
    edges.set(edge.id, edge);
  }
}

function branchFromNode(node: GraphNode | undefined): string | null {
  return node?.branch ?? null;
}

function hasBranchEvidence(
  edges: Map<string, GraphEdge>,
  nodes: Map<string, GraphNode>,
  leftBranch: string,
  rightBranch: string
): boolean {
  return Array.from(edges.values()).some((edge) => {
    const sourceBranch = branchFromNode(nodes.get(edge.source));
    const targetBranch = branchFromNode(nodes.get(edge.target));
    return (
      (sourceBranch === leftBranch && targetBranch === rightBranch)
      || (sourceBranch === rightBranch && targetBranch === leftBranch)
    );
  });
}

function hasIncomingBranchInference(edges: Map<string, GraphEdge>, branchName: string): boolean {
  return Array.from(edges.values()).some((edge) => (
    edge.target === `branch:${branchName}`
    && (edge.type === "branch_possible" || edge.type === "branch_assumed")
  ));
}

function commitSetKey(commits: GitHubCommit[]): string | null {
  if (commits.length === 0) {
    return null;
  }

  return commits.map((commit) => commit.sha).sort().join("|");
}

function hasSharedHistory(
  parentBranch: string,
  childBranch: string,
  branchCommitShas: Map<string, Set<string>>
): boolean {
  const parentShas = branchCommitShas.get(parentBranch);
  const childShas = branchCommitShas.get(childBranch);
  if (!parentShas || !childShas) {
    return false;
  }

  return Array.from(parentShas).some((sha) => childShas.has(sha));
}

/** Chooses the branch that should own a merge commit when multiple visible branches contain it. */
function preferredMergeDestination(
  mergeSha: string,
  sourceBranch: string,
  branchCommitShas: Map<string, Set<string>>,
  branchCommitIndexes: Map<string, Map<string, number>>,
  branchPositions: Map<string, number>
): string | null {
  const sourceProject = branchProject(sourceBranch);
  const candidates = Array.from(branchCommitShas.entries())
    .filter(([branchName, shas]) => branchName !== sourceBranch && shas.has(mergeSha))
    .map(([branchName]) => branchName);

  return candidates
    .sort((left, right) => {
      const leftSameProject = branchProject(left) === sourceProject ? 0 : 1;
      const rightSameProject = branchProject(right) === sourceProject ? 0 : 1;
      return (
        leftSameProject - rightSameProject
        || mergeDestinationRank(left) - mergeDestinationRank(right)
        || (branchCommitIndexes.get(left)?.get(mergeSha) ?? Number.POSITIVE_INFINITY)
        - (branchCommitIndexes.get(right)?.get(mergeSha) ?? Number.POSITIVE_INFINITY)
        || (branchPositions.get(left) ?? 0) - (branchPositions.get(right) ?? 0)
        || left.localeCompare(right)
      );
    })[0] ?? null;
}

function graphCacheKey(repo: RepositoryRef): string {
  return repo.fullName.toLowerCase();
}

async function loadMissingBranchCommits(
  cache: RepositoryGraphCache,
  branchNames: string[]
): Promise<void> {
  const availableBranches = new Set(cache.branches.map((branch) => branch.name));
  const missingBranches = Array.from(new Set(branchNames))
    .filter((branchName) => {
      if (!availableBranches.has(branchName)) {
        return false;
      }

      const requestedLimit = cache.commitLimitsByBranch.get(branchName) ?? 0;
      const commits = cache.commitsByBranch.get(branchName) ?? [];
      return requestedLimit < cache.maxCommits && commits.length >= requestedLimit;
    });
  const missingRelationshipBranches = Array.from(new Set(branchNames))
    .filter((branchName) => {
      if (!availableBranches.has(branchName)) {
        return false;
      }

      const relationshipLimit = Math.max(cache.maxCommits, relationshipHistoryCommitLimit);
      const requestedLimit = cache.relationshipCommitLimitsByBranch.get(branchName) ?? 0;
      const commits = cache.relationshipCommitsByBranch.get(branchName) ?? [];
      return requestedLimit < relationshipLimit && commits.length >= requestedLimit;
    });

  await Promise.all([
    ...missingBranches.map(async (branchName) => {
      const commits = await getBranchCommits(cache.repo, branchName, cache.maxCommits);
      cache.commitsByBranch.set(branchName, commits);
      cache.commitLimitsByBranch.set(branchName, cache.maxCommits);
    }),
    ...missingRelationshipBranches.map(async (branchName) => {
      const relationshipLimit = Math.max(cache.maxCommits, relationshipHistoryCommitLimit);
      const commits = await getBranchCommits(
        cache.repo,
        branchName,
        relationshipLimit
      );
      cache.relationshipCommitsByBranch.set(branchName, commits);
      cache.relationshipCommitLimitsByBranch.set(branchName, relationshipLimit);
    })
  ]);
}

/** Builds graph nodes and direct Git/PR edges from the cached GitHub branch data. */
function graphFromCache(cache: RepositoryGraphCache): GraphResponse {
  const {
    repo,
    branches,
    commitsByBranch: cachedCommits,
    relationshipCommitsByBranch
  } = cache;
  if (branches.length === 0) {
    return { repository: repo.fullName, nodes: [], edges: [] };
  }

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const branchHeads = new Map<string, string>();
  const visibleBranchCommitShas = new Map<string, Set<string>>();
  const branchCommitShas = new Map<string, Set<string>>();
  const branchCommitIndexes = new Map<string, Map<string, number>>();
  const branchCommits = new Map<string, GitHubCommit[]>();
  const branchPositions = new Map<string, number>();

  for (const [branchIndex, branch] of branches.entries()) {
    const branchName = branch.name;
    branchPositions.set(branchName, branchIndex);
    const branchGraphNode = branchNode(branchName);
    nodes.set(branchGraphNode.id, branchGraphNode);

    const commits = (cachedCommits.get(branchName) ?? []).slice(0, cache.maxCommits);
    branchCommits.set(branchName, commits);
    const visibleCommitShas = new Set(commits.map((commit) => commit.sha));
    const visibleCommitIndexes = new Map(commits.map((commit, index) => [commit.sha, index]));
    const relationshipCommits = relationshipCommitsByBranch.get(branchName) ?? commits;
    const commitShas = new Set(relationshipCommits.map((commit) => commit.sha));
    const commitIndexes = new Map(relationshipCommits.map((commit, index) => [commit.sha, index]));
    visibleBranchCommitShas.set(branchName, visibleCommitShas);
    branchCommitShas.set(branchName, commitShas);
    branchCommitIndexes.set(branchName, commitIndexes);
    if (commits.length > 0) {
      branchHeads.set(branchName, commits[0].sha);
    }

    commits.forEach((commit, index) => {
      const id = commitId(branchName, commit.sha);
      nodes.set(id, commitNode(commit, branchName, index));

      if (index === 0) {
        addEdge(edges, {
          id: `branch-head:${branchName}:${commit.sha}`,
          source: `branch:${branchName}`,
          target: id,
          type: "branch_commit",
          branch: branchName
        });
      }

      const directParent = (commit.parents ?? [])
        .filter((parent): parent is { sha: string } => (
          Boolean(parent.sha)
          && visibleCommitShas.has(parent.sha as string)
          && (visibleCommitIndexes.get(parent.sha as string) ?? -1) > index
        ))
        .sort((left, right) => (
          (visibleCommitIndexes.get(left.sha) ?? Number.POSITIVE_INFINITY)
          - (visibleCommitIndexes.get(right.sha) ?? Number.POSITIVE_INFINITY)
        ))[0];

      const directParentIndex = directParent
        ? visibleCommitIndexes.get(directParent.sha) ?? Number.POSITIVE_INFINITY
        : Number.POSITIVE_INFINITY;
      const nextVisibleCommit = commits[index + 1];
      const visibleParentSha = directParentIndex === index + 1
        ? directParent?.sha
        : nextVisibleCommit?.sha;

      if (visibleParentSha) {
        const type: GraphEdgeType = directParentIndex === index + 1 && (commit.parents?.length ?? 0) > 1
          ? "merge"
          : "parent";
        addEdge(edges, {
          id: `${type}:${branchName}:${commit.sha}:${visibleParentSha}`,
          source: id,
          target: commitId(branchName, visibleParentSha),
          type,
          branch: branchName
        });
      }
    });
  }

  const representedMerges = new Set<string>();
  // Merge edges are created only from direct GitHub parent metadata, never from transitive ancestry.
  branchCommits.forEach((commits, destinationBranch) => {
    commits.forEach((mergeCommit) => {
      const parents = mergeCommit.parents ?? [];
      if (parents.length < 2 || representedMerges.has(mergeCommit.sha)) {
        return;
      }

      for (const mergedParent of parents.slice(1)) {
        if (!mergedParent.sha) {
          continue;
        }
        const sourceCandidates = Array.from(branchCommitShas.entries())
          .filter(([branchName, shas]) => (
            branchName !== destinationBranch
            && shas.has(mergedParent.sha as string)
            && (visibleBranchCommitShas.get(branchName)?.has(mergedParent.sha as string) ?? false)
            // A downstream branch may inherit both commits. It is not the direct merge source.
            && !shas.has(mergeCommit.sha)
          ))
          .map(([branchName]) => branchName);
        if (sourceCandidates.length === 0) {
          continue;
        }
        const destinationPosition = branchPositions.get(destinationBranch) ?? 0;
        const earlierCandidates = sourceCandidates.filter((branchName) => (
          (branchPositions.get(branchName) ?? 0) < destinationPosition
        ));
        const sourceBranch = (earlierCandidates.length > 0 ? earlierCandidates : sourceCandidates)
          .sort((left, right) => (
            (branchPositions.get(right) ?? 0) - (branchPositions.get(left) ?? 0)
          ))[0];
        if (preferredMergeDestination(
          mergeCommit.sha,
          sourceBranch,
          branchCommitShas,
          branchCommitIndexes,
          branchPositions
        ) !== destinationBranch) {
          continue;
        }

        addEdge(edges, {
          id: `pull-request-merge:${sourceBranch}:${destinationBranch}:${mergeCommit.sha}`,
          source: commitId(sourceBranch, mergedParent.sha),
          target: commitId(destinationBranch, mergeCommit.sha),
          type: "pull_request_merge",
          branch: sourceBranch
        });
        representedMerges.add(mergeCommit.sha);
        break;
      }
    });
  });

  const branchesByCommitSet = new Map<string, string[]>();
  branchCommits.forEach((commits, branchName) => {
    const key = commitSetKey(commits);
    if (!key) {
      return;
    }

    branchesByCommitSet.set(key, [...(branchesByCommitSet.get(key) ?? []), branchName]);
  });

  // Identical histories need a deterministic branch-level tie-breaker without changing commit edges.
  branchesByCommitSet.forEach((matchingBranches) => {
    if (matchingBranches.length < 2) {
      return;
    }

    const bases = matchingBranches.filter(isBaseBranch);
    if (bases.length === 0) {
      return;
    }

    matchingBranches
      .filter((branchName) => isChildBranch(branchName))
      .forEach((childBranch) => {
        const childProject = branchProject(childBranch);
        const parentBranch = bases.find((baseBranch) => (
          baseBranch !== childBranch
          && branchProject(baseBranch) === childProject
          && !hasBranchEvidence(edges, nodes, baseBranch, childBranch)
        ));

        if (!parentBranch) {
          return;
        }

        addEdge(edges, {
          id: `branch_possible:identical-history:${parentBranch}:${childBranch}`,
          source: `branch:${parentBranch}`,
          target: `branch:${childBranch}`,
          type: "branch_possible",
          branch: childBranch
        });
      });
  });

  const parentBranch = Array.from(branchHeads.keys()).find((branch) => branch.toLowerCase() === "main")
    ?? Array.from(branchHeads.keys()).find((branch) => branch.toLowerCase() === "master");

  if (parentBranch) {
    const parentHead = branchHeads.get(parentBranch) as string;
    branchHeads.forEach((childHead, childBranch) => {
      if (childBranch === parentBranch) {
        return;
      }
      if (hasIncomingBranchInference(edges, childBranch)) {
        return;
      }

      let type: GraphEdgeType = "branch_possible";
      const sharesParentHistory = hasSharedHistory(parentBranch, childBranch, branchCommitShas);
      if (isPrimaryEnvironmentBranch(childBranch)) {
        if (childHead === parentHead) {
          type = "branch_assumed";
        } else if (!sharesParentHistory) {
          return;
        }
      } else if (!sharesParentHistory) {
        return;
      }

      addEdge(edges, {
        id: `${type}:${parentBranch}:${childBranch}`,
        source: `branch:${parentBranch}`,
        target: `branch:${childBranch}`,
        type,
        branch: childBranch
      });
    });
  }

  return {
    repository: repo.fullName,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values())
  };
}

/** Loads the default branch set and returns the initial repository graph. */
export async function buildRepositoryGraph(repoUrl: string, maxCommits: number): Promise<GraphResponse> {
  const repo = parseGitHubRepoUrl(repoUrl);
  const branches = (await getBranches(repo)).sort(compareBranches);
  const key = graphCacheKey(repo);
  const previousCache = graphCaches.get(key);
  const cache: RepositoryGraphCache = {
    repo,
    branches,
    commitsByBranch: previousCache?.commitsByBranch ?? new Map(),
    commitLimitsByBranch: previousCache?.commitLimitsByBranch ?? new Map(),
    relationshipCommitsByBranch: previousCache?.relationshipCommitsByBranch ?? new Map(),
    relationshipCommitLimitsByBranch: previousCache?.relationshipCommitLimitsByBranch ?? new Map(),
    maxCommits
  };

  graphCaches.set(key, cache);
  const initialBranches = initialVisibleBranches(branches.map((branch) => branch.name));
  initialBranches.forEach((branchName) => cache.commitsByBranch.delete(branchName));
  initialBranches.forEach((branchName) => cache.commitLimitsByBranch.delete(branchName));
  initialBranches.forEach((branchName) => cache.relationshipCommitsByBranch.delete(branchName));
  initialBranches.forEach((branchName) => cache.relationshipCommitLimitsByBranch.delete(branchName));
  await loadMissingBranchCommits(cache, initialBranches);
  return graphFromCache(cache);
}

/** Loads additional branch histories into the existing repository graph cache. */
export async function loadRepositoryBranches(
  repoUrl: string,
  maxCommits: number,
  branchNames: string[]
): Promise<GraphResponse> {
  const repo = parseGitHubRepoUrl(repoUrl);
  const cache = graphCaches.get(graphCacheKey(repo));
  if (!cache) {
    return buildRepositoryGraph(repoUrl, maxCommits);
  }

  cache.maxCommits = maxCommits;
  await loadMissingBranchCommits(cache, branchNames);
  return graphFromCache(cache);
}

/** Refreshes the selected visible branches while preserving the graph cache contract. */
export async function refreshRepositoryBranches(
  repoUrl: string,
  maxCommits: number,
  branchNames: string[]
): Promise<GraphResponse> {
  const repo = parseGitHubRepoUrl(repoUrl);
  const branches = (await getBranches(repo)).sort(compareBranches);
  const key = graphCacheKey(repo);
  const previousCache = graphCaches.get(key);
  const cache: RepositoryGraphCache = {
    repo,
    branches,
    commitsByBranch: previousCache?.commitsByBranch ?? new Map(),
    commitLimitsByBranch: previousCache?.commitLimitsByBranch ?? new Map(),
    relationshipCommitsByBranch: previousCache?.relationshipCommitsByBranch ?? new Map(),
    relationshipCommitLimitsByBranch: previousCache?.relationshipCommitLimitsByBranch ?? new Map(),
    maxCommits
  };

  graphCaches.set(key, cache);
  branchNames.forEach((branchName) => cache.commitsByBranch.delete(branchName));
  branchNames.forEach((branchName) => cache.commitLimitsByBranch.delete(branchName));
  branchNames.forEach((branchName) => cache.relationshipCommitsByBranch.delete(branchName));
  branchNames.forEach((branchName) => cache.relationshipCommitLimitsByBranch.delete(branchName));
  await loadMissingBranchCommits(cache, branchNames);
  return graphFromCache(cache);
}
