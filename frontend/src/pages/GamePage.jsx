import { useState, useEffect, useRef } from "react";
import { UserX, Eye } from "lucide-react";
import { useGame } from "../context/GameContext";
import ConfirmModal from "../components/ConfirmModal";

function useCountdown(startTime, duration, serverTime) {
  const [remaining, setRemaining] = useState(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!startTime || !duration || !serverTime) {
      setRemaining(null);
      return;
    }
    // Calculate clock offset between server and client
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

export default function GamePage() {
  const { gameState, playerInfo, sendMessage, leaveRoom, error } = useGame();
  const isHost = gameState?.host === playerInfo?.id;
  const [clue, setClue] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [kickTarget, setKickTarget] = useState(null);

  if (!gameState) return <div className="page center"><p>Loading...</p></div>;

  const thinkingTime = gameState.settings?.thinking_time || 30;
  const remaining = useCountdown(
    gameState.turn_start_time,
    thinkingTime,
    gameState.server_time
  );

  const isMyTurn = gameState.current_player_id === playerInfo.id;
  const currentPlayer = gameState.players.find(
    (p) => p.id === gameState.current_player_id
  );

  const orderedPlayers = gameState.clue_order
    .map((id) => gameState.players.find((p) => p.id === id))
    .filter(Boolean);

  function handleSubmitClue(e) {
    e.preventDefault();
    const word = clue.trim();
    if (!word || word.includes(" ")) return;
    sendMessage({ type: "submit_clue", clue: word });
    setClue("");
  }

  return (
    <div className="page">
      <button className="leave-btn" onClick={() => setConfirmLeave(true)}>Leave Room</button>
      <div
        className="game-header"
        onPointerDown={() => gameState.settings?.discreet_mode && setRevealing(true)}
        onPointerUp={() => setRevealing(false)}
        onPointerLeave={() => setRevealing(false)}
        style={gameState.settings?.discreet_mode ? { userSelect: "none", touchAction: "none" } : undefined}
      >
        {gameState.settings?.discreet_mode && !revealing ? (
          <div className="discreet-card">
            <p className="discreet-label">Your role is hidden</p>
            <button className="btn reveal-hold-btn" tabIndex={-1}>
              <Eye size={18} /> Hold to reveal
            </button>
          </div>
        ) : (
          gameState.is_imposter ? (
            <div className="imposter-reveal">
              <div className="imposter-icon">🎭</div>
              <h2>You are the IMPOSTER!</h2>
              {gameState.word ? (
                <>
                  <p className="word-label">Your word is</p>
                  <div className="secret-word">{gameState.word}</div>
                  <p className="word-hint">This is close to the real word — blend in!</p>
                </>
              ) : (
                <p>Blend in. Don't get caught.</p>
              )}
            </div>
          ) : (
            <div className="word-reveal">
              <p className="word-label">The secret word is</p>
              <div className="secret-word">{gameState.word}</div>
              <p className="word-hint">Give a clue — but don't make it too obvious!</p>
            </div>
          )
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="game-content">
        <div className="turn-indicator">
          {isMyTurn ? (
            <div className="your-turn-banner">It's your turn!</div>
          ) : (
            <div className="waiting-banner">
              Waiting for <strong>{currentPlayer?.name}</strong> to give a clue...
            </div>
          )}
          {remaining !== null && (
            <div className={`countdown-badge${remaining <= 5 ? " countdown-urgent" : ""}`}>
              {remaining}s
            </div>
          )}
        </div>

        {isMyTurn && (
          <form className="clue-form" onSubmit={handleSubmitClue}>
            <input
              className="input input-large"
              type="text"
              placeholder="One word clue..."
              value={clue}
              onChange={(e) => setClue(e.target.value.replace(/\s/g, ""))}
              maxLength={30}
              autoFocus
            />
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!clue.trim()}
            >
              Submit Clue
            </button>
          </form>
        )}

        <div className="clues-section">
          <h3>Clues Given</h3>
          <div className="clue-list">
            {orderedPlayers.map((player, idx) => (
              <div key={player.id} className="clue-row">
                <div className="clue-player-info">
                  <span className="clue-order-num">{idx + 1}</span>
                  <span className="clue-player-name">
                    {player.name}
                    {player.id === playerInfo.id && (
                      <span className="badge badge-you">You</span>
                    )}
                    {player.is_host && (
                      <span className="badge badge-host">Host</span>
                    )}
                    {!player.connected && (
                      <span className="badge badge-disconnected">Disconnected</span>
                    )}
                  </span>
                  {isHost && player.id !== playerInfo.id && (
                    <button
                      className="kick-btn"
                      title="Kick player"
                      onClick={() => setKickTarget({ id: player.id, name: player.name })}
                    >
                      <UserX size={13} />
                    </button>
                  )}
                </div>
                <div className="clue-value">
                  {player.clue === "__word_revealed__" ? (
                    <span className="clue-revealed">⚠️ Typed the word!</span>
                  ) : player.clue ? (
                    <span className="clue-word">{player.clue}</span>
                  ) : player.id === gameState.current_player_id ? (
                    <span className="clue-thinking">thinking...</span>
                  ) : (
                    <span className="clue-pending">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {confirmLeave && (
        <ConfirmModal
          title="Leave Room?"
          message="Are you sure you want to leave the game?"
          confirmLabel="Leave"
          confirmDanger
          onConfirm={leaveRoom}
          onCancel={() => setConfirmLeave(false)}
        />
      )}

      {kickTarget && (
        <ConfirmModal
          title="Kick Player?"
          message={`Remove ${kickTarget.name} from the room?`}
          confirmLabel="Kick"
          confirmDanger
          onConfirm={() => {
            sendMessage({ type: "kick_player", target_id: kickTarget.id });
            setKickTarget(null);
          }}
          onCancel={() => setKickTarget(null)}
        />
      )}
    </div>
  );
}
