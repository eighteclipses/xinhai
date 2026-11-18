import test from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
const prefix = 'qa-' + crypto.randomUUID();
async function call(path, body, headers = {}) {
  const r = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: '__sites_local_auth=1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  return { status: r.status, data };
}
test('API流程：持久化、版本冲突、隔离、照片与专注', async () => {
  const anon = await fetch(origin + '/api/state');
  assert.equal(anon.status, 401);
  assert.equal((await call('/api/state')).status, 200);
  const task = {
    id: prefix + 'task',
    kind: 'task',
    version: 0,
    data: { title: 'QA-专注任务', date: '2026-09-05', done: false },
  };
  assert.equal(
    (await call('/api/records', task, { Origin: 'https://example.invalid' }))
      .status,
    403,
  );
  assert.equal((await call('/api/records', task)).status, 200);
  assert.equal(
    (await call('/api/records', task)).status,
    200,
    '同一创建请求可安全重试',
  );
  const update = { ...task, version: 1, data: { ...task.data, done: true } };
  assert.equal((await call('/api/records', update)).status, 200);
  assert.equal(
    (await call('/api/records', update)).status,
    409,
    '旧版本不能覆盖',
  );
  assert.equal(
    (await call('/api/records', { ...task, id: 'focus' })).status,
    400,
  );
  const state = (await call('/api/state')).data.items;
  assert.equal(state.find((x) => x.id === task.id).data.done, true);
  const entry = {
    id: prefix + 'entry',
    kind: 'entry',
    version: 0,
    data: {
      text: '我在操场打篮球 ' + prefix,
      date: '2026-09-05',
      scores: [0, 0, 0, 0, 1],
      confirmed: true,
      source: 'diary',
    },
  };
  assert.equal((await call('/api/records', entry)).status, 200);
  assert.equal(
    (await call('/api/records', { ...entry, id: prefix + 'duplicate' })).status,
    409,
  );
  assert.equal(
    (
      await call('/api/records', {
        ...entry,
        id: prefix + 'invalid',
        data: { ...entry.data, scores: [9, 0, 0, 0, 0] },
      })
    ).status,
    400,
  );
  const linked = {
    ...entry,
    id: prefix + 'linked',
    data: { ...entry.data, linkedId: entry.id },
  };
  assert.equal((await call('/api/records', linked)).status, 200);
  assert.equal(
    (
      await call('/api/records', {
        id: entry.id,
        kind: 'entry',
        version: 1,
        remove: true,
      })
    ).status,
    409,
  );
  const form = new FormData();
  form.append(
    'photo',
    new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR24AAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      { type: 'image/png' },
    ),
    'test.png',
  );
  const upload = await fetch(origin + '/api/photos', {
    method: 'POST',
    headers: { Cookie: '__sites_local_auth=1' },
    body: form,
  });
  assert.equal(upload.status, 200);
  const photo = await upload.json();
  assert.equal(
    (
      await fetch(origin + '/api/photos/' + photo.id, {
        headers: { Cookie: '__sites_local_auth=1' },
      })
    ).status,
    200,
  );
  assert.equal((await fetch(origin + '/api/photos/' + photo.id)).status, 401);
  const fake = new FormData();
  fake.append('photo', new Blob(['<svg/>'], { type: 'image/png' }), 'fake.png');
  assert.equal(
    (
      await fetch(origin + '/api/photos', {
        method: 'POST',
        headers: { Cookie: '__sites_local_auth=1' },
        body: fake,
      })
    ).status,
    400,
  );
  let timer = (await call('/api/state')).data.items.find(
    (x) => x.kind === 'timer',
  );
  assert.ok(!timer || timer.data.status === 'idle', '测试前不能有用户正在专注');
  const version = timer?.version || 0;
  assert.equal(
    (
      await call('/api/timer', {
        action: 'start',
        version,
        minutes: 1,
        taskId: task.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call('/api/timer', { action: 'start', version, minutes: 1 })).status,
    409,
  );
  assert.equal(
    (await call('/api/timer', { action: 'pause', version: version + 1 }))
      .status,
    200,
  );
  timer = (await call('/api/state')).data.items.find((x) => x.kind === 'timer');
  assert.equal(timer.data.status, 'paused');
  assert.equal(
    (await call('/api/timer', { action: 'resume', version: version + 2 }))
      .status,
    200,
  );
  assert.equal(
    (await call('/api/timer', { action: 'finish', version: version + 3 }))
      .status,
    200,
  );
  assert.equal(
    (await call('/api/timer', { action: 'finish', version: version + 3 }))
      .status,
    409,
    '结算不可重复',
  );
  const after = (await call('/api/state')).data.items;
  assert.equal(
    after.filter((x) => x.kind === 'session' && x.data.taskId === task.id)
      .length,
    1,
  );
  for (const [id, kind, version] of [
    [linked.id, 'entry', 1],
    [entry.id, 'entry', 1],
    [task.id, 'task', 2],
  ])
    assert.equal(
      (await call('/api/records', { id, kind, version, remove: true })).status,
      200,
    );
});
