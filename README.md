# repoMap

Aplicacion web MVP para visualizar repositorios de GitHub como grafos interactivos de ramas, commits y relaciones de flujo. El objetivo es ofrecer una lectura visual tipo Git Flow/DevOps, sin base de datos y procesando la informacion en memoria desde la API REST de GitHub.

## Funcionalidades

- Consulta de repositorios publicos mediante URL de GitHub.
- Limite configurable de commits por rama, con valor inicial de `5`.
- Visualizacion interactiva de ramas, commits, relaciones asumidas y merges disponibles.
- Colores por rama, zoom, desplazamiento y arrastre de nodos.
- Cambio entre orientaciones del diagrama.
- Selector con buscador para mostrar u ocultar ramas sin reordenar el canvas.
- Seleccion multiple de ramas o commits con `Shift + clic`.
- Nombres largos de ramas con ajuste de linea automatico.
- Ramas de ambientes principales ordenadas en flujo: `development`/`dev`, `qa`, `staging`, `main`/`master`.
- Agrupacion visual de ramas de trabajo por prefijo anterior a `/`, por ejemplo `project_a/development` y `project_a/qa`.
- Repositorios con mas de 4 ramas inician con los commits colapsados.
- Doble clic sobre una rama para mostrar u ocultar sus ultimos commits.
- Boton global para mostrar u ocultar los commits de todas las ramas.
- Edicion visual de puntos de conexion y curvatura en relaciones entre ramas.

## Tecnologias

### Frontend

- React 19
- TypeScript
- Vite
- PrimeReact y PrimeIcons
- Cytoscape.js
- Axios

### Backend

- Python 3.12
- FastAPI
- Uvicorn
- HTTPX
- Pydantic
- python-dotenv

### Ejecucion

- Docker
- Docker Compose

## Arquitectura

```text
Usuario
  |
  v
React + Cytoscape.js (http://localhost:8080)
  |
  | POST /api/graph
  v
FastAPI (http://localhost:8000)
  |
  | GitHub REST API
  v
Ramas y commits transformados a nodes + edges
```

La aplicacion no utiliza base de datos ni Neo4j. El backend obtiene las ramas y los commits solicitados desde GitHub, genera el modelo de grafo y lo devuelve al frontend para renderizarlo con Cytoscape.js.

## Estructura Del Proyecto

```text
repoMap/
  backend/
    app/
      main.py                 # API FastAPI y configuracion CORS
      models.py               # Modelos de request y respuesta
      services/
        github.py             # Cliente de la API REST de GitHub
        graph_builder.py      # Transformacion de ramas/commits a grafo
    .env.example
    Dockerfile
    requirements.txt
  frontend/
    src/
      components/             # Formulario, canvas y controles visuales
      services/               # Consumo del backend
      types/                  # Tipos TypeScript del grafo
    Dockerfile
    package.json
    vite.config.ts
  docker-compose.yml
```

## Levantar Con Docker Compose

### Requisitos

- Docker Desktop instalado y ejecutandose.
- Git.

### 1. Configurar variables del backend

Crea el archivo local de variables a partir del ejemplo:

```bash
cp backend/.env.example backend/.env
```

Contenido esperado:

```env
GITHUB_TOKEN=
GITHUB_API_BASE_URL=https://api.github.com
FRONTEND_ORIGIN=http://localhost:8080
```

`GITHUB_TOKEN` es opcional para iniciar, pero es recomendado. Sin token, GitHub aplica un limite bajo de solicitudes anonimas y un repositorio con muchas ramas puede consumirlo rapidamente.

### 2. Construir y ejecutar los servicios

```bash
docker compose up --build
```

### 3. Abrir la aplicacion

| Servicio | URL |
| --- | --- |
| Frontend | [http://localhost:8080](http://localhost:8080) |
| Backend | [http://localhost:8000](http://localhost:8000) |
| Health check | [http://localhost:8000/health](http://localhost:8000/health) |
| Documentacion OpenAPI | [http://localhost:8000/docs](http://localhost:8000/docs) |

Para detener la aplicacion:

```bash
docker compose down
```

## Uso

1. Ingresa una URL de repositorio, por ejemplo `https://github.com/facebook/react`.
2. Indica la cantidad maxima de commits por rama.
3. Presiona **Graficar**.
4. Usa el selector **Ramas visibles** para filtrar el diagrama.
5. Usa el boton de orientacion para alternar la vista.
6. En repositorios grandes, haz doble clic sobre una rama o usa el boton de ojo para mostrar commits.
7. Manten presionada la tecla `Shift` mientras haces clic para seleccionar varios nodos.

## API Backend

### Health check

```http
GET /health
```

Respuesta:

```json
{
  "status": "ok"
}
```

### Generar grafo

```http
POST /api/graph
Content-Type: application/json
```

Body:

```json
{
  "repo_url": "https://github.com/facebook/react",
  "max_commits": 5
}
```

Respuesta simplificada:

```json
{
  "repository": "facebook/react",
  "nodes": [],
  "edges": []
}
```

Los `nodes` representan ramas y commits. Los `edges` representan conexiones rama-commit, padres de commits, merges y relaciones visuales entre ramas.

## Token De GitHub Y Limites

El token debe configurarse solo en `backend/.env`:

```env
GITHUB_TOKEN=tu_token_personal
```

Luego reinicia el backend:

```bash
docker compose restart backend
```

No subas `backend/.env` a Git. El archivo esta excluido mediante `.gitignore`; utiliza `backend/.env.example` como plantilla versionable.

## Estado Del MVP

El proyecto cubre la exploracion visual inicial de ramas y commits usando datos en tiempo real de GitHub. No incluye autenticacion de usuarios, persistencia de diagramas, cache de respuestas ni edicion del repositorio remoto.
