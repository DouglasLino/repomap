# repoMap

Aplicacion web MVP para visualizar repositorios de GitHub como grafos interactivos de ramas, commits y relaciones de flujo. El objetivo es ofrecer una lectura visual tipo Git Flow/DevOps, sin base de datos ni servidor backend: la aplicacion consulta la API REST de GitHub y procesa el grafo directamente en el navegador.

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
- Fetch API

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
  | Fetch API / GitHub REST API
  v
Ramas y commits transformados a nodes + edges
```

La aplicacion no utiliza base de datos ni Neo4j. Los servicios TypeScript obtienen las ramas y commits desde GitHub, generan el modelo de grafo y Cytoscape.js lo renderiza. Al ser una aplicacion estatica, puede publicarse posteriormente en GitHub Pages.

## Estructura Del Proyecto

```text
repoMap/
  frontend/
    src/
      components/             # Formulario, canvas y controles visuales
      services/
        github.ts             # Cliente browser de la API REST de GitHub
        graphBuilder.ts       # Transformacion de ramas/commits a grafo
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

### 1. Construir y ejecutar la aplicacion

```bash
docker compose up --build
```

### 2. Abrir la aplicacion

| Servicio | URL |
| --- | --- |
| Aplicacion web | [http://localhost:8080](http://localhost:8080) |

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

## GitHub API Y Limites

La aplicacion realiza consultas publicas desde el navegador del usuario:

- Una solicitud para listar las ramas del repositorio.
- Una solicitud adicional por cada rama para obtener sus commits visibles.

GitHub aplica limites bajos a solicitudes no autenticadas. Por seguridad, no se incluye un `GITHUB_TOKEN` en el frontend: cualquier token empaquetado en una aplicacion estatica o publicada en GitHub Pages seria visible para los visitantes.

Para una version futura con mayor limite de uso o repositorios privados, se debe incorporar autenticacion del usuario o desplegar nuevamente un servicio seguro que proteja el token.

## Estado Del MVP

El proyecto cubre la exploracion visual inicial de ramas y commits usando datos publicos en tiempo real de GitHub. No incluye autenticacion de usuarios, persistencia de diagramas, cache de respuestas ni edicion del repositorio remoto.
