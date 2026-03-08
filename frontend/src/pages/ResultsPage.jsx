import { useGame } from "../context/GameContext";

export default function ResultsPage() {
  const { gameState, playerInfo, sendMessage } = useGame();

  if (!gameState || !gameState.results) return <div className="page center"><p>Loading...</p></div>;

  const { results } = gameState;
  const isHost = gameState.host === playerInfo.id;
  const iWasImposter = gameState.is_imposter;
  const caught = results.caught;

  // Did I win?
  const iWon = iWasImposter ? !caught : caught;

  const orderedPlayers = gameState.clue_order
    .map((id) => gameState.players.find((p) => p.id === id))
    .filter(Boolean);

  function handlePlayAgain() {
    sendMessage({ type: "play_again" });
  }

  return (
    <div className="page center">
      <div className={`outcome-banner ${caught ? "outcome-caught" : "outcome-escaped"}`}>
        {caught ? (
          <>
            <div className="outcome-icon">🚨</div>
            <h1>Imposter Caught!</h1>
            <p>The crew wins this round</p>
          </>
        ) : (
          <>
            <div className="outcome-icon">🎭</div>
            <h1>Imposter Escaped!</h1>
            <p>The imposter fooled everyone</p>
          </>
        )}
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
              const votedFor = gameState.players.find((p) => p.vote === player.id);
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
                      {player.id === playerInfo.id && <span className="badge badge-you">You</span>}
                    </span>
                  </div>
                  <div className="result-right">
                    <span className="clue-word">{player.clue || "—"}</span>
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
          <button className="btn btn-primary" onClick={handlePlayAgain}>
            Play Again
          </button>
        ) : (
          <p className="hint">Waiting for host to start a new round...</p>
        )}
      </div>
    </div>
  );
}
