'use client';
import { useEffect, useRef, useState } from 'react';
import { Headphones, Pause, Play, Upload, Volume2, Waves } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

export function MusicPlayer() {
  const audio = useRef<HTMLAudioElement>(null),
    noise = useRef<AudioContext | null>(null),
    gain = useRef<GainNode | null>(null),
    source = useRef('');
  const [playing, setPlaying] = useState(false),
    [volume, setVolume] = useState(0.4),
    [ambient, setAmbient] = useState(false),
    [error, setError] = useState(''),
    [name, setName] = useState('Color Your Night');

  useEffect(
    () => () => {
      void noise.current?.close();
      if (source.current) URL.revokeObjectURL(source.current);
    },
    [],
  );

  async function toggle() {
    try {
      if (!audio.current) return;
      if (playing) audio.current.pause();
      else await audio.current.play();
    } catch {
      setError('播放失败，可选择本地音频');
    }
  }

  async function toggleAmbient() {
    try {
      if (!noise.current) {
        const ctx = new AudioContext();
        noise.current = ctx;
        const b = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate),
          values = b.getChannelData(0);
        let last = 0;
        for (let i = 0; i < values.length; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          values[i] = last * 3.5;
        }
        const node = ctx.createBufferSource();
        node.buffer = b;
        node.loop = true;
        gain.current = ctx.createGain();
        gain.current.gain.value = 0.12;
        node.connect(gain.current).connect(ctx.destination);
        node.start();
      }
      if (ambient) await noise.current.suspend();
      else await noise.current.resume();
      setAmbient(!ambient);
    } catch {
      setError('当前设备不支持环境音');
    }
  }

  return (
    <section className="music" aria-label="背景音乐与环境音">
      <audio
        ref={audio}
        src="/assets/night.ogg"
        loop
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={() => {
          if (audio.current) audio.current.volume = volume;
        }}
        onError={() => setError('音频加载失败，可选择本地音乐')}
      />
      <Headphones size={19} className="music-icon" />
      <div className="music-title">
        <small className="ornament-en">NOW PLAYING</small>
        <strong>{name}</strong>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label={playing ? '暂停音乐' : '播放音乐'}
        onClick={() => void toggle()}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="music-volume-group">
        <Volume2 size={16} />
        <Slider
          aria-label="音乐音量"
          className="volume"
          value={[volume]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(v) => {
            const n = Array.isArray(v) ? v[0] : v;
            setVolume(n);
            if (audio.current) audio.current.volume = n;
          }}
        />
      </div>
      <button
        type="button"
        className={'icon-btn ' + (ambient ? 'lit' : '')}
        aria-label={ambient ? '关闭水下环境音' : '开启水下环境音'}
        title="水下环境白噪"
        onClick={() => void toggleAmbient()}
      >
        <Waves size={19} />
      </button>
      <label className="icon-btn" title="选择本地音乐">
        <Upload size={17} />
        <input
          type="file"
          accept="audio/*"
          className="sr-only"
          aria-label="选择本地音乐"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f || !audio.current) return;
            if (source.current) URL.revokeObjectURL(source.current);
            source.current = URL.createObjectURL(f);
            audio.current.src = source.current;
            setName(f.name.replace(/\.[^.]+$/, ''));
            setPlaying(false);
            setError('');
          }}
        />
      </label>
      {error && <span className="music-error">{error}</span>}
    </section>
  );
}
