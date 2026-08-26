/** Build-time constant from electron.vite.config.ts: client-safe env baked
    into packaged builds. Absent under vitest, hence the typeof guards. */
declare const __MANOR_BAKED_ENV__: Record<string, string> | undefined
