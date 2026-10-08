import { useEffect, useState } from "react";

const ARMED_MS = 4_000;

/** The armed confirm action, which disarms itself when no second press follows. */
export function useArmed<Action>() {
  const [armed, setArmed] = useState<Action | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  return [armed, setArmed] as const;
}
