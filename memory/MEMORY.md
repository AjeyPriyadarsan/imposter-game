# Imposter Game — Project Memory

## Stack
- **Backend:** FastAPI + Redis + WebSockets (Python), runs on :8000
- **Frontend:** React 18 + Vite, runs on :5173. No router library, no state library.
- **Storage:** Redis only — no SQL/NoSQL DB. Key: `room:{room_id}`, JSON blob, 24h TTL.
- **Deploy targets:** Render (backend) + Vercel (frontend) + Upstash Redis

## Key Files
- `backend/main.py` — FastAPI app, 2 REST endpoints + 1 WebSocket
- `backend/room_manager.py` — all game logic, Redis I/O, broadcast
- `backend/word_list.py` — 85+ words + imposter word pairs (WORDS, WORD_PAIRS)
- `frontend/src/context/GameContext.jsx` — WS + HTTP, shared state (playerInfo, gameState, error)
- `frontend/src/App.jsx` — switches on `gameState.state` to render correct page
- `frontend/src/pages/` — HomePage, LobbyPage, GamePage, VotingPage, ResultsPage

## Game Flow
`lobby → playing → voting → results`

- 1 imposter for 3–5 players, 2 for 6–8
- Imposters get a related but different word (e.g., pizza → lasagna)
- Clue order shuffled once at game start; `current_turn` is index into `clue_order`
- `get_room_state()` is player-aware: strips real word from imposters, hides votes until results

## API
- `POST /rooms` → `{room_id, player_id}`
- `POST /rooms/{room_id}/join` → `{player_id}`
- WS `/ws/{room_id}/{player_id}`
  - In: `start_game`, `submit_clue`, `submit_vote`, `play_again`
  - Out: `state_update`, `error`

## Environment Variables
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

## Notable Behaviors
- Session saved to `localStorage` keyed by room ID for reconnect on refresh
- URL-based room code detection: visiting `/ABCD` auto-fills join form
- Disconnected players skipped in clue phase; voting requires only connected players
- Self-voting blocked server-side; single-word clue enforced client + server
- Host transfers to next player on disconnect in lobby
- WS connections stored in-memory (not Redis) — single-process only
- CORS configurable via env var `CORS_ORIGINS`
