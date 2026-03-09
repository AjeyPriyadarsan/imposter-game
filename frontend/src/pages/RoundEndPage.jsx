import { useGame } from "../context/GameContext";

export default function RoundEndPage() {
  const { gameState, playerInfo, sendMessage } = useGame();

  if (!gameState || !gameState.round_end_info) return <div className="page center"><p>Loading...</p></div>;

  const { round_end_info } = gameState;
  const isHost = gameState.host === playerInfo.id;
  const currentRound = gameState.current_round || 1;
  const totalRounds = gameState.total_rounds || 1;

  const { eliminated_name, eliminated_id, vote_counts, most_voted_ids, was_tie } = round_end_info;

  const colors = ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];

  // Players with at least 1 vote, sorted descending
  const votedPlayers = gameState.players
    .filter((p) => (vote_counts[p.id] || 0) > 0)
    .sort((a, b) => (vote_counts[b.id] || 0) - (vote_counts[a.id] || 0));

  function handleNextRound() {
    sendMessage({ type: "next_round" });
  }

  return (
    <div className="page center">
      <div className="round-indicator">Round {currentRound} of {totalRounds}</div>

      <div className={`outcome-banner ${was_tie ? "outcome-tie" : "outcome-escaped"}`}>
        <div className="outcome-icon">{was_tie ? "🤝" : "🚫"}</div>
        <h1>{was_tie ? "It's a Tie!" : `${eliminated_name} has been eliminated`}</h1>
        <p>{was_tie ? "No one was eliminated — game continues" : "The investigation continues..."}</p>
      </div>

      {votedPlayers.length > 0 && (
        <div className="result-card card" style={{ width: "100%" }}>
          <h3>Vote Tally</h3>
          <div className="clue-list">
            {votedPlayers.map((player, idx) => {
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
          </div>
        </div>
      )}

      <div className="results-actions">
        {isHost ? (
          <button className="btn btn-primary" onClick={handleNextRound}>
            Start Round {currentRound + 1}
          </button>
        ) : (
          <p className="hint">Waiting for host to start round {currentRound + 1}...</p>
        )}
      </div>
    </div>
  );
}
