# Agentic Property Search Demo

A 3-tier demo: **React** frontend, **Node.js** API (LangGraph + Vertex AI + Voyage AI), **MongoDB Atlas** (vector + geo search). Users chat in natural language to search properties (e.g. “2 bedroom near James Ruse Public School”); the agent asks for missing criteria and runs vector + filter search.

**Demo intent:** This project showcases the power of **lexical prefilters with vector search**—combining semantic understanding with precise filters (geo, bedrooms, etc.) in a single Atlas Search index. More on this capability: [Semantic Power, Lexical Precision: Advanced Filtering for Vector Search](https://www.mongodb.com/company/blog/product-release-announcements/semantic-power-lexical-precision-advanced-filtering-for-vector-search). The goal is to illustrate how a **unified data platform like MongoDB** can power an agentic AI search experience. This demo is **not intended for production-scale use**; it is for learning and evaluation only.

---

## Architecture and flow

How the frontend, API, agent (LangGraph), and RAG-style search interact:

```mermaid
flowchart LR
  subgraph FE [Frontend]
    React[React UI]
  end
  subgraph API [API]
    ChatRoute["POST /api/chat"]
    RunAgent[runAgent]
  end
  subgraph Agent [Agent]
    Graph[LangGraph]
    Vertex[Vertex AI]
    Tools[Tools]
  end
  subgraph RAG [Search and data]
    Embed[Voyage embed]
    Atlas["Atlas $search\n(vector + lexical prefilters)"]
    Rerank[Voyage rerank]
    Market[Market service]
    Mongo[(MongoDB)]
  end

  React -->|"sessionId, userId, message"| ChatRoute
  ChatRoute --> RunAgent
  RunAgent --> Graph
  Graph --> Vertex
  Vertex -->|"tool_calls"| Tools
  Tools -->|property_search| Embed
  Embed --> Atlas
  Atlas --> Rerank
  Tools -->|get_market_estimate| Market
  Market --> Mongo
  Atlas --> Mongo
  Rerank -->|top N properties| Tools
  Tools --> Graph
  Graph -->|reply, top10, pipeline| RunAgent
  RunAgent --> ChatRoute
  ChatRoute -->|JSON response| React
```

- **Frontend:** Sends user message to `POST /api/chat`; displays reply, tool badges, pipeline, and map.
- **API:** Loads thread and preferences, calls `runAgent`, appends to thread, returns reply and optional `top10` / `aggregationPipeline` / `marketEstimateQuery`.
- **Agent (LangGraph):** State graph: `agent` (Vertex AI with tools) → if tool_calls then `tools` (ToolNode) → back to `agent`; else `respond` → END. Tools: `property_search`, `get_market_estimate`.
- **RAG-style search:** For `property_search`: Voyage embeds the query → MongoDB Atlas `$search` (vector + lexical prefilters: geo, bedrooms, bathrooms, parking) → Voyage reranker → top N. Market data comes from MongoDB via the market service.

---

## Prerequisites

- **Node.js** 18+ and npm
- **MongoDB Atlas** cluster (free tier is fine). Atlas uses replica sets by default, so change streams (real-time new-listing notifications) work out of the box.
- **Voyage AI** API key (embeddings + reranker)
- **Google Cloud** project with Vertex AI enabled (for the chat model)
- **Google Maps JavaScript API** key (for the map in the frontend)

---

## Quick start (run from repo root)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd agentic-property-search
npm install
```

This installs root dependencies only. The first time you run `npm run dev` or `npm run build`, you may need to install backend and frontend dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

### 2. Environment variables

Create a `.env` file at the **project root** (or in `backend/`). The backend loads from both.

```bash
cp .env.example .env
```

Edit `.env` and set:

| Variable | Description |
|----------|-------------|
| `MONGODB_ATLAS_URI` | MongoDB Atlas connection string (e.g. `mongodb+srv://user:pass@cluster.mongodb.net/`) |
| `VOYAGE_API_KEY` | [Voyage AI](https://www.voyageai.com/) API key (embeddings + reranker) |
| `GOOGLE_CLOUD_PROJECT_ID` | Your GCP project ID (for Vertex AI) |
| `VERTEX_AI_LOCATION` | Region (e.g. `australia-southeast1`) |
| `PORT` | Optional; default `4000` (API port) |

Optional: `GOOGLE_IMPERSONATION_SERVICE_ACCOUNT` for Vertex AI when not using `gcloud auth application-default login`.

For the **frontend**, create `frontend/.env`:

```bash
cp frontend/.env.example frontend/.env
```

Set:

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend API URL (default `http://localhost:4000`) |
| `VITE_GOOGLE_MAPS_KEY` | Google Maps JavaScript API key for the map |

**Important:** Do not commit `.env` files; they are listed in `.gitignore`.

### 3. Seed data (do this before creating Atlas indexes)

You need to seed the database **before** creating the MongoDB Atlas search indexes, so that the `property_search` database and `properties` collection exist and have the expected structure (including `embedding`, `location`, `suburb`, etc.).

From the repo root:

```bash
cd backend
npm run inject:all
```

This loads POIs, market data, and sample properties (with embeddings). Other scripts (see `backend/package.json`): `inject:james-ruse`, `inject:carlingford`, `inject:pois`, `inject:market`, `inject:properties`, etc.

### 4. MongoDB Atlas indexes

Create these in your Atlas project (database `property_search`, collection `properties`). The collection should already exist from step 3.

1. **Vector + geo + filter index** (for chat and agent search):
   - In Atlas: **Search** → **Create Search Index** → **Atlas Search** (JSON Editor).
   - Index name: `property_search`. Use the definition in `backend/atlas-search-index-lexical.json`.
   - Mapping: `embedding` (vector, 1024 dimensions, cosine similarity), `location` (geo), `bedrooms`, `bathrooms`, `parking` (number). The app uses this index for vector search with lexical prefilters (geo + bedrooms/bathrooms/parking).

2. **Suburb autocomplete** (required for the location field):
   - Index name: `property_suburb_autocomplete`. Use `backend/atlas-search-index-property-suburb-autocomplete.json` (autocomplete on `suburb`, edgeGram, minGrams 2, maxGrams 15, foldDiacritics).

### 5. Run the app

**Production** (build then start backend and frontend):

```bash
npm run build
npm start
```

- API: http://localhost:4000  
- Frontend: http://localhost:4173  

For **local development** with hot reload, use `npm run dev` instead (API on 4000, frontend on 5173).

If the API uses a different port (e.g. 4003), either free port 4000 (`lsof -ti:4000 | xargs kill -9`) and restart, or set `VITE_API_URL=http://localhost:4003` in `frontend/.env` and rebuild the frontend.

---

## Project structure

```
agentic-property-search/
├── backend/          # Node.js API (Express, LangGraph, Vertex, Voyage, MongoDB)
├── frontend/          # React + Vite app (chat UI, map)
├── .env.example       # Backend env template (copy to .env)
├── package.json       # Root scripts: dev, build, start
└── README.md
```

- **Backend:** `backend/src/agent/graph.ts` (agent graph), `backend/src/agent/tools.ts` (search tools), `backend/src/services/search.ts` (vector + filter search).
- **Frontend:** `frontend/src/App.tsx`, `frontend/src/components/ChatPanel.tsx`, `frontend/src/components/Map.tsx`.

---

## Demo behaviour

- Default saved preferences: 2 bed, 2 bath, 1 parking, near Carlingford (5 km from centre).
- Sessions and threads are stored in MongoDB; after “logout” and “login” you can resume by selecting a session.
- The agent asks for bedroom count when missing, treats “2 bedroom” (or similar) as the answer and runs search; map shows results with valid coordinates.

---

## Change streams (optional)

The app uses **MongoDB Change Streams** to react to new property inserts. When a listing is added that matches a logged-in user's saved preferences (suburb, bedrooms, bathrooms, parking, price), the agent pushes a real-time message in the same session.

**How to run the demo:**

1. Start the app (`npm run build` then `npm start`) and open the frontend at http://localhost:4173 in your browser.
2. Click **Login as buyer** so you have an active session and the SSE connection is open.
3. In another terminal, from the project root run:
   ```bash
   npm run insert:one-carlingford --prefix backend
   ```
   This inserts one property in Carlingford (2 bed, 2 bath, 1 parking) matching the default preferences.
4. Watch the chat: the agent should nudge you with a message like *"Hey there's new property listed in your saved area based on bedrooms, bathrooms, parking and within the price that's set—thought you might have a look"*, and the new listing appears in the recommendations list.

Change streams require a replica set (MongoDB Atlas uses replica sets by default). If the backend cannot start the stream, it logs a warning and the rest of the app still runs.

---

## Pushing to GitHub

1. Ensure `.env` and `frontend/.env` are **not** tracked (they are in `.gitignore`).
2. Commit `.env.example` and `frontend/.env.example` (no secrets).
3. In the README, replace `<your-repo-url>` with your actual repo URL.
4. Optionally add a **License** file and a **Contributing** section if you want others to contribute.
