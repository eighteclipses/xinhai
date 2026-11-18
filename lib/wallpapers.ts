export type WallpaperKind = 'gradient' | 'image' | 'video';

export type WallpaperDescriptor = {
  id: string;
  name: string;
  subtitle: string;
  kind: WallpaperKind;
  src?: string;
  builtin: boolean;
  sizeBytes?: number;
  mimeType?: string;
};

export const DEFAULT_WALLPAPER_ID = 'deep-ocean';
export const MAX_WALLPAPER_BYTES = 40 * 1024 * 1024;

export const BUILTIN_WALLPAPERS: readonly WallpaperDescriptor[] = [
  {
    id: 'deep-ocean',
    name: '深海静默',
    subtitle: '零功耗光影渐变',
    kind: 'gradient',
    builtin: true,
  },
  {
    id: 'abyss-glass',
    name: '月影潜流',
    subtitle: '通透折射静态海面',
    kind: 'gradient',
    builtin: true,
  },
  {
    id: 'sea-video',
    name: '心海微澜',
    subtitle: '内置海面循环视频 · 2.4 MB',
    kind: 'video',
    src: '/assets/sea.mp4',
    builtin: true,
    sizeBytes: 2_501_739,
  },
];

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

export function validateWallpaperFile(file: {
  name: string;
  size: number;
  type: string;
}): { ok: true; kind: 'image' | 'video' } | { ok: false; error: string } {
  if (!file || file.size <= 0) {
    return { ok: false, error: '请选择有效的壁纸文件' };
  }
  if (file.size > MAX_WALLPAPER_BYTES) {
    return {
      ok: false,
      error: '单个壁纸请控制在 40 MB 以内，避免平板解码卡顿',
    };
  }
  if (ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { ok: true, kind: 'image' };
  }
  if (ALLOWED_VIDEO_TYPES.has(file.type)) {
    return { ok: true, kind: 'video' };
  }
  return {
    ok: false,
    error: '支持 JPG / PNG / WebP 图片或 MP4 / WebM 视频',
  };
}

export function resolveWallpaperAfterDelete(
  activeId: string,
  deletedId: string,
): string {
  return activeId === deletedId ? DEFAULT_WALLPAPER_ID : activeId;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type StoredWallpaperRecord = {
  id: string;
  name: string;
  kind: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  blob: Blob;
};

const DB_NAME = 'xinhai-wallpapers-v1';
const STORE_NAME = 'wallpapers';

function openWallpaperDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持本地壁纸存储'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('无法打开壁纸存储'));
  });
}

export async function listCustomWallpapers(): Promise<WallpaperDescriptor[]> {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const rows = (req.result as StoredWallpaperRecord[]) || [];
      rows.sort((a, b) => b.createdAt - a.createdAt);
      resolve(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          subtitle: `${r.kind === 'video' ? '动态视频' : '静态壁纸'} · ${formatBytes(r.sizeBytes)}`,
          kind: r.kind,
          builtin: false,
          sizeBytes: r.sizeBytes,
          mimeType: r.mimeType,
        })),
      );
    };
    req.onerror = () => reject(req.error ?? new Error('读取壁纸列表失败'));
    tx.oncomplete = () => db.close();
  });
}

export async function saveCustomWallpaper(
  file: File,
): Promise<WallpaperDescriptor> {
  const check = validateWallpaperFile(file);
  if (!check.ok) throw new Error(check.error);

  const record: StoredWallpaperRecord = {
    id: `custom:${crypto.randomUUID()}`,
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || '自定义壁纸',
    kind: check.kind,
    mimeType: file.type,
    sizeBytes: file.size,
    createdAt: Date.now(),
    blob: file,
  };

  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve({
        id: record.id,
        name: record.name,
        subtitle: `${record.kind === 'video' ? '动态视频' : '静态壁纸'} · ${formatBytes(record.sizeBytes)}`,
        kind: record.kind,
        builtin: false,
        sizeBytes: record.sizeBytes,
        mimeType: record.mimeType,
      });
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('保存壁纸失败，可能存储空间不足'));
    };
  });
}

export async function loadCustomWallpaperBlob(
  id: string,
): Promise<{ blob: Blob; kind: 'image' | 'video' } | null> {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => {
      const row = req.result as StoredWallpaperRecord | undefined;
      resolve(row ? { blob: row.blob, kind: row.kind } : null);
    };
    req.onerror = () => reject(req.error ?? new Error('加载壁纸失败'));
    tx.oncomplete = () => db.close();
  });
}

export async function deleteCustomWallpaper(id: string): Promise<void> {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('删除壁纸失败'));
    };
  });
}
