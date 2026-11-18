'use client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DIMENSIONS, type Scores } from '@/lib/domain';

export function Choice({
  id,
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v ?? '')}
      disabled={disabled}
      items={options}
    >
      <SelectTrigger id={id} aria-label={label} className="choice">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Radar({ scores }: { scores: Scores }) {
  const max = Math.max(10, ...scores),
    point = (i: number, v: number) => {
      const a = ((-90 + i * 72) * Math.PI) / 180;
      return `${150 + Math.cos(a) * v},${145 + Math.sin(a) * v}`;
    };
  const summary = DIMENSIONS.map((d, i) => `${d}${scores[i]}点`).join('，');
  return (
    <svg viewBox="0 0 300 290" className="radar" aria-label={summary}>
      <title>{summary}</title>
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon
          key={r}
          points={DIMENSIONS.map((_, i) => point(i, r * 94)).join(' ')}
          fill="none"
          stroke="#6ca5cb"
          strokeOpacity=".35"
        />
      ))}
      {DIMENSIONS.map((_, i) => (
        <line
          key={i}
          x1="150"
          y1="145"
          x2={point(i, 94).split(',')[0]}
          y2={point(i, 94).split(',')[1]}
          stroke="#6ca5cb"
          strokeOpacity=".35"
        />
      ))}
      <polygon
        points={DIMENSIONS.map((_, i) =>
          point(i, Math.max(3, (scores[i] / max) * 94)),
        ).join(' ')}
        fill="#60dfff3d"
        stroke="#78ebff"
        strokeWidth="2"
      />
      {DIMENSIONS.map((d, i) => {
        const [x, y] = point(i, 122).split(',');
        return (
          <text
            key={d}
            x={x}
            y={y}
            fill="#dcf4ff"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="15"
          >
            {d}
          </text>
        );
      })}
    </svg>
  );
}
