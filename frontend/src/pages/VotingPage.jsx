import { useState, useEffect, useRef } from "react";
import { UserX, Eye, EyeOff, ShieldAlert, ShieldCheck, AlertTriangle } from "lucide-react";
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
  const { gameState, playerInfo, sendMessage, leaveRoom, localDiscreet, setLocalDiscreet } = useGame();
  const isHost = gameState?.host === playerInfo?.id;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [kickTarget, setKickTarget] = useState(null);
  const [revealing, setRevealing] = useState(false);

  if (!gameState) return <div className="page center"><p>Loading...</p></div>;

  const isDiscreet = gameState.settings?.discreet_mode || localDiscreet;
  const isAnonymous = gameState.settings?.anonymous_role === true;

  const votingTime = gameState.settings?.voting_time || 60;
  const remaining = useCountdown(
    gameState.phase_start_time,
    votingTime,
    gameState.server_time
  );

  const me = gameState.players.find((p) => p.id === playerInfo.id);
  const isBanned = me?.revealed === true || me?.eliminated === true;
  const isWordRevealer = me?.word_revealer === true;
  const hasVoted = me?.vote !== null && me?.vote !== undefined;
  // Eligible voters: not revealed, not eliminated, not kicked, not left
  const eligibleVoters = gameState.players.filter((p) => !p.revealed && !p.eliminated && !p.kicked && !p.left);
  const votesCast = eligibleVoters.filter((p) => p.vote !== null && p.vote !== undefined).length;
  const totalVoters = eligibleVoters.length;
  // Voteable targets: not revealed, not eliminated, not kicked, not left
  const voteTargets = gameState.players.filter((p) => !p.revealed && !p.eliminated && !p.kicked && !p.left);

  function handleVote(targetId) {
    if (isBanned || hasVoted) return;
    sendMessage({ type: "submit_vote", voted_id: targetId });
  }

  function handleSkip() {
    if (isBanned || hasVoted) return;
    sendMessage({ type: "submit_vote", voted_id: "skip" });
  }

  const orderedPlayers = gameState.clue_order
    .map((id) => gameState.players.find((p) => p.id === id))
    .filter(Boolean);

  return (
    <div className="page center">
      <div className="top-actions">
        <button className="leave-btn" onClick={() => setConfirmLeave(true)}>Leave Room</button>
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

      <div
        className="voting-header-card card"
        onPointerDown={() => isDiscreet && setRevealing(true)}
        onPointerUp={() => setRevealing(false)}
        onPointerLeave={() => setRevealing(false)}
        style={isDiscreet ? { userSelect: "none", touchAction: "none" } : undefined}
      >
        {isDiscreet && !revealing ? (
          <button className="btn reveal-hold-btn" tabIndex={-1}>
            <Eye size={16} /> Hold to reveal your word
          </button>
        ) : isAnonymous ? (
          <div className="voting-role-info">
            <span className="voting-role-word">{gameState.word}</span>
          </div>
        ) : gameState.is_imposter ? (
          <div className="voting-role-info imposter">
            <span className="voting-role-label"><ShieldAlert size={16} style={{ marginRight: 4, verticalAlign: "middle" }} /> Imposter</span>
            <span className="voting-role-word">{gameState.word || "???"}</span>
          </div>
        ) : (
          <div className="voting-role-info innocent">
            <span className="voting-role-label"><ShieldCheck size={16} style={{ marginRight: 4, verticalAlign: "middle" }} /> Innocent</span>
            <span className="voting-role-word">{gameState.word}</span>
          </div>
        )}
        <div className="voting-header-divider" />
        <div className="page-heading" style={{ marginTop: 0 }}>
          <h1>Vote</h1>
          <p>Who do you think is the imposter?</p>
          {remaining !== null && (
            <div className={`countdown-badge countdown-inline${remaining <= 10 ? " countdown-urgent" : ""}`}>
              {remaining}s
            </div>
          )}
        </div>
      </div>

      <div className="vote-progress">
        <div className="vote-progress-bar">
          <div
            className="vote-progress-fill"
            style={{ width: `${(votesCast / totalVoters) * 100}%` }}
          />
        </div>
        <p className="vote-count">{votesCast}/{totalVoters} voted</p>
      </div>

      <div className="clues-review card" style={{ width: "100%" }}>
        <h3>Clues from this round</h3>
        <div className="clue-list">
          {orderedPlayers.map((player, idx) => {
            const voteStatus = player.vote === "skip" ? "skip"
              : player.vote !== null && player.vote !== undefined ? "voted"
              : null;
            return (
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
                  {!player.kicked && !player.left && voteStatus === "skip" && (
                    <span className="badge badge-skip">Skipped</span>
                  )}
                  {!player.kicked && !player.left && voteStatus === "voted" && (
                    <span className="badge badge-voted">Voted</span>
                  )}
                </span>
                {(player.kicked || player.left) && (
                  <span className="vote-excluded-note">
                    {player.vote !== null && player.vote !== undefined
                      ? "vote counted"
                      : "vote won't be counted"}
                  </span>
                )}
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
              {player.clue === "__word_revealed__" ? (
                <span className="clue-revealed"><AlertTriangle size={13} style={{ marginRight: 4, verticalAlign: "middle" }} /> Typed the word!</span>
              ) : (
                <span className="clue-word">{player.clue || "—"}</span>
              )}
            </div>
          );
          })}
        </div>
      </div>

      {isBanned ? (
        <div className="voted-message">
          {isWordRevealer ? (
            <p><AlertTriangle size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />
              You revealed the secret word — you cannot vote. You can watch what's happening.</p>
          ) : (
            <p>You have been eliminated and cannot vote.</p>
          )}
        </div>
      ) : hasVoted ? (
        <div className="voted-message">
          {me.vote === "skip" ? (
            <p>You skipped your vote. Waiting for others...</p>
          ) : (
            <p>You voted for <strong>{gameState.players.find((p) => p.id === me.vote)?.name || "Unknown"}</strong>. Waiting for others...</p>
          )}
        </div>
      ) : (
        <div className="vote-grid">
          <h3>Tap to vote</h3>
          <div className="vote-buttons">
            {voteTargets.map((player, idx) => {
              const isSelf = player.id === playerInfo.id;
              const colors = ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];
              const colorIdx = gameState.players.findIndex((p) => p.id === player.id);
              return (
                <button
                  key={player.id}
                  className="vote-btn"
                  onClick={() => handleVote(player.id)}
                >
                  <span className="vote-avatar" style={{ background: colors[colorIdx % colors.length] }}>
                    {player.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="vote-player-name">{player.name}</span>
                  {isSelf && <span className="vote-self-hint">(you)</span>}
                  {player.is_host && <span className="badge badge-host">Host</span>}
                  {player.kicked ? (
                    <span className="badge badge-kicked">Kicked</span>
                  ) : player.left ? (
                    <span className="badge badge-left">Left</span>
                  ) : !player.connected ? (
                    <span className="badge badge-disconnected">Disconnected</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <button className="skip-vote-btn" onClick={handleSkip}>
            Skip Vote
          </button>
        </div>
      )}

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
