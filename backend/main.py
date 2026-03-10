import os
import asyncio
import time
import redis
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from room_manager import RoomManager

load_dotenv()

app = FastAPI()

cors_origins = os.environ.get("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_url = os.environ.get("REDIS_URL", "redis://localhost:6380")
redis_client = redis.from_url(redis_url, decode_responses=True)
manager = RoomManager(redis_client=redis_client)

# Timer management: room_id -> asyncio.Task
_timers: dict[str, asyncio.Task] = {}
_idle_timers: dict[str, asyncio.Task] = {}

LOBBY_IDLE_SECONDS = 600  # 10 minutes total idle
LOBBY_WARN_SECONDS = 300  # show warning in last 5 minutes


def cancel_timer(room_id: str):
    task = _timers.pop(room_id, None)
    if task and not task.done():
        task.cancel()


def cancel_idle_timer(room_id: str):
    task = _idle_timers.pop(room_id, None)
    if task and not task.done():
        task.cancel()


async def _idle_lobby_timer(room_id: str):
    """Delete a lobby room after it idles past idle_expires_at."""
    while True:
        room = manager._get_room(room_id)
        if not room or room["state"] != "lobby":
            _idle_timers.pop(room_id, None)
            return
        now = time.time()
        expires = room.get("idle_expires_at", now)
        remaining = expires - now
        if remaining <= 0:
            # Close all connections and delete the room
            connections = dict(manager.connections.get(room_id, {}))
            for pid, ws in connections.items():
                try:
                    await ws.send_json({
                        "type": "room_closed",
                        "payload": {"message": "Room closed due to inactivity"}
                    })
                    await ws.close()
                except Exception:
                    pass
            manager._delete_room(room_id)
            manager.connections.pop(room_id, None)
            _idle_timers.pop(room_id, None)
            return
        await asyncio.sleep(remaining)


def schedule_idle_timer(room_id: str):
    cancel_idle_timer(room_id)
    _idle_timers[room_id] = asyncio.create_task(_idle_lobby_timer(room_id))


async def _thinking_timer(room_id: str, seconds: int, expected_turn: int):
    """Auto-skip current player's turn after thinking_time expires."""
    await asyncio.sleep(seconds)
    room = manager._get_room(room_id)
    if not room or room["state"] != "playing":
        return
    if room["current_turn"] != expected_turn:
        return  # Turn already advanced
    if manager.skip_turn(room_id):
        manager.auto_advance_turn(room_id)
        await manager.broadcast(room_id)
        # Schedule next timer
        schedule_turn_timer(room_id)


async def _voting_timer(room_id: str, seconds: int):
    """Auto-end voting after voting_time expires."""
    await asyncio.sleep(seconds)
    _timers.pop(room_id, None)
    if manager.force_end_voting(room_id):
        await manager.broadcast(room_id)
        schedule_post_voting_timer(room_id)


async def _round_end_timer(room_id: str):
    """Auto-advance to next round 30s after round_end state."""
    await asyncio.sleep(30)
    _timers.pop(room_id, None)
    room = manager._get_room(room_id)
    if not room or room["state"] != "round_end":
        return
    if manager.next_round(room_id):
        await manager.broadcast(room_id)
        schedule_turn_timer(room_id)


async def _results_timer(room_id: str):
    """Auto-return to lobby 30s after results state."""
    await asyncio.sleep(30)
    _timers.pop(room_id, None)
    room = manager._get_room(room_id)
    if not room or room["state"] != "results":
        return
    manager.play_again(room_id)
    await manager.broadcast(room_id)


def schedule_post_voting_timer(room_id: str):
    """Schedule auto-advance timer after voting resolves (round_end or results)."""
    room = manager._get_room(room_id)
    if not room:
        return
    cancel_timer(room_id)
    if room["state"] == "round_end" and room.get("total_rounds", 1) > 1:
        _timers[room_id] = asyncio.create_task(_round_end_timer(room_id))
    elif room["state"] == "results":
        _timers[room_id] = asyncio.create_task(_results_timer(room_id))


def schedule_turn_timer(room_id: str):
    """Schedule a thinking timer for the current turn."""
    cancel_timer(room_id)
    room = manager._get_room(room_id)
    if not room:
        return
    if room["state"] == "playing" and room["current_turn"] < len(room["clue_order"]):
        seconds = room.get("settings", {}).get("thinking_time", 30)
        _timers[room_id] = asyncio.create_task(
            _thinking_timer(room_id, seconds, room["current_turn"])
        )
    elif room["state"] == "voting":
        seconds = room.get("settings", {}).get("voting_time", 60)
        _timers[room_id] = asyncio.create_task(
            _voting_timer(room_id, seconds)
        )


class CreateRoomRequest(BaseModel):
    player_name: str


class JoinRoomRequest(BaseModel):
    player_name: str


@app.post("/rooms")
async def create_room(req: CreateRoomRequest):
    name = req.player_name.strip()
    if not name or len(name) > 20:
        raise HTTPException(status_code=400, detail="Invalid player name")
    room_id, player_id = manager.create_room(name)
    schedule_idle_timer(room_id)
    return {"room_id": room_id, "player_id": player_id}


@app.post("/rooms/{room_id}/join")
async def join_room(room_id: str, req: JoinRoomRequest):
    room_id = room_id.upper()
    name = req.player_name.strip()
    if not name or len(name) > 20:
        raise HTTPException(status_code=400, detail="Invalid player name")
    room = manager._get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    player_id = manager.join_room(room_id, name)
    if player_id is None:
        room = manager._get_room(room_id)
        if room["state"] != "lobby":
            raise HTTPException(status_code=400, detail="Game already in progress")
        raise HTTPException(status_code=400, detail="Room is full (max 20 players)")
    manager.reset_idle_timer(room_id)
    schedule_idle_timer(room_id)
    return {"player_id": player_id}


@app.websocket("/ws/{room_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    room = manager._get_room(room_id)
    if not room or player_id not in room["players"]:
        await websocket.close(code=4004)
        return

    await manager.connect(room_id, player_id, websocket)
    manager.set_player_connected(room_id, player_id, True)
    # Reset idle timer on reconnect/connect to lobby
    if manager._get_room(room_id) and manager._get_room(room_id)["state"] == "lobby":
        manager.reset_idle_timer(room_id)
        schedule_idle_timer(room_id)
    await manager.broadcast(room_id)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            # Reset idle timer on any activity while in lobby
            room = manager._get_room(room_id)
            if room and room["state"] == "lobby":
                manager.reset_idle_timer(room_id)
                schedule_idle_timer(room_id)

            if msg_type == "start_game":
                room = manager._get_room(room_id)
                if room and room["host"] == player_id:
                    if len(room["players"]) < 3:
                        await websocket.send_json({
                            "type": "error",
                            "payload": {"message": "Need at least 3 players to start"}
                        })
                    else:
                        cancel_idle_timer(room_id)
                        manager.start_game(room_id)
                        await manager.broadcast(room_id)
                        schedule_turn_timer(room_id)

            elif msg_type == "update_settings":
                settings = data.get("settings", {})
                success, error_msg = manager.update_settings(room_id, player_id, settings)
                if success:
                    await manager.broadcast(room_id)
                elif error_msg:
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"message": error_msg}
                    })

            elif msg_type == "submit_clue":
                clue = data.get("clue", "").strip()
                if not clue:
                    continue
                # Only allow single word
                if len(clue.split()) > 1:
                    await websocket.send_json({
                        "type": "error",
                        "payload": {"message": "Clue must be a single word"}
                    })
                    continue
                if manager.submit_clue(room_id, player_id, clue):
                    manager.auto_advance_turn(room_id)
                    await manager.broadcast(room_id)
                    room = manager._get_room(room_id)
                    if room and room["state"] == "results":
                        schedule_post_voting_timer(room_id)
                    else:
                        schedule_turn_timer(room_id)

            elif msg_type == "submit_vote":
                voted_id = data.get("voted_id")
                if voted_id:
                    if manager.submit_vote(room_id, player_id, voted_id):
                        room = manager._get_room(room_id)
                        if room and room["state"] in ("results", "round_end"):
                            schedule_post_voting_timer(room_id)
                        await manager.broadcast(room_id)

            elif msg_type == "next_round":
                room = manager._get_room(room_id)
                if room and room["host"] == player_id and room["state"] == "round_end":
                    cancel_timer(room_id)
                    if manager.next_round(room_id):
                        await manager.broadcast(room_id)
                        schedule_turn_timer(room_id)

            elif msg_type == "play_again":
                room = manager._get_room(room_id)
                if room and room["host"] == player_id:
                    cancel_timer(room_id)
                    manager.play_again(room_id)
                    await manager.broadcast(room_id)
                    schedule_idle_timer(room_id)

            elif msg_type == "kick_player":
                target_id = data.get("target_id")
                room = manager._get_room(room_id)
                if not (room and room["host"] == player_id and target_id
                        and target_id != player_id and target_id in room.get("players", {})):
                    continue
                # Notify and close the target's WebSocket connection
                target_ws = manager.connections.get(room_id, {}).get(target_id)
                if target_ws:
                    try:
                        await target_ws.send_json({"type": "kicked"})
                        await target_ws.close(code=4008)
                    except Exception:
                        pass
                    manager.disconnect(room_id, target_id)
                room = manager._get_room(room_id)
                if not room or target_id not in room["players"]:
                    continue
                if room["state"] == "lobby":
                    del room["players"][target_id]
                    if target_id in room["clue_order"]:
                        room["clue_order"].remove(target_id)
                    if target_id in room["imposters"]:
                        room["imposters"].remove(target_id)
                    if not room["players"]:
                        manager._delete_room(room_id)
                    else:
                        settings = room.get("settings")
                        if settings:
                            max_imp = manager.get_max_imposters(len(room["players"]))
                            if settings["num_imposters"] > max_imp:
                                settings["num_imposters"] = max_imp
                        manager._save_room(room)
                        await manager.broadcast(room_id)
                else:
                    manager.set_player_connected(room_id, target_id, False)
                    room = manager._get_room(room_id)
                    if room["state"] == "playing":
                        if manager.auto_advance_turn(room_id):
                            schedule_turn_timer(room_id)
                    elif room["state"] == "voting":
                        if manager.check_voting_complete(room_id):
                            cancel_timer(room_id)
                    await manager.broadcast(room_id)

    except WebSocketDisconnect:
        manager.disconnect(room_id, player_id)
        room = manager._get_room(room_id)
        if not room or player_id not in room["players"]:
            return

        if room["state"] == "lobby":
            # Remove player from lobby entirely
            del room["players"][player_id]
            if player_id in room["clue_order"]:
                room["clue_order"].remove(player_id)
            if player_id in room["imposters"]:
                room["imposters"].remove(player_id)
            if room["host"] == player_id and room["players"]:
                room["host"] = next(iter(room["players"]))
            if not room["players"]:
                manager._delete_room(room_id)
            else:
                # Auto-clamp imposters if player count dropped
                settings = room.get("settings")
                if settings:
                    max_imp = manager.get_max_imposters(len(room["players"]))
                    if settings["num_imposters"] > max_imp:
                        settings["num_imposters"] = max_imp
                manager._save_room(room)
                await manager.broadcast(room_id)
        else:
            # Keep player in room but mark as disconnected so they can rejoin
            manager.set_player_connected(room_id, player_id, False)
            room = manager._get_room(room_id)
            # Transfer host to next connected player if host disconnected
            if room["host"] == player_id:
                next_host = next(
                    (pid for pid, p in room["players"].items()
                     if pid != player_id and p.get("connected", True)),
                    None
                )
                if next_host:
                    room["host"] = next_host
                    manager._save_room(room)
            if room["state"] == "playing":
                if manager.auto_advance_turn(room_id):
                    schedule_turn_timer(room_id)
            elif room["state"] == "voting":
                if manager.check_voting_complete(room_id):
                    cancel_timer(room_id)
            elif room["state"] == "round_end":
                pass  # Nothing to do on disconnect during round_end
            await manager.broadcast(room_id)
