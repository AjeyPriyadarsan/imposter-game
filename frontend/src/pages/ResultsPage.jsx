import { useState, useEffect } from "react";
import { useGame } from "../context/GameContext";
import ConfirmModal from "../components/ConfirmModal";

const AUTO_LOBBY_DELAY = 30;

export default function ResultsPage() {
  const { gameState, playerInfo, sendMessage, leaveRoom } = useGame();
  const [countdown, setCountdown] = useState(AUTO_LOBBY_DELAY);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (!gameState?.phase_start_time) return;

    const elapsed = (gameState.server_time || Date.now() / 1000) - gameState.phase_start_time;
    const initial = Math.max(0, AUTO_LOBBY_DELAY - Math.floor(elapsed));
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
  }, [gameState?.phase_start_time]);

  if (!gameState || !gameState.results) return <div className="page center"><p>Loading...</p></div>;

  const { results } = gameState;
  const isHost = gameState.host === playerInfo.id;
  const iWasImposter = gameState.is_imposter;

  const currentRound = gameState.current_round || 1;
  const totalRounds = gameState.total_rounds || 1;

  // Determine outcome
  const { caught, tie, imposter_guessed } = results;

  // Did I win?
  let iWon;
  if (imposter_guessed) {
    iWon = iWasImposter;
  } else if (caught) {
    iWon = !iWasImposter; // innocents win
  } else {
    iWon = iWasImposter; // imposter wins
  }

  const orderedPlayers = gameState.clue_order
    .map((id) => gameState.players.find((p) => p.id === id))
    .filter(Boolean);

  function handlePlayAgain() {
    sendMessage({ type: "play_again" });
  }

  // Outcome banner
  let bannerClass, bannerIcon, bannerTitle, bannerSub;
  if (imposter_guessed) {
    bannerClass = "outcome-escaped";
    bannerIcon = "🎯";
    bannerTitle = "Imposter Guessed the Word!";
    bannerSub = results.win_reason || "The imposter wins!";
  } else if (caught) {
    bannerClass = "outcome-caught";
    bannerIcon = "🚨";
    bannerTitle = "Imposter Caught!";
    bannerSub = results.win_reason || "The crew wins!";
  } else if (tie) {
    bannerClass = "outcome-tie";
    bannerIcon = "🤝";
    bannerTitle = "Imposter Wins!";
    bannerSub = results.win_reason || "The crew couldn't agree — imposter escapes!";
  } else {
    bannerClass = "outcome-escaped";
    bannerIcon = "🎭";
    bannerTitle = "Imposter Escaped!";
    bannerSub = results.win_reason || "The imposter fooled everyone";
  }

  return (
    <div className="page center">
      <button className="leave-btn" onClick={() => setConfirmLeave(true)}>Leave Room</button>
      {totalRounds > 1 && (
        <div className="round-indicator">Round {currentRound} of {totalRounds}</div>
      )}

      <div className={`outcome-banner ${bannerClass}`}>
        <div className="outcome-icon">{bannerIcon}</div>
        <h1>{bannerTitle}</h1>
        <p>{bannerSub}</p>
      </div>

      <div className={`personal-result ${iWon ? "result-win" : "result-lose"}`}>
        {iWon ? "You won!" : "You lost!"}
        {iWasImposter && " (you were the imposter)"}
      </div>

      <div className="results-grid">
        <div className="result-card card">
          <h3>The Imposter{results.imposter_names.length > 1 ? "s" : ""}</h3>
          <div className="imposter-names">
            {results.imposter_names.map((name, i) => (
              <span key={i} className="imposter-name-tag">{name}</span>
            ))}
          </div>
          <div className="secret-word-result">
            <span className="word-label-small">Innocents' word</span>
            <span className="secret-word-reveal">{results.word}</span>
          </div>
          {results.imposter_word && results.imposter_word !== results.word && (
            <div className="secret-word-result">
              <span className="word-label-small">Imposter's word</span>
              <span className="secret-word-reveal">{results.imposter_word}</span>
            </div>
          )}
        </div>

        <div className="result-card card">
          <h3>Clues &amp; Votes</h3>
          <div className="clue-list">
            {orderedPlayers.map((player, idx) => {
              const isImposter = results.imposters.includes(player.id);
              const voteCount = results.vote_counts?.[player.id] || 0;
              return (
                <div
                  key={player.id}
                  className={`clue-row result-clue-row ${isImposter ? "imposter-row" : ""}`}
                >
                  <div className="clue-player-info">
                    <span className="clue-order-num">{idx + 1}</span>
                    <span className="clue-player-name">
                      {player.name}
                      {isImposter && <span className="badge badge-imposter">Imposter</span>}
                      {player.revealed && <span className="badge badge-revealed">Revealed</span>}
                      {player.eliminated && <span className="badge badge-revealed">Eliminated</span>}
                      {player.id === playerInfo.id && <span className="badge badge-you">You</span>}
                      {!player.connected && <span className="badge badge-disconnected">Disconnected</span>}
                    </span>
                  </div>
                  <div className="result-right">
                    {player.clue === "__word_revealed__" ? (
                      <span className="clue-revealed">Typed the word!</span>
                    ) : (
                      <span className="clue-word">{player.clue || "—"}</span>
                    )}
                    {voteCount > 0 && (
                      <span className="vote-tally">
                        {voteCount} vote{voteCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {(results.skip_count || 0) > 0 && (
              <div className="clue-row result-clue-row">
                <div className="clue-player-info">
                  <span className="clue-order-num">—</span>
                  <span className="clue-player-name" style={{ color: "var(--text-muted, #9ca3af)" }}>
                    Skipped / No vote
                  </span>
                </div>
                <div className="result-right">
                  <span className="vote-tally">
                    {results.skip_count} skip{results.skip_count !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="results-actions">
        {isHost ? (
          <>
            <button className="btn btn-secondary" onClick={handlePlayAgain}>
              Start New Match Now
            </button>
            <p className="hint">Returning to lobby in {countdown}s...</p>
          </>
        ) : (
          <p className="hint">Returning to lobby in {countdown}s...</p>
        )}
      </div>

      {confirmLeave && (
        <ConfirmModal
          title="Leave Room?"
          message="Are you sure you want to leave the room?"
          confirmLabel="Leave"
          confirmDanger
          onConfirm={leaveRoom}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}
