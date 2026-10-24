// Deterministic clock for the voice replay harness. Injected into the jsdom
// window in place of setTimeout/setInterval/requestAnimationFrame/Date, because
// node:test mock timers do not reach code running in jsdom's separate context.
export function createClock(start = Date.UTC(2026, 9, 23, 18, 0, 0)) {
  let now = start;
  let seq = 0;
  const timers = new Map(); // id -> { at, fn, args, every }
  const add = (fn, ms, args, repeat) => {
    const id = ++seq;
    const d = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: now + d, fn, args, every: repeat ? Math.max(1, d) : 0 });
    return id;
  };
  const clear = (id) => { timers.delete(id); };
  return {
    now: () => now,
    setTimeout: (fn, ms, ...args) => add(fn, ms, args, false),
    clearTimeout: clear,
    setInterval: (fn, ms, ...args) => add(fn, ms, args, true),
    clearInterval: clear,
    requestAnimationFrame: (fn) => add(() => fn(now), 16, [], false),
    cancelAnimationFrame: clear,
    runUntil(target) {
      for (;;) {
        let nextId = null;
        let next = null;
        for (const [id, t] of timers) {
          if (t.at > target) continue;
          if (!next || t.at < next.at || (t.at === next.at && id < nextId)) { next = t; nextId = id; }
        }
        if (!next) break;
        now = next.at;
        if (next.every) next.at += next.every; else timers.delete(nextId);
        next.fn(...next.args);
      }
      now = Math.max(now, target);
    },
    pending: () => timers.size,
  };
}
