import { useEffect, useState } from 'react';

/** Whole seconds left until `until` (a timestamp), ticking every second; 0 once it has passed. */
export const useSecondsLeft = (until: number | null) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (null === until) {
      return;
    }

    const tick = () => {
      const current = Date.now();
      setNow(current);

      if (current >= until) {
        clearInterval(interval);
      }
    };
    // Refresh straight away, `now` is stale from the last tick
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [until]);

  return null === until ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
};

export const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
