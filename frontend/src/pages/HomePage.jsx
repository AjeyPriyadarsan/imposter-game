import { useState, useEffect, useRef } from "react";
import { useGame } from "../context/GameContext";
import { Plus, LogIn, ArrowLeft, Gamepad2, Fingerprint, RefreshCw } from "lucide-react";

const CREATE_STEPS = [
  { delay: 0,     text: "Waking up server…" },
  { delay: 7000,  text: "Starting services…" },
  { delay: 20000, text: "Almost ready…" },
  { delay: 35000, text: "Creating your room…" },
  { delay: 50000, text: "Just a moment…" },
];

const JOIN_STEPS = [
  { delay: 0,    text: "Connecting…" },
  { delay: 5000, text: "Joining room…" },
  { delay: 10000, text: "Almost there…" },
];

export default function HomePage() {
  const { createRoom, joinRoom, error, pendingRoomCode } = useGame();
  const [name, setName] = useState(() => {
    try { return localStorage.getItem("player:name") || ""; } catch { return ""; }
  });
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState(null); // "create" | "join"
  const [loading, setLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState(null); // null | 'loading' | 'failed'
  const [loadMsg, setLoadMsg] = useState("");
  const timersRef = useRef([]);

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

  function startLoadingMessages(steps) {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    steps.forEach(({ delay, text }) => {
      const t = setTimeout(() => setLoadMsg(text), delay);
      timersRef.current.push(t);
    });
  }

  function clearLoadingTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  async function handleCreate(e) {
    e?.preventDefault();
    if (!name.trim()) return;
    setMode("create");
    setLoadStatus("loading");
    setLoadMsg(CREATE_STEPS[0].text);
    startLoadingMessages(CREATE_STEPS);
    const result = await createRoom(name.trim());
    clearLoadingTimers();
    if (!result) {
      setLoadStatus("failed");
      setLoadMsg("Failed to connect. Server may be starting up.");
    }
    // on success, GameContext navigates away — no cleanup needed
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!name.trim() || !roomCode.trim()) return;
    setLoading(true);
    setLoadStatus("loading");
    setLoadMsg(JOIN_STEPS[0].text);
    startLoadingMessages(JOIN_STEPS);
    await joinRoom(roomCode.trim(), name.trim());
    clearLoadingTimers();
    setLoading(false);
    setLoadStatus(null);
  }

  function handleRetry() {
    if (mode === "join") {
      handleJoin({ preventDefault: () => {} });
    } else {
      handleCreate();
    }
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
        <h1 className="title">Word Imposter</h1>
        <p className="subtitle">Find the imposter among your friends</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loadStatus === "loading" && (
        <div className="card room-loading-card" style={{ width: "100%", alignItems: "center", gap: 20, padding: "36px 24px" }}>
          <div className="room-spinner" />
          <div style={{ textAlign: "center" }}>
            <div key={loadMsg} className="room-loading-msg">{loadMsg}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}>
              First launch may take up to 60 seconds
            </div>
          </div>
        </div>
      )}

      {loadStatus === "failed" && (
        <div className="card" style={{ width: "100%", alignItems: "center", gap: 16, padding: "32px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 36 }}>⚠️</div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Could not reach server</div>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{loadMsg}</div>
          </div>
          <button className="btn btn-primary" onClick={handleRetry}>
            <RefreshCw size={15} />
            Try Again
          </button>
        </div>
      )}

      {!loadStatus && !mode && (
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

      {!loadStatus && mode === "join" && (
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
            placeholder="Room code (e.g. 1234)"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ""))}
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

      {!loadStatus && !mode && (
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
