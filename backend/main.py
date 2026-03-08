import redis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from room_manager import RoomManager

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_client = redis.Redis(host="localhost", port=6380, decode_responses=True)
manager = RoomManager(redis_client=redis_client)


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
        raise HTTPException(status_code=400, detail="Room is full (max 8 players)")
    return {"player_id": player_id}


@app.websocket("/ws/{room_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    room = manager._get_room(room_id)
    if not room or player_id not in room["players"]:
        await websocket.close(code=4004)
        return

    await manager.connect(room_id, player_id, websocket)
    manager.set_player_connected(room_id, player_id, True)
    await manager.broadcast(room_id)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "start_game":
                room = manager._get_room(room_id)
                if room and room["host"] == player_id:
                    if len(room["players"]) < 3:
                        await websocket.send_json({
                            "type": "error",
                            "payload": {"message": "Need at least 3 players to start"}
                        })
                    else:
                        manager.start_game(room_id)
                        await manager.broadcast(room_id)

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

            elif msg_type == "submit_vote":
                voted_id = data.get("voted_id")
                if voted_id:
                    if manager.submit_vote(room_id, player_id, voted_id):
                        await manager.broadcast(room_id)

            elif msg_type == "play_again":
                room = manager._get_room(room_id)
                if room and room["host"] == player_id:
                    manager.play_again(room_id)
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
                manager._save_room(room)
                await manager.broadcast(room_id)
        else:
            # Keep player in room but mark as disconnected so they can rejoin
            manager.set_player_connected(room_id, player_id, False)
            room = manager._get_room(room_id)
            if room["state"] == "playing":
                manager.auto_advance_turn(room_id)
            elif room["state"] == "voting":
                manager.check_voting_complete(room_id)
            await manager.broadcast(room_id)
