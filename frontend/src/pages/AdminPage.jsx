import { useState, useEffect, useCallback } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const STATE_COLORS = {
  lobby: "#7c3aed",
  playing: "#059669",
  voting: "#d97706",
  round_end: "#2563eb",
  results: "#dc2626",
};

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function timeAgo(ts) {
  if (!ts) return "Unknown";
  const secs = Math.floor(Date.now() / 1000 - ts);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem("admin_token") || "");
  const [input, setInput] = useState("");
  const [authed, setAuthed] = useState(!!sessionStorage.getItem("admin_token"));
  const [rooms, setRooms] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const fetchRooms = useCallback(async (t) => {
    try {
      const res = await fetch(`${API_URL}/admin/rooms`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        setError("Invalid password. Please log in again.");
        setAuthed(false);
        sessionStorage.removeItem("admin_token");
        return;
      }
      const data = await res.json();
      setRooms(data.rooms || []);
      setLastRefresh(new Date());
      setError("");
    } catch {
      setError("Failed to reach server.");
    }
  }, []);

  useEffect(() => {
    if (!authed || !token) return;
    fetchRooms(token);
    const interval = setInterval(() => fetchRooms(token), 5000);
    return () => clearInterval(interval);
  }, [authed, token, fetchRooms]);

  function handleLogin(e) {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    fetch(`${API_URL}/admin/rooms`, {
      headers: { Authorization: `Bearer ${input.trim()}` },
    })
      .then((res) => {
        setLoading(false);
        if (res.status === 401) {
          setError("Wrong password.");
          return;
        }
        sessionStorage.setItem("admin_token", input.trim());
        setToken(input.trim());
        setAuthed(true);
        setError("");
        return res.json();
      })
      .then((data) => {
        if (data) {
          setRooms(data.rooms || []);
          setLastRefresh(new Date());
        }
      })
      .catch(() => {
        setLoading(false);
        setError("Failed to reach server.");
      });
  }

  function handleLogout() {
    sessionStorage.removeItem("admin_token");
    setToken("");
    setAuthed(false);
    setRooms([]);
    setInput("");
  }

  if (!authed) {
    return (
      <div className="page center">
        <div className="card" style={{ maxWidth: 360, width: "100%" }}>
          <h2 style={{ marginBottom: 16 }}>Admin Login</h2>
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="password"
              placeholder="Admin password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #334155", background: "#1e293b", color: "#f1f5f9", fontSize: 15 }}
              autoFocus
            />
            {error && <p style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>{error}</p>}
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Checking..." : "Login"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const filteredRooms = rooms.filter((r) =>
    r.id.toUpperCase().includes(filter.toUpperCase().trim())
  );

  return (
    <div className="page" style={{ padding: "24px 16px", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Admin Dashboard</h1>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 14 }}>
            {rooms.length} active room{rooms.length !== 1 ? "s" : ""}
            {lastRefresh && (
              <span style={{ marginLeft: 12 }}>Last updated: {formatTime(lastRefresh)}</span>
            )}
          </p>
        </div>
        <button className="btn" onClick={handleLogout} style={{ padding: "8px 16px" }}>
          Logout
        </button>
      </div>

      {/* Filter */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Filter by room code..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #334155",
            background: "#1e293b",
            color: "#f1f5f9",
            fontSize: 14,
            width: "100%",
            maxWidth: 280,
            boxSizing: "border-box",
          }}
        />
      </div>

      {error && <p style={{ color: "#ef4444", marginBottom: 16 }}>{error}</p>}

      {rooms.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "#94a3b8", padding: 48 }}>
          No active rooms
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "#94a3b8", padding: 48 }}>
          &ldquo;{filter}&rdquo; &mdash; no match
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {filteredRooms.map((room) => (
            <RoomCard key={room.id} room={room} token={token} onDeleted={() => fetchRooms(token)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, token, onDeleted }) {
  const stateColor = STATE_COLORS[room.state] || "#64748b";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await fetch(`${API_URL}/admin/rooms/${room.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      onDeleted();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      {/* Room header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <span className="badge" style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>
          {room.id}
        </span>
        <span className="badge" style={{ background: stateColor, color: "#fff", textTransform: "uppercase", fontSize: 11 }}>
          {room.state}
        </span>
        {room.total_rounds > 0 && (
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            Round {room.current_round}/{room.total_rounds}
          </span>
        )}
        <span style={{ color: "#64748b", fontSize: 12, marginLeft: "auto" }}>
          {timeAgo(room.created_at)}
        </span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid #ef4444",
            background: confirmDelete ? "#ef4444" : "transparent",
            color: confirmDelete ? "#fff" : "#ef4444",
            fontSize: 12,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {deleting ? "Deleting..." : confirmDelete ? "Sure?" : "Delete"}
        </button>
      </div>

      {/* Words */}
      {room.word && (
        <div style={{ marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            <span style={{ color: "#94a3b8", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Word</span>
            <p style={{ margin: "2px 0 0", fontWeight: 600 }}>{room.word}</p>
          </div>
          {room.imposter_word && (
            <div>
              <span style={{ color: "#94a3b8", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Imposter word</span>
              <p style={{ margin: "2px 0 0", fontWeight: 600, color: "#ef4444" }}>{room.imposter_word}</p>
            </div>
          )}
        </div>
      )}

      {/* Settings */}
      {room.settings && Object.keys(room.settings).length > 0 && (
        <div style={{ marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#94a3b8" }}>
          {room.settings.thinking_time && <span>Think: {room.settings.thinking_time}s</span>}
          {room.settings.voting_time && <span>Vote: {room.settings.voting_time}s</span>}
          {room.settings.num_imposters && <span>Imposters: {room.settings.num_imposters}</span>}
        </div>
      )}

      {/* Players */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {room.players.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 20,
              background: "#1e293b",
              border: "1px solid #334155",
              fontSize: 13,
              opacity: p.eliminated ? 0.45 : 1,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: p.connected ? "#22c55e" : "#ef4444",
                flexShrink: 0,
              }}
            />
            {p.is_imposter && <span title="Imposter">👑</span>}
            <span style={{ color: p.eliminated ? "#64748b" : "#f1f5f9" }}>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
