'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, Film, ImageIcon, Sparkles, Trash2, Upload } from 'lucide-react';
import {
  BUILTIN_WALLPAPERS,
  deleteCustomWallpaper,
  listCustomWallpapers,
  resolveWallpaperAfterDelete,
  saveCustomWallpaper,
  type WallpaperDescriptor,
} from '@/lib/wallpapers';

export function WallpaperPicker({
  activeId,
  reducedMotion,
  onSelect,
  onNotify,
}: {
  activeId: string;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
  onNotify: (msg: string) => void;
}) {
  const [customs, setCustoms] = useState<WallpaperDescriptor[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await listCustomWallpapers();
      setCustoms(list);
    } catch {
      setCustoms([]);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      void reload();
    }, 0);
    return () => clearTimeout(id);
  }, [reload]);

  async function handleImport(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const saved = await saveCustomWallpaper(file);
      await reload();
      onSelect(saved.id);
      onNotify(`已切换壁纸「${saved.name}」`);
    } catch (e) {
      onNotify(e instanceof Error ? e.message : '导入壁纸失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: WallpaperDescriptor) {
    setBusy(true);
    try {
      await deleteCustomWallpaper(item.id);
      const nextId = resolveWallpaperAfterDelete(activeId, item.id);
      if (nextId !== activeId) onSelect(nextId);
      await reload();
      onNotify(`已删除壁纸「${item.name}」，存储已释放`);
    } catch (e) {
      onNotify(e instanceof Error ? e.message : '删除壁纸失败');
    } finally {
      setBusy(false);
    }
  }

  const allItems = [...BUILTIN_WALLPAPERS, ...customs];

  return (
    <div className="wallpaper-manager">
      <div className="section-title">
        <div>
          <h3>心海背景与壁纸</h3>
          <p className="subtle">
            按需解码，切到后台自动暂停。导入的壁纸仅存于本机浏览器，可随时删除释放空间。
          </p>
        </div>
        <label className="secondary upload-label">
          <Upload size={16} />
          <span>{busy ? '处理中…' : '导入壁纸'}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            className="sr-only"
            disabled={busy}
            aria-label="导入本地图片或视频壁纸"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.currentTarget.value = '';
              void handleImport(file);
            }}
          />
        </label>
      </div>
      {reducedMotion && (
        <p className="subtle">已开启「减少动态效果」，视频壁纸将保持静止。</p>
      )}
      <div className="wallpaper-grid">
        {allItems.map((item) => {
          const selected = activeId === item.id;
          return (
            <div
              key={item.id}
              className={'wallpaper-card ' + (selected ? 'selected' : '')}
            >
              <button
                type="button"
                className="wallpaper-select"
                onClick={() => onSelect(item.id)}
              >
                <span className="wallpaper-icon">
                  {item.kind === 'video' ? (
                    <Film size={18} />
                  ) : item.kind === 'image' ? (
                    <ImageIcon size={18} />
                  ) : (
                    <Sparkles size={18} />
                  )}
                </span>
                <span className="wallpaper-meta">
                  <strong>{item.name}</strong>
                  <small>{item.subtitle}</small>
                </span>
                {selected && <Check size={17} className="cyan" />}
              </button>
              {!item.builtin && (
                <button
                  type="button"
                  className="icon-btn muted wallpaper-delete"
                  disabled={busy}
                  aria-label={`删除壁纸 ${item.name}`}
                  title="删除此壁纸并释放空间"
                  onClick={() => void handleDelete(item)}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
