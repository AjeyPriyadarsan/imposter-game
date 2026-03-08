import { useState, useEffect } from "react";
import { useGame } from "../context/GameContext";

export default function HomePage() {
  const { createRoom, joinRoom, error, pendingRoomCode } = useGame();
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState(null); // "create" | "join"
  const [loading, setLoading] = useState(false);

  // If we arrived via a room link, jump straight to join mode
  useEffect(() => {
    if (pendingRoomCode) {
      setRoomCode(pendingRoomCode);
      // Pre-fill name from any previously stored session for this room
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
    e.preventDefault();
    if (!name.trim()) return;
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
        <div className="logo">🕵️</div>
        <h1 className="title">Imposterprud</h1>
        <p className="subtitle">Find the imposter among your friends</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!mode && (
        <div className="card" style={{ maxWidth: 360 }}>
          <input
            className="input"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoFocus
          />
          <div className="btn-group">
            <button
              className="btn btn-primary"
              onClick={() => name.trim() && setMode("create")}
              disabled={!name.trim()}
            >
              Create Room
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => name.trim() && setMode("join")}
              disabled={!name.trim()}
            >
              Join Room
            </button>
          </div>
        </div>
      )}

      {mode === "create" && (
        <form
          className="card"
          style={{ maxWidth: 360 }}
          onSubmit={handleCreate}
        >
          <p className="label">
            Playing as <strong>{name}</strong>
          </p>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Room"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={handleBack}>
            Back
          </button>
        </form>
      )}

      {mode === "join" && (
        <form className="card" style={{ maxWidth: 360 }} onSubmit={handleJoin}>
          <input
            className="input"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoFocus={!name}
          />
          <input
            className="input"
            type="text"
            placeholder="Room code (e.g. ABCD)"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={4}
            readOnly={!!pendingRoomCode}
          />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading || roomCode.length !== 4 || !name.trim()}
          >
            {loading ? "Joining..." : "Join Room"}
          </button>
          {!pendingRoomCode && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={handleBack}
            >
              Back
            </button>
          )}
        </form>
      )}

      {!mode && (
        <div className="how-to-play">
          <h3>How to play</h3>
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
