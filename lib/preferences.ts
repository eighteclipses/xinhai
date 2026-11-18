'use client';
import { useCallback, useSyncExternalStore } from 'react';

export type GlassStyle = 'liquid' | 'frosted';

export type UiPreferences = {
  reducedMotion: boolean;
  glassStyle: GlassStyle;
  hideOrnaments: boolean;
  showTopClock: boolean;
  hideFocusDigits: boolean;
  wallpaperId: string;
};

export const PREFERENCES_STORAGE_KEY = 'xinhai-preferences-v2';

export const DEFAULT_PREFERENCES: UiPreferences = {
  reducedMotion: false,
  glassStyle: 'liquid',
  hideOrnaments: false,
  showTopClock: true,
  hideFocusDigits: false,
  wallpaperId: 'deep-ocean',
};

export function normalizePreferences(
  raw: unknown,
  legacy?: {
    reduced?: string | null;
    moving?: string | null;
    systemReduced?: boolean;
  },
): UiPreferences {
  const fallbackReduced =
    legacy?.reduced === 'true' || Boolean(legacy?.systemReduced);
  const fallbackWallpaper =
    legacy?.moving === 'true' ? 'sea-video' : DEFAULT_PREFERENCES.wallpaperId;

  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_PREFERENCES,
      reducedMotion: fallbackReduced,
      wallpaperId: fallbackWallpaper,
    };
  }

  const obj = raw as Record<string, unknown>;
  const glassStyle: GlassStyle =
    obj.glassStyle === 'frosted' ? 'frosted' : 'liquid';
  const wallpaperId =
    typeof obj.wallpaperId === 'string' && obj.wallpaperId.trim().length > 0
      ? obj.wallpaperId.trim()
      : fallbackWallpaper;

  return {
    reducedMotion:
      typeof obj.reducedMotion === 'boolean'
        ? obj.reducedMotion
        : fallbackReduced,
    glassStyle,
    hideOrnaments: obj.hideOrnaments === true,
    showTopClock: obj.showTopClock !== false,
    hideFocusDigits: obj.hideFocusDigits === true,
    wallpaperId,
  };
}

let cachedRaw: string | null | undefined;
let cachedSnapshot: UiPreferences = DEFAULT_PREFERENCES;
const listeners = new Set<() => void>();

function readClientPreferences(): UiPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (raw === cachedRaw) return cachedSnapshot;
    cachedRaw = raw;
    const systemReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const legacy = {
      reduced: window.localStorage.getItem('xinhai-reduced'),
      moving: window.localStorage.getItem('xinhai-moving'),
      systemReduced,
    };
    cachedSnapshot = raw
      ? normalizePreferences(JSON.parse(raw), legacy)
      : normalizePreferences(null, legacy);
    return cachedSnapshot;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function getServerPreferences(): UiPreferences {
  return DEFAULT_PREFERENCES;
}

function subscribePreferences(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === PREFERENCES_STORAGE_KEY) {
      cachedRaw = undefined;
      listener();
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

export function writeClientPreferences(next: UiPreferences) {
  if (typeof window === 'undefined') return;
  try {
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, serialized);
    window.localStorage.setItem('xinhai-reduced', String(next.reducedMotion));
    window.localStorage.setItem(
      'xinhai-moving',
      String(next.wallpaperId === 'sea-video'),
    );
    cachedRaw = serialized;
    cachedSnapshot = next;
  } catch {}
  for (const listener of listeners) listener();
}

export function usePreferences() {
  const preferences = useSyncExternalStore(
    subscribePreferences,
    readClientPreferences,
    getServerPreferences,
  );

  const updatePreferences = useCallback((patch: Partial<UiPreferences>) => {
    const current = readClientPreferences();
    writeClientPreferences(normalizePreferences({ ...current, ...patch }));
  }, []);

  return { preferences, updatePreferences };
}
