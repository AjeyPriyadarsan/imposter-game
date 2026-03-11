import { useState, useEffect } from "react";
import { useGame } from "../context/GameContext";
import { Plus, LogIn, ArrowLeft, Gamepad2, Fingerprint } from "lucide-react";

export default function HomePage() {
  const { createRoom, joinRoom, error, pendingRoomCode } = useGame();
  const [name, setName] = useState(() => {
    try { return localStorage.getItem("player:name") || ""; } catch { return ""; }
  });
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState(null); // "create" | "join"
  const [loading, setLoading] = useState(false);

  function handleNameChange(e) {
    const val = e.target.value;
    setName(val);
    try { localStorage.setItem("player:name", val); } catch { /* ignore */ }
  }

  // If we arrived via a room link, jump straight to join mode
  useEffect(() => {
    if (pendingRoomCode) {
      setRoomCode(pendingRoomCode);
      // Pre-fill name from room-specific session if available, else use saved name
      try {
        const stored = localStorage.getItem(`session:${pendingRoomCode}`);
        if (stored) {
          const { name: storedName } = JSON.parse(stored);
          setName(storedName);
        }
      } catch {
        /* ignore */
      }
      setMode("join");
    }
  }, [pendingRoomCode]);

  async function handleCreate(e) {
    e?.preventDefault();
    if (!name.trim()) return;
    setMode("create");
    setLoading(true);
    await createRoom(name.trim());
    setLoading(false);
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!name.trim() || !roomCode.trim()) return;
    setLoading(true);
    await joinRoom(roomCode.trim(), name.trim());
    setLoading(false);
  }

  function handleBack() {
    setMode(null);
    // If we came from a room link, go back to root URL
    if (pendingRoomCode) {
      history.pushState(null, "", "/");
      window.location.reload();
    }
  }

  return (
    <div className="page center">
      <div className="hero">
        <div className="logo"><Fingerprint size={56} /></div>
        <h1 className="title">Imposter</h1>
        <p className="subtitle">Find the imposter among your friends</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!mode && (
        <div className="card" style={{ width: "100%" }}>
          <input
            className="input"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={handleNameChange}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(e); }}
            maxLength={20}
            autoFocus
          />
          <div className="btn-group">
            <button
              className="btn btn-primary btn-full"
              onClick={handleCreate}
              disabled={!name.trim() || loading}
            >
              <Plus size={16} />
              {loading && mode === "create" ? "Creating..." : "Create Room"}
            </button>
            <button
              className="btn btn-secondary btn-full"
              onClick={() => name.trim() && setMode("join")}
              disabled={!name.trim()}
            >
              <LogIn size={16} />
              Join Room
            </button>
          </div>
        </div>
      )}

{mode === "join" && (
        <form className="card" style={{ width: "100%" }} onSubmit={handleJoin}>
          <input
            className="input"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={handleNameChange}
            maxLength={20}
            autoFocus={!name}
          />
          <input
            className="input input-large"
            type="text"
            placeholder="Room code (e.g. ABCD)"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={4}
            readOnly={!!pendingRoomCode}
          />
          <div className="btn-group">
            <button
              className="btn btn-primary btn-full"
              type="submit"
              autoFocus={!!name.trim() && roomCode.length === 4}
              disabled={loading || roomCode.length !== 4 || !name.trim()}
            >
              <LogIn size={16} />
              {loading ? "Joining..." : "Join Room"}
            </button>
            <button
              className="btn btn-ghost btn-full"
              type="button"
              onClick={handleBack}
            >
              <ArrowLeft size={15} />
              Back
            </button>
          </div>
        </form>
      )}

      {!mode && (
        <div className="how-to-play">
          <h3>
            <Gamepad2 size={13} />
            How to play
          </h3>
          <ol>
            <li>Everyone gets the same secret word — except 1-2 imposters</li>
            <li>Take turns giving a one-word clue about the word</li>
            <li>Vote on who you think the imposter is</li>
            <li>Imposters win if they avoid being caught</li>
          </ol>
        </div>
      )}
    </div>
  );
}
