'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  ArrowUpRight,
  Camera,
  Plus,
  PenLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Trash2,
  BookOpen,
  Target,
  Cloud,
  Play,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { AmbientClock, useTodayKey } from '@/components/ambient-clock';
import { FocusTimerCard } from '@/components/focus-timer-card';
import { WallpaperStage } from '@/components/wallpaper-stage';
import { WallpaperPicker } from '@/components/wallpaper-picker';
import { Choice, Radar } from '@/components/study-controls';
import { MusicPlayer } from '@/components/music-player';
import { EntryEditor } from '@/components/entry-editor';
import { ItemEditor } from '@/components/item-editor';
import {
  dateKey,
  DIMENSIONS,
  emptyTimer,
  focusPoints,
  growth,
  itemsOfKind,
  type EditableKind,
  type Item,
} from '@/lib/domain';
import { usePreferences } from '@/lib/preferences';
import { DEFAULT_WALLPAPER_ID } from '@/lib/wallpapers';
import { useStore, requestJSON } from '@/lib/use-store';

const sections = [
  ['home', '共学桌面'],
  ['focus', '专注'],
  ['plan', '今日计划'],
  ['moments', '随手记录'],
  ['diary', '日记'],
  ['growth', '五维成长'],
  ['settings', '设置'],
] as const;

type SimpleEditorKind = Exclude<EditableKind, 'entry'>;

type EditorState =
  | {
      kind: 'entry';
      old?: Item<'entry'>;
      source: 'photo' | 'diary';
      key: string;
    }
  | {
      kind: SimpleEditorKind;
      old?: Item<SimpleEditorKind>;
      key: string;
    };

type ModelContextRegistry = {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean };
      execute: (input: unknown) => Promise<{ status: string; saved: boolean }>;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

function download(name: string, content: string, mime = 'application/json') {
  const u = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

function shiftDaysKey(yyyyMmDd: string, deltaDays: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0);
  return dateKey(utc);
}

