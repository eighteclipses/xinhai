'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Camera, Check, Save, Sparkles, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Choice } from './study-controls';
import {
  analyze,
  dateKey,
  DIMENSIONS,
  type Analysis,
  type Evidence,
  type Item,
  type Scores,
} from '@/lib/domain';
import type { useStore } from '@/lib/use-store';

type Store = ReturnType<typeof useStore>;

function readInitialDraft(
  source: 'photo' | 'diary',
  existing?: string,
): string {
  if (existing !== undefined) return existing;
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem('xinhai-draft-' + source) || '';
  } catch {
    return '';
  }
}

export function EntryEditor({
  source,
  old,
  store,
  onClose,
}: {
  source: 'photo' | 'diary';
  old?: Item<'entry'>;
  store: Store;
  onClose: () => void;
}) {
  const linkFieldId = useId();
  const [text, setText] = useState(() =>
      readInitialDraft(source, old?.data.text),
    ),
    [date, setDate] = useState(() => old?.data.date || dateKey()),
    [scores, setScores] = useState<Scores>(
      () => old?.data.scores || [0, 0, 0, 0, 0],
    ),
    [analysis, setAnalysis] = useState<Analysis | null>(
      () => old?.data.analysis || null,
    ),
    [photoId, setPhotoId] = useState(() => old?.data.photoId || ''),
    [linkedId, setLinkedId] = useState(() => old?.data.linkedId || ''),
    [uploading, setUploading] = useState(false),
    [issue, setIssue] = useState('');
  const id = useRef(old?.id || crypto.randomUUID());

  useEffect(() => {
    if (!old) {
      try {
        localStorage.setItem('xinhai-draft-' + source, text);
      } catch {}
    }
  }, [text, old, source]);

  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setIssue('');
    try {
      const data = new FormData();
      data.append('photo', file);
      const r = await fetch('/api/photos', { method: 'POST', body: data });
      const result = (await r.json()) as { id?: string; error?: string };
      if (!r.ok || !result.id) throw new Error(result.error || '照片上传失败');
      setPhotoId(result.id);
    } catch (e) {
      setIssue(e instanceof Error ? e.message : '照片上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function save(confirmed: boolean) {
    if (!text.trim()) {
      setIssue('写下一句今天完成了什么吧。');
      return;
    }
    if (source === 'photo' && !photoId) {
      setIssue('请先选择一张照片。');
      return;
    }
    const ok = await store.save(
      'entry',
      {
        text,
        date,
        scores,
        photoId,
        linkedId,
        source,
        confirmed,
      },
      old,
      id.current,
    );
    if (ok) {
      try {
        localStorage.removeItem('xinhai-draft-' + source);
      } catch {}
      onClose();
    }
  }

  const links = store.items.filter(
    (x): x is Item<'entry' | 'session'> =>
      (x.kind === 'entry' || x.kind === 'session') &&
      x.id !== old?.id &&
      !(x.kind === 'entry' && x.data.linkedId) &&
      x.data.date === date,
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="editor-modal glass-surface">
        <DialogTitle>
          {source === 'photo' ? '随手记录这一刻' : '写给今天的自己'}
        </DialogTitle>
        <DialogDescription>
          记录真实行动，自由微调每一项成长点数。
        </DialogDescription>
        <div className="editor-columns">
          <div className="entry-input">
            <label>
              日期
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            {source === 'photo' && (
              <div className="photo-drop">
                {photoId ? (
                  <img
                    src={'/api/photos/' + photoId}
                    alt="本次行动照片"
                    decoding="async"
                  />
                ) : (
                  <Camera size={38} />
                )}
                <label className="secondary">
                  <Upload size={16} />
                  {uploading
                    ? '上传中…'
                    : photoId
                      ? '更换照片'
                      : '拍照 / 选择图片'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    disabled={uploading}
                    onChange={(e) => void upload(e.target.files?.[0])}
                  />
                </label>
                <small>JPG / PNG / WebP · 最大 6 MB</small>
              </div>
            )}
            <label>
              {source === 'photo' ? '行动描述' : '今日内容'}
              <textarea
                rows={source === 'photo' ? 4 : 8}
                maxLength={5000}
                placeholder={
                  source === 'photo'
                    ? '例如：去操场投篮半小时，手感慢慢回来了。'
                    : '今天做了什么？遇到什么卡点，又是怎么推进的？'
                }
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setAnalysis(null);
                  setScores([0, 0, 0, 0, 0]);
                }}
              />
            </label>
            <div className="entry-meta-bar">
              <small>{text.length} / 5000 · 草稿自动暂存本机</small>
              <button
                type="button"
                className="secondary"
                disabled={!text.trim()}
                onClick={() => {
                  const a = analyze(text);
                  setAnalysis(a);
                  setScores(a.scores);
                }}
              >
                <Sparkles size={16} />
                智能提取点数
              </button>
            </div>
          </div>
          <div className="feedback">
            <p className="eyebrow ornament-en">GROWTH FEEDBACK</p>
            <h3>五维点数</h3>
            {analysis ? (
              <div className="evidence-list">
                {analysis.insufficient ? (
                  <p className="subtle">
                    未提取到明确已完成的行动词句，可直接手动设置点数。
                  </p>
                ) : (
                  analysis.evidence
                    .slice(0, 6)
                    .map((e: Evidence, i: number) => (
                      <div className="evidence" key={i}>
                        <strong>{DIMENSIONS[e.dimension]}</strong>
                        <q>{e.text}</q>
                        <small>{e.reason}</small>
                      </div>
                    ))
                )}
              </div>
            ) : (
              <p className="quiet">
                输入后可点击「智能提取点数」，或直接手动填写。
              </p>
            )}
            <div className="score-inputs">
              {DIMENSIONS.map((d, i) => (
                <label key={d}>
                  {d}
                  <input
                    type="number"
                    aria-label={d + '点数'}
                    min={0}
                    max={5}
                    value={scores[i]}
                    onChange={(e) => {
                      const copy = [...scores] as Scores;
                      copy[i] = Math.min(
                        5,
                        Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                      );
                      setScores(copy);
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="field-block">
              <label htmlFor={linkFieldId}>
                关联同一次行动（避免重复计分）
              </label>
              <Choice
                id={linkFieldId}
                label="关联已记录行动"
                value={linkedId || 'none'}
                onChange={(v) => setLinkedId(v === 'none' ? '' : v)}
                options={[
                  { value: 'none', label: '独立新行动' },
                  ...links.map((x) => ({
                    value: x.id,
                    label: (x.kind === 'entry'
                      ? x.data.text
                      : x.data.taskTitle || '专注记录'
                    ).slice(0, 35),
                  })),
                ]}
              />
            </div>
            {linkedId && (
              <p className="subtle">已关联已有行动，保存后不重复累加五维。</p>
            )}
          </div>
        </div>
        {issue && (
          <p role="alert" className="error-text">
            {issue}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            disabled={store.busy || uploading}
            onClick={() => void save(false)}
          >
            <Save size={16} />
            仅存草稿记录
          </button>
          <button
            type="button"
            className="primary"
            disabled={store.busy || uploading}
            onClick={() => void save(true)}
          >
            <Check size={17} />
            {old?.data.confirmed ? '更新记录' : '确认并记入五维'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
