from app.models import GraphEdge, GraphNode, GraphResponse
from app.services.github import GitHubClient, RepositoryRef


def _commit_label(sha: str) -> str:
    return sha[:4]


def _commit_id(branch_name: str, sha: str) -> str:
    return f"commit:{branch_name}:{sha}"


def _commit_node(commit: dict, branch_name: str) -> GraphNode:
    sha = commit["sha"]
    commit_data = commit.get("commit", {})
    author = commit_data.get("author") or {}
    message = (commit_data.get("message") or "").splitlines()[0]

    return GraphNode(
        id=_commit_id(branch_name, sha),
        label=_commit_label(sha),
        type="commit",
        branch=branch_name,
        author=author.get("name"),
        date=author.get("date"),
        message=message,
        url=commit.get("html_url"),
    )


def _branch_node(branch_name: str) -> GraphNode:
    return GraphNode(
        id=f"branch:{branch_name}",
        label=branch_name,
        type="branch",
        branch=branch_name,
    )

# Las ramas base quedan al final para que main sea el origen visual de las derivadas.
def _branch_sort_key(branch: dict) -> tuple[int, str]:
    name = branch["name"].lower()
    if name in {"development", "develop", "dev"}:
        return (1, name)
    if name == "qa":
        return (2, name)
    if name in {"main", "master"}:
        return (3, name)
    return (0, name)


def _is_primary_environment_branch(branch_name: str) -> bool:
    return branch_name.lower() in {"development", "develop", "dev", "qa"}


async def build_repository_graph(
    github: GitHubClient,
    repo: RepositoryRef,
    max_commits: int,
) -> GraphResponse:
    branches = sorted(await github.get_branches(repo), key=_branch_sort_key)
    if not branches:
        return GraphResponse(repository=repo.full_name, nodes=[], edges=[])

    nodes_by_id: dict[str, GraphNode] = {}
    edges_by_id: dict[str, GraphEdge] = {}
    branch_heads: dict[str, str] = {}
    branch_commit_shas: dict[str, set[str]] = {}
    branch_commits: dict[str, list[dict]] = {}
    branch_positions: dict[str, int] = {}

    for branch_index, branch in enumerate(branches):
        branch_name = branch["name"]
        branch_positions[branch_name] = branch_index
        branch_node = _branch_node(branch_name)
        nodes_by_id[branch_node.id] = branch_node

        commits = await github.get_branch_commits(repo, branch_name, max_commits)
        branch_commits[branch_name] = commits
        commit_shas = {commit["sha"] for commit in commits}
        branch_commit_shas[branch_name] = commit_shas
        if commits:
            branch_heads[branch_name] = commits[0]["sha"]

        for index, commit in enumerate(commits):
            sha = commit["sha"]
            commit_id = _commit_id(branch_name, sha)

            nodes_by_id[commit_id] = _commit_node(commit, branch_name)

            if index == 0:
                edge = GraphEdge(
                    id=f"branch-head:{branch_name}:{sha}",
                    source=f"branch:{branch_name}",
                    target=commit_id,
                    type="branch_commit",
                    branch=branch_name,
                )
                edges_by_id[edge.id] = edge

            for parent in commit.get("parents", []):
                parent_sha = parent.get("sha")
                if not parent_sha or parent_sha not in commit_shas:
                    continue
                parent_id = _commit_id(branch_name, parent_sha)

                edge_type = "merge" if len(commit.get("parents", [])) > 1 else "parent"
                edge = GraphEdge(
                    id=f"{edge_type}:{branch_name}:{sha}:{parent_sha}",
                    source=commit_id,
                    target=parent_id,
                    type=edge_type,
                    branch=branch_name,
                )
                edges_by_id.setdefault(edge.id, edge)

    represented_merges: set[str] = set()
    for destination_branch, commits in branch_commits.items():
        for merge_commit in commits:
            merge_sha = merge_commit["sha"]
            parents = merge_commit.get("parents", [])
            if len(parents) < 2 or merge_sha in represented_merges:
                continue

            for merged_parent in parents[1:]:
                merged_sha = merged_parent.get("sha")
                if not merged_sha:
                    continue

                source_candidates = [
                    branch_name
                    for branch_name, shas in branch_commit_shas.items()
                    if branch_name != destination_branch and merged_sha in shas
                ]
                if not source_candidates:
                    continue

                earlier_candidates = [
                    branch_name
                    for branch_name in source_candidates
                    if branch_positions[branch_name] < branch_positions[destination_branch]
                ]
                source_branch = max(
                    earlier_candidates or source_candidates,
                    key=lambda branch_name: branch_positions[branch_name],
                )
                edge = GraphEdge(
                    id=f"pull-request-merge:{source_branch}:{destination_branch}:{merge_sha}",
                    source=_commit_id(source_branch, merged_sha),
                    target=_commit_id(destination_branch, merge_sha),
                    type="pull_request_merge",
                    branch=source_branch,
                )
                edges_by_id[edge.id] = edge
                represented_merges.add(merge_sha)
                break

    parent_branch = next(
        (branch_name for branch_name in branch_heads if branch_name.lower() == "main"),
        next((branch_name for branch_name in branch_heads if branch_name.lower() == "master"), None),
    )

    if parent_branch:
        parent_head = branch_heads[parent_branch]
        for child_branch, child_head in branch_heads.items():
            if child_branch == parent_branch:
                continue

            if _is_primary_environment_branch(child_branch):
                if child_head == parent_head:
                    edge_type = "branch_assumed"
                elif parent_head in branch_commit_shas[child_branch]:
                    edge_type = "branch_possible"
                else:
                    continue
            else:
                edge_type = "branch_possible"

            edge = GraphEdge(
                id=f"{edge_type}:{parent_branch}:{child_branch}",
                source=f"branch:{parent_branch}",
                target=f"branch:{child_branch}",
                type=edge_type,
                branch=child_branch,
            )
            edges_by_id[edge.id] = edge

    return GraphResponse(
        repository=repo.full_name,
        nodes=list(nodes_by_id.values()),
        edges=list(edges_by_id.values()),
    )
