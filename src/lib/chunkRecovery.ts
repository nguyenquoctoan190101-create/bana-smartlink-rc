const RECOVERY_KEY = "bana-smartlink:chunk-reload-at";
const RECOVERY_WINDOW_MS = 60_000;

type RecoveryStorage = Pick<Storage, "getItem" | "setItem">;
type ReloadTarget = { reload: () => void };

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk [^ ]+ failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function attemptChunkRecovery(
  error: unknown,
  options: {
    storage?: RecoveryStorage;
    location?: ReloadTarget;
    now?: number;
  } = {},
): boolean {
  if (!isChunkLoadError(error)) return false;

  const storage = options.storage ?? window.sessionStorage;
  const location = options.location ?? window.location;
  const now = options.now ?? Date.now();
  const previous = Number(storage.getItem(RECOVERY_KEY));

  // A second failure inside the guard window is a real deployment/cache
  // problem. Let the error boundary explain it instead of creating a loop.
  if (Number.isFinite(previous) && previous > 0 && now - previous < RECOVERY_WINDOW_MS) {
    return false;
  }

  storage.setItem(RECOVERY_KEY, String(now));
  location.reload();
  return true;
}

export function installChunkRecovery(): void {
  window.addEventListener("vite:preloadError", (event: Event) => {
    const preloadEvent = event as Event & { payload?: unknown };
    if (attemptChunkRecovery(preloadEvent.payload ?? event)) {
      event.preventDefault();
    }
  });
}
