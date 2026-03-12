import { useState, useEffect, useRef } from "react";

export function useCountdown(startTime, duration, serverTime) {
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
