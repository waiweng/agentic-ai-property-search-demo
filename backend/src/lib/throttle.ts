/**
 * Simple in-memory throttle for Voyage API (free tier safe).
 * Max N operations per second.
 */
const queue: Array<() => void> = [];
const MAX_PER_SECOND = 3;
let lastRefill = Date.now() / 1000;
let tokens = MAX_PER_SECOND;

function refill(): void {
  const now = Date.now() / 1000;
  const elapsed = now - lastRefill;
  lastRefill = now;
  tokens = Math.min(MAX_PER_SECOND, tokens + elapsed * MAX_PER_SECOND);
}

function processQueue(): void {
  refill();
  while (tokens >= 1 && queue.length > 0) {
    tokens -= 1;
    const next = queue.shift();
    if (next) next();
  }
  if (queue.length > 0) {
    setTimeout(processQueue, (1 / MAX_PER_SECOND) * 1000);
  }
}

export function throttle<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() => {
      fn().then(resolve).catch(reject);
    });
    if (queue.length === 1) processQueue();
  });
}
