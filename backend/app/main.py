import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.models import GraphRequest, GraphResponse
from app.services.github import GitHubClient, GitHubClientError, parse_github_repo_url
from app.services.graph_builder import build_repository_graph

load_dotenv()

app = FastAPI(title="repoMap API", version="0.1.0")

frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:8080")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin, "http://127.0.0.1:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/graph", response_model=GraphResponse)
async def graph_repository(payload: GraphRequest) -> GraphResponse:
    try:
        repo = parse_github_repo_url(str(payload.repo_url))
        github = GitHubClient()
        return await build_repository_graph(github, repo, payload.max_commits)
    except GitHubClientError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
