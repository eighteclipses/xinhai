import { database, identity, failure, ApiError, safeWrite } from '@/lib/server';
import {
  analyze,
  validateScores,
  normalizeText,
  type EditableKind,
} from '@/lib/domain';

type ExistingRecordRow = {
  id?: string;
  version: number;
  kind: string;
  payload: string;
};

type PayloadOnlyRow = {
  id?: string;
  kind?: string;
  payload: string;
};

type RecordWriteRequest = {
  id?: unknown;
  kind?: unknown;
  version?: unknown;
  remove?: unknown;
  data?: unknown;
};

const EDITABLE_KINDS = new Set<string>([
  'task',
  'entry',
  'event',
  'habit',
  'note',
]);

function isEditableKind(value: unknown): value is EditableKind {
  return typeof value === 'string' && EDITABLE_KINDS.has(value);
}

export async function POST(request: Request) {
  try {
    safeWrite(request);
    const owner = await identity();
    if (Number(request.headers.get('content-length')) > 100000)
      throw new ApiError(413, '内容过长');
    const body = (await request.json()) as RecordWriteRequest;
    const { id, kind, version = 0, remove = false } = body;
    if (
      typeof id !== 'string' ||
      id === 'focus' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
      !isEditableKind(kind) ||
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 0
    )
      throw new ApiError(400, '记录格式不正确');
    const db = database();
    const old = await db
      .prepare(
        'SELECT version,kind,payload FROM records WHERE owner=? AND id=?',
      )
      .bind(owner, id)
      .first<ExistingRecordRow>();
    if (
      old &&
      ((old.version !== version && !(old.version === 1 && version === 0)) ||
        old.kind !== kind)
    )
      throw new ApiError(
        409,
        '另一台设备已修改这条记录，请刷新后重试。输入会保留。',
      );
    if (!old && version !== 0)
      throw new ApiError(409, '记录已变化，请刷新后重试');
    if (remove === true) {
      const linked = await db
        .prepare(
          "SELECT id FROM records WHERE owner=? AND kind='entry' AND json_extract(payload,'$.linkedId')=? LIMIT 1",
        )
        .bind(owner, id)
        .first();
      if (linked)
        throw new ApiError(
          409,
          '还有补充记录关联这次行动，请先修改或删除补充记录。',
        );
      const result = await db
        .prepare('DELETE FROM records WHERE owner=? AND id=? AND version=?')
        .bind(owner, id, version)
        .run();
      if (!result.meta.changes) throw new ApiError(409, '记录已变化');
      return Response.json({ ok: true });
    }
    if (!body.data || typeof body.data !== 'object')
      throw new ApiError(400, '缺少记录内容');
    const raw = body.data as Record<string, unknown>;
    const str = (v: unknown, max: number) => {
      if (typeof v !== 'string' || v.length > max)
        throw new ApiError(400, '文字格式或长度不正确');
      return v.trim();
    };
    let data: Record<string, unknown> = {};
    if (kind === 'entry') {
      const text = str(raw.text, 5000);
      if (!text) throw new ApiError(400, '请写下一句行动描述');
      const date = str(raw.date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new ApiError(400, '请选择记录日期');
      const linkedId = str(raw.linkedId || '', 80);
      if (linkedId) {
        const linked = await db
          .prepare(
            "SELECT kind,payload FROM records WHERE owner=? AND id=? AND kind IN ('entry','session')",
          )
          .bind(owner, linkedId)
          .first<PayloadOnlyRow>();
        const parsedLinked = linked
          ? (JSON.parse(linked.payload) as { linkedId?: string })
          : null;
        if (!linked || linkedId === id || parsedLinked?.linkedId)
          throw new ApiError(400, '请选择有效的原始行动记录');
      }
      const photoId = str(raw.photoId || '', 80);
      if (
        photoId &&
        !(await db
          .prepare('SELECT id FROM photos WHERE owner=? AND id=?')
          .bind(owner, photoId)
          .first())
      )
        throw new ApiError(400, '照片不存在');
      let scores;
      try {
        scores = validateScores(raw.scores);
      } catch {
        throw new ApiError(400, '成长建议须为0至5的整数');
      }
      if (raw.confirmed && !linkedId) {
        const rows = await db
          .prepare(
            "SELECT id,payload FROM records WHERE owner=? AND kind='entry' AND id<>?",
          )
          .bind(owner, id)
          .all<PayloadOnlyRow>();
        const duplicate = rows.results.find((r) => {
          const p = JSON.parse(r.payload) as {
            confirmed?: boolean;
            date?: string;
            text?: string;
          };
          return (
            p.confirmed &&
            p.date === date &&
            typeof p.text === 'string' &&
            normalizeText(p.text) === normalizeText(text)
          );
        });
        if (duplicate)
          throw new ApiError(
            409,
            '今天已确认过相同描述，请关联原记录，避免重复结算。',
          );
      }
      data = {
        text,
        date,
        photoId,
        linkedId,
        scores,
        confirmed: raw.confirmed === true,
        source: raw.source === 'photo' ? 'photo' : 'diary',
        analysis: analyze(text),
      };
    } else if (kind === 'task') {
      const title = str(raw.title, 160);
      if (!title) throw new ApiError(400, '请输入任务名称');
      data = {
        title,
        done: raw.done === true,
        date: str(raw.date || '', 10),
        priority: raw.priority === 'high' ? 'high' : 'normal',
      };
    } else if (kind === 'note') {
      data = {
        title: str(raw.title || '便签', 100),
        text: str(raw.text, 10000),
      };
    } else if (kind === 'habit') {
      const title = str(raw.title, 100);
      if (!title) throw new ApiError(400, '请输入习惯名称');
      const dates = Array.isArray(raw.dates) ? raw.dates : [];
      if (
        dates.length > 4000 ||
        !dates.every(
          (d): d is string =>
            typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d),
        )
      )
        throw new ApiError(400, '打卡日期不正确');
      data = { title, dates: [...new Set(dates)] };
    } else {
      const title = str(raw.title, 160),
        start = str(raw.start, 30),
        end = str(raw.end, 30);
      if (
        !title ||
        !Number.isFinite(Date.parse(start)) ||
        !Number.isFinite(Date.parse(end)) ||
        Date.parse(end) <= Date.parse(start)
      )
        throw new ApiError(400, '请填写标题及有效的开始、结束时间');
      data = { title, start, end };
    }
    if (old && version === 0) {
      if (old.payload === JSON.stringify(data))
        return Response.json({ ok: true, id, version: old.version });
      throw new ApiError(409, '此记录已存在，请刷新后编辑');
    }
    const now = Date.now();
    const result = old
      ? await db
          .prepare(
            'UPDATE records SET payload=?,version=version+1,updated=? WHERE owner=? AND id=? AND version=?',
          )
          .bind(JSON.stringify(data), now, owner, id, version)
          .run()
      : await db
          .prepare(
            'INSERT OR IGNORE INTO records(owner,id,kind,payload,version,updated) VALUES(?,?,?,?,1,?)',
          )
          .bind(owner, id, kind, JSON.stringify(data), now)
          .run();
    if (!result.meta.changes) {
      const current = await db
        .prepare('SELECT payload FROM records WHERE owner=? AND id=?')
        .bind(owner, id)
        .first<PayloadOnlyRow>();
      if (!old && current?.payload === JSON.stringify(data))
        return Response.json({ ok: true });
      throw new ApiError(409, '记录已变化，请刷新后重试');
    }
    return Response.json({ ok: true, id, version: version + 1 });
  } catch (e) {
    return failure(e);
  }
}
