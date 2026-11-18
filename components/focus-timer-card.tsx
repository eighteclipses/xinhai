'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Pause, Play, Square } from 'lucide-react';
import { elapsedSeconds, type Timer } from '@/lib/domain';

type FocusTimerCardProps = {
  timer: Timer;
  timerVersion: number;
  minutes: number;
  selectedTaskTitle: string;
  hideDigits: boolean;
  ready: boolean;
  busy: boolean;
  onAction: (
    action: 'start' | 'pause' | 'resume' | 'finish',
    mode?: 'focus' | 'rest',
  ) => Promise<boolean>;
};

export function FocusTimerCard({
  timer,
  timerVersion,
  minutes,
  selectedTaskTitle,
  hideDigits,
  ready,
  busy,
  onAction,
}: FocusTimerCardProps) {
  const active = timer.status !== 'idle';
  const [tickNow, setTickNow] = useState(() => Date.now());
  const autoFinishRef = useRef('');

  useEffect(() => {
    if (timer.status !== 'running') return;
    const sync = () => setTickNow(Date.now());
    const initial = setTimeout(sync, 0);
    const id = setInterval(sync, 1000);
    const onVisible = () => {
      if (!document.hidden) sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
    };
  }, [timer.status, timer.since]);

  const seconds = active
    ? Math.max(0, timer.duration - elapsedSeconds(timer, tickNow))
    : minutes * 60;
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  useEffect(() => {
    if (timer.status === 'running' && seconds === 0 && ready && !busy) {
      const key = String(timerVersion);
      if (autoFinishRef.current !== key) {
        autoFinishRef.current = key;
        void onAction('finish');
      }
    }
  }, [seconds, timer.status, timerVersion, ready, busy, onAction]);

  return (
    <>
      <div className="section-label">
        <span className="ornament-en">
          {timer.mode === 'rest' && active ? 'TAKE A BREATH' : 'FOCUS SESSION'}
        </span>
        <span>
          {active
            ? timer.status === 'paused'
              ? '已暂停'
              : '进行中'
            : '准备就绪'}
        </span>
      </div>
      <div className="timer" aria-live="off">
        {hideDigits && active ? (
          <span className="timer-calm">专注当下</span>
        ) : (
          <>
            {mm}
            <span className="timer-colon">:</span>
            {ss}
          </>
        )}
      </div>
      <p className="timer-task">
        {active ? timer.taskTitle : selectedTaskTitle}
      </p>
      {active ? (
        <div className="button-row">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void onAction(timer.status === 'paused' ? 'resume' : 'pause')
            }
          >
            {timer.status === 'paused' ? (
              <Play size={18} />
            ) : (
              <Pause size={18} />
            )}
            <span>{timer.status === 'paused' ? '继续' : '暂停'}</span>
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void onAction('finish')}
          >
            <Square size={16} />
            <span>结束并保存</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={!ready || busy}
          onClick={() => void onAction('start')}
        >
          <span className="btn-inline">
            <Play size={18} />
            开始专注
          </span>
          <ArrowUpRight size={20} />
        </button>
      )}
    </>
  );
}
