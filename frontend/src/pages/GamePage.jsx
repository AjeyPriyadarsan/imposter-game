import { useState, useEffect, useRef } from "react";
import { UserX, Eye, EyeOff, ShieldAlert, AlertTriangle, ShieldCheck } from "lucide-react";
import { useGame } from "../context/GameContext";
import ConfirmModal from "../components/ConfirmModal";
import RoomCodeChip from "../components/RoomCodeChip";
import { useCountdown } from "../hooks/useCountdown";

export default function GamePage() {
  const { gameState, playerInfo, sendMessage, leaveRoom, error, localDiscreet, setLocalDiscreet } = useGame();
  const isHost = gameState?.host === playerInfo?.id;
  const [clue, setClue] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmEndMatch, setConfirmEndMatch] = useState(false);
  const [kickTarget, setKickTarget] = useState(null);
  const [myReaction, setMyReaction] = useState(null);
  const reactionTimerRef = useRef(null);
  const prevReactionsRef = useRef({});
  const [reactionBursts, setReactionBursts] = useState({});
  const [activeBtn, setActiveBtn] = useState(null);

  useEffect(() => {
    const serverReaction = gameState?.player_reactions?.[playerInfo?.id] ?? null;
    setMyReaction(serverReaction);
  }, [gameState?.player_reactions, playerInfo?.id]);

  useEffect(() => {
    const reactions = gameState?.player_reactions || {};
    const prev = prevReactionsRef.current || {};
    const newBursts = {};
    for (const [pid, emoji] of Object.entries(reactions)) {
      if (prev[pid] !== emoji) {
        newBursts[pid] = { emoji, key: Date.now() + pid };
      }
    }
    if (Object.keys(newBursts).length > 0) {
      setReactionBursts(prev => ({ ...prev, ...newBursts }));
      setTimeout(() => {
        setReactionBursts(prev => {
          const next = { ...prev };
          for (const pid of Object.keys(newBursts)) {
            if (next[pid]?.key === newBursts[pid].key) delete next[pid];
          }
          return next;
        });
      }, 1100);
    }
    prevReactionsRef.current = reactions;
  }, [gameState?.player_reactions]);

  if (!gameState) return <div className="page center"><p>Loading...</p></div>;

  const isDiscreet = gameState.settings?.discreet_mode || localDiscreet;
  const isAnonymous = gameState.settings?.anonymous_role === true;
  const thinkingTime = gameState.settings?.thinking_time || 30;
  const remaining = useCountdown(
    gameState.turn_start_time,
    thinkingTime,
    gameState.server_time
  );

  const me = gameState.players.find((p) => p.id === playerInfo.id);
  const isWordRevealer = me?.word_revealer === true;
  const isEliminated = me?.eliminated === true;
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
      <div className="top-actions">
        <RoomCodeChip roomId={playerInfo?.roomId} />
        <div className="top-actions-right">
          <button className="leave-btn" onClick={() => setConfirmLeave(true)}>Leave Room</button>
          {isHost && (
            <button className="end-match-btn" onClick={() => setConfirmEndMatch(true)}>End Match</button>
          )}
          {!gameState.settings?.discreet_mode && (
            <button
              className={`discreet-toggle${localDiscreet ? " active" : ""}`}
              onClick={() => setLocalDiscreet((d) => !d)}
            >
              {localDiscreet ? <EyeOff size={14} /> : <Eye size={14} />}
              Discreet
            </button>
          )}
        </div>
      </div>
      <div
        className="game-header"
        onPointerDown={() => isDiscreet && setRevealing(true)}
        onPointerUp={() => setRevealing(false)}
        onPointerLeave={() => setRevealing(false)}
        style={isDiscreet ? { userSelect: "none", touchAction: "none" } : undefined}
      >
        {isDiscreet && !revealing ? (
          <div className="discreet-card">
            <p className="discreet-label">Your role is hidden</p>
            <button className="btn reveal-hold-btn" tabIndex={-1}>
              <Eye size={18} /> Hold to reveal
            </button>
          </div>
        ) : isAnonymous && !isEliminated ? (
          <div className="word-reveal">
            <p className="word-label">Your word is</p>
            <div className="secret-word">{gameState.word}</div>
            <span className="badge" style={{ background: "#6b7280", marginTop: 6 }}>Role: Anonymous</span>
            <p className="word-hint">Your role is hidden — Give a clue!</p>
          </div>
        ) : gameState.is_imposter ? (
          <div className="imposter-reveal">
            <div className="imposter-icon"><ShieldAlert size={44} /></div>
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
            {gameState.fellow_imposters?.length > 0 && (
              <div className="fellow-imposters">
                <p>Your fellow imposter{gameState.fellow_imposters.length > 1 ? 's' : ''}:</p>
                <div className="fellow-names">
                  {gameState.fellow_imposters.map(p => (
                    <span key={p.id} className="badge">{p.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="innocent-reveal">
            <div className="innocent-icon"><ShieldCheck size={44} /></div>
            <h2>You are Innocent!</h2>
            <p className="word-label">The secret word is</p>
            <div className="secret-word">{gameState.word}</div>
            <p className="word-hint">Give a clue — but don't make it too obvious!</p>
          </div>
        )}
      </div>

      {!isAnonymous && gameState.remaining_imposters !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#94a3b8', marginTop: '4px', justifyContent: 'center' }}>
          <ShieldAlert size={14} />
          <span>{gameState.remaining_imposters} imposter{gameState.remaining_imposters !== 1 ? 's' : ''} remaining</span>
        </div>
      )}

      {isEliminated && (
        <div className="alert alert-warning">
          <AlertTriangle size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />
          You have been eliminated — you cannot give clues or vote. You can watch what's happening.
        </div>
      )}

      {isWordRevealer && (
        <div className="alert alert-warning">
          <AlertTriangle size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />
          You revealed the secret word — you cannot give clues or vote. You can watch what's happening.
        </div>
      )}

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

        {gameState.state === "playing" && !isEliminated && !isWordRevealer && (
          <div className="emoji-picker">
            {["😂", "🤔", "😱", "😡"].map((emoji) => (
              <button
                key={emoji}
                className={`emoji-btn${myReaction === emoji ? " active" : ""}${activeBtn === emoji ? " clicked" : ""}`}
                onClick={() => {
                  const isToggleOff = myReaction === emoji;
                  sendMessage({ type: "set_reaction", emoji });
                  setMyReaction(isToggleOff ? null : emoji);
                  setActiveBtn(emoji);
                  setTimeout(() => setActiveBtn(null), 150);
                  if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
                  if (!isToggleOff) {
                    reactionTimerRef.current = setTimeout(() => {
                      sendMessage({ type: "set_reaction", emoji });
                      setMyReaction(null);
                    }, 4000);
                  }
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="clues-section">
          <h3>Clues Given</h3>
          <div className="clue-list">
            {orderedPlayers.map((player, idx) => (
              <div key={player.id} className="clue-row" style={{ position: "relative" }}>
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
                    {player.kicked ? (
                      <span className="badge badge-kicked">Kicked</span>
                    ) : player.left ? (
                      <span className="badge badge-left">Left</span>
                    ) : !player.connected ? (
                      <span className="badge badge-disconnected">Disconnected</span>
                    ) : null}
                    {player.word_revealer && (
                      <span className="badge badge-word-revealer">Vote won't count</span>
                    )}
                    {gameState.player_reactions?.[player.id] && (
                      <span
                        key={gameState.player_reactions[player.id]}
                        className="player-reaction"
                      >
                        {gameState.player_reactions[player.id]}
                      </span>
                    )}
                  </span>
                  {isHost && player.id !== playerInfo.id && !player.kicked && !player.left && (
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
                    <span className="clue-revealed"><AlertTriangle size={13} style={{ marginRight: 4, verticalAlign: "middle" }} /> Typed the word!</span>
                  ) : player.clue ? (
                    <span className="clue-word">{player.clue}</span>
                  ) : player.id === gameState.current_player_id ? (
                    <span className="clue-thinking">thinking...</span>
                  ) : (
                    <span className="clue-pending">—</span>
                  )}
                </div>
                {reactionBursts[player.id] && (
                  <span key={reactionBursts[player.id].key} className="reaction-burst">
                    {reactionBursts[player.id].emoji}
                  </span>
                )}
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

      {confirmEndMatch && (
        <ConfirmModal
          title="End Match?"
          message="Are you sure you want to end the match? Everyone will return to the lobby."
          confirmLabel="End Match"
          confirmDanger
          onConfirm={() => {
            sendMessage({ type: "end_match" });
            setConfirmEndMatch(false);
          }}
          onCancel={() => setConfirmEndMatch(false)}
        />
      )}
    </div>
  );
}
