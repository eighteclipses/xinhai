'use client';
import { useId, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Choice } from './study-controls';
import { dateKey, type Item } from '@/lib/domain';
import type { useStore } from '@/lib/use-store';

type SimpleEditorKind = 'task' | 'event' | 'habit' | 'note';

export function ItemEditor({
  kind,
  old,
  store,
  onClose,
}: {
  kind: SimpleEditorKind;
  old?: Item<SimpleEditorKind>;
  store: ReturnType<typeof useStore>;
  onClose: () => void;
}) {
  const priorityId = useId();
  const [title, setTitle] = useState(() => old?.data.title || ''),
    [text, setText] = useState(() =>
      old?.kind === 'note' ? old.data.text : '',
    ),
    [date, setDate] = useState(() =>
      old?.kind === 'task' ? old.data.date : dateKey(),
    ),
    [priority, setPriority] = useState<'normal' | 'high'>(() =>
      old?.kind === 'task' && old.data.priority === 'high' ? 'high' : 'normal',
    ),
    [start, setStart] = useState(() =>
      old?.kind === 'event'
        ? old.data.start.slice(0, 16)
        : dateKey() + 'T09:00',
    ),
    [end, setEnd] = useState(() =>
      old?.kind === 'event' ? old.data.end.slice(0, 16) : dateKey() + 'T10:00',
    );
  const id = useRef(crypto.randomUUID());

  const name =
    kind === 'task'
      ? '任务'
      : kind === 'event'
        ? '日程'
        : kind === 'habit'
          ? '习惯'
          : '便签';

  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    let ok = false;
    if (kind === 'task') {
      ok = await store.save(
        'task',
        {
          title,
          date,
          priority,
          done: old?.kind === 'task' ? old.data.done : false,
        },
        old?.kind === 'task' ? old : undefined,
        id.current,
      );
    } else if (kind === 'event') {
      ok = await store.save(
        'event',
        { title, start: start + ':00+08:00', end: end + ':00+08:00' },
        old?.kind === 'event' ? old : undefined,
        id.current,
      );
    } else if (kind === 'habit') {
      ok = await store.save(
        'habit',
        { title, dates: old?.kind === 'habit' ? old.data.dates : [] },
        old?.kind === 'habit' ? old : undefined,
        id.current,
      );
    } else {
      ok = await store.save(
        'note',
        { title, text },
        old?.kind === 'note' ? old : undefined,
        id.current,
      );
    }
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="small-modal glass-surface">
        <DialogTitle>
          {old ? '编辑' : '新建'}
          {name}
        </DialogTitle>
        <DialogDescription>安排清楚，心就会安静下来。</DialogDescription>
        <form onSubmit={(e) => void submit(e)} className="form-stack">
          <label>
            {name}名称
            <input
              required
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === 'task' ? '例如：复盘一套行测判断推理' : ''}
            />
          </label>
          {kind === 'task' && (
            <>
              <label>
                计划日期
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <div className="field-block">
                <label htmlFor={priorityId}>优先级</label>
                <Choice
                  id={priorityId}
                  label="优先级"
                  value={priority}
                  onChange={(v) =>
                    setPriority(v === 'high' ? 'high' : 'normal')
                  }
                  options={[
                    { value: 'normal', label: '普通' },
                    { value: 'high', label: '重要' },
                  ]}
                />
              </div>
            </>
          )}
          {kind === 'event' && (
            <>
              <label>
                开始时间
                <input
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                结束时间
                <input
                  type="datetime-local"
                  required
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </>
          )}
          {kind === 'note' && (
            <label>
              便签内容
              <textarea
                rows={7}
                maxLength={10000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          )}
          <button className="primary" disabled={store.busy} type="submit">
            <span>保存{name}</span>
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
