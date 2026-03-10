import json
import random
import string
import time
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
                    "revealed": False,
                    "eliminated": False,
                }
            },
            "state": "lobby",
            "word": None,
            "imposter_word": None,
            "imposters": [],
            "clue_order": [],
            "current_turn": 0,
            "outcome": None,
            "current_round": 1,
            "total_rounds": 1,
            "settings": {
                "num_imposters": 1,
                "thinking_time": 30,
                "voting_time": 60,
                "num_rounds": 1,
            },
        }
        self._save_room(room)
        self.connections[room_id] = {}
        return room_id, player_id

    @staticmethod
    def get_max_imposters(player_count: int) -> int:
        return min(3, max(1, (player_count - 1) // 2))

    def update_settings(self, room_id: str, player_id: str, settings: dict) -> tuple[bool, str]:
        room = self._get_room(room_id)
        if not room:
            return False, "Room not found"
        if room["state"] != "lobby":
            return False, "Can only change settings in lobby"
        if room["host"] != player_id:
            return False, "Only the host can change settings"

        valid_thinking = [10, 20, 30, 40, 50, 60]
        valid_voting = [30, 45, 60, 90, 120]
        valid_rounds = [1, 2, 3]

        current = room.get("settings", {
            "num_imposters": 1, "thinking_time": 30,
            "voting_time": 60, "num_rounds": 1,
        })

        if "num_imposters" in settings:
            val = settings["num_imposters"]
            if isinstance(val, int) and 1 <= val <= 3:
                max_imp = self.get_max_imposters(len(room["players"]))
                current["num_imposters"] = min(val, max_imp)

        if "thinking_time" in settings:
            val = settings["thinking_time"]
            if val in valid_thinking:
                current["thinking_time"] = val

        if "voting_time" in settings:
            val = settings["voting_time"]
            if val in valid_voting:
                current["voting_time"] = val

        if "num_rounds" in settings:
            val = settings["num_rounds"]
            if val in valid_rounds:
                current["num_rounds"] = val

        room["settings"] = current
        self._save_room(room)
        return True, ""

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
            "revealed": False,
            "eliminated": False,
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
        """Advance turn past disconnected or eliminated players during playing phase. Returns True if state changed."""
        room = self._get_room(room_id)
        if not room or room["state"] != "playing":
            return False

        changed = False
        clue_order = room["clue_order"]
        while room["current_turn"] < len(clue_order):
            current_pid = clue_order[room["current_turn"]]
            p = room["players"].get(current_pid, {})
            if p.get("connected", True) and not p.get("eliminated", False):
                break  # Current player is connected and active, stop
            room["current_turn"] += 1
            changed = True

        if room["current_turn"] >= len(clue_order):
            room["state"] = "voting"
            room["phase_start_time"] = time.time()
            changed = True
        elif changed:
            room["turn_start_time"] = time.time()

        if changed:
            self._save_room(room)
        return changed

    def check_voting_complete(self, room_id: str) -> bool:
        """Check if all eligible players have voted. Returns True if state changed."""
        room = self._get_room(room_id)
        if not room or room["state"] != "voting":
            return False
        eligible = [p for p in room["players"].values()
                    if p.get("connected", True)
                    and not p.get("revealed", False)
                    and not p.get("eliminated", False)]
        if not eligible:
            return False
        all_voted = all(p["vote"] is not None for p in eligible)
        if all_voted:
            self._resolve_voting(room)
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

        settings = room.get("settings", {"num_imposters": 1})
        num_imposters = min(settings["num_imposters"], self.get_max_imposters(len(player_ids)))
        imposters = player_ids[:num_imposters]

        clue_order = player_ids[:]
        random.shuffle(clue_order)

        word = random.choice(WORDS)
        room["word"] = word
        room["imposter_word"] = WORD_PAIRS.get(word, word)
        room["imposters"] = imposters
        room["clue_order"] = clue_order
        room["current_turn"] = 0
        room["outcome"] = None
        room["current_round"] = 1
        room["total_rounds"] = room.get("settings", {}).get("num_rounds", 1)
        room["last_vote_counts"] = {}
        room["last_most_voted_ids"] = []
        room["last_eliminated_id"] = None
        room["state"] = "playing"
        room["turn_start_time"] = time.time()
        for p in room["players"].values():
            p["clue"] = None
            p["vote"] = None
            p["revealed"] = False
            p["eliminated"] = False
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

        normalized = clue.strip().lower()

        # Imposter correctly guesses the innocent word → immediate imposter win
        if player_id in room["imposters"] and normalized == room["word"].lower():
            room["players"][player_id]["clue"] = normalized
            room["outcome"] = "imposter_guessed"
            room["current_turn"] += 1
            room["state"] = "results"
            self._save_room(room)
            return True

        # Innocent reveals the secret word → mark as revealed, advance turn
        if player_id not in room["imposters"] and normalized == room["word"].lower():
            room["players"][player_id]["clue"] = "__word_revealed__"
            room["players"][player_id]["revealed"] = True
            room["current_turn"] += 1
            if room["current_turn"] >= len(clue_order):
                room["state"] = "voting"
                room["phase_start_time"] = time.time()
            else:
                room["turn_start_time"] = time.time()
            self._save_room(room)
            return True

        room["players"][player_id]["clue"] = normalized
        room["current_turn"] += 1

        if room["current_turn"] >= len(clue_order):
            room["state"] = "voting"
            room["phase_start_time"] = time.time()
        else:
            room["turn_start_time"] = time.time()
        self._save_room(room)
        return True

    def skip_turn(self, room_id: str) -> bool:
        """Skip the current player's turn (timer expired). Returns True if state changed."""
        room = self._get_room(room_id)
        if not room or room["state"] != "playing":
            return False
        if room["current_turn"] >= len(room["clue_order"]):
            return False

        current_pid = room["clue_order"][room["current_turn"]]
        room["players"][current_pid]["clue"] = "(skipped)"
        room["current_turn"] += 1

        if room["current_turn"] >= len(room["clue_order"]):
            room["state"] = "voting"
            room["phase_start_time"] = time.time()
        else:
            room["turn_start_time"] = time.time()

        self._save_room(room)
        return True

    def force_end_voting(self, room_id: str) -> bool:
        """Force voting to end (timer expired). Returns True if state changed."""
        room = self._get_room(room_id)
        if not room or room["state"] != "voting":
            return False
        self._resolve_voting(room)
        return True

    def _resolve_voting(self, room: dict):
        """Resolve voting: eliminate a player or end the game. Saves room state."""
        # Count votes from active (non-eliminated, non-revealed) players only
        vote_counts: Dict[str, int] = {}
        for player in room["players"].values():
            if player.get("eliminated") or player.get("revealed"):
                continue
            if player["vote"]:
                vid = player["vote"]
                vote_counts[vid] = vote_counts.get(vid, 0) + 1

        if vote_counts:
            max_votes = max(vote_counts.values())
            most_voted_ids = [pid for pid, c in vote_counts.items() if c == max_votes]
        else:
            most_voted_ids = []

        room["last_vote_counts"] = vote_counts
        room["last_most_voted_ids"] = most_voted_ids

        is_final_round = room.get("current_round", 1) >= room.get("total_rounds", 1)

        if len(most_voted_ids) == 1:
            # Clear plurality — eliminate this player
            eliminated_id = most_voted_ids[0]
            room["players"][eliminated_id]["eliminated"] = True
            room["last_eliminated_id"] = eliminated_id

            if eliminated_id in room["imposters"]:
                # Imposter caught — innocents win!
                room["outcome"] = "innocents_win"
                room["state"] = "results"
            elif is_final_round:
                # Wrong person eliminated on final round — imposter wins
                room["outcome"] = "imposter_wins"
                room["state"] = "results"
            else:
                # Innocent eliminated, more rounds remain — continue
                room["outcome"] = None
                room["state"] = "round_end"
        else:
            # Tie (or no votes) — no elimination
            room["last_eliminated_id"] = None
            if is_final_round:
                room["outcome"] = "imposter_wins"
                room["state"] = "results"
            else:
                room["outcome"] = None
                room["state"] = "round_end"

        self._save_room(room)

    def submit_vote(self, room_id: str, voter_id: str, voted_id: str) -> bool:
        room = self._get_room(room_id)
        if not room or room["state"] != "voting":
            return False
        if voted_id not in room["players"]:
            return False
        # Cannot vote for eliminated or revealed players
        target = room["players"].get(voted_id, {})
        if target.get("eliminated", False) or target.get("revealed", False):
            return False
        # Eliminated/revealed players cannot vote
        voter = room["players"].get(voter_id, {})
        if voter.get("revealed", False) or voter.get("eliminated", False):
            return False

        room["players"][voter_id]["vote"] = voted_id

        # All active connected players must vote
        eligible = [p for p in room["players"].values()
                    if p.get("connected", True)
                    and not p.get("revealed", False)
                    and not p.get("eliminated", False)]
        all_voted = all(p["vote"] is not None for p in eligible)
        if all_voted:
            self._resolve_voting(room)
        else:
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
        room["outcome"] = None
        room["current_round"] = 1
        room["total_rounds"] = 1
        room["last_vote_counts"] = {}
        room["last_most_voted_ids"] = []
        room["last_eliminated_id"] = None
        for p in room["players"].values():
            p["clue"] = None
            p["vote"] = None
            p["revealed"] = False
            p["eliminated"] = False
        self._save_room(room)
        return True

    def next_round(self, room_id: str) -> bool:
        room = self._get_room(room_id)
        if not room or room["state"] != "round_end":
            return False

        # Exclude eliminated and revealed players from next round
        eligible_ids = [pid for pid, p in room["players"].items()
                        if not p.get("revealed", False) and not p.get("eliminated", False)]
        random.shuffle(eligible_ids)

        # Keep the same word and imposters across rounds of the same match
        room["clue_order"] = eligible_ids
        room["current_turn"] = 0
        room["outcome"] = None
        room["current_round"] = room.get("current_round", 1) + 1
        room["state"] = "playing"
        room["turn_start_time"] = time.time()
        for pid, p in room["players"].items():
            if not p.get("eliminated", False) and not p.get("revealed", False):
                p["clue"] = None
                p["vote"] = None
        self._save_room(room)
        return True

    def _calculate_results(self, room: dict) -> dict:
        base = {
            "imposters": room["imposters"],
            "imposter_names": [room["players"][pid]["name"] for pid in room["imposters"] if pid in room["players"]],
            "word": room["word"],
            "imposter_word": room.get("imposter_word"),
        }

        if room.get("outcome") == "imposter_guessed":
            return {**base, "caught": False, "tie": False, "imposter_guessed": True, "vote_counts": {}, "most_voted_ids": [], "eliminated_id": None}

        vote_counts = room.get("last_vote_counts", {})
        most_voted_ids = room.get("last_most_voted_ids", [])
        eliminated_id = room.get("last_eliminated_id")

        caught = room.get("outcome") == "innocents_win"
        # Tie = imposter wins because nobody was eliminated (tied votes or no votes)
        tie = not caught and eliminated_id is None

        return {
            **base,
            "caught": caught,
            "tie": tie,
            "imposter_guessed": False,
            "vote_counts": {pid: vote_counts.get(pid, 0) for pid in room["players"]},
            "most_voted_ids": most_voted_ids,
            "eliminated_id": eliminated_id,
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
                "vote": player["vote"] if room["state"] in ("results", "round_end") or pid == player_id else None,
                "is_host": pid == room["host"],
                "connected": player.get("connected", True),
                "revealed": player.get("revealed", False),
                "eliminated": player.get("eliminated", False),
            })

        current_player_id = None
        if room["state"] == "playing" and room["current_turn"] < len(room["clue_order"]):
            current_player_id = room["clue_order"][room["current_turn"]]

        results = None
        if room["state"] == "results":
            results = self._calculate_results(room)

        round_end_info = None
        if room["state"] == "round_end":
            elim_id = room.get("last_eliminated_id")
            elim_name = room["players"][elim_id]["name"] if elim_id and elim_id in room["players"] else None
            round_end_info = {
                "eliminated_id": elim_id,
                "eliminated_name": elim_name,
                "vote_counts": room.get("last_vote_counts", {}),
                "most_voted_ids": room.get("last_most_voted_ids", []),
                "was_tie": elim_id is None,
            }

        is_imposter = player_id in room["imposters"]
        in_game = room["state"] not in ("lobby",)
        is_eliminated = room["players"].get(player_id, {}).get("eliminated", False)

        if in_game:
            word = room["imposter_word"] if is_imposter else room["word"]
        else:
            word = None

        default_settings = {
            "num_imposters": 1, "thinking_time": 30,
            "voting_time": 60, "num_rounds": 1,
        }

        return {
            "room_id": room_id,
            "state": room["state"],
            "players": players_list,
            "host": room["host"],
            "current_player_id": current_player_id,
            "clue_order": room["clue_order"],
            "is_imposter": is_imposter,
            "is_eliminated": is_eliminated,
            "word": word,
            "results": results,
            "round_end_info": round_end_info,
            "settings": room.get("settings", default_settings),
            "max_imposters": self.get_max_imposters(len(room["players"])),
            "turn_start_time": room.get("turn_start_time"),
            "phase_start_time": room.get("phase_start_time"),
            "server_time": time.time(),
            "current_round": room.get("current_round", 1),
            "total_rounds": room.get("total_rounds", 1),
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
