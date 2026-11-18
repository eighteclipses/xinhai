import { database, identity, failure, ApiError, safeWrite } from '@/lib/server';
import {
  emptyTimer,
  elapsedSeconds,
  dateKey,
  type SessionData,
  type Timer,
} from '@/lib/domain';

type TimerRow = {
  payload: string;
  version: number;
};

type TaskPayloadRow = {
  payload: string;
};

type TimerActionRequest = {
  action?: unknown;
  version?: unknown;
  minutes?: unknown;
  taskId?: unknown;
  mode?: unknown;
};

export async function POST(request: Request) {
  try {
    safeWrite(request);
    const owner = await identity();
    const b = (await request.json()) as TimerActionRequest;
    const db = database();
    const now = Date.now();
    const old = await db
      .prepare(
        "SELECT payload,version FROM records WHERE owner=? AND id='focus'",
      )
      .bind(owner)
      .first<TimerRow>();
    const version = old?.version || 0;
    if (version !== b.version)
      throw new ApiError(409, '专注状态已在另一台设备更新，请刷新后重试');
    let timer: Timer = old ? (JSON.parse(old.payload) as Timer) : emptyTimer();
    const elapsed = elapsedSeconds(timer, now);
    let completed: SessionData | null = null;
    if (b.action === 'start') {
      if (timer.status !== 'idle')
        throw new ApiError(409, '已有专注或休息正在进行');
      if (
        typeof b.minutes !== 'number' ||
        !Number.isInteger(b.minutes) ||
        b.minutes < 1 ||
        b.minutes > 240
      )
        throw new ApiError(400, '时长须为1至240分钟');
      let taskTitle = '自由专注';
      const taskId = typeof b.taskId === 'string' ? b.taskId : '';
      if (taskId) {
        const task = await db
          .prepare(
            "SELECT payload FROM records WHERE owner=? AND id=? AND kind='task'",
          )
          .bind(owner, taskId)
          .first<TaskPayloadRow>();
        if (!task) throw new ApiError(400, '关联任务不存在');
        taskTitle = (JSON.parse(task.payload) as { title: string }).title;
      }
      timer = {
        status: 'running',
        mode: b.mode === 'rest' ? 'rest' : 'focus',
        duration: b.minutes * 60,
        elapsed: 0,
        since: now,
        taskId,
        taskTitle,
      };
    } else if (b.action === 'pause' && timer.status === 'running') {
      timer = { ...timer, status: 'paused', elapsed, since: 0 };
    } else if (b.action === 'resume' && timer.status === 'paused') {
      timer = { ...timer, status: 'running', since: now };
    } else if (b.action === 'finish' && timer.status !== 'idle') {
      completed = {
        seconds: elapsed,
        mode: timer.mode,
        taskId: timer.taskId,
        taskTitle: timer.taskTitle,
        date: dateKey(now),
        ended: now,
      };
      timer = emptyTimer();
    } else throw new ApiError(400, '当前状态不能执行此操作');
    if (!old) {
      const result = await db
        .prepare(
          "INSERT OR IGNORE INTO records(owner,id,kind,payload,version,updated) VALUES(?,'focus','timer',?,1,?)",
        )
        .bind(owner, JSON.stringify(timer), now)
        .run();
      if (!result.meta.changes)
        throw new ApiError(409, '另一台设备已开始专注，请刷新');
    } else {
      const statements = [];
      if (completed)
        statements.push(
          db
            .prepare(
              "INSERT INTO records(owner,id,kind,payload,version,updated) SELECT ?,?,'session',?,1,? FROM records WHERE owner=? AND id='focus' AND version=?",
            )
            .bind(
              owner,
              crypto.randomUUID(),
              JSON.stringify(completed),
              now,
              owner,
              version,
            ),
        );
      statements.push(
        db
          .prepare(
            "UPDATE records SET payload=?,version=version+1,updated=? WHERE owner=? AND id='focus' AND version=?",
          )
          .bind(JSON.stringify(timer), now, owner, version),
      );
      const results = await db.batch(statements);
      if (!results[results.length - 1].meta.changes)
        throw new ApiError(409, '专注状态已变化，请刷新');
    }
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
