import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";

const GameContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

function getUrlRoomCode() {
  const path = window.location.pathname.slice(1).toUpperCase();
  return /^[A-Z]{4}$/.test(path) ? path : null;
}

function saveSession(roomId, playerId, name) {
  localStorage.setItem(`session:${roomId}`, JSON.stringify({ player_id: playerId, name }));
}

function loadSession(roomId) {
  try {
    const stored = localStorage.getItem(`session:${roomId}`);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function clearSession(roomId) {
  localStorage.removeItem(`session:${roomId}`);
}

export function GameProvider({ children }) {
  const [playerInfo, setPlayerInfo] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState(null);
  const [pendingRoomCode, setPendingRoomCode] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const wsRef = useRef(null);

  // Returns a Promise<boolean> — true if WS connected successfully, false if rejected
  const connectWs = useCallback((roomId, playerId) => {
    return new Promise((resolve) => {
      let resolved = false;
      let opened = false;
      let kicked = false;
      const ws = new WebSocket(`${WS_URL}/ws/${roomId}/${playerId}`);

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "state_update") {
          setGameState(msg.payload);
        } else if (msg.type === "error") {
          setError(msg.payload.message);
          setTimeout(() => setError(null), 3000);
        } else if (msg.type === "kicked") {
          kicked = true;
          clearSession(roomId);
          setPlayerInfo(null);
          setGameState(null);
          setPendingRoomCode(null);
          history.pushState(null, "", "/");
          setError("You were kicked by the host.");
          setTimeout(() => setError(null), 3000);
        } else if (msg.type === "room_closed") {
          clearSession(roomId);
          setPlayerInfo(null);
          setGameState(null);
          setPendingRoomCode(null);
          history.pushState(null, "", "/");
          setError(msg.payload.message || "Room closed due to inactivity");
          setTimeout(() => setError(null), 5000);
        }
      };

      ws.onopen = () => {
        opened = true;
        if (!resolved) { resolved = true; resolve(true); }
      };

      ws.onclose = (e) => {
        if (!resolved) { resolved = true; resolve(false); }
        else if (opened && !kicked) {
          if (e.code === 4008) {
            clearSession(roomId);
            setPlayerInfo(null);
            setGameState(null);
            setPendingRoomCode(null);
            history.pushState(null, "", "/");
            setError("You were kicked by the host.");
            setTimeout(() => setError(null), 3000);
          } else {
            setError("Connection lost. Please refresh.");
          }
        }
      };

      ws.onerror = () => {
        if (!resolved) { resolved = true; resolve(false); }
      };

      wsRef.current = ws;
    });
  }, []);

  // On mount: check URL for room code and try session resume
  useEffect(() => {
    const roomCode = getUrlRoomCode();
    if (!roomCode) return;

    const session = loadSession(roomCode);
    if (!session) {
      setPendingRoomCode(roomCode);
      return;
    }

    setReconnecting(true);
    connectWs(roomCode, session.player_id).then((success) => {
      setReconnecting(false);
      if (success) {
        setPlayerInfo({ id: session.player_id, name: session.name, roomId: roomCode });
      } else {
        clearSession(roomCode);
        setPendingRoomCode(roomCode);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createRoom = useCallback(
    async (name) => {
      try {
        setError(null);
        const res = await fetch(`${API_URL}/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_name: name }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail);
        }
        const data = await res.json();
        saveSession(data.room_id, data.player_id, name);
        history.pushState(null, "", `/${data.room_id}`);
        setPlayerInfo({ id: data.player_id, name, roomId: data.room_id });
        setPendingRoomCode(null);
        await connectWs(data.room_id, data.player_id);
        return data.room_id;
      } catch (e) {
        setError(e.message);
        setTimeout(() => setError(null), 3000);
        return null;
      }
    },
    [connectWs]
  );

  const joinRoom = useCallback(
    async (roomId, name) => {
      try {
        setError(null);
        const code = roomId.trim().toUpperCase();
        const res = await fetch(`${API_URL}/rooms/${code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_name: name }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail);
        }
        const data = await res.json();
        saveSession(code, data.player_id, name);
        history.pushState(null, "", `/${code}`);
        setPlayerInfo({ id: data.player_id, name, roomId: code });
        setPendingRoomCode(null);
        await connectWs(code, data.player_id);
      } catch (e) {
        setError(e.message);
        setTimeout(() => setError(null), 3000);
      }
    },
    [connectWs]
  );

  const sendMessage = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const leaveRoom = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (playerInfo?.roomId) clearSession(playerInfo.roomId);
    setPlayerInfo(null);
    setGameState(null);
    setPendingRoomCode(null);
    window.location.href = "/";
  }, [playerInfo]);

  return (
    <GameContext.Provider
      value={{ playerInfo, gameState, error, createRoom, joinRoom, sendMessage, leaveRoom, pendingRoomCode, reconnecting }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}
