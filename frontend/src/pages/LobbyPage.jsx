import { useState } from "react";
import { useGame } from "../context/GameContext";

export default function LobbyPage() {
  const { gameState, playerInfo, sendMessage, error } = useGame();
  const [copied, setCopied] = useState(false);

  function copyLink() {
    const url = `${window.location.origin}/${gameState.room_id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!gameState) return <div className="page center"><p>Connecting...</p></div>;

  const isHost = gameState.host === playerInfo.id;
  const playerCount = gameState.players.length;
  const canStart = playerCount >= 3;

  function handleStart() {
    sendMessage({ type: "start_game" });
  }

  return (
    <div className="page center">
      <div className="room-code-display">
        <span className="room-code-label">Room Code</span>
        <span className="room-code">{gameState.room_id}</span>
        <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={copyLink}>
          {copied ? "Copied!" : "Copy Link"}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ maxWidth: 400, width: "100%" }}>
        <div className="section-header">
          <h2>Players ({playerCount}/8)</h2>
        </div>
        <ul className="player-list">
          {gameState.players.map((p, idx) => {
            const colors = ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];
            return (
              <li key={p.id} className="player-item">
                <span className="player-name">
                  <span className="player-avatar" style={{ background: colors[idx % colors.length] }}>
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  {p.name}
                  {p.id === playerInfo.id && (
                    <span className="badge badge-you">You</span>
                  )}
                  {p.is_host && (
                    <span className="badge badge-host">Host</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {isHost ? (
          <div>
            {!canStart && (
              <p className="hint">Need at least 3 players to start</p>
            )}
            <button
              className="btn btn-primary btn-full"
              onClick={handleStart}
              disabled={!canStart}
            >
              Start Game
            </button>
          </div>
        ) : (
          <p className="hint center-text">Waiting for host to start the game...</p>
        )}
      </div>

      <div className="rules-info">
        <p>
          {playerCount >= 6
            ? "6+ players: 2 imposters"
            : "3-5 players: 1 imposter"}
        </p>
      </div>
    </div>
  );
}
