import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze,
  elapsedSeconds,
  emptyTimer,
  focusPoints,
  growth,
  validateScores,
  dateKey,
} from '../lib/domain.ts';
test('篮球照片的配文只支持灵巧，不推断意志或时长', () => {
  assert.deepEqual(analyze('在操场打篮球').scores, [0, 0, 0, 0, 1]);
});
test('计划、否定及他人行动不作为已完成行为', () => {
  for (const text of [
    '明天准备打篮球',
    '今天没有打篮球',
    '朋友在操场打篮球',
    '我不学习',
    '如果能坚持阅读',
  ])
    assert.equal(analyze(text).insufficient, true, text);
});
test('负面情绪不否定后续明确行动', () => {
  assert.equal(analyze('今天很焦虑，但还是完成了复习').scores[0], 2);
});
test('重复表述与情绪扩写不增加行为分数', () => {
  const base = analyze('我完成了复习').scores;
  assert.deepEqual(
    analyze('我完成了复习。我完成了复习。今天很开心。').scores,
    base,
  );
});
test('暂停不增加时间；超时与时钟回拨安全', () => {
  const t = {
    ...emptyTimer(),
    status: 'running',
    duration: 60,
    since: 10000,
    elapsed: 5,
  };
  assert.equal(elapsedSeconds(t, 20000), 15);
  assert.equal(elapsedSeconds({ ...t, status: 'paused' }, 20000), 5);
  assert.equal(elapsedSeconds(t, 999999), 60);
  assert.equal(elapsedSeconds(t, 0), 5);
});
test('经验边界及无效分数', () => {
  assert.equal(focusPoints(1499), 0);
  assert.equal(focusPoints(1500), 1);
  assert.equal(focusPoints(14400), 4);
  for (const s of [
    [0, 1],
    [-1, 0, 0, 0, 0],
    [0, 0, 0, 0, 6],
    [0, 0, 0.1, 0, 0],
  ])
    assert.throws(() => validateScores(s));
});
test('补充记录与未确认记录不会重复增加经验', () => {
  const make = (id, data) => ({
    id,
    kind: 'entry',
    data,
    version: 1,
    updated: 1,
  });
  assert.deepEqual(
    growth([
      make('a', { confirmed: true, scores: [1, 2, 0, 0, 0] }),
      make('b', { confirmed: true, linkedId: 'a', scores: [1, 2, 0, 0, 0] }),
      make('c', { confirmed: false, scores: [5, 5, 5, 5, 5] }),
    ]),
    [1, 2, 0, 0, 0],
  );
});
test('北京时间跨日', () => {
  assert.equal(dateKey(Date.parse('2026-09-05T17:00:00Z')), '2026-09-06');
});
