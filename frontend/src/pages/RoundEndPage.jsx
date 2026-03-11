import { useState, useEffect } from "react";
import { useGame } from "../context/GameContext";
import { SkipForward, Scale, Ban, Eye } from "lucide-react";

const AUTO_ADVANCE_DELAY = 60;

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

  const { eliminated_name, eliminated_id, vote_counts, most_voted_ids, was_tie, skip_won, skip_count, eliminated_was_imposter } = round_end_info;
  const isAnonymous = gameState.settings?.anonymous_role === true;
  const isDiscreet = gameState.settings?.discreet_mode === true;
  const isAnonymousVoter = gameState.settings?.anonymous_voter !== false;
  const [revealingElim, setRevealingElim] = useState(false);

  const colors = ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];

  const votedPlayers = gameState.players
    .filter((p) => (vote_counts[p.id] || 0) > 0)
    .sort((a, b) => (vote_counts[b.id] || 0) - (vote_counts[a.id] || 0));

  const allPlayersSorted = gameState.players
    .filter((p) => !p.kicked && !p.left)
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
        {isAnonymous && !isDiscreet && eliminated_was_imposter !== null && (
          <span className={`badge ${eliminated_was_imposter ? "badge-imposter" : "badge-innocent"}`}>
            {eliminated_was_imposter ? "Was Imposter!" : "Was Innocent"}
          </span>
        )}
        {isAnonymous && isDiscreet && eliminated_was_imposter !== null && (
          <div
            className={`discreet-card${revealingElim ? " revealing" : ""}`}
            onMouseDown={() => setRevealingElim(true)}
            onMouseUp={() => setRevealingElim(false)}
            onMouseLeave={() => setRevealingElim(false)}
            onTouchStart={() => setRevealingElim(true)}
            onTouchEnd={() => setRevealingElim(false)}
            style={{ userSelect: "none", touchAction: "none", marginTop: 8 }}
          >
            {revealingElim ? (
              <span className={`badge ${eliminated_was_imposter ? "badge-imposter" : "badge-innocent"}`}>
                {eliminated_was_imposter ? "Was Imposter!" : "Was Innocent"}
              </span>
            ) : (
              <p className="discreet-label"><Eye size={14} /> Hold to reveal role</p>
            )}
          </div>
        )}
      </div>

      {(votedPlayers.length > 0 || (skip_count || 0) > 0) && (
        <div className="result-card card" style={{ width: "100%" }}>
          <h3>Vote Tally</h3>
          <div className="clue-list">
            {(() => {
              const votedByMap = {};
              gameState.players.filter((p) => !p.kicked && !p.left).forEach((voter) => {
                if (voter.vote && voter.vote !== "skip") {
                  if (!votedByMap[voter.vote]) votedByMap[voter.vote] = [];
                  votedByMap[voter.vote].push(voter);
                }
              });
              const skippers = gameState.players.filter((p) => !p.kicked && !p.left && (!p.vote || p.vote === "skip"));
              return (
                <>
                  {allPlayersSorted.map((player) => {
                    const colorIdx = gameState.players.findIndex((p) => p.id === player.id);
                    const isEliminated = player.id === eliminated_id;
                    const voters = isAnonymousVoter ? [] : (votedByMap[player.id] || []);
                    const voteCount = vote_counts[player.id] || 0;
                    return (
                      <div key={player.id} className={`clue-row result-clue-row ${isEliminated ? "imposter-row" : ""}`}>
                        <div className="clue-player-info">
                          <span className="vote-avatar" style={{ background: colors[colorIdx % colors.length], width: 28, height: 28, fontSize: 13 }}>
                            {player.name.charAt(0).toUpperCase()}
                          </span>
                          <span className="clue-player-name">
                            {player.name}
                            {player.id === playerInfo.id && <span className="badge badge-you">You</span>}
                            {player.id === gameState.host && <span className="badge badge-host">Host</span>}
                            {isEliminated && <span className="badge badge-revealed">Eliminated</span>}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {isAnonymousVoter ? (
                            voteCount > 0 && (
                              <span style={{ color: "var(--text-muted, #9ca3af)", fontSize: 13 }}>
                                {voteCount} vote{voteCount !== 1 ? "s" : ""}
                              </span>
                            )
                          ) : (
                            voters.map((voter) => {
                              const voterIdx = gameState.players.findIndex((p) => p.id === voter.id);
                              return (
                                <span key={voter.id} className="vote-avatar" title={voter.name}
                                  style={{ background: colors[voterIdx % colors.length], width: 24, height: 24, fontSize: 11 }}>
                                  {voter.name.charAt(0).toUpperCase()}
                                </span>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {(isAnonymousVoter ? (skip_count || 0) > 0 : skippers.length > 0) && (
                    <div className="clue-row result-clue-row">
                      <div className="clue-player-info">
                        <span className="vote-avatar" style={{ background: "#6b7280", width: 28, height: 28, fontSize: 13 }}>
                          <SkipForward size={14} />
                        </span>
                        <span className="clue-player-name" style={{ color: "var(--text-muted, #9ca3af)" }}>Skipped</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {isAnonymousVoter ? (
                          <span style={{ color: "var(--text-muted, #9ca3af)", fontSize: 13 }}>
                            {skip_count} vote{skip_count !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          skippers.map((voter) => {
                            const voterIdx = gameState.players.findIndex((p) => p.id === voter.id);
                            return (
                              <span key={voter.id} className="vote-avatar" title={voter.name}
                                style={{ background: colors[voterIdx % colors.length], width: 24, height: 24, fontSize: 11 }}>
                                {voter.name.charAt(0).toUpperCase()}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
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
