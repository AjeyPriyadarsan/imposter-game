import { useState, useEffect } from "react";
import { useGame } from "../context/GameContext";
import { SkipForward, Scale, Ban } from "lucide-react";

const AUTO_ADVANCE_DELAY = 30;

export default function RoundEndPage() {
  const { gameState, playerInfo, sendMessage } = useGame();
  const [countdown, setCountdown] = useState(AUTO_ADVANCE_DELAY);

  const totalRounds = gameState?.total_rounds || 1;
  const isMultiRound = totalRounds > 1;

  useEffect(() => {
    if (!isMultiRound || !gameState?.phase_start_time) return;

    const elapsed = (gameState.server_time || Date.now() / 1000) - gameState.phase_start_time;
    const initial = Math.max(0, AUTO_ADVANCE_DELAY - Math.floor(elapsed));
    setCountdown(initial);

    if (initial <= 0) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [gameState?.phase_start_time, isMultiRound]);

  if (!gameState || !gameState.round_end_info) return <div className="page center"><p>Loading...</p></div>;

  const { round_end_info } = gameState;
  const isHost = gameState.host === playerInfo.id;
  const currentRound = gameState.current_round || 1;

  const { eliminated_name, eliminated_id, vote_counts, most_voted_ids, was_tie, skip_won, skip_count } = round_end_info;

  const colors = ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];

  const votedPlayers = gameState.players
    .filter((p) => (vote_counts[p.id] || 0) > 0)
    .sort((a, b) => (vote_counts[b.id] || 0) - (vote_counts[a.id] || 0));

  function handleNextRound() {
    sendMessage({ type: "next_round" });
  }

  return (
    <div className="page center">
      <div className="round-indicator">Round {currentRound} of {totalRounds}</div>

      <div className={`outcome-banner ${(was_tie || skip_won) ? "outcome-tie" : "outcome-escaped"}`}>
        <div className="outcome-icon">{skip_won ? <SkipForward size={44} /> : was_tie ? <Scale size={44} /> : <Ban size={44} />}</div>
        <h1>
          {skip_won
            ? "Vote Skipped!"
            : was_tie
            ? "It's a Tie!"
            : `${eliminated_name} has been eliminated`}
        </h1>
        <p>
          {skip_won
            ? `${skip_count} skip vote${skip_count !== 1 ? "s" : ""} — no one was eliminated`
            : was_tie
            ? "No one was eliminated — game continues"
            : "The investigation continues..."}
        </p>
      </div>

      {(votedPlayers.length > 0 || (skip_count || 0) > 0) && (
        <div className="result-card card" style={{ width: "100%" }}>
          <h3>Vote Tally</h3>
          <div className="clue-list">
            {votedPlayers.map((player) => {
              const count = vote_counts[player.id] || 0;
              const isEliminated = player.id === eliminated_id;
              const colorIdx = gameState.players.findIndex((p) => p.id === player.id);
              return (
                <div key={player.id} className={`clue-row result-clue-row ${isEliminated ? "imposter-row" : ""}`}>
                  <div className="clue-player-info">
                    <span
                      className="vote-avatar"
                      style={{ background: colors[colorIdx % colors.length], width: 28, height: 28, fontSize: 13 }}
                    >
                      {player.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="clue-player-name">
                      {player.name}
                      {player.id === playerInfo.id && <span className="badge badge-you">You</span>}
                      {isEliminated && <span className="badge badge-revealed">Eliminated</span>}
                    </span>
                  </div>
                  <span className="vote-tally">{count} vote{count !== 1 ? "s" : ""}</span>
                </div>
              );
            })}
            {(skip_count || 0) > 0 && (
              <div className="clue-row result-clue-row">
                <div className="clue-player-info">
                  <span
                    className="vote-avatar"
                    style={{ background: "#6b7280", width: 28, height: 28, fontSize: 13 }}
                  >
                    <SkipForward size={14} />
                  </span>
                  <span className="clue-player-name" style={{ color: "var(--text-muted, #9ca3af)" }}>
                    Skipped / No vote
                  </span>
                </div>
                <span className="vote-tally">{skip_count} skip{skip_count !== 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="results-actions">
        {isHost ? (
          <>
            <button className="btn btn-primary" onClick={handleNextRound}>
              Start Round {currentRound + 1} Now
            </button>
            {isMultiRound && (
              <p className="hint">Auto-starting in {countdown}s...</p>
            )}
          </>
        ) : (
          <p className="hint">
            {isMultiRound
              ? `Round ${currentRound + 1} starts in ${countdown}s...`
              : `Waiting for host to start round ${currentRound + 1}...`}
          </p>
        )}
      </div>
    </div>
  );
}
