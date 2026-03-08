# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend
```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload       # dev server on :8000
python3 -c "from main import app; print('OK')"  # quick import check
```

### Frontend
```bash
cd frontend
npm run dev      # dev server on :5173
npm run build    # production build (use to verify no compile errors)
```

## Architecture

### State Machine
The game flows through 4 states managed entirely in-memory on the backend: `lobby → playing → voting → results`. All clients receive the full room state after every action via WebSocket broadcast. There is no persistent storage.

### Backend (`backend/`)
- **`room_manager.py`** — all game logic lives here. `RoomManager` holds two dicts: `rooms` (game state) and `connections` (room_id → player_id → WebSocket). The `get_room_state()` method is player-aware — it hides the word from imposters and hides votes until results phase.
- **`main.py`** — thin FastAPI layer. Two REST endpoints (`POST /rooms`, `POST /rooms/{room_id}/join`) bootstrap the connection; everything after that is a single WebSocket at `/ws/{room_id}/{player_id}`. Incoming message types: `start_game`, `submit_clue`, `submit_vote`, `play_again`.
- **`word_list.py`** — flat list of words, randomly selected at game start.

### Frontend (`frontend/src/`)
- **`context/GameContext.jsx`** — single source of truth. Manages the WebSocket connection (`wsRef`), exposes `playerInfo` (local identity), `gameState` (latest server snapshot), and `sendMessage()`. HTTP calls for room create/join happen here too.
- **`App.jsx`** — renders the correct page by switching on `gameState.state`. No router library used.
- **`pages/`** — one file per game phase. Pages are purely presentational; they call `sendMessage()` to act and read `gameState` to render.

### Key Design Decisions
- Player identity is a random 8-char string generated server-side at join time, stored in React state (lost on page refresh — intentional for simplicity).
- Imposters are identified by player ID in `room["imposters"]` list; `get_room_state()` sets `is_imposter` and strips the word before sending.
- Clue order is shuffled once at game start and stored in `room["clue_order"]`; `current_turn` is an index into that list.
- 1 imposter for 3–5 players, 2 imposters for 6–8 players.
- CORS is wide open (`allow_origins=["*"]`) — fine for local play, lock down for production.

## Full Project Summary

### Stack
- **Backend:** FastAPI + Redis + WebSockets (Python)
- **Frontend:** React 18 + Vite (no router, no state library)
- **Storage:** Redis only — no SQL/NoSQL DB. Room data at `room:{room_id}`, JSON blob, 24h TTL.
- **Deploy targets:** Render (backend) + Vercel (frontend) + Upstash Redis

### REST Endpoints
- `POST /rooms` → `{room_id, player_id}` — create room
- `POST /rooms/{room_id}/join` → `{player_id}` — join room

### WebSocket `/ws/{room_id}/{player_id}`
- Incoming: `start_game`, `submit_clue`, `submit_vote`, `play_again`
- Outgoing: `state_update` (player-aware snapshot), `error`

### Frontend Files
| File | Role |
|------|------|
| `context/GameContext.jsx` | WS connection, HTTP calls, all shared state |
| `App.jsx` | Switch on `gameState.state` to render correct page |
| `pages/HomePage.jsx` | Create or join room |
| `pages/LobbyPage.jsx` | Player list, copy link, start game |
| `pages/GamePage.jsx` | Word/imposter reveal, clue input, clue list |
| `pages/VotingPage.jsx` | Vote UI, progress bar, clues review |
| `pages/ResultsPage.jsx` | Outcome banner, imposter reveal, vote tallies |

### Environment Variables
**Backend (`backend/.env`):**
```
REDIS_URL=redis://localhost:6380
CORS_ORIGINS=http://localhost:5173
```
**Frontend (`frontend/.env.local`):**
```
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

### Key Behaviors
- Imposters get a related but different word (e.g., `pizza` → `lasagna`)
- `get_room_state()` is player-aware: hides real word from imposters, hides votes until results
- Disconnected players are skipped in clue phase; voting requires only connected players
- Session saved to `localStorage` keyed by room ID for reconnect
- URL-based room code detection (`/ABCD` → auto-fills join form)
- Self-voting blocked server-side; single-word clue enforced client + server
- Host transfers automatically on disconnect in lobby
- WebSocket connections are in-memory only (not Redis) — single-process only
