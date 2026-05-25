# repoMap

Aplicacion web MVP para visualizar repositorios GitHub como un grafo interactivo estilo Git Flow.

## Stack

- Frontend: React, TypeScript, PrimeReact, Cytoscape.js, Axios
- Backend: FastAPI, httpx
- Persistencia: ninguna, todo se procesa en memoria

## Estructura

```text
repoMap/
  backend/
    app/
      main.py
      models.py
      services/
        github.py
        graph_builder.py
    requirements.txt
    .env.example
  frontend/
    src/
      components/
      services/
      types/
    package.json
    vite.config.ts
```

## Ejecutar backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Opcional: configura `GITHUB_TOKEN` en `backend/.env` para aumentar el limite de requests de GitHub.

## Ejecutar frontend

```bash
cd frontend
npm install
npm run dev
```

El frontend espera el backend en `http://localhost:8000`. Puedes cambiarlo con `VITE_API_BASE_URL`.

## Ejecutar con Docker Compose

```bash
docker compose up --build
```

Servicios:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:8000`
- Health check backend: `http://localhost:8000/health`

Si quieres usar token de GitHub, edita `backend/.env`:

```env
GITHUB_TOKEN=tu_token
```

## Endpoint principal

```http
POST /api/graph
```

Body:

```json
{
  "repo_url": "https://github.com/facebook/react",
  "max_commits": 5
}
```

`max_commits` define cuantos commits se muestran como maximo en cada rama.

Respuesta:

```json
{
  "repository": "facebook/react",
  "nodes": [],
  "edges": []
}
```
