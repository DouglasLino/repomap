import os
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx


class GitHubClientError(Exception):
    pass


@dataclass(frozen=True)
class RepositoryRef:
    owner: str
    repo: str

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.repo}"


def parse_github_repo_url(repo_url: str) -> RepositoryRef:
    parsed = urlparse(repo_url)
    host = parsed.netloc.lower()

    if host != "github.com":
        raise GitHubClientError("La URL debe pertenecer a github.com")

    parts = [part for part in parsed.path.strip("/").split("/") if part]
    if len(parts) < 2:
        raise GitHubClientError("La URL debe tener formato https://github.com/owner/repo")

    repo = parts[1].removesuffix(".git")
    return RepositoryRef(owner=parts[0], repo=repo)


class GitHubClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("GITHUB_API_BASE_URL", "https://api.github.com").rstrip("/")
        self.token = os.getenv("GITHUB_TOKEN")

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "repoMap-mvp",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    async def _get(self, path: str, params: dict[str, object] | None = None) -> object:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(headers=self._headers(), timeout=20) as client:
            response = await client.get(url, params=params)

        if response.status_code == 404:
            raise GitHubClientError("Repositorio no encontrado o privado sin token valido")
        if response.status_code == 403:
            raise GitHubClientError("GitHub rechazo la solicitud. Revisa rate limit o token")
        if response.is_error:
            raise GitHubClientError(f"GitHub respondio con status {response.status_code}")

        return response.json()

    async def get_branches(self, repo: RepositoryRef, limit: int = 100) -> list[dict]:
        data = await self._get(f"/repos/{repo.owner}/{repo.repo}/branches", {"per_page": limit})
        if not isinstance(data, list):
            raise GitHubClientError("Respuesta inesperada al consultar ramas")
        return data

    async def get_branch_commits(
        self,
        repo: RepositoryRef,
        branch_name: str,
        per_page: int,
    ) -> list[dict]:
        data = await self._get(
            f"/repos/{repo.owner}/{repo.repo}/commits",
            {"sha": branch_name, "per_page": per_page},
        )
        if not isinstance(data, list):
            raise GitHubClientError("Respuesta inesperada al consultar commits")
        return data
