'use client';
import { useEffect, useRef, useState } from 'react';
import {
  BUILTIN_WALLPAPERS,
  DEFAULT_WALLPAPER_ID,
  loadCustomWallpaperBlob,
} from '@/lib/wallpapers';

type ResolvedMedia = {
  forId: string;
  kind: 'image' | 'video';
  url: string;
};

export function WallpaperStage({
  wallpaperId,
  reducedMotion,
  onFallback,
}: {
  wallpaperId: string;
  reducedMotion: boolean;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [customMedia, setCustomMedia] = useState<ResolvedMedia | null>(null);

  const isCustom = wallpaperId.startsWith('custom:');
  const builtin =
    BUILTIN_WALLPAPERS.find((w) => w.id === wallpaperId) ??
    BUILTIN_WALLPAPERS[0];

  useEffect(() => {
    if (!isCustom) return;
    let cancelled = false;
    let objectUrl = '';

    void loadCustomWallpaperBlob(wallpaperId)
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          onFallback();
          return;
        }
        objectUrl = URL.createObjectURL(record.blob);
        setCustomMedia({
          forId: wallpaperId,
          kind: record.kind,
          url: objectUrl,
        });
      })
      .catch(() => {
        if (!cancelled) onFallback();
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isCustom, wallpaperId, onFallback]);

  const activeVideoUrl = isCustom
    ? customMedia?.forId === wallpaperId && customMedia.kind === 'video'
      ? customMedia.url
      : ''
    : builtin.kind === 'video'
      ? (builtin.src ?? '')
      : '';

  const activeImageUrl =
    isCustom &&
    customMedia?.forId === wallpaperId &&
    customMedia.kind === 'image'
      ? customMedia.url
      : '';

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !activeVideoUrl) return;

    const syncPlayback = () => {
      if (document.hidden || reducedMotion) {
        el.pause();
      } else {
        void el.play().catch(() => {});
      }
    };

    syncPlayback();
    document.addEventListener('visibilitychange', syncPlayback);
    return () => {
      document.removeEventListener('visibilitychange', syncPlayback);
    };
  }, [activeVideoUrl, reducedMotion]);

  const variantClass =
    wallpaperId === 'abyss-glass'
      ? 'wallpaper-stage variant-abyss'
      : 'wallpaper-stage variant-deep';

  return (
    <div className={variantClass} aria-hidden="true">
      {activeImageUrl && (
        <img
          className="wallpaper-media"
          src={activeImageUrl}
          alt=""
          decoding="async"
        />
      )}
      {activeVideoUrl && !reducedMotion && (
        <video
          ref={videoRef}
          className="wallpaper-media"
          src={activeVideoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => {
            if (wallpaperId !== DEFAULT_WALLPAPER_ID) onFallback();
          }}
        />
      )}
      <div className="wallpaper-scrim" />
    </div>
  );
}
