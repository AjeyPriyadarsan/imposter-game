import { useState, useEffect } from "react";
import { useGame } from "../context/GameContext";
import { Copy, Check, Settings, Users, Timer, Vote, Layers, UserX, Play, Eye, Gauge } from "lucide-react";
import ConfirmModal from "../components/ConfirmModal";

export default function LobbyPage() {
  const { gameState, playerInfo, sendMessage, updateSettings, leaveRoom, error } = useGame();
  const [copied, setCopied] = useState(false);
  const [idleSecsLeft, setIdleSecsLeft] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [kickTarget, setKickTarget] = useState(null); // { id, name }

  useEffect(() => {
    const expiresAt = gameState?.idle_expires_at;
    if (!expiresAt) { setIdleSecsLeft(null); return; }

    function getRemaining() {
      return Math.max(0, expiresAt - Date.now() / 1000);
    }

    const initial = getRemaining();
    if (initial > 300) { setIdleSecsLeft(null); return; }

    setIdleSecsLeft(Math.ceil(initial));
    const iv = setInterval(() => {
      const r = getRemaining();
      setIdleSecsLeft(Math.ceil(r));
      if (r <= 0) clearInterval(iv);
    }, 1000);
    return () => clearInterval(iv);
  }, [gameState?.idle_expires_at]);

  function copyLink() {
    const url = `${window.location.origin}/${gameState.room_id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!gameState) return <div className="page center"><p>Connecting...</p></div>;

  const isHost = gameState.host === playerInfo.id;
  const playerCount = gameState.players.length;
  const canStart = playerCount >= 3;
  const settings = gameState.settings || {
    num_imposters: 1, thinking_time: 30, voting_time: 60, num_rounds: 1,
    discreet_mode: false, word_similarity: "similar",
  };
  const maxImposters = gameState.max_imposters || 1;

  function handleStart() {
    sendMessage({ type: "start_game" });
  }

  function updateSetting(key, value) {
    updateSettings({ [key]: value });
  }

  const thinkingOptions = [10, 20, 30, 40, 50, 60];
  const votingOptions = [30, 45, 60, 90, 120];
  const colors = ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];

  return (
    <div className="page center">
      <button className="leave-btn" onClick={() => setConfirmLeave(true)}>Leave Room</button>
      <div className="room-code-display">
        <span className="room-code-label">Room Code</span>
        <span className="room-code">{gameState.room_id}</span>
        <button className="btn btn-secondary" onClick={copyLink}>
          {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy Link</>}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {idleSecsLeft !== null && (
        <div className="idle-warning">
          <Timer size={14} />
          Room closes in {Math.floor(idleSecsLeft / 60)}:{String(idleSecsLeft % 60).padStart(2, "0")} due to inactivity
        </div>
      )}

      {/* Players Card */}
      <div className="card" style={{ width: "100%" }}>
        <div className="section-header">
          <h2>
            <Users size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
            Players ({playerCount}/20)
          </h2>
        </div>
        <ul className="player-list">
          {gameState.players.map((p, idx) => (
            <li key={p.id} className="player-item">
              <span className="player-name">
                <span className="player-avatar" style={{ background: colors[idx % colors.length] }}>
                  {p.name.charAt(0).toUpperCase()}
                </span>
                {p.name}
                {p.id === playerInfo.id && <span className="badge badge-you">You</span>}
                {p.is_host && <span className="badge badge-host">Host</span>}
              </span>
              {isHost && p.id !== playerInfo.id && (
                <button
                  className="kick-btn"
                  title="Kick player"
                  onClick={() => setKickTarget({ id: p.id, name: p.name })}
                >
                  <UserX size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Settings Card — host only */}
      {isHost && (
        <div className="settings-card">
          <div className="settings-card-header">
            <Settings size={16} className="settings-icon" />
            <h2>Game Settings</h2>
          </div>

          <div className="setting-block">
            <div className="setting-block-top">
              <span className="setting-name">
                <UserX size={14} />
                Imposters
              </span>
              <span className="setting-current-value">{settings.num_imposters}</span>
            </div>
            <div className="setting-options">
              {Array.from({ length: maxImposters }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  className={`settings-btn${settings.num_imposters === n ? " active" : ""}`}
                  disabled={!isHost}
                  onClick={() => updateSetting("num_imposters", n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block">
            <div className="setting-block-top">
              <span className="setting-name">
                <Timer size={14} />
                Think Time
              </span>
              <span className="setting-current-value">{settings.thinking_time}s</span>
            </div>
            <div className="setting-options">
              {thinkingOptions.map((t) => (
                <button
                  key={t}
                  className={`settings-btn${settings.thinking_time === t ? " active" : ""}`}
                  disabled={!isHost}
                  onClick={() => updateSetting("thinking_time", t)}
                >
                  {t}s
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block">
            <div className="setting-block-top">
              <span className="setting-name">
                <Vote size={14} />
                Vote Time
              </span>
              <span className="setting-current-value">{settings.voting_time}s</span>
            </div>
            <div className="setting-options">
              {votingOptions.map((t) => (
                <button
                  key={t}
                  className={`settings-btn${settings.voting_time === t ? " active" : ""}`}
                  disabled={!isHost}
                  onClick={() => updateSetting("voting_time", t)}
                >
                  {t}s
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block">
            <div className="setting-block-top">
              <span className="setting-name">
                <Layers size={14} />
                Rounds
              </span>
              <span className="setting-current-value">{settings.num_rounds}</span>
            </div>
            <div className="setting-options">
              {[1, 2, 3].map((n) => {
                const tooFew = n < settings.num_imposters;
                return (
                  <button
                    key={n}
                    className={`settings-btn${settings.num_rounds === n ? " active" : ""}`}
                    disabled={!isHost || tooFew}
                    title={tooFew ? `Need at least ${settings.num_imposters} rounds for ${settings.num_imposters} imposters` : undefined}
                    onClick={() => updateSetting("num_rounds", n)}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            {settings.num_rounds < settings.num_imposters && (
              <p className="hint" style={{ marginTop: 6, color: "var(--color-warning, #f59e0b)" }}>
                Rounds must be at least equal to the number of imposters.
              </p>
            )}
          </div>

          <div className="setting-block">
            <div className="setting-block-top">
              <span className="setting-name">
                <Eye size={14} />
                Discreet Mode
              </span>
              <span className="setting-current-value">{settings.discreet_mode ? "On" : "Off"}</span>
            </div>
            <div className="setting-options">
              <button
                className={`settings-btn${!settings.discreet_mode ? " active" : ""}`}
                onClick={() => updateSetting("discreet_mode", false)}
              >Off</button>
              <button
                className={`settings-btn${settings.discreet_mode ? " active" : ""}`}
                onClick={() => updateSetting("discreet_mode", true)}
              >On</button>
            </div>
          </div>

          <div className="setting-block">
            <div className="setting-block-top">
              <span className="setting-name">
                <Gauge size={14} />
                Word Similarity
              </span>
              <span className="setting-current-value">
                {settings.word_similarity === "similar" ? "Similar" : settings.word_similarity === "somewhat" ? "Somewhat" : "Random"}
              </span>
            </div>
            <div className="setting-options">
              {[
                { value: "similar", label: "Similar" },
                { value: "somewhat", label: "Somewhat" },
                { value: "random", label: "Random" },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  className={`settings-btn${(settings.word_similarity ?? "similar") === value ? " active" : ""}`}
                  onClick={() => updateSetting("word_similarity", value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              {(settings.word_similarity ?? "similar") === "similar" && "Imposter gets a very close word (e.g. forest → jungle)"}
              {(settings.word_similarity ?? "similar") === "somewhat" && "Imposter gets a loosely related word (e.g. forest → trees)"}
              {(settings.word_similarity ?? "similar") === "random" && "Imposter gets a totally unrelated word (e.g. forest → icecream)"}
            </p>
          </div>
        </div>
      )}

      {/* Non-host settings summary */}
      {!isHost && (
        <div className="rules-info">
          <p>
            {settings.num_imposters} imposter{settings.num_imposters > 1 ? "s" : ""} · {settings.thinking_time}s think · {settings.voting_time}s vote · {settings.num_rounds} round{settings.num_rounds > 1 ? "s" : ""}{settings.discreet_mode ? " · discreet" : ""} · {settings.word_similarity ?? "similar"} words
          </p>
        </div>
      )}

      {/* Host controls */}
      {isHost && (
        <div className="host-controls-card">
          {!canStart && (
            <p className="hint center-text">Need at least 3 players to start</p>
          )}
          <button
            className="btn btn-primary btn-full"
            onClick={handleStart}
            disabled={!canStart}
            style={{ padding: "13px 20px", fontSize: "15px" }}
          >
            <Play size={16} />
            Start Game
          </button>
        </div>
      )}

      {!isHost && (
        <p className="hint center-text">Waiting for host to start the game...</p>
      )}

      {confirmLeave && (
        <ConfirmModal
          title="Leave Room?"
          message="Are you sure you want to leave this room?"
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
