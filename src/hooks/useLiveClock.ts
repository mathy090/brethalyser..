import { useState, useEffect } from "react";

export interface LiveClock {
  date: string;
  time: string;
}

export function useLiveClock(): LiveClock {
  const format = (): LiveClock => {
    const now = new Date();
    return {
      date: now.toLocaleDateString("en-GB", {
        weekday: "short", day: "2-digit",
        month: "short",   year: "numeric",
      }),
      time: now.toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit",
        second: "2-digit", hour12: false,
      }),
    };
  };

  const [clock, setClock] = useState<LiveClock>(format);
  useEffect(() => {
    const id = setInterval(() => setClock(format()), 1000);
    return () => clearInterval(id);
  }, []);

  return clock;
}