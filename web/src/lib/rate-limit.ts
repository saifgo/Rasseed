/**
 * Small in-memory fixed-window limiter (the app runs as a single server process).
 * Used to slow down guessing of short pairing codes.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

/** Counts a hit for `key`; returns false once `limit` hits happened within `windowMs`. */
export function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (windows.size > 10_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  w.count++;
  return w.count <= limit;
}
