import { useState } from "react";
import { Copy, Check } from "lucide-react";

export default function RoomCodeChip({ roomId }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!roomId) return null;

  return (
    <button className="room-code-chip" onClick={handleCopy} title="Copy room code">
      <span className="room-code-chip-label">ROOM</span>
      <span className="room-code-chip-code">{roomId}</span>
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}
