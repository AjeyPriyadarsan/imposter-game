import { useState, useEffect, useRef } from "react";
import { useGame } from "../context/GameContext";

function useCountdown(startTime, duration, serverTime) {
  const [remaining, setRemaining] = useState(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!startTime || !duration || !serverTime) {
      setRemaining(null);
      return;
    }
    offsetRef.current = serverTime - Date.now() / 1000;
  }, [serverTime, startTime, duration]);

  useEffect(() => {
    if (!startTime || !duration) {
      setRemaining(null);
      return;
    }

    function tick() {
      const now = Date.now() / 1000 + offsetRef.current;
      const elapsed = now - startTime;
      const left = Math.max(0, Math.ceil(duration - elapsed));
      setRemaining(left);
    }

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [startTime, duration]);

  return remaining;
}

export default function VotingPage() {
  const { gameState, playerInfo, sendMessage } = useGame();

  if (!gameState) return <div className="page center"><p>Loading...</p></div>;

  const votingTime = gameState.settings?.voting_time || 60;
  const remaining = useCountdown(
    gameState.phase_start_time,
    votingTime,
    gameState.server_time
  );

  const me = gameState.players.find((p) => p.id === playerInfo.id);
  const hasVoted = me?.vote !== null && me?.vote !== undefined;
  const votesCast = gameState.players.filter((p) => p.vote !== null && p.vote !== undefined).length;
  const totalPlayers = gameState.players.length;

  function handleVote(targetId) {
    if (hasVoted || targetId === playerInfo.id) return;
    sendMessage({ type: "submit_vote", voted_id: targetId });
  }

  const orderedPlayers = gameState.clue_order
    .map((id) => gameState.players.find((p) => p.id === id))
    .filter(Boolean);

  return (
    <div className="page center">
      <div className="page-heading">
        <h1>Vote</h1>
        <p>Who do you think is the imposter?</p>
        {remaining !== null && (
          <div className={`countdown-badge countdown-inline${remaining <= 10 ? " countdown-urgent" : ""}`}>
            {remaining}s
          </div>
        )}
      </div>

      <div className="vote-progress">
        <div className="vote-progress-bar">
          <div
            className="vote-progress-fill"
            style={{ width: `${(votesCast / totalPlayers) * 100}%` }}
          />
        </div>
        <p className="vote-count">{votesCast}/{totalPlayers} voted</p>
      </div>

      <div className="clues-review card" style={{ width: "100%" }}>
        <h3>Clues from this round</h3>
        <div className="clue-list">
          {orderedPlayers.map((player, idx) => (
            <div key={player.id} className="clue-row">
              <div className="clue-player-info">
                <span className="clue-order-num">{idx + 1}</span>
                <span className="clue-player-name">{player.name}</span>
              </div>
              <span className="clue-word">{player.clue || "—"}</span>
            </div>
          ))}
        </div>
      </div>

      {hasVoted ? (
        <div className="voted-message">
          <p>Vote cast! Waiting for others...</p>
        </div>
      ) : (
        <div className="vote-grid">
          <h3>Tap to vote</h3>
          <div className="vote-buttons">
            {gameState.players.map((player, idx) => {
              const isSelf = player.id === playerInfo.id;
              const colors = ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];
              return (
                <button
                  key={player.id}
                  className={`vote-btn ${isSelf ? "vote-btn-disabled" : ""}`}
                  onClick={() => handleVote(player.id)}
                  disabled={isSelf}
                >
                  <span className="vote-avatar" style={{ background: colors[idx % colors.length] }}>
                    {player.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="vote-player-name">{player.name}</span>
                  {isSelf && <span className="vote-self-hint">(you)</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
