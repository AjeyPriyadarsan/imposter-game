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
