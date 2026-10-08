export type ClientStateSyncRequest =
  | { op: 'initialize'; state: Record<string, string> }
  | { op: 'set'; key: string; value: string }
  | { op: 'remove'; key: string }
  | { op: 'clear' }

export type ClientStateSyncResult =
  | { ok: true; value: Record<string, string> | null }
  | { ok: false; error: string }
