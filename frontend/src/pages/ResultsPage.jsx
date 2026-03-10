import { useGame } from "../context/GameContext";

export default function ResultsPage() {
  const { gameState, playerInfo, sendMessage } = useGame();

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
    bannerSub = "The imposter wins!";
  } else if (caught) {
    bannerClass = "outcome-caught";
    bannerIcon = "🚨";
    bannerTitle = "Imposter Caught!";
    bannerSub = "The crew wins!";
  } else if (tie) {
    bannerClass = "outcome-tie";
    bannerIcon = "🤝";
    bannerTitle = "Imposter Wins by Tie!";
    bannerSub = "The crew couldn't agree — imposter escapes!";
  } else {
    bannerClass = "outcome-escaped";
    bannerIcon = "🎭";
    bannerTitle = "Imposter Escaped!";
    bannerSub = "The imposter fooled everyone";
  }

  return (
    <div className="page center">
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
          </div>
        </div>
      </div>

      <div className="results-actions">
        {isHost ? (
          <button className="btn btn-secondary" onClick={handlePlayAgain}>
            Play Again
          </button>
        ) : (
          <p className="hint">Waiting for host to start a new game...</p>
        )}
      </div>
    </div>
  );
}
