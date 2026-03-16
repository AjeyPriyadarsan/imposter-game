# Word Imposter — Full Project Documentation

A real-time multiplayer word guessing game where some players are **imposters** trying to blend in with the innocent players who all share the same secret word.

---

## Table of Contents

1. [What is this game?](#1-what-is-this-game)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [How the Game Works — Full Flow with Examples](#4-how-the-game-works--full-flow-with-examples)
   - [Step 1: Creating a Room](#step-1-creating-a-room)
   - [Step 2: Joining a Room](#step-2-joining-a-room)
   - [Step 3: The Lobby](#step-3-the-lobby)
   - [Step 4: Starting the Game](#step-4-starting-the-game)
   - [Step 5: Playing Phase — Giving Clues](#step-5-playing-phase--giving-clues)
   - [Step 6: Voting Phase](#step-6-voting-phase)
   - [Step 7: Round End](#step-7-round-end)
   - [Step 8: Results](#step-8-results)
   - [Step 9: Play Again or Leave](#step-9-play-again-or-leave)
5. [State Machine — How the Game Moves Forward](#5-state-machine--how-the-game-moves-forward)
6. [Redis — How Data is Stored](#6-redis--how-data-is-stored)
7. [WebSocket vs REST — Why Both?](#7-websocket-vs-rest--why-both)
8. [How the Frontend Works](#8-how-the-frontend-works)
9. [Timers — Auto-Skip and Auto-End](#9-timers--auto-skip-and-auto-end)
10. [Win Conditions — All Ways the Game Can End](#10-win-conditions--all-ways-the-game-can-end)
11. [Edge Cases Handled](#11-edge-cases-handled)
12. [Game Settings Explained](#12-game-settings-explained)
13. [Running Locally](#13-running-locally)
14. [Environment Variables](#14-environment-variables)
15. [Deployment](#15-deployment)

---

## 1. What is this game?

**Word Imposter** is a social deduction game for 3–20 players.

- All **innocent** players receive the same secret word (e.g., `"pizza"`).
- **Imposter** players receive a **different but related** word (e.g., `"lasagna"`).
- Players take turns giving a **one-word clue** about their word.
- After all clues are given, everyone **votes** on who they think the imposter is.
- If the imposter gets voted out → **Innocents win**.
- If the vote is tied, skipped, or the wrong person is eliminated → **Imposter wins**.
- The imposter can also win instantly by **guessing the innocent word** during their clue turn.

**Example with 4 players:**
```
Secret word  → "pizza"
Imposter word → "lasagna"

Ajey   (innocent)  → clue: "cheesy"
Priya  (innocent)  → clue: "round"
Bob    (innocent)  → clue: "slice"
Raj    (imposter)  → clue: "baked"   ← sounds right, but "baked" fits lasagna too!

Everyone votes... Raj gets 3 votes → eliminated → Innocents win!
```

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI |
| Real-time communication | WebSockets (built into FastAPI) |
| Database | Redis (key-value store, no SQL) |
| Frontend | React 18, Vite |
| Deployment | Render (backend) + Vercel (frontend) + Upstash (Redis) |

---

## 3. Project Structure

```
imposter-game/
├── backend/
│   ├── main.py           ← FastAPI app: REST endpoints + WebSocket handler
│   ├── room_manager.py   ← All game logic: create room, start game, clues, votes, etc.
│   ├── word_list.py      ← List of words + imposter word pairs
│   └── .env              ← REDIS_URL, CORS_ORIGINS
│
└── frontend/
    └── src/
        ├── App.jsx                    ← Renders the right page based on game state
        ├── context/GameContext.jsx    ← WebSocket connection + all shared state
        └── pages/
            ├── HomePage.jsx      ← Create or join room
            ├── LobbyPage.jsx     ← Player list, settings, start game
            ├── GamePage.jsx      ← Word reveal + clue submission
            ├── VotingPage.jsx    ← Vote for the imposter
            ├── RoundEndPage.jsx  ← Show round result, prepare next round
            └── ResultsPage.jsx   ← Final outcome: win/lose + vote breakdown
```

---

## 4. How the Game Works — Full Flow with Examples

---

### Step 1: Creating a Room

**What the user does:** Opens the app, types their name, clicks "Create Room".

**What happens behind the scenes:**

1. Frontend calls `POST /rooms` with `{ player_name: "Ajey" }`.
2. Backend generates:
   - A 4-digit **room ID** (e.g., `"1234"`).
   - A random 8-character **player ID** (e.g., `"ab3xk9mz"`) for the creator.
3. Backend creates a fresh room object and saves it to Redis under the key `room:1234`.
4. Backend returns `{ room_id: "1234", player_id: "ab3xk9mz" }` to the frontend.
5. Frontend saves this to `localStorage` (for reconnect later), updates the browser URL to `/1234`, and opens a WebSocket connection to `ws://backend/ws/1234/ab3xk9mz`.
6. The creator is now the **host** of the room.

```
Browser URL: http://yourapp.com/1234
localStorage: { "session:1234": { player_id: "ab3xk9mz", name: "Ajey" } }
Redis key:    room:1234  →  { id: "1234", host: "ab3xk9mz", state: "lobby", players: {...}, ... }
```

---

### Step 2: Joining a Room

**What the user does:** Another person visits the app or opens the share link `http://yourapp.com/1234`, types their name, clicks "Join Room".

**What happens:**

1. If they opened the direct link `/1234`, the app auto-fills the room code.
2. Frontend calls `POST /rooms/1234/join` with `{ player_name: "Priya" }`.
3. Backend generates a new player ID (e.g., `"zy7w2qle"`) and adds this player to the room in Redis.
4. Backend returns `{ player_id: "zy7w2qle" }`.
5. Frontend opens a WebSocket to `ws://backend/ws/1234/zy7w2qle`.
6. Backend broadcasts updated room state to **all connected players** — so Ajey immediately sees Priya appear in the lobby.

**Reconnect logic:** If someone refreshes the page, the frontend checks `localStorage` for a saved session. If found, it tries to reconnect with the same `player_id` without calling the join REST API again.

---

### Step 3: The Lobby

Everyone waits here until the host starts the game.

**What's visible:**
- List of all players currently connected.
- Room code that can be copied and shared.
- Game settings (only the host can change them).
- Idle timer — room auto-closes after 20 minutes of no activity.

**Settings the host can configure:**

| Setting | Options | What it does |
|---------|---------|--------------|
| Max Players | 3–20 | Caps how many people can join |
| Imposters | 1 to max | How many imposters in the game |
| Think Time | 10s–60s | How long each player has to give a clue before auto-skip |
| Vote Time | 30s–120s | How long the voting phase lasts before auto-end |
| Rounds | 1–6 | How many voting rounds before a final result |
| Discreet Mode | On/Off | Hides word/role on screen (for in-person play on shared devices) |
| Word Similarity | Similar / Somewhat / Random | How close the imposter's word is to the real word |
| Anonymous Role | On/Off | Players don't know if they're imposter until revealed |
| Anonymous Voter | On/Off | Votes are counted but who-voted-for-whom is hidden until end |

**Every setting change** is sent via WebSocket to the server, saved in Redis, and instantly broadcast back to all players so everyone sees the change live.

---

### Step 4: Starting the Game

**What the host does:** Clicks "Start Game" (need at least 3 players).

**What happens:**

1. Frontend sends `{ type: "start_game" }` via WebSocket.
2. Backend picks a **random word** from the word list (e.g., `"pizza"`).
3. Backend finds the matching **imposter word** based on the similarity setting (e.g., `"lasagna"` for "similar").
4. Backend randomly picks imposter players (e.g., 1 out of 4 players).
5. Backend shuffles the player order — this becomes `clue_order` (the turn order).
6. Room state changes to `"playing"` and all these values are saved to Redis.
7. Backend broadcasts the updated state to all players. But **each player gets a different view**:
   - Innocent players see: `word: "pizza"`, `is_imposter: false`
   - Imposter players see: `word: "lasagna"`, `is_imposter: true`

```
Redis after start:
{
  "state": "playing",
  "word": "pizza",
  "imposter_word": "lasagna",
  "imposters": ["zy7w2qle"],         ← Priya is the imposter
  "clue_order": ["mn4j...", "ab3x...", "zy7w...", "kp9r..."],
  "current_turn": 0,
  ...
}
```

---

### Step 5: Playing Phase — Giving Clues

Players give clues **one at a time** in the order defined by `clue_order`. The current player's turn is tracked by `current_turn` (an index into the array).

**Example turn sequence:**
```
Turn 0 → Meera gives clue: "cheesy"
Turn 1 → Ajey gives clue:  "round"
Turn 2 → Priya (imposter) gives clue: "baked"   ← blending in
Turn 3 → Bob gives clue:   "slice"
→ All clues done → state moves to "voting"
```

**What happens when a player submits a clue:**

1. Frontend sends `{ type: "submit_clue", clue: "cheesy" }` via WebSocket.
2. Backend validates:
   - Is it this player's turn? (`clue_order[current_turn] == player_id`)
   - Is it a single word? (no spaces)
   - Does an innocent's clue contain the secret word? → **Rejected** with error.
3. If valid: `players["ab3x..."]["clue"] = "cheesy"` is saved, `current_turn` increments.
4. Broadcast to all — everyone sees the new clue appear live.

**Special case — Imposter guesses the word:**
If an imposter submits the **exact innocent word** as their clue, the game ends immediately with **imposter win** (`outcome: "imposter_guessed"`).

**Special case — Innocent reveals the word:**
If an innocent accidentally types the exact secret word, they are marked `revealed: true` and removed from voting. Their clue shows as "Typed the word!" to everyone.

**Auto-skip timer:** Each player has `thinking_time` seconds (e.g., 30s). If the timer runs out, their turn is skipped and their clue is saved as `"(skipped)"`. The timer is an in-memory asyncio task — it is **not** stored in Redis.

---

### Step 6: Voting Phase

After all clues are given, `state` changes to `"voting"`.

**What players see:**
- All clues from this round for review.
- A list of all players to vote on.
- Progress bar showing how many people have voted.
- Countdown timer.

**What a player does:** Taps on a player's name to vote for them (or clicks "Skip Vote").

**What happens when a vote is submitted:**

1. Frontend sends `{ type: "submit_vote", voted_id: "zy7w2qle" }`.
2. Backend saves `players["ab3x..."]["vote"] = "zy7w2qle"` to Redis.
3. Backend checks if **all eligible players** have now voted.
4. If all voted → votes are tallied immediately (no need to wait for the timer).
5. If not everyone has voted yet → wait. The state is saved and broadcast so others can see the "Voted" badge appear.

**How votes are counted (in `_resolve_voting`):**

```python
# Count how many votes each player received
vote_counts = { "zy7w2qle": 3, "ab3x...": 1 }

# Skip votes + players who never voted = skip_count
skip_count = 1

# The player with the most votes is eliminated — unless:
# - It's a tie (two players tied for most votes)
# - Skip count >= max votes (skip wins)
```

**Results saved to Redis:**
```json
"last_vote_counts": { "zy7w2qle": 3, "ab3xk9mz": 1 },
"last_most_voted_ids": ["zy7w2qle"],
"last_eliminated_id": "zy7w2qle",
"last_skip_count": 0,
"last_skip_won": false
```

**Auto-end timer:** If the `voting_time` expires before everyone votes, the backend force-ends voting with whoever has voted so far. Disconnected players are excluded from "eligible voters" and do not block vote completion.

---

### Step 7: Round End

After voting resolves and the game is **not** over yet (multi-round game), `state` changes to `"round_end"`.

**What everyone sees:**
- Who got eliminated and how many votes they received.
- Whether the eliminated player was an imposter or innocent (unless anonymous role is on).
- Vote tally: who voted for whom.
- Countdown to next round (60 seconds) or a "Start Next Round" button for the host.

**What changes for the next round:**
- Eliminated and revealed players are **excluded** from the next round's clue order.
- All clues and votes are reset to `null` for remaining players.
- `current_round` increments.
- The same word and the same imposters carry over — the mystery continues.

---

### Step 8: Results

When the game is truly over (someone wins or all rounds are done), `state` changes to `"results"`.

**What everyone sees:**
- Win/loss banner ("Imposter Caught!", "Imposter Escaped!", "Imposter Guessed the Word!", "It's a Tie!")
- Whether **you personally** won or lost.
- Who the imposters were.
- The innocent word and the imposter word revealed side-by-side.
- All players and their clues.
- Full vote breakdown — who voted for whom.

**Auto-return to lobby:** After 300 seconds (5 minutes), the backend automatically resets the room back to `"lobby"` state.

---

### Step 9: Play Again or Leave

**Host clicks "Start New Match Now":**
- Frontend sends `{ type: "play_again" }`.
- Backend resets: word, imposters, clues, votes, round info all cleared.
- State returns to `"lobby"`.
- Kicked/left players are permanently removed.
- Everyone else is back in the lobby with their same names.

**Any player clicks "Leave Room":**
- Frontend sends `{ type: "leave_game" }`.
- In lobby → player is deleted from the room entirely.
- Mid-game → player is marked `left: true` and `connected: false`. Their slot stays in the game data so vote history is preserved, but they can no longer participate.

---

## 5. State Machine — How the Game Moves Forward

The room's `state` field drives everything. Here is every possible transition:

```
                   ┌─────────────────────────────────────────────────┐
                   │                                                 │
                   ▼                                                 │
              ┌─────────┐                                           │
              │  lobby  │ ◄─── play_again / end_match / auto-reset  │
              └────┬────┘                                           │
                   │  host sends start_game (≥3 players)            │
                   ▼                                                 │
            ┌──────────┐                                            │
            │  playing │  ← each player submits clue                │
            └─────┬────┘    (or timer auto-skips)                   │
                  │  all clues submitted                             │
                  │  OR imposter guesses word ──────────────────────►│
                  ▼                                                   │
            ┌──────────┐                                            │
            │  voting  │  ← each player votes                       │
            └─────┬────┘    (or timer auto-ends)                    │
                  │                                                  │
         ┌────────┴────────┐                                        │
         │                 │                                        │
         ▼                 ▼                                        │
   ┌───────────┐     ┌─────────┐                                    │
   │ round_end │     │ results │ ──────────────────────────────────►┘
   └─────┬─────┘     └─────────┘
         │  next round starts
         └──► playing  (same word, same imposters, fewer players)
```

---

## 6. Redis — How Data is Stored

Redis is a key-value store — think of it as a giant dictionary. There is **no table, no SQL, no rows and columns**.

**Key format:** `room:{room_id}`
**Value:** The entire room state as a **JSON string**.
**Expiry:** 24 hours (86400 seconds) — after that Redis automatically deletes the room.

### Complete Redis JSON Structure

```json
{
  "id": "1234",
  "host": "ab3xk9mz",
  "state": "playing",
  "word": "pizza",
  "imposter_word": "lasagna",
  "imposters": ["zy7w2qle"],
  "clue_order": ["mn4j1abc", "ab3xk9mz", "zy7w2qle", "kp9r5def"],
  "current_turn": 2,
  "outcome": null,
  "win_reason": null,
  "current_round": 1,
  "total_rounds": 2,
  "turn_start_time": 1710000030.5,
  "phase_start_time": null,
  "idle_expires_at": null,
  "created_at": 1710000000.0,
  "host_ended": false,

  "last_vote_counts": {},
  "last_most_voted_ids": [],
  "last_eliminated_id": null,
  "last_skip_count": 0,
  "last_skip_won": false,

  "settings": {
    "num_imposters": 1,
    "thinking_time": 30,
    "voting_time": 60,
    "num_rounds": 2,
    "discreet_mode": false,
    "word_similarity": "similar",
    "max_players": 10,
    "anonymous_role": false,
    "anonymous_voter": false
  },

  "players": {
    "ab3xk9mz": {
      "id": "ab3xk9mz",
      "name": "Ajey",
      "clue": "cheesy",
      "vote": null,
      "connected": true,
      "revealed": false,
      "eliminated": false,
      "kicked": false,
      "left": false,
      "word_revealer": false
    },
    "zy7w2qle": {
      "id": "zy7w2qle",
      "name": "Priya",
      "clue": null,
      "vote": null,
      "connected": true,
      "revealed": false,
      "eliminated": false,
      "kicked": false,
      "left": false,
      "word_revealer": false
    }
  }
}
```

### Every Write to Redis

The pattern is always the same. Every action:
1. `redis.get("room:1234")` → parse JSON → Python dict
2. Modify the dict
3. `redis.setex("room:1234", 86400, json.dumps(dict))` → write back

| Action | What changes in Redis |
|--------|----------------------|
| Player joins | New entry added inside `players` dict |
| Host changes settings | `settings` object updated |
| Game starts | `word`, `imposter_word`, `imposters`, `clue_order`, `state = "playing"` set |
| Player submits clue | `players[id]["clue"] = "word"`, `current_turn += 1` |
| Player votes | `players[id]["vote"] = "target_id"` |
| All votes counted | `last_vote_counts`, `last_eliminated_id`, `state` updated |
| Player disconnects (mid-game) | `players[id]["connected"] = false` |
| Player leaves mid-game | `players[id]["left"] = true` |
| Player kicked mid-game | `players[id]["kicked"] = true` |
| Game ends | `state = "results"`, `outcome` and `win_reason` set |
| Play again | Everything reset, `state = "lobby"` |

### What is NOT stored in Redis

| Thing | Where it lives |
|-------|----------------|
| WebSocket connections | In-memory Python dict (`manager.connections`) |
| Countdown timers | In-memory asyncio tasks (`_timers` dict) |
| Player identity on the browser | Browser's `localStorage` and React state |

> **Important:** Since WebSocket connections and timers are in-memory, if the server restarts, all live connections are lost. Players would need to refresh and reconnect. Room data is safe in Redis.

---

## 7. WebSocket vs REST — Why Both?

### REST (HTTP) — Used for one-time setup only

```
POST /rooms              → Create a room, get room_id + player_id
POST /rooms/1234/join    → Join a room, get player_id
GET  /health             → Health check
```

REST is used here because these are **one-shot requests** that happen before the game. They return information the frontend needs to then open a WebSocket.

### WebSocket — Used for everything real-time

After joining via REST, the frontend opens a **persistent two-way connection**:

```
ws://backend/ws/{room_id}/{player_id}
```

From this point on, all communication is through the WebSocket:

**Client → Server (messages the frontend sends):**

| Message type | When | Payload |
|-------------|------|---------|
| `start_game` | Host clicks Start | — |
| `update_settings` | Host changes a setting | `{ settings: {...} }` |
| `submit_clue` | Player submits their clue | `{ clue: "word" }` |
| `submit_vote` | Player votes | `{ voted_id: "player_id" or "skip" }` |
| `next_round` | Host starts next round | — |
| `play_again` | Host starts new match | — |
| `end_match` | Host ends match early | — |
| `kick_player` | Host kicks someone | `{ target_id: "player_id" }` |
| `leave_game` | Player leaves | — |
| `ping` | Keep-alive (every 25s) | — |

**Server → Client (messages the backend sends):**

| Message type | When | What it contains |
|-------------|------|-----------------|
| `state_update` | After every action | Full room state (personalized per player) |
| `error` | Invalid action | `{ message: "error text" }` |
| `kicked` | You were kicked | — |
| `room_closed` | Room deleted (idle timeout / admin) | `{ message: "..." }` |
| `pong` | Response to ping | — |
| `left` | You sent leave_game | — |

### Why not use REST for everything?

Because REST is **request-response** — one person asks, one person gets the answer. In a multiplayer game, when Ajey submits a clue, **all 4 players** need to instantly see it. With REST that would require every browser to constantly poll the server ("anything new?") every second. WebSocket is a persistent open connection — the server can push updates to everyone at any moment.

---

## 8. How the Frontend Works

### GameContext — The Brain

`context/GameContext.jsx` is the single source of truth for the frontend. It manages:

- **`playerInfo`** — Who am I? `{ id, name, roomId }`
- **`gameState`** — The latest snapshot received from the server. Everything the UI renders comes from here.
- **`wsRef`** — The WebSocket connection reference.
- **`sendMessage(msg)`** — Sends a JSON message over the WebSocket.
- **`createRoom(name)`** — Calls `POST /rooms` then opens WebSocket.
- **`joinRoom(roomId, name)`** — Calls `POST /rooms/{id}/join` then opens WebSocket.
- **`leaveRoom()`** — Sends `leave_game` and clears local state.

### App.jsx — The Router

There is no React Router. Instead, `App.jsx` looks at `gameState.state` and renders the correct page:

```jsx
switch (gameState.state) {
  case "lobby"     → <LobbyPage />
  case "playing"   → <GamePage />
  case "voting"    → <VotingPage />
  case "round_end" → <RoundEndPage />
  case "results"   → <ResultsPage />
}
```

If `playerInfo` is null (not joined), it shows `<HomePage />`.

### Pages — Purely Presentational

Each page only does two things:
1. **Read** from `gameState` to decide what to display.
2. **Call** `sendMessage()` to take actions.

Pages never call REST APIs directly (except `GameContext` does during create/join).

### How player-specific data works

The server sends a **different** `state_update` to each player in the same room. So:

- **Ajey** gets: `{ word: "pizza", is_imposter: false, fellow_imposters: [] }`
- **Priya (imposter)** gets: `{ word: "lasagna", is_imposter: true, fellow_imposters: [] }`

During voting, you can see your own vote, but other players only show `"voted"` (not who they voted for):
```json
// Priya sees in her state_update (she voted for Bob):
{ "id": "priya_id", "vote": "bob_id" }       ← her own vote revealed

// Ajey sees in his state_update:
{ "id": "priya_id", "vote": "voted" }         ← just knows she voted
```

### Session and Reconnect

- On `createRoom` / `joinRoom` success, `player_id` and `name` are saved to `localStorage` under `session:{room_id}`.
- If you refresh the page or navigate to `/1234` directly, the app reads `localStorage` and tries to reconnect via WebSocket with the same `player_id`.
- If the WebSocket drops mid-game, it tries to reconnect up to 5 times (at 3s, 5s, 8s, 12s, 15s intervals).
- If in lobby and connection drops → session is cleared, user returns to home screen.

---

## 9. Timers — Auto-Skip and Auto-End

All timers are **in-memory asyncio tasks** — they are never stored in Redis. This means:
- If the server restarts, timers are lost. Games in progress would need the host to restart.
- Only one server process should run (timers are process-local).

### Thinking Timer (per-turn)

Starts when a turn begins. If `thinking_time` seconds pass without the current player submitting a clue:
- Their clue is saved as `"(skipped)"`.
- `current_turn` advances.
- If all turns are done, state moves to `"voting"`.

### Voting Timer

Starts when `state` becomes `"voting"`. If `voting_time` seconds pass without everyone voting:
- Votes are tallied with whatever has been submitted so far.
- Players who didn't vote are treated as not having voted (count toward `skip_count`).

### Round End Timer (multi-round only)

After `round_end` state, the host can start the next round manually or wait 60 seconds for auto-advance.

### Results Timer

After `results` state, the room automatically resets to `lobby` after 300 seconds (5 minutes).

### Idle Lobby Timer

If the lobby sits idle for 20 minutes, a `room_closed` message is sent to all connected players and the room is deleted from Redis.

---

## 10. Win Conditions — All Ways the Game Can End

### Innocents Win
- The player with the **most votes** is eliminated and they were an imposter.
- All imposters get eliminated across multiple rounds.
- An imposter is **kicked** by the host, and they were the last remaining imposter.
- An imposter **leaves** the game, and they were the last remaining imposter.

### Imposters Win
- **Tie vote or skip wins** — nobody is eliminated, and the imposters have now survived all available rounds.
- **Imposter guesses the word** — during the playing phase, an imposter submits the exact innocent word as their clue. Instant win.
- **Parity** — after any elimination, the number of active imposters equals or exceeds the number of active innocents.
- **Rounds exhausted** — all rounds have been played, and at least one imposter is still active.

---

## 11. Edge Cases Handled

| Situation | What happens |
|-----------|-------------|
| Player disconnects in lobby | Removed from the room entirely. If they were host, host transfers to next player. |
| Player disconnects mid-game | Marked `connected: false`. Their turn is auto-skipped. They can reconnect and resume. |
| Player leaves mid-game | Marked `left: true`. If they had already voted, that vote still counts. |
| Host disconnects mid-game | Host role transfers to the next connected player. |
| Last imposter is kicked | Game immediately ends: Innocents win. |
| Imposter types the real word as clue | Instant imposter win — they guessed correctly. |
| Innocent types the secret word | Marked `word_revealer: true`. Cannot vote. Shown as "Typed the word!" |
| Tie vote | Nobody is eliminated. Game continues to next round (or imposter wins if no rounds left). |
| Skip vote wins | Same as tie — nobody eliminated. |
| Only disconnected players remain for voting | Voting resolves immediately (no eligible voters). |

---

## 12. Game Settings Explained

### Word Similarity

Controls how "obvious" it is that someone has a different word.

| Level | Example | Effect |
|-------|---------|--------|
| Similar | `pizza → lasagna` | Very close — imposters are hard to catch |
| Somewhat | `pizza → bread` | Related but different — medium difficulty |
| Random | `pizza → volcano` | No connection — imposter is easy to spot |

### Discreet Mode

For **in-person play** where everyone is in the same room using their own phones:
- Word and role are hidden on screen by default.
- Player must **hold** the screen to reveal their word to themselves only.
- Prevents the person sitting next to you from seeing your screen.

### Anonymous Role

- `Off` (default): You know from the start if you're imposter or innocent. The number of remaining imposters is shown to all.
- `On`: Everyone just sees a word, no role label. You don't know if you're imposter or innocent. Role is only revealed when eliminated or at game end.

### Anonymous Voter

- `Off`: Everyone sees in real-time who voted for whom as votes come in.
- `On` (default): You see the vote tally (counts) per round, but who-voted-for-whom is only revealed in final results.

---

## 13. Running Locally

### Prerequisites
- Python 3.11+
- Node.js 18+
- Redis running on port 6380

### Backend

```bash
cd backend
python3 -m venv impostervenv
source impostervenv/bin/activate
pip install -r requirements.txt

# Create .env file
echo "REDIS_URL=redis://localhost:6380" > .env
echo "CORS_ORIGINS=http://localhost:5173" >> .env

# Start server
uvicorn main:app --reload
# Running on http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install

# Create .env.local file
echo "VITE_API_URL=http://localhost:8000" > .env.local
echo "VITE_WS_URL=ws://localhost:8000" >> .env.local

npm run dev
# Running on http://localhost:5173
```

### Verify everything works

```bash
# Backend health check
curl http://localhost:8000/health
# Expected: {"status":"ok"}

# Quick Python import check
cd backend && python3 -c "from main import app; print('OK')"

# Frontend build check (no compile errors)
cd frontend && npm run build
```

---

## 14. Environment Variables

### Backend (`backend/.env`)

| Variable | Example | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6380` | Redis connection URL |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed frontend origins (comma-separated for multiple) |
| `ADMIN_SECRET` | `mysecrettoken` | Secret token for admin API endpoints (optional) |

### Frontend (`frontend/.env.local`)

| Variable | Example | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:8000` | Backend REST API base URL |
| `VITE_WS_URL` | `ws://localhost:8000` | Backend WebSocket base URL |

---

## 15. Deployment

### Backend → Render

1. Connect your GitHub repo to Render.
2. Create a new **Web Service**.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Set environment variables: `REDIS_URL`, `CORS_ORIGINS` (your Vercel frontend URL).

### Frontend → Vercel

1. Connect your GitHub repo to Vercel.
2. Set root directory to `frontend`.
3. Set environment variables: `VITE_API_URL` and `VITE_WS_URL` (your Render backend URL, use `wss://` for WebSocket over HTTPS).

### Redis → Upstash

1. Create a free Redis database on [upstash.com](https://upstash.com).
2. Copy the Redis URL and set it as `REDIS_URL` in your Render service.

> **Note:** The backend uses in-memory WebSocket connections and timers. This means only **one server instance** should run. Do not enable auto-scaling / multiple instances on Render for this project — each instance would have its own in-memory state and players connected to different instances would not see each other.
