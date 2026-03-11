import json
import random
import string
import time
from typing import Dict, Optional
from fastapi import WebSocket
from word_list import WORDS, WORD_PAIRS_BY_LEVEL


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
                    "left": False,
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
                "discreet_mode": False,
                "word_similarity": "similar",
                "max_players": 10,
                "anonymous_role": False,
                "anonymous_voter": True,
            },
            "idle_expires_at": time.time() + 600,
        }
        self._save_room(room)
        self.connections[room_id] = {}
        return room_id, player_id

    @staticmethod
    def get_max_imposters(player_count: int) -> int:
        # ~1 imposter per 3 players: 3-5→1, 6-8→2, 9-11→3, 12-14→4, 15-17→5, 18-20→6
        return max(1, player_count // 3)

    def reset_idle_timer(self, room_id: str, seconds: int = 600) -> bool:
        room = self._get_room(room_id)
        if not room or room["state"] != "lobby":
            return False
        room["idle_expires_at"] = time.time() + seconds
        self._save_room(room)
        return True

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
        valid_rounds = [1, 2, 3, 4, 5, 6]

        current = room.get("settings", {
            "num_imposters": 1, "thinking_time": 30,
            "voting_time": 60, "num_rounds": 1,
        })

        if "num_imposters" in settings:
            val = settings["num_imposters"]
            max_imp = self.get_max_imposters(len(room["players"]))
            if isinstance(val, int) and 1 <= val <= max_imp:
                current["num_imposters"] = val

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

        # Enforce num_rounds >= num_imposters so innocents always have a chance
        if current["num_rounds"] < current["num_imposters"]:
            current["num_rounds"] = current["num_imposters"]

        if "max_players" in settings:
            val = settings["max_players"]
            if isinstance(val, int) and 3 <= val <= 20 and val >= len(room["players"]):
                current["max_players"] = val

        if "discreet_mode" in settings:
            if isinstance(settings["discreet_mode"], bool):
                current["discreet_mode"] = settings["discreet_mode"]

        if "word_similarity" in settings:
            if settings["word_similarity"] in ("similar", "somewhat", "random"):
                current["word_similarity"] = settings["word_similarity"]

        if "anonymous_role" in settings:
            if isinstance(settings["anonymous_role"], bool):
                current["anonymous_role"] = settings["anonymous_role"]

        if "anonymous_voter" in settings:
            if isinstance(settings["anonymous_voter"], bool):
                current["anonymous_voter"] = settings["anonymous_voter"]

        room["settings"] = current
        self._save_room(room)
        return True, ""

    def join_room(self, room_id: str, player_name: str) -> Optional[str]:
        room = self._get_room(room_id)
        if not room:
            return None
        if room["state"] != "lobby":
            return None
        max_players = room.get("settings", {}).get("max_players", 20)
        if len(room["players"]) >= max_players:
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
            "left": False,
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
            if p.get("connected", True) and not p.get("eliminated", False) \
               and not p.get("kicked", False) and not p.get("left", False):
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
                    and not p.get("eliminated", False)
                    and not p.get("kicked", False)
                    and not p.get("left", False)]
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
        similarity = settings.get("word_similarity", "similar")
        pairs = WORD_PAIRS_BY_LEVEL.get(similarity, WORD_PAIRS_BY_LEVEL["similar"])
        room["word"] = word
        room["imposter_word"] = pairs.get(word, word)
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
        room["idle_expires_at"] = None
        room["turn_start_time"] = time.time()
        for p in room["players"].values():
            p["clue"] = None
            p["vote"] = None
            p["revealed"] = False
            p["eliminated"] = False
            p["word_revealer"] = False
        self._save_room(room)
        return True

    @staticmethod
    def _clue_contains_word(clue: str, word: str) -> bool:
        """Returns True if clue contains the secret word or its reverse as a substring."""
        clue_lower = clue.lower()
        word_lower = word.lower()
        reversed_word = word_lower[::-1]
        return word_lower in clue_lower or reversed_word in clue_lower

    def submit_clue(self, room_id: str, player_id: str, clue: str) -> tuple[bool, str]:
        room = self._get_room(room_id)
        if not room or room["state"] != "playing":
            return False, ""
        clue_order = room["clue_order"]
        if room["current_turn"] >= len(clue_order):
            return False, ""
        if clue_order[room["current_turn"]] != player_id:
            return False, ""

        normalized = clue.strip().lower()

        # Imposter correctly guesses the innocent word → immediate imposter win
        if player_id in room["imposters"] and normalized == room["word"].lower():
            room["players"][player_id]["clue"] = normalized
            room["outcome"] = "imposter_guessed"
            room["win_reason"] = (
                f"The imposter correctly guessed the innocents' word '{room['word']}'!"
            )
            room["current_turn"] += 1
            room["state"] = "results"
            room["phase_start_time"] = time.time()
            self._save_room(room)
            return True, ""

        # Innocent reveals the secret word exactly → mark as revealed, advance turn
        if player_id not in room["imposters"] and normalized == room["word"].lower():
            room["players"][player_id]["clue"] = "__word_revealed__"
            room["players"][player_id]["revealed"] = True
            room["players"][player_id]["word_revealer"] = True
            room["current_turn"] += 1

            # Check parity immediately after marking revealed
            win_reason = self._check_imposter_win_condition(room)
            if win_reason:
                room["outcome"] = "imposter_win"
                room["win_reason"] = win_reason
                room["state"] = "results"
                room["phase_start_time"] = time.time()
            elif room["current_turn"] >= len(clue_order):
                room["state"] = "voting"
                room["phase_start_time"] = time.time()
            else:
                room["turn_start_time"] = time.time()

            self._save_room(room)
            return True, ""

        # Innocent clue contains the word or its reverse as a substring → reject
        if player_id not in room["imposters"] and self._clue_contains_word(normalized, room["word"]):
            return False, "Your clue contains or hints at the secret word!"

        room["players"][player_id]["clue"] = normalized
        room["current_turn"] += 1

        if room["current_turn"] >= len(clue_order):
            room["state"] = "voting"
            room["phase_start_time"] = time.time()
        else:
            room["turn_start_time"] = time.time()
        self._save_room(room)
        return True, ""

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

    def _imposter_wins_by_parity(self, room: dict) -> bool:
        """Returns True if active imposters >= active innocents."""
        players = room["players"]
        imposters = set(room["imposters"])
        active = [p for p in players.values()
                  if not p.get("eliminated") and not p.get("revealed")
                  and not p.get("kicked") and not p.get("left")]
        active_imposters = sum(1 for p in active if p["id"] in imposters)
        active_innocents = len(active) - active_imposters
        return active_imposters >= active_innocents

    def _check_imposter_win_condition(self, room: dict) -> Optional[str]:
        """Returns a win-reason string if imposters win right now, else None."""
        players = room["players"]
        imposters = set(room["imposters"])
        active = [p for p in players.values()
                  if not p.get("eliminated") and not p.get("revealed")
                  and not p.get("kicked") and not p.get("left")]
        active_imposters = sum(1 for p in active if p["id"] in imposters)
        active_innocents = len(active) - active_imposters

        # Parity: imposters outnumber or match innocents
        if active_imposters >= active_innocents:
            return (
                f"Imposters ({active_imposters}) now outnumber the remaining "
                f"innocents ({active_innocents})"
            )

        # Rounds remaining: fewer rounds left than active imposters
        remaining_rounds = room.get("total_rounds", 1) - room.get("current_round", 1)
        if remaining_rounds < active_imposters:
            if remaining_rounds == 0:
                total = room.get("total_rounds", 1)
                return (
                    f"Imposters survived all {total} "
                    f"round{'s' if total != 1 else ''}!"
                )
            return (
                f"Only {remaining_rounds} round{'s' if remaining_rounds != 1 else ''} "
                f"left but {active_imposters} imposter{'s' if active_imposters != 1 else ''} "
                f"remain — innocents can't catch them all!"
            )

        return None

    def _resolve_voting(self, room: dict):
        """Resolve voting: eliminate a player or end the game. Saves room state."""
        players = room["players"]

        # Eligible: not eliminated, not revealed (word revealers keep revealed=True across rounds)
        # Kicked/left players count only if they had already voted before exiting
        eligible = []
        for p in players.values():
            if p.get("eliminated") or p.get("revealed"):
                continue
            if p.get("kicked") or p.get("left"):
                # Only count their vote if they cast one before exiting
                if p["vote"] is not None:
                    eligible.append(p)
                # else: excluded entirely — left/kicked without voting
            else:
                eligible.append(p)

        # Skip count = explicit "skip" votes + players who never voted (None)
        skip_count = sum(1 for p in eligible if p["vote"] is None or p["vote"] == "skip")

        # Real votes per player (exclude skip / None)
        vote_counts: Dict[str, int] = {}
        for player in eligible:
            if player["vote"] and player["vote"] != "skip":
                vid = player["vote"]
                vote_counts[vid] = vote_counts.get(vid, 0) + 1

        # Skip wins when skip_count >= any individual vote count
        max_real_votes = max(vote_counts.values()) if vote_counts else 0
        skip_won = skip_count >= max_real_votes if max_real_votes > 0 else True

        if vote_counts and not skip_won:
            most_voted_ids = [pid for pid, c in vote_counts.items() if c == max_real_votes]
        else:
            most_voted_ids = []

        room["last_vote_counts"] = vote_counts
        room["last_most_voted_ids"] = most_voted_ids
        room["last_skip_count"] = skip_count
        room["last_skip_won"] = skip_won

        if len(most_voted_ids) == 1:
            # Clear plurality and skip did not win — eliminate this player
            eliminated_id = most_voted_ids[0]
            room["players"][eliminated_id]["eliminated"] = True
            room["last_eliminated_id"] = eliminated_id

            if eliminated_id in room["imposters"]:
                elim_name = room["players"][eliminated_id]["name"]
                room["outcome"] = "innocents_win"
                room["win_reason"] = f"{elim_name} was voted out and was the imposter!"
                room["state"] = "results"
                room["phase_start_time"] = time.time()
            else:
                win_reason = self._check_imposter_win_condition(room)
                if win_reason:
                    room["outcome"] = "imposter_wins"
                    room["win_reason"] = win_reason
                    room["state"] = "results"
                    room["phase_start_time"] = time.time()
                else:
                    room["outcome"] = None
                    room["win_reason"] = None
                    room["state"] = "round_end"
                    room["phase_start_time"] = time.time()
        else:
            # Tie, skip won, or no real votes — no elimination
            room["last_eliminated_id"] = None
            win_reason = self._check_imposter_win_condition(room)
            if win_reason:
                room["outcome"] = "imposter_wins"
                room["win_reason"] = win_reason
                room["state"] = "results"
                room["phase_start_time"] = time.time()
            else:
                room["outcome"] = None
                room["win_reason"] = None
                room["state"] = "round_end"
                room["phase_start_time"] = time.time()

        self._save_room(room)

    def submit_vote(self, room_id: str, voter_id: str, voted_id: str) -> bool:
        room = self._get_room(room_id)
        if not room or room["state"] != "voting":
            return False
        # "skip" is a valid special vote — skip target validation
        if voted_id != "skip":
            if voted_id not in room["players"]:
                return False
            # Cannot vote for eliminated, revealed, kicked, or left players
            target = room["players"].get(voted_id, {})
            if target.get("eliminated", False) or target.get("revealed", False) \
               or target.get("kicked", False) or target.get("left", False):
                return False
        # Eliminated/revealed/kicked/left players cannot vote
        voter = room["players"].get(voter_id, {})
        if voter.get("revealed", False) or voter.get("eliminated", False) \
           or voter.get("kicked", False) or voter.get("left", False):
            return False

        room["players"][voter_id]["vote"] = voted_id

        # Wait for connected non-kicked/left players; disconnected handled by timer
        eligible = [p for p in room["players"].values()
                    if p.get("connected", True)
                    and not p.get("revealed", False)
                    and not p.get("eliminated", False)
                    and not p.get("kicked", False)
                    and not p.get("left", False)]
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
        room["idle_expires_at"] = time.time() + 600
        # Remove kicked/left players — they should not appear in the next lobby
        kicked_or_left = [pid for pid, p in room["players"].items()
                          if p.get("kicked") or p.get("left")]
        for pid in kicked_or_left:
            del room["players"][pid]
        # If host was removed, transfer to next available player
        if room["host"] not in room["players"] and room["players"]:
            room["host"] = next(iter(room["players"]))
        for p in room["players"].values():
            p["clue"] = None
            p["vote"] = None
            p["revealed"] = False
            p["eliminated"] = False
            p["word_revealer"] = False
        # Clamp num_imposters if player count dropped
        settings = room.get("settings")
        if settings and room["players"]:
            max_imp = self.get_max_imposters(len(room["players"]))
            if settings["num_imposters"] > max_imp:
                settings["num_imposters"] = max_imp
        self._save_room(room)
        return True

    def next_round(self, room_id: str) -> bool:
        room = self._get_room(room_id)
        if not room or room["state"] != "round_end":
            return False

        # Exclude eliminated, revealed (word revealers), kicked, and left players from next round
        eligible_ids = [pid for pid, p in room["players"].items()
                        if not p.get("revealed", False) and not p.get("eliminated", False)
                        and not p.get("kicked", False) and not p.get("left", False)]
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
            "win_reason": room.get("win_reason", ""),
            "skip_count": room.get("last_skip_count", 0),
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
            "skip_won": room.get("last_skip_won", False),
        }

    def get_room_state(self, room_id: str, player_id: str, room: dict = None) -> Optional[dict]:
        if room is None:
            room = self._get_room(room_id)
        if not room:
            return None

        players_list = []
        for pid, player in room["players"].items():
            players_list.append({
                "id": pid,
                "name": player["name"],
                "clue": player["clue"],
                "vote": (
                    player["vote"] if room["state"] in ("results", "round_end") or pid == player_id
                    else "skip" if player["vote"] == "skip"
                    else "voted" if player["vote"] is not None
                    else None
                ),
                "is_host": pid == room["host"],
                "connected": player.get("connected", True),
                "revealed": player.get("revealed", False),
                "eliminated": player.get("eliminated", False),
                "kicked": player.get("kicked", False),
                "left": player.get("left", False),
                "word_revealer": player.get("word_revealer", False),
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
            skip_won = room.get("last_skip_won", False)
            round_end_info = {
                "eliminated_id": elim_id,
                "eliminated_name": elim_name,
                "vote_counts": room.get("last_vote_counts", {}),
                "most_voted_ids": room.get("last_most_voted_ids", []),
                "was_tie": elim_id is None and not skip_won,
                "skip_won": skip_won,
                "skip_count": room.get("last_skip_count", 0),
                "eliminated_was_imposter": (elim_id in room["imposters"]) if elim_id else None,
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
            "discreet_mode": False, "word_similarity": "similar",
            "max_players": 10, "anonymous_role": False,
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
            "idle_expires_at": room.get("idle_expires_at") if room["state"] == "lobby" else None,
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
        # Fetch room from Redis once, reuse for all players
        room = self._get_room(room_id)
        if not room:
            return
        dead = []
        for pid, ws in self.connections[room_id].items():
            state = self.get_room_state(room_id, pid, room=room)
            if state:
                try:
                    await ws.send_json({"type": "state_update", "payload": state})
                except Exception:
                    dead.append(pid)
        for pid in dead:
            self.connections[room_id].pop(pid, None)
