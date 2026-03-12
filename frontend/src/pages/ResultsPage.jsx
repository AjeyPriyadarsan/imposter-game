import { useState } from "react";
import { useGame } from "../context/GameContext";
import { Target, Siren, Scale, ShieldOff, AlertTriangle } from "lucide-react";
import ConfirmModal from "../components/ConfirmModal";
import { useCountdown } from "../hooks/useCountdown";

const AUTO_LOBBY_DELAY = 300;

export default function ResultsPage() {
  const { gameState, playerInfo, sendMessage, leaveRoom } = useGame();
  const [confirmLeave, setConfirmLeave] = useState(false);

  const countdown = useCountdown(gameState?.phase_start_time, AUTO_LOBBY_DELAY, gameState?.server_time);

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

  const AVATAR_COLORS = [
    "#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
    "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16",
    "#e11d48", "#0ea5e9", "#a855f7", "#14b8a6", "#eab308",
    "#6366f1", "#22c55e", "#fb7185", "#38bdf8", "#fb923c",
  ];

  const orderedPlayers = gameState.clue_order
    .map((id) => gameState.players.find((p) => p.id === id))
    .filter(Boolean);

  // Build a stable color index map keyed by player id
  const playerColorMap = {};
  orderedPlayers.forEach((p, idx) => {
    playerColorMap[p.id] = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  });

  const votedByMap = {};
  const skippedByList = [];
  gameState.players.forEach((voter) => {
    if (voter.vote && voter.vote !== "skip") {
      if (!votedByMap[voter.vote]) votedByMap[voter.vote] = [];
      votedByMap[voter.vote].push(voter);
    } else if (voter.vote === "skip") {
      skippedByList.push(voter);
    }
  });

  function handlePlayAgain() {
    sendMessage({ type: "play_again" });
  }

  // Outcome banner
  let bannerIcon, bannerTitle, bannerSub;
  if (imposter_guessed) {
    bannerIcon = <Target size={44} />;
    bannerTitle = "Imposter Guessed the Word!";
    bannerSub = results.win_reason || "The imposter wins!";
  } else if (caught) {
    bannerIcon = <Siren size={44} />;
    bannerTitle = "Imposter Caught!";
    bannerSub = results.win_reason || "The crew wins!";
  } else if (tie) {
    bannerIcon = <Scale size={44} />;
    bannerTitle = "Imposter Wins!";
    bannerSub = results.win_reason || "The crew couldn't agree — imposter escapes!";
  } else {
    bannerIcon = <ShieldOff size={44} />;
    bannerTitle = "Imposter Escaped!";
    bannerSub = results.win_reason || "The imposter fooled everyone";
  }

  return (
    <div className="page center">
      <button className="leave-btn" onClick={() => setConfirmLeave(true)}>Leave Room</button>
      {totalRounds > 1 && (
        <div className="round-indicator">Round {currentRound} of {totalRounds}</div>
      )}

      <div className={`outcome-banner ${iWon ? "outcome-win" : "outcome-lose"}`}>
        <div className="outcome-icon">{bannerIcon}</div>
        <h1>{bannerTitle}</h1>
        <p>{bannerSub}</p>
        <div className="outcome-personal">
          <div className="outcome-personal-result">{iWon ? "You won!" : "You lost!"}</div>
          <div className="outcome-personal-role">
            You were{" "}
            <span className={iWasImposter ? "role-imposter" : "role-innocent"}>
              {iWasImposter ? "the Imposter" : "Innocent"}
            </span>
          </div>
        </div>
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

      </div>

      <div className="results-bottom-row">
        <div className="result-section-full card">
          <h3>Players &amp; Clues</h3>
          <div className="result-player-list">
            {orderedPlayers.map((player, idx) => {
              const isImposter = results.imposters.includes(player.id);
              return (
                <div key={player.id} className={`result-player-row ${isImposter ? "imposter-row" : ""}`}>
                  <span className="clue-order-num">{idx + 1}</span>
                  <span className="result-player-avatar" style={{ background: playerColorMap[player.id] }}>
                    {player.name[0].toUpperCase()}
                  </span>
                  <div className="result-player-info">
                    <span className="clue-player-name">{player.name}</span>
                    {player.clue === "__word_revealed__" ? (
                      <span className="result-player-clue clue-revealed"><AlertTriangle size={11} /> Typed the word!</span>
                    ) : (
                      <span className="result-player-clue">{player.clue || "—"}</span>
                    )}
                  </div>
                  <span className="result-player-badges">
                    {isImposter && <span className="badge badge-imposter">Imposter</span>}
                    {player.eliminated && <span className="badge badge-revealed">Eliminated</span>}
                    {player.id === playerInfo.id && <span className="badge badge-you">You</span>}
                    {player.id === gameState.host && <span className="badge badge-host">Host</span>}
                    {player.kicked ? (
                      <span className="badge badge-kicked">Kicked</span>
                    ) : !player.connected ? (
                      <span className="badge badge-disconnected">Disconnected</span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="result-section-full card" style={{ display: "flex", flexDirection: "column" }}>
          <h3>Vote Breakdown</h3>
          <div className="vote-table" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="vote-table-header">
              <span>Player</span>
              <span>Votes</span>
              <span>Voted by</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {[...orderedPlayers]
                .sort((a, b) => (results.vote_counts?.[b.id] || 0) - (results.vote_counts?.[a.id] || 0))
                .map((player) => {
                  const voteCount = results.vote_counts?.[player.id] || 0;
                  const voters = votedByMap[player.id] || [];
                  return (
                    <div key={player.id} className="vote-table-row">
                      <span className="vote-player-name">{player.name}</span>
                      <span className="vote-count-pill">{voteCount}</span>
                      <span className="vote-from-avatars">
                        {voters.map((v) => (
                          <span
                            key={v.id}
                            className="vote-voter-avatar"
                            style={{ background: playerColorMap[v.id] || "#7c3aed" }}
                            title={v.name}
                          >
                            {v.name[0].toUpperCase()}
                          </span>
                        ))}
                      </span>
                    </div>
                  );
                })}
              <div className="vote-table-row vote-skip-row">
                <span className="vote-player-name" style={{ color: "var(--text-muted)", overflow: "visible", whiteSpace: "normal" }}>Skipped / No vote</span>
                <span className="vote-count-pill vote-count-skip">{results.skip_count || 0}</span>
                <span className="vote-from-avatars">
                  {skippedByList.length > 0
                    ? skippedByList.map((v) => (
                        <span
                          key={v.id}
                          className="vote-voter-avatar"
                          style={{ background: playerColorMap[v.id] || "#7c3aed" }}
                          title={v.name}
                        >
                          {v.name[0].toUpperCase()}
                        </span>
                      ))
                    : <span style={{ color: "var(--text-muted)" }}>—</span>}
                </span>
              </div>
            </div>
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
