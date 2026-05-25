import type { GraphEdge, GraphEdgeType, GraphNode, GraphResponse } from "../types/graph";
import {
  getBranches,
  getBranchCommits,
  parseGitHubRepoUrl,
  type GitHubBranch,
  type GitHubCommit
} from "./github";

function commitId(branchName: string, sha: string): string {
  return `commit:${branchName}:${sha}`;
}

function commitNode(commit: GitHubCommit, branchName: string): GraphNode {
  return {
    id: commitId(branchName, commit.sha),
    label: commit.sha.slice(0, 4),
    type: "commit",
    branch: branchName,
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

function addEdge(edges: Map<string, GraphEdge>, edge: GraphEdge): void {
  if (!edges.has(edge.id)) {
    edges.set(edge.id, edge);
  }
}

export async function buildRepositoryGraph(repoUrl: string, maxCommits: number): Promise<GraphResponse> {
  const repo = parseGitHubRepoUrl(repoUrl);
  const branches = (await getBranches(repo)).sort(compareBranches);
  if (branches.length === 0) {
    return { repository: repo.fullName, nodes: [], edges: [] };
  }

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const branchHeads = new Map<string, string>();
  const branchCommitShas = new Map<string, Set<string>>();
  const branchCommits = new Map<string, GitHubCommit[]>();
  const branchPositions = new Map<string, number>();

  for (const [branchIndex, branch] of branches.entries()) {
    const branchName = branch.name;
    branchPositions.set(branchName, branchIndex);
    const branchGraphNode = branchNode(branchName);
    nodes.set(branchGraphNode.id, branchGraphNode);

    const commits = await getBranchCommits(repo, branchName, maxCommits);
    branchCommits.set(branchName, commits);
    const commitShas = new Set(commits.map((commit) => commit.sha));
    branchCommitShas.set(branchName, commitShas);
    if (commits.length > 0) {
      branchHeads.set(branchName, commits[0].sha);
    }

    commits.forEach((commit, index) => {
      const id = commitId(branchName, commit.sha);
      nodes.set(id, commitNode(commit, branchName));

      if (index === 0) {
        addEdge(edges, {
          id: `branch-head:${branchName}:${commit.sha}`,
          source: `branch:${branchName}`,
          target: id,
          type: "branch_commit",
          branch: branchName
        });
      }

      (commit.parents ?? []).forEach((parent) => {
        if (!parent.sha || !commitShas.has(parent.sha)) {
          return;
        }
        const type: GraphEdgeType = (commit.parents?.length ?? 0) > 1 ? "merge" : "parent";
        addEdge(edges, {
          id: `${type}:${branchName}:${commit.sha}:${parent.sha}`,
          source: id,
          target: commitId(branchName, parent.sha),
          type,
          branch: branchName
        });
      });
    });
  }

  const representedMerges = new Set<string>();
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
            branchName !== destinationBranch && shas.has(mergedParent.sha as string)
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

  const parentBranch = Array.from(branchHeads.keys()).find((branch) => branch.toLowerCase() === "main")
    ?? Array.from(branchHeads.keys()).find((branch) => branch.toLowerCase() === "master");

  if (parentBranch) {
    const parentHead = branchHeads.get(parentBranch) as string;
    branchHeads.forEach((childHead, childBranch) => {
      if (childBranch === parentBranch) {
        return;
      }

      let type: GraphEdgeType = "branch_possible";
      if (isPrimaryEnvironmentBranch(childBranch)) {
        if (childHead === parentHead) {
          type = "branch_assumed";
        } else if (!branchCommitShas.get(childBranch)?.has(parentHead)) {
          return;
        }
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
