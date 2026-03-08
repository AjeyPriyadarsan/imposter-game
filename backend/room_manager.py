import json
import random
import string
from typing import Dict, Optional
from fastapi import WebSocket
from word_list import WORDS, WORD_PAIRS


class RoomManager:
    def __init__(self, redis_client=None):
        self.redis = redis_client
        self.connections: Dict[str, Dict[str, WebSocket]] = {}

    def _get_room(self, room_id: str) -> Optional[dict]:
        data = self.redis.get(f"room:{room_id}")
        return json.loads(data) if data else None

    def _save_room(self, room: dict):
        self.redis.setex(f"room:{room['id']}", 86400, json.dumps(room))

    def _delete_room(self, room_id: str):
        self.redis.delete(f"room:{room_id}")

    def _room_exists(self, room_id: str) -> bool:
        return self.redis.exists(f"room:{room_id}") > 0

    def _generate_room_id(self) -> str:
        while True:
            room_id = "".join(random.choices(string.ascii_uppercase, k=4))
            if not self._room_exists(room_id):
                return room_id

    def _generate_player_id(self) -> str:
        return "".join(random.choices(string.ascii_lowercase + string.digits, k=8))

    def create_room(self, host_name: str) -> tuple[str, str]:
        room_id = self._generate_room_id()
        player_id = self._generate_player_id()
        room = {
            "id": room_id,
            "host": player_id,
            "players": {
                player_id: {
                    "id": player_id,
                    "name": host_name,
                    "clue": None,
                    "vote": None,
                    "connected": True,
                }
            },
            "state": "lobby",
            "word": None,
            "imposter_word": None,
            "imposters": [],
            "clue_order": [],
            "current_turn": 0,
        }
        self._save_room(room)
        self.connections[room_id] = {}
        return room_id, player_id

    def join_room(self, room_id: str, player_name: str) -> Optional[str]:
        room = self._get_room(room_id)
        if not room:
            return None
        if room["state"] != "lobby":
            return None
        if len(room["players"]) >= 8:
            return None
        player_id = self._generate_player_id()
        room["players"][player_id] = {
            "id": player_id,
            "name": player_name,
            "clue": None,
            "vote": None,
            "connected": True,
        }
        self._save_room(room)
        return player_id

    def set_player_connected(self, room_id: str, player_id: str, connected: bool) -> bool:
        room = self._get_room(room_id)
        if not room or player_id not in room["players"]:
            return False
        room["players"][player_id]["connected"] = connected
        self._save_room(room)
        return True

    def auto_advance_turn(self, room_id: str) -> bool:
        """Advance turn past disconnected players during playing phase. Returns True if state changed."""
        room = self._get_room(room_id)
        if not room or room["state"] != "playing":
            return False

        changed = False
        clue_order = room["clue_order"]
        while room["current_turn"] < len(clue_order):
            current_pid = clue_order[room["current_turn"]]
            if room["players"].get(current_pid, {}).get("connected", True):
                break  # Current player is connected, stop
            room["current_turn"] += 1
            changed = True

        if room["current_turn"] >= len(clue_order):
            room["state"] = "voting"
            changed = True

        if changed:
            self._save_room(room)
        return changed

    def check_voting_complete(self, room_id: str) -> bool:
        """Check if all connected players have voted. Returns True if state changed to results."""
        room = self._get_room(room_id)
        if not room or room["state"] != "voting":
            return False
        connected = [p for p in room["players"].values() if p.get("connected", True)]
        if not connected:
            return False
        all_voted = all(p["vote"] is not None for p in connected)
        if all_voted:
            room["state"] = "results"
            self._save_room(room)
            return True
        return False

    def start_game(self, room_id: str) -> bool:
        room = self._get_room(room_id)
        if not room or room["state"] != "lobby":
            return False
        if len(room["players"]) < 3:
            return False

        player_ids = list(room["players"].keys())
        random.shuffle(player_ids)

        num_imposters = 2 if len(player_ids) >= 6 else 1
        imposters = player_ids[:num_imposters]

        word = random.choice(WORDS)
        room["word"] = word
        room["imposter_word"] = WORD_PAIRS.get(word, word)
        room["imposters"] = imposters
        room["clue_order"] = player_ids
        room["current_turn"] = 0
        room["state"] = "playing"
        for p in room["players"].values():
            p["clue"] = None
            p["vote"] = None
        self._save_room(room)
        return True

    def submit_clue(self, room_id: str, player_id: str, clue: str) -> bool:
        room = self._get_room(room_id)
        if not room or room["state"] != "playing":
            return False
        clue_order = room["clue_order"]
        if room["current_turn"] >= len(clue_order):
            return False
        if clue_order[room["current_turn"]] != player_id:
            return False

        room["players"][player_id]["clue"] = clue.strip().lower()
        room["current_turn"] += 1

        if room["current_turn"] >= len(clue_order):
            room["state"] = "voting"
        self._save_room(room)
        return True

    def submit_vote(self, room_id: str, voter_id: str, voted_id: str) -> bool:
        room = self._get_room(room_id)
        if not room or room["state"] != "voting":
            return False
        if voted_id not in room["players"]:
            return False
        if voter_id == voted_id:
            return False

        room["players"][voter_id]["vote"] = voted_id

        # Only require connected players to vote
        connected = [p for p in room["players"].values() if p.get("connected", True)]
        all_voted = all(p["vote"] is not None for p in connected)
        if all_voted:
            room["state"] = "results"
        self._save_room(room)
        return True

    def play_again(self, room_id: str) -> bool:
        room = self._get_room(room_id)
        if not room or room["state"] != "results":
            return False
        room["state"] = "lobby"
        room["word"] = None
        room["imposter_word"] = None
        room["imposters"] = []
        room["clue_order"] = []
        room["current_turn"] = 0
        for p in room["players"].values():
            p["clue"] = None
            p["vote"] = None
        self._save_room(room)
        return True

    def _calculate_results(self, room: dict) -> dict:
        vote_counts: Dict[str, int] = {}
        for player in room["players"].values():
            if player["vote"]:
                vid = player["vote"]
                vote_counts[vid] = vote_counts.get(vid, 0) + 1

        if not vote_counts:
            most_voted_ids = []
            caught = False
        else:
            max_votes = max(vote_counts.values())
            most_voted_ids = [pid for pid, c in vote_counts.items() if c == max_votes]
            caught = any(pid in room["imposters"] for pid in most_voted_ids)

        return {
            "imposters": room["imposters"],
            "imposter_names": [room["players"][pid]["name"] for pid in room["imposters"] if pid in room["players"]],
            "word": room["word"],
            "imposter_word": room.get("imposter_word"),
            "caught": caught,
            "vote_counts": {pid: vote_counts.get(pid, 0) for pid in room["players"]},
            "most_voted_ids": most_voted_ids,
        }

    def get_room_state(self, room_id: str, player_id: str) -> Optional[dict]:
        room = self._get_room(room_id)
        if not room:
            return None

        players_list = []
        for pid, player in room["players"].items():
            players_list.append({
                "id": pid,
                "name": player["name"],
                "clue": player["clue"],
                "vote": player["vote"] if room["state"] == "results" or pid == player_id else None,
                "is_host": pid == room["host"],
                "connected": player.get("connected", True),
            })

        current_player_id = None
        if room["state"] == "playing" and room["current_turn"] < len(room["clue_order"]):
            current_player_id = room["clue_order"][room["current_turn"]]

        results = None
        if room["state"] == "results":
            results = self._calculate_results(room)

        is_imposter = player_id in room["imposters"]
        in_game = room["state"] not in ("lobby",)

        if in_game:
            word = room["imposter_word"] if is_imposter else room["word"]
        else:
            word = None

        return {
            "room_id": room_id,
            "state": room["state"],
            "players": players_list,
            "host": room["host"],
            "current_player_id": current_player_id,
            "clue_order": room["clue_order"],
            "is_imposter": is_imposter,
            "word": word,
            "results": results,
        }

    async def connect(self, room_id: str, player_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.connections:
            self.connections[room_id] = {}
        self.connections[room_id][player_id] = websocket

    def disconnect(self, room_id: str, player_id: str):
        if room_id in self.connections:
            self.connections[room_id].pop(player_id, None)

    async def broadcast(self, room_id: str):
        if room_id not in self.connections:
            return
        dead = []
        for pid, ws in self.connections[room_id].items():
            state = self.get_room_state(room_id, pid)
            if state:
                try:
                    await ws.send_json({"type": "state_update", "payload": state})
                except Exception:
                    dead.append(pid)
        for pid in dead:
            self.connections[room_id].pop(pid, None)
