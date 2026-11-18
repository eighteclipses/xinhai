'use client';
import { useSyncExternalStore } from 'react';
import { dateKey } from '@/lib/domain';

const subscribers = new Set<() => void>();
let timerHandle: ReturnType<typeof setTimeout> | null = null;
let currentMinuteStamp = '';
let currentDayStamp = '';

function formatClockText(ms: number): string {
  const datePart = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(ms);
  const timePart = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ms);
  return `${datePart} · ${timePart}`;
}

function syncClockStore() {
  const now = Date.now();
  const nextMinute = formatClockText(now);
  const nextDay = dateKey(now);
  if (nextMinute !== currentMinuteStamp || nextDay !== currentDayStamp) {
    currentMinuteStamp = nextMinute;
    currentDayStamp = nextDay;
    for (const cb of subscribers) cb();
  }
}

function scheduleNextTick() {
  if (timerHandle) clearTimeout(timerHandle);
  if (subscribers.size === 0) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const now = Date.now();
  const delay = 60_000 - (now % 60_000) + 60;
  timerHandle = setTimeout(() => {
    syncClockStore();
    scheduleNextTick();
  }, delay);
}

function subscribeClock(cb: () => void) {
  if (subscribers.size === 0 && typeof window !== 'undefined') {
    const now = Date.now();
    currentMinuteStamp = formatClockText(now);
    currentDayStamp = dateKey(now);
  }
  subscribers.add(cb);
  scheduleNextTick();

  const onVisible = () => {
    if (!document.hidden) {
      syncClockStore();
      scheduleNextTick();
    }
  };

  if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
  }

  return () => {
    subscribers.delete(cb);
    if (typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    }
    if (subscribers.size === 0 && timerHandle) {
      clearTimeout(timerHandle);
      timerHandle = null;
    }
  };
}

function getClockSnapshot(): string {
  if (!currentMinuteStamp && typeof window !== 'undefined') {
    currentMinuteStamp = formatClockText(Date.now());
  }
  return currentMinuteStamp;
}

function getServerClockSnapshot(): string {
  return '';
}

function getDaySnapshot(): string {
  if (!currentDayStamp) {
    currentDayStamp = dateKey();
  }
  return currentDayStamp;
}

const SERVER_FALLBACK_DAY = dateKey();
function getServerDaySnapshot(): string {
  return SERVER_FALLBACK_DAY;
}

export function useTodayKey(): string {
  return useSyncExternalStore(
    subscribeClock,
    getDaySnapshot,
    getServerDaySnapshot,
  );
}

export function AmbientClock({ visible }: { visible: boolean }) {
  const label = useSyncExternalStore(
    subscribeClock,
    getClockSnapshot,
    getServerClockSnapshot,
  );

  if (!visible) return null;

  return (
    <time className="ambient-clock" aria-label="当前日期与时间">
      {label || '心海时刻'}
    </time>
  );
}