export default function StudyApp() {
  const store = useStore();
  const { items, busy, ready, status, perform, setMessage } = store;
  const { preferences, updatePreferences } = usePreferences();
  const today = useTodayKey();

  const hideDigitsId = useId();
  const taskChoiceId = useId();
  const reducedSwitchId = useId();
  const ornamentsSwitchId = useId();
  const clockSwitchId = useId();
  const glassSelectId = useId();

  const [view, setView] = useState('home');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [minutes, setMinutes] = useState(25);
  const [taskId, setTaskId] = useState('none');
  const [day, setDay] = useState(() => dateKey());
  const [month, setMonth] = useState(() => dateKey().slice(0, 7));
  const [search, setSearch] = useState('');

  const tasks = itemsOfKind(items, 'task');
  const entries = itemsOfKind(items, 'entry');
  const events = itemsOfKind(items, 'event');
  const sessions = itemsOfKind(items, 'session');
  const habits = itemsOfKind(items, 'habit');
  const notes = itemsOfKind(items, 'note');
  const timerItem = itemsOfKind(items, 'timer')[0];
  const timer = timerItem?.data ?? emptyTimer();
  const active = timer.status !== 'idle';

  const todaySeconds = sessions
    .filter((x) => x.data.date === today && x.data.mode === 'focus')
    .reduce((s, x) => s + x.data.seconds, 0);

  const weekStart = shiftDaysKey(today, -6);
  const totals = growth(items);
  const recent = growth(
    items.filter((x) => {
      if (x.kind === 'entry' || x.kind === 'session') {
        return x.data.date >= weekStart && x.data.date <= today;
      }
      return false;
    }),
  );

  const openEntry = useCallback(
    (source: 'photo' | 'diary', old?: Item<'entry'>) => {
      setEditor({
        kind: 'entry',
        old,
        source: old?.data.source ?? source,
        key: crypto.randomUUID(),
      });
    },
    [],
  );

  const openSimple = useCallback(
    <K extends SimpleEditorKind>(kind: K, old?: Item<K>) => {
      setEditor({
        kind,
        old,
        key: crypto.randomUUID(),
      });
    },
    [],
  );

  const timerVersion = timerItem?.version ?? 0;

  const timerAction = useCallback(
    async (
      action: 'start' | 'pause' | 'resume' | 'finish',
      mode: 'focus' | 'rest' = 'focus',
    ) => {
      const ok = await perform(
        () =>
          requestJSON('/api/timer', {
            action,
            version: timerVersion,
            minutes: mode === 'rest' ? 5 : minutes,
            taskId: taskId === 'none' ? '' : taskId,
            mode,
          }),
        action === 'finish' ? '本次专注已保存，休息一下吧。' : '专注状态已同步',
      );
      if (ok && action === 'start') setView('focus');
      return ok;
    },
    [perform, timerVersion, minutes, taskId],
  );

  useEffect(() => {
    const context = (
      document as Document & { modelContext?: ModelContextRegistry }
    ).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    const tool = {
      name: 'start_behavior_record',
      description: '打开行动记录编辑器并预填草稿；不会自动保存或结算五维。',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: 5000 } },
        required: ['text'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input: unknown) => {
        const text =
          input && typeof input === 'object'
            ? (input as { text?: unknown }).text
            : undefined;
        if (typeof text !== 'string' || !text.trim() || text.length > 5000)
          throw new Error('请输入1至5000字的行动描述');
        localStorage.setItem('xinhai-draft-diary', text);
        setView('diary');
        setEditor({
          kind: 'entry',
          source: 'diary',
          key: crypto.randomUUID(),
        });
        return { status: 'draft_opened', saved: false };
      },
    };
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: controller.signal }),
      ).catch(() => {});
    } catch {}
    return () => controller.abort();
  }, []);

  const handleWallpaperFallback = useCallback(() => {
    updatePreferences({ wallpaperId: DEFAULT_WALLPAPER_ID });
  }, [updatePreferences]);

  const selectedTaskTitle =
    taskId === 'none'
      ? '选择一件想推进的小事，或直接自由专注'
      : (tasks.find((t) => t.id === taskId)?.data.title ?? '自由专注');

  const signInHref = '/signin-with-chatgpt?return_to=%2F';
  const signOutHref = '/signout-with-chatgpt?return_to=%2F';

  const empty = (label: string, action?: () => void) => (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        ＋
      </span>
      <p>{label}</p>
      {action && (
        <button type="button" className="text-btn" onClick={action}>
          立即添加 <ArrowUpRight size={16} />
        </button>
      )}
    </div>
  );

  const taskRows = (list: Item<'task'>[]) =>
    list.length ? (
      <div className="task-list">
        {list.map((t) => (
          <div key={t.id} className={'task-row ' + (t.data.done ? 'done' : '')}>
            <Checkbox
              aria-label={'完成任务 ' + t.data.title}
              checked={t.data.done}
              disabled={busy}
              onCheckedChange={(done) =>
                void store.save('task', { ...t.data, done: Boolean(done) }, t)
              }
            />
            <button
              type="button"
              className="task-name"
              onClick={() => openSimple('task', t)}
            >
              <span>{t.data.title}</span>
              <small>
                {t.data.priority === 'high' ? '重要 · ' : ''}
                {t.data.date || '未排期'}
              </small>
            </button>
            {!t.data.done && (
              <button
                type="button"
                className="icon-btn"
                aria-label={'专注于 ' + t.data.title}
                onClick={() => {
                  setTaskId(t.id);
                  setView('focus');
                }}
              >
                <Play size={17} />
              </button>
            )}
            <button
              type="button"
              className="icon-btn muted"
              aria-label={'删除 ' + t.data.title}
              onClick={() => setDeleting(t)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    ) : (
      empty('留下一件今天想完成的事。', () => openSimple('task'))
    );

  const heading = (
    id: string,
    title: string,
    subtitle: string,
    action?: React.ReactNode,
  ) => (
    <div className="page-heading">
      <div>
        <p className="eyebrow">
          <span className="ornament-num">{id}</span>
          <span className="ornament-en"> / {subtitle}</span>
        </p>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );

  const recordCards = (list: Item<'entry'>[]) =>
    list.length ? (
      <div className="record-grid">
        {list.map((e) => (
          <article key={e.id} className="record-card glass-surface">
            {e.data.photoId && (
              <button
                type="button"
                className="photo-preview"
                onClick={() => openEntry(e.data.source, e)}
              >
                <img
                  src={'/api/photos/' + e.data.photoId}
                  alt="行动照片"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            )}
            <div className="record-content">
              <div className="record-meta">
                <span>{e.data.date}</span>
                <span>
                  {e.data.linkedId
                    ? '关联补充'
                    : e.data.confirmed
                      ? '已记入五维'
                      : '草稿'}
                </span>
              </div>
              <p>{e.data.text}</p>
              <div className="chips">
                {e.data.scores.map(
                  (v, i) =>
                    v > 0 && (
                      <span key={i}>
                        {DIMENSIONS[i]} +{v}
                      </span>
                    ),
                )}
              </div>
              <div className="record-actions">
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => openEntry(e.data.source, e)}
                >
                  <PenLine size={15} />
                  编辑
                </button>
                <button
                  type="button"
                  className="icon-btn muted"
                  aria-label="删除记录"
                  onClick={() => setDeleting(e)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    ) : (
      empty('还没有记录。真实发生的小事，也值得留下。', () =>
        openEntry(view === 'moments' ? 'photo' : 'diary'),
      )
    );

  const [year, monthNum] = month.split('-').map(Number);
  const monthDays = new Date(year, monthNum, 0).getDate();
  const offset = (new Date(year, monthNum - 1, 1).getDay() + 6) % 7;

  function changeMonth(delta: number) {
    const d = new Date(year, monthNum - 1 + delta, 1);
    setMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }

  return (
    <Tabs
      value={view}
      onValueChange={(v) => setView(String(v))}
      data-glass={preferences.glassStyle}
      data-hide-ornaments={preferences.hideOrnaments ? 'true' : 'false'}
      className={
        'app ' + (preferences.reducedMotion ? 'reduced ' : '') + 'glass-root'
      }
    >
      <WallpaperStage
        wallpaperId={preferences.wallpaperId}
        reducedMotion={preferences.reducedMotion}
        onFallback={handleWallpaperFallback}
      />

      <header className="topbar">
        <button type="button" className="brand" onClick={() => setView('home')}>
          心海<span className="ornament-en">STUDY IN THE BLUE</span>
        </button>
        <div className="topbar-right">
          <span className="top-en ornament-en" aria-hidden="true">
            DEEP SEA SPACE
          </span>
          <AmbientClock visible={preferences.showTopClock} />
          <button
            type="button"
            className="status"
            onClick={() => void store.refresh()}
            title="点击立即同步"
          >
            <Cloud size={15} />
            <span>{status === '已同步' ? '已同步' : status}</span>
          </button>
        </div>
      </header>

      {!ready && (
        <div className="connection-banner glass-surface">
          <span>{status}</span>
          <a href={signInHref} target="_top">
            登录心海
          </a>
          <button
            type="button"
            className="text-btn"
            onClick={() => void store.refresh()}
          >
            重试
          </button>
        </div>
      )}

      <TabsContent value="home">
        <section className="home">
          <span className="corner-watermark ornament-num" aria-hidden="true">
            00
          </span>
          <div className="hero-art" aria-hidden="true">
            <img
              src="/assets/makoto.png"
              alt=""
              decoding="async"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <span className="art-word ornament-en">BLUE</span>
          </div>
          <div className="home-left">
            <p className="eyebrow">
              <span className="ornament-num">00</span>
              <span className="ornament-en"> / YOUR STUDY SPACE</span>
            </p>
            <h1>
              沉入此刻<span>让成长自然浮现。</span>
            </h1>
            <p className="intro">把注意力留给眼前的事。今天，也从这里开始。</p>
            <div className="focus-panel glass-surface">
              <FocusTimerCard
                timer={timer}
                timerVersion={timerVersion}
                minutes={minutes}
                selectedTaskTitle={selectedTaskTitle}
                hideDigits={preferences.hideFocusDigits}
                ready={ready}
                busy={busy}
                onAction={timerAction}
              />
            </div>
            <div className="home-quick">
              <button
                type="button"
                className="glass-pill"
                onClick={() => openEntry('photo')}
              >
                <Camera size={18} />
                随手拍记
              </button>
              <button
                type="button"
                className="glass-pill"
                onClick={() => openEntry('diary')}
              >
                <PenLine size={17} />
                写下今天
              </button>
            </div>
          </div>
          <div className="art-caption">
            <span className="ornament-en">LET THE WORLD SLOW DOWN.</span>
            <p>
              世界很大。
              <br />
              此刻，只需要做好眼前的事。
            </p>
          </div>
        </section>

        <section className="home-bottom">
          <div className="today-panel glass-surface">
            <div className="section-title">
              <h3>
                今日待办{' '}
                <small className="ornament-en">TODAY&apos;S PLAN</small>
              </h3>
              <button
                type="button"
                className="icon-btn"
                aria-label="新建任务"
                onClick={() => openSimple('task')}
              >
                <Plus size={20} />
              </button>
            </div>
            {taskRows(
              tasks
                .filter(
                  (t) => !t.data.done && (!t.data.date || t.data.date <= today),
                )
                .slice(0, 4),
            )}
          </div>
          <div className="daily-stats">
            <div className="stat-card glass-surface">
              <strong>
                {Math.floor(todaySeconds / 60)}
                <small>分钟</small>
              </strong>
              <span>今日专注</span>
            </div>
            <div className="stat-card glass-surface">
              <strong>
                {
                  tasks.filter((t) => t.data.done && t.data.date === today)
                    .length
                }
                <small>件</small>
              </strong>
              <span>已完成计划</span>
            </div>
            <div className="stat-card glass-surface">
              <strong>
                {entries.filter((e) => e.data.date === today).length}
                <small>条</small>
              </strong>
              <span>今日记录</span>
            </div>
          </div>
        </section>
      </TabsContent>

      <TabsContent value="focus">
        <section className="focus-room">
          <span className="corner-watermark ornament-num" aria-hidden="true">
            01
          </span>
          <div className="focus-center glass-surface">
            <p className="eyebrow">
              <span className="ornament-num">01</span>
              <span className="ornament-en"> / ONE THING AT A TIME</span>
            </p>
            <h2>
              {active && timer.mode === 'rest'
                ? '浮出水面，休息片刻。'
                : '这一刻，只做一件事。'}
            </h2>
            <div className="focus-large">
              <FocusTimerCard
                timer={timer}
                timerVersion={timerVersion}
                minutes={minutes}
                selectedTaskTitle={selectedTaskTitle}
                hideDigits={preferences.hideFocusDigits}
                ready={ready}
                busy={busy}
                onAction={timerAction}
              />
            </div>
            {!active && (
              <div className="focus-options">
                <div className="preset-row">
                  {[25, 45, 50, 60].map((n) => (
                    <button
                      type="button"
                      key={n}
                      className={minutes === n ? 'selected' : ''}
                      onClick={() => setMinutes(n)}
                    >
                      {n} 分钟
                    </button>
                  ))}
                </div>
                <label className="inline-number-label">
                  <span>自定义时长（分钟）</span>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={minutes}
                    onChange={(e) =>
                      setMinutes(
                        Math.max(
                          1,
                          Math.min(
                            240,
                            Math.trunc(Number(e.target.value) || 1),
                          ),
                        ),
                      )
                    }
                  />
                </label>
                <div className="field-block">
                  <label htmlFor={taskChoiceId} className="sr-only">
                    关联任务
                  </label>
                  <Choice
                    id={taskChoiceId}
                    label="关联任务"
                    value={taskId}
                    onChange={setTaskId}
                    options={[
                      { value: 'none', label: '自由专注 · 不绑定任务' },
                      ...tasks
                        .filter((t) => !t.data.done)
                        .map((t) => ({ value: t.id, label: t.data.title })),
                    ]}
                  />
                </div>
                <button
                  type="button"
                  className="text-btn"
                  disabled={!ready || busy}
                  onClick={() => void timerAction('start', 'rest')}
                >
                  先休息 5 分钟
                </button>
              </div>
            )}
            <div className="switch-row">
              <Switch
                id={hideDigitsId}
                checked={preferences.hideFocusDigits}
                onCheckedChange={(checked) =>
                  updatePreferences({ hideFocusDigits: Boolean(checked) })
                }
              />
              <label htmlFor={hideDigitsId}>专注时隐藏倒计时数字</label>
            </div>
          </div>
        </section>

        <section className="content narrow">
          <div className="panel glass-surface">
            <div className="section-title">
              <h3>最近专注记录</h3>
            </div>
            {sessions.length
              ? sessions.slice(0, 8).map((s) => (
                  <div key={s.id} className="history-row">
                    <Target size={18} />
                    <div>
                      <strong>
                        {s.data.mode === 'rest' ? '休息' : s.data.taskTitle}
                      </strong>
                      <small>{s.data.date}</small>
                    </div>
                    <span className="tabular">
                      {Math.floor(s.data.seconds / 60)}分{s.data.seconds % 60}秒
                    </span>
                    <span className="cyan">
                      {s.data.mode === 'focus'
                        ? '学识 +' + focusPoints(s.data.seconds)
                        : '休息'}
                    </span>
                  </div>
                ))
              : empty('完成第一段专注，留下今天的轨迹。')}
          </div>
        </section>
      </TabsContent>

      <TabsContent value="plan">
        <section className="content">
          {heading(
            '02',
            '今日计划与日程',
            'MAKE ROOM FOR TODAY',
            <button
              type="button"
              className="primary"
              onClick={() => openSimple('task')}
            >
              <Plus size={18} />
              <span>新建任务</span>
            </button>,
          )}
          <div className="plan-grid">
            <div className="plan-left">
              <div className="calendar-panel glass-surface">
                <div className="section-title">
                  <h3 className="tabular">
                    {year}
                    <span className="month-number">
                      {' '}
                      / {String(monthNum).padStart(2, '0')}
                    </span>
                  </h3>
                  <div className="button-row">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="上个月"
                      onClick={() => changeMonth(-1)}
                    >
                      <ChevronLeft />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="下个月"
                      onClick={() => changeMonth(1)}
                    >
                      <ChevronRight />
                    </button>
                  </div>
                </div>
                <div className="calendar-grid">
                  {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
                    <span className="weekday" key={w}>
                      {w}
                    </span>
                  ))}
                  {Array.from({ length: offset }, (_, i) => (
                    <span key={'blank' + i} />
                  ))}
                  {Array.from({ length: monthDays }, (_, i) => {
                    const key = month + '-' + String(i + 1).padStart(2, '0');
                    const has =
                      tasks.some((t) => t.data.date === key) ||
                      events.some((e) => e.data.start.startsWith(key));
                    return (
                      <button
                        type="button"
                        key={key}
                        className={
                          (key === day ? 'selected ' : '') +
                          (key === today ? 'today' : '')
                        }
                        onClick={() => setDay(key)}
                      >
                        {i + 1}
                        {has && <i />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="panel habits glass-surface">
                <div className="section-title">
                  <h3>
                    日常习惯{' '}
                    <small className="ornament-en">KEEP COMING BACK</small>
                  </h3>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="新增习惯"
                    onClick={() => openSimple('habit')}
                  >
                    <Plus size={18} />
                  </button>
                </div>
                {habits.length
                  ? habits.map((h) => (
                      <div key={h.id} className="habit-row">
                        <button
                          type="button"
                          className={
                            'habit-check ' +
                            (h.data.dates.includes(today) ? 'checked' : '')
                          }
                          aria-label={'今日打卡 ' + h.data.title}
                          disabled={busy}
                          onClick={() =>
                            void store.save(
                              'habit',
                              {
                                ...h.data,
                                dates: h.data.dates.includes(today)
                                  ? h.data.dates.filter(
                                      (d: string) => d !== today,
                                    )
                                  : [...h.data.dates, today],
                              },
                              h,
                            )
                          }
                        >
                          <Check size={18} />
                        </button>
                        <button
                          type="button"
                          className="task-name"
                          onClick={() => openSimple('habit', h)}
                        >
                          <span>{h.data.title}</span>
                          <small>累计 {h.data.dates.length} 天</small>
                        </button>
                        <button
                          type="button"
                          className="icon-btn muted"
                          aria-label="删除习惯"
                          onClick={() => setDeleting(h)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))
                  : empty('连续不是目的，重新回来才是。', () =>
                      openSimple('habit'),
                    )}
              </div>
            </div>

            <div className="plan-right">
              <div className="panel glass-surface">
                <div className="section-title">
                  <h3 className="tabular">
                    {day.slice(5).replace('-', ' / ')} 待办
                  </h3>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setDay(today)}
                  >
                    回到今天
                  </button>
                </div>
                {taskRows(
                  tasks.filter((t) => t.data.date === day || !t.data.date),
                )}
              </div>

              <div className="panel glass-surface">
                <div className="section-title">
                  <h3>日程安排</h3>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="新增日程"
                    onClick={() => openSimple('event')}
                  >
                    <Plus size={19} />
                  </button>
                </div>
                {events.filter((e) => e.data.start.startsWith(day)).length
                  ? events
                      .filter((e) => e.data.start.startsWith(day))
                      .sort((a, b) => a.data.start.localeCompare(b.data.start))
                      .map((e) => (
                        <div className="history-row" key={e.id}>
                          <span className="event-time tabular">
                            {e.data.start.slice(11, 16)}
                          </span>
                          <button
                            type="button"
                            className="task-name"
                            onClick={() => openSimple('event', e)}
                          >
                            <span>{e.data.title}</span>
                            <small className="tabular">
                              至 {e.data.end.slice(11, 16)}
                            </small>
                          </button>
                          <button
                            type="button"
                            className="icon-btn muted"
                            aria-label="删除日程"
                            onClick={() => setDeleting(e)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))
                  : empty('这一天还有留白。', () => openSimple('event'))}
              </div>

              <div className="panel glass-surface">
                <div className="section-title">
                  <h3>随手便签</h3>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="新增便签"
                    onClick={() => openSimple('note')}
                  >
                    <Plus size={19} />
                  </button>
                </div>
                {notes.length
                  ? notes.map((n) => (
                      <div className="note-row" key={n.id}>
                        <button
                          type="button"
                          onClick={() => openSimple('note', n)}
                        >
                          <strong>{n.data.title}</strong>
                          <p>{n.data.text}</p>
                        </button>
                        <button
                          type="button"
                          className="icon-btn muted"
                          aria-label="删除便签"
                          onClick={() => setDeleting(n)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  : empty('把突然想到的事暂存在这里。', () =>
                      openSimple('note'),
                    )}
              </div>
            </div>
          </div>
        </section>
      </TabsContent>

      <TabsContent value="moments">
        <section className="content">
          {heading(
            '03',
            '随手记录',
            'LITTLE MOMENTS',
            <button
              type="button"
              className="primary"
              onClick={() => openEntry('photo')}
            >
              <Camera size={18} />
              <span>记录此刻</span>
            </button>,
          )}
          <div className="moment-intro glass-surface">
            <span className="giant-label ornament-en" aria-hidden="true">
              SNAP.
              <br />
              LIVE.
              <br />
              GROW.
            </span>
            <div>
              <h3>一张照片，一件真实行动。</h3>
              <p>运动、写完的一页题、认真吃的一顿饭，把生活里的行动留下来。</p>
            </div>
          </div>
          {recordCards(entries.filter((e) => e.data.source === 'photo'))}
        </section>
      </TabsContent>

      <TabsContent value="diary">
        <section className="content">
          {heading(
            '04',
            '今日日记',
            'DEAR MYSELF',
            <button
              type="button"
              className="primary"
              onClick={() => openEntry('diary')}
            >
              <PenLine size={18} />
              <span>写下今天</span>
            </button>,
          )}
          <div className="diary-tools">
            <p className="subtle">不必追求文采，如实记下今天做成的事。</p>
            <input
              aria-label="搜索日记"
              type="search"
              placeholder="搜索日记内容…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {recordCards(
            entries.filter(
              (e) => e.data.source === 'diary' && e.data.text.includes(search),
            ),
          )}
        </section>
      </TabsContent>

      <TabsContent value="growth">
        <section className="content">
          {heading('05', '五维成长', 'YOUR INNER UNIVERSE')}
          <div className="growth-grid">
            <div className="radar-panel glass-surface">
              <p className="eyebrow ornament-en">LAST 7 DAYS</p>
              <h3>近七日行动分布</h3>
              <Radar scores={recent} />
              <p className="subtle">汇总近 7 天已确认记录与专注时长。</p>
            </div>
            <div className="dimension-list glass-surface">
              {DIMENSIONS.map((d, i) => {
                const level = Math.floor(Math.sqrt(totals[i] / 30)) + 1;
                const next = 30 * level * level;
                const base = 30 * (level - 1) * (level - 1);
                return (
                  <div key={d} className="dimension-row">
                    <span className="dimension-num ornament-num">0{i + 1}</span>
                    <div>
                      <div className="dimension-heading">
                        <strong>{d}</strong>
                        <span className="tabular">Lv.{level}</span>
                      </div>
                      <div className="xp-track">
                        <i
                          style={{
                            width:
                              ((totals[i] - base) / (next - base)) * 100 + '%',
                          }}
                        />
                      </div>
                      <small className="tabular">
                        累计 {totals[i]} 点 · 距下一级 {next - totals[i]} 点
                      </small>
                    </div>
                    <span className="week-xp tabular">
                      +{recent[i]}
                      <small>近七日</small>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel growth-history glass-surface">
            <div className="section-title">
              <h3>成长来源明细</h3>
            </div>
            {entries.filter((e) => e.data.confirmed).length
              ? entries
                  .filter((e) => e.data.confirmed)
                  .slice(0, 12)
                  .map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      className="growth-event"
                      onClick={() => openEntry(e.data.source, e)}
                    >
                      <BookOpen size={18} />
                      <span>
                        {e.data.text.slice(0, 80)}
                        <small>
                          {e.data.date} ·{' '}
                          {e.data.linkedId
                            ? '关联补充（不重复计分）'
                            : '已确认'}
                        </small>
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                  ))
              : empty('确认第一条行动记录后在此显示。')}
            <p className="subtle">
              专注每满 25 分钟 +1 学识（单次上限 4 点）；日记与照片每维 0–5 点。
            </p>
          </div>
        </section>
      </TabsContent>

      <TabsContent value="settings">
        <section className="content narrow">
          {heading('06', '外观与数据', 'MAKE IT YOURS')}

          <div className="panel settings-panel glass-surface">
            <h3>界面与视觉质感</h3>
            <div className="setting-row">
              <div>
                <strong>小组件材质</strong>
                <p>统一全平台液态玻璃折射质感，或切换为高对比深海雾面。</p>
              </div>
              <div className="setting-select">
                <label htmlFor={glassSelectId} className="sr-only">
                  小组件材质
                </label>
                <Choice
                  id={glassSelectId}
                  label="小组件材质"
                  value={preferences.glassStyle}
                  onChange={(v) =>
                    updatePreferences({
                      glassStyle: v === 'frosted' ? 'frosted' : 'liquid',
                    })
                  }
                  options={[
                    { value: 'liquid', label: '液态玻璃（通透折射）' },
                    { value: 'frosted', label: '深海雾面（高对比度）' },
                  ]}
                />
              </div>
            </div>

            <div className="setting-row">
              <div>
                <label htmlFor={ornamentsSwitchId}>
                  <strong>隐藏装饰英文与编号</strong>
                </label>
                <p>
                  隐藏右上角英文副标、左下角与导航栏装饰数字，仅保留核心内容。
                </p>
              </div>
              <Switch
                id={ornamentsSwitchId}
                checked={preferences.hideOrnaments}
                onCheckedChange={(checked) =>
                  updatePreferences({ hideOrnaments: Boolean(checked) })
                }
              />
            </div>

            <div className="setting-row">
              <div>
                <label htmlFor={clockSwitchId}>
                  <strong>显示顶栏时钟</strong>
                </label>
                <p>独立等宽分钟时钟，零全页重绘，平板与电脑均不抖动。</p>
              </div>
              <Switch
                id={clockSwitchId}
                checked={preferences.showTopClock}
                onCheckedChange={(checked) =>
                  updatePreferences({ showTopClock: Boolean(checked) })
                }
              />
            </div>

            <div className="setting-row">
              <div>
                <label htmlFor={reducedSwitchId}>
                  <strong>减少动态效果</strong>
                </label>
                <p>停止视频背景播放与界面过渡动画，降低平板功耗。</p>
              </div>
              <Switch
                id={reducedSwitchId}
                checked={preferences.reducedMotion}
                onCheckedChange={(checked) =>
                  updatePreferences({ reducedMotion: Boolean(checked) })
                }
              />
            </div>
          </div>

          <div className="panel settings-panel glass-surface">
            <WallpaperPicker
              activeId={preferences.wallpaperId}
              reducedMotion={preferences.reducedMotion}
              onSelect={(id) => updatePreferences({ wallpaperId: id })}
              onNotify={(msg) => setMessage(msg)}
            />
          </div>

          <div className="panel settings-panel glass-surface">
            <h3>数据备份与同步</h3>
            <p className="subtle">
              支持
              Mac、iPad、Windows、安卓平板与手机多端自适应。云端记录跟随机主账户同步。
            </p>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  download(
                    '心海记录-' + today + '.json',
                    JSON.stringify(
                      {
                        format: 'xinhai-1',
                        exportedAt: new Date().toISOString(),
                        items,
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                <Download size={16} />
                导出 JSON 备份
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  download(
                    '心海日记-' + today + '.md',
                    entries
                      .map(
                        (e) =>
                          '## ' + e.data.date + '\n\n' + e.data.text + '\n\n',
                      )
                      .join('\n'),
                    'text/markdown',
                  )
                }
              >
                <Download size={16} />
                导出 Markdown 日记
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  download(
                    '心海专注-' + today + '.csv',
                    '\uFEFF日期,任务,秒数,类型\n' +
                      sessions
                        .map((s) =>
                          [
                            s.data.date,
                            s.data.taskTitle,
                            s.data.seconds,
                            s.data.mode,
                          ]
                            .map(
                              (v) =>
                                '"' + String(v).replaceAll('"', '""') + '"',
                            )
                            .join(','),
                        )
                        .join('\n'),
                    'text/csv',
                  )
                }
              >
                <Download size={16} />
                导出专注 CSV
              </button>
            </div>
            <div className="settings-footer-actions">
              <button
                type="button"
                className="text-btn"
                onClick={() => void store.refresh()}
              >
                <RefreshCw size={15} />
                立即云同步
              </button>
              <a className="text-btn" href={signOutHref} target="_top">
                退出当前账户
              </a>
            </div>
          </div>
        </section>
      </TabsContent>

      <div className="music-dock glass-dock">
        <MusicPlayer />
      </div>

      <TabsList className="bottom-nav glass-dock" aria-label="学习空间导航">
        {sections.map(([id, name], i) => (
          <TabsTrigger
            key={id}
            value={id}
            className={view === id ? 'active' : ''}
          >
            <small className="ornament-num">0{i}</small>
            <span>{name}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {editor &&
        (editor.kind === 'entry' ? (
          <EntryEditor
            key={editor.key}
            source={editor.source}
            old={editor.old}
            store={store}
            onClose={() => setEditor(null)}
          />
        ) : (
          <ItemEditor
            key={editor.key}
            kind={editor.kind}
            old={editor.old}
            store={store}
            onClose={() => setEditor(null)}
          />
        ))}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <AlertDialogContent className="small-modal glass-surface">
          <AlertDialogTitle>确认删除这条记录？</AlertDialogTitle>
          <AlertDialogDescription>
            删除后对应的五维经验将自动重算，此操作不可撤销。
          </AlertDialogDescription>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => setDeleting(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (deleting && (await store.remove(deleting)))
                  setDeleting(null);
              }}
            >
              <span>确认删除</span>
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {store.message && (
        <output className="toast glass-surface">
          <span>{store.message}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭提示"
            onClick={() => store.setMessage('')}
          >
            ×
          </button>
        </output>
      )}
    </Tabs>
  );
}
