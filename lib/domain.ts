export const DIMENSIONS = ['学识', '意志', '表达', '体贴', '灵巧'] as const;
export type Scores = [number, number, number, number, number];

export type Evidence = {
  dimension: number;
  text: string;
  reason: string;
  score: number;
};

export type Analysis = {
  version: string;
  scores: Scores;
  evidence: Evidence[];
  insufficient: boolean;
};

export type TaskData = {
  title: string;
  date: string;
  priority?: 'normal' | 'high';
  done: boolean;
};

export type EntryData = {
  text: string;
  date: string;
  photoId?: string;
  linkedId?: string;
  scores: Scores;
  confirmed: boolean;
  source: 'photo' | 'diary';
  analysis?: Analysis | null;
};

export type EventData = {
  title: string;
  start: string;
  end: string;
};

export type HabitData = {
  title: string;
  dates: string[];
};

export type NoteData = {
  title: string;
  text: string;
};

export type SessionData = {
  seconds: number;
  mode: 'focus' | 'rest';
  taskId: string;
  taskTitle: string;
  date: string;
  ended: number;
};

export type Timer = {
  status: 'idle' | 'running' | 'paused';
  mode: 'focus' | 'rest';
  duration: number;
  elapsed: number;
  since: number;
  taskId: string;
  taskTitle: string;
};

export type RecordDataMap = {
  task: TaskData;
  entry: EntryData;
  event: EventData;
  habit: HabitData;
  note: NoteData;
  session: SessionData;
  timer: Timer;
};

export type Kind = keyof RecordDataMap;
export type EditableKind = Exclude<Kind, 'session' | 'timer'>;

type AllItemsUnion = {
  [P in Kind]: {
    id: string;
    kind: P;
    data: RecordDataMap[P];
    version: number;
    updated: number;
  };
}[Kind];

export type Item<K extends Kind = Kind> = Extract<AllItemsUnion, { kind: K }>;

export function itemsOfKind<K extends Kind>(
  items: readonly Item[],
  kind: K,
): Item<K>[] {
  return items.filter((item): item is Item<K> => item.kind === kind);
}

export const emptyTimer = (): Timer => ({
  status: 'idle',
  mode: 'focus',
  duration: 25 * 60,
  elapsed: 0,
  since: 0,
  taskId: '',
  taskTitle: '',
});

export function elapsedSeconds(timer: Timer, now: number) {
  return Math.min(
    timer.duration,
    Math.max(
      0,
      timer.elapsed +
        (timer.status === 'running'
          ? Math.floor(Math.max(0, now - timer.since) / 1000)
          : 0),
    ),
  );
}

export function focusPoints(seconds: number) {
  return Math.min(4, Math.floor(seconds / 1500));
}

export function dateKey(time: number | Date = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(time);
}

export function validateScores(value: unknown): Scores {
  if (
    !Array.isArray(value) ||
    value.length !== 5 ||
    !value.every((v) => Number.isInteger(v) && v >= 0 && v <= 5)
  )
    throw new Error('每个维度须为0至5的整数');
  return value as Scores;
}

const patterns = [
  /学习|复习|背单词|阅读|读书|做题|解题|课程|错题|知识|论文/,
  /坚持|克服|按时|自律|还是完成|仍然完成|继续完成/,
  /讲解|讲题|演讲|写作|发言|沟通|写了|撰写|总结观点/,
  /帮助|陪伴|安慰|感谢|道歉|照顾|帮同学|帮朋友/,
  /篮球|足球|运动|跑步|编程|代码|绘画|画画|实验|乐器|钢琴|手工|训练/,
];

// Conservative baseline, not a trained model. Scores reflect explicit wording only.
export function analyze(text: string): Analysis {
  const scores: Scores = [0, 0, 0, 0, 0];
  const evidence: Evidence[] = [];
  const clauses = [
    ...new Set(
      text
        .split(/[。！？!?；;\n，,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  for (const clause of clauses) {
    if (
      /明天|后天|准备|计划|打算|想要|希望|如果|假如|他说|她说|同学在|朋友在|照片里|图片中|没有|没去|没做|没能|没完成|未完成|不想|不打|不去|不学|不读|不练|没打|没学|没读|没练/.test(
        clause,
      )
    )
      continue;
    for (let dimension = 0; dimension < 5; dimension++) {
      if (!patterns[dimension].test(clause)) continue;
      const score = /总结.*(错因|方法)|纠正|独立完成|反复练习|完成.*验证/.test(
        clause,
      )
        ? 3
        : /完成|坚持|练习|复习|帮助|讲解/.test(clause)
          ? 2
          : 1;
      scores[dimension] = Math.max(scores[dimension], score);
      evidence.push({
        dimension,
        text: clause,
        reason:
          score === 3
            ? '出现具体完成与改进证据'
            : score === 2
              ? '出现明确行动描述'
              : '识别到活动描述，强度信息有限',
        score,
      });
    }
  }
  return {
    version: 'rules-0.1',
    scores,
    evidence,
    insufficient: evidence.length === 0,
  };
}

export function normalizeText(text: string) {
  return text.replace(/[\s，。！？,.!?；;：“”"']/g, '').toLowerCase();
}

export function growth(items: readonly Item[]): Scores {
  const result: Scores = [0, 0, 0, 0, 0];
  for (const item of items) {
    if (item.kind === 'entry' && item.data.confirmed && !item.data.linkedId) {
      const s = validateScores(item.data.scores);
      s.forEach((v, i) => {
        result[i] += v;
      });
    }
    if (item.kind === 'session' && item.data.mode === 'focus')
      result[0] += focusPoints(item.data.seconds);
  }
  return result;
}
