from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class GraphRequest(BaseModel):
    repo_url: HttpUrl
    max_commits: int = Field(default=5, ge=1, le=500)


class GraphNode(BaseModel):
    id: str
    label: str
    type: Literal["branch", "commit"]
    branch: str | None = None
    author: str | None = None
    date: str | None = None
    message: str | None = None
    url: str | None = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    type: Literal[
        "branch_commit",
        "parent",
        "merge",
        "pull_request_merge",
        "branch_assumed",
        "branch_possible",
    ]
    branch: str | None = None


class GraphResponse(BaseModel):
    repository: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
