'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditableKind, Item, RecordDataMap } from './domain';

type ApiPayload = {
  error?: string;
  items?: Item[];
  ok?: boolean;
  id?: string;
  version?: number;
};

export async function requestJSON(
  path: string,
  body?: unknown,
): Promise<ApiPayload> {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const result = (await r.json()) as ApiPayload;
  if (!r.ok) throw new Error(result.error || '暂时无法连接，请重试');
  return result;
}

export function useStore() {
  const [items, setItems] = useState<Item[]>([]),
    [status, setStatus] = useState('正在连接'),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const lock = useRef(false),
    counter = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++counter.current;
    try {
      const data = await requestJSON('/api/state');
      if (seq === counter.current) {
        setItems(Array.isArray(data.items) ? data.items : []);
        setStatus('已同步');
        setReady(true);
      }
      return true;
    } catch (e) {
      if (seq === counter.current)
        setStatus(e instanceof Error ? e.message : '连接失败');
      return false;
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => {
      void refresh();
    }, 0);
    const timer = setInterval(() => {
      if (!document.hidden && !lock.current) void refresh();
    }, 15000);
    const focus = () => {
      if (!lock.current) void refresh();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 7000);
    return () => clearTimeout(t);
  }, [message]);

  const perform = useCallback(
    async (action: () => Promise<unknown>, success = '已保存') => {
      if (lock.current) return false;
      lock.current = true;
      setBusy(true);
      try {
        await action();
        const ok = await refresh();
        setMessage(ok ? success : '已保存，等待刷新中，请勿重复提交');
        return true;
      } catch (e) {
        setMessage(e instanceof Error ? e.message : '保存失败，请重试');
        await refresh();
        return false;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [refresh],
  );

  const save = useCallback(
    <K extends EditableKind>(
      kind: K,
      data: RecordDataMap[K],
      old?: Item,
      id?: string,
    ) =>
      perform(() =>
        requestJSON('/api/records', {
          id: old?.id || id || crypto.randomUUID(),
          kind,
          data,
          version: old?.version || 0,
        }),
      ),
    [perform],
  );

  const remove = useCallback(
    (item: Item) =>
      perform(
        () =>
          requestJSON('/api/records', {
            id: item.id,
            kind: item.kind,
            version: item.version,
            remove: true,
          }),
        '已删除',
      ),
    [perform],
  );

  return {
    items,
    status,
    ready,
    busy,
    message,
    setMessage,
    refresh,
    perform,
    save,
    remove,
  };
}
