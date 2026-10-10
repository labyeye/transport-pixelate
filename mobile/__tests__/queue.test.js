import { enqueue, flush, pending, failures, resetForTests, counts } from '../src/lib/queue';

const err = status => Object.assign(new Error(`status ${status}`), { status });
beforeEach(async () => { await resetForTests(); });

describe('offline queue', () => {
  it('replays in the order items were created and clears them', async () => {
    await enqueue({ id: 'a', path: '/1' });
    await enqueue({ id: 'b', path: '/2' });
    await enqueue({ id: 'c', path: '/3' });
    const seen = [];
    const out = await flush(async i => { seen.push(i.id); });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(out).toMatchObject({ sent: 3, dropped: 0, stopped: null });
    expect(await pending()).toHaveLength(0);
  });

  it('stops at the first network failure and keeps order for later', async () => {
    await enqueue({ id: 'a' }); await enqueue({ id: 'b' }); await enqueue({ id: 'c' });
    let call = 0;
    const out = await flush(async () => { if (++call === 2) throw err(0); });
    expect(out).toMatchObject({ sent: 1, stopped: 'offline' });
    expect((await pending()).map(i => i.id)).toEqual(['b', 'c']); // b was not skipped over
    const again = await flush(async () => {});
    expect(again.sent).toBe(2);
  });

  it('drops definite rejections and reports them, without blocking later items', async () => {
    await enqueue({ id: 'bad', path: '/x' }); await enqueue({ id: 'good', path: '/y' });
    const out = await flush(async i => { if (i.id === 'bad') throw err(409); });
    expect(out).toMatchObject({ sent: 1, dropped: 1, stopped: null });
    const f = await failures();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: 'bad' });
    expect((await counts()).failed).toBe(1);
  });

  it('keeps items on server errors and gives up after repeated failures', async () => {
    await enqueue({ id: 'a' });
    for (let i = 0; i < 7; i++) {
      const out = await flush(async () => { throw err(503); });
      expect(out.stopped).toBe('server');
    }
    expect(await pending()).toHaveLength(1);
    const last = await flush(async () => { throw err(503); });
    expect(last.dropped).toBe(1);
    expect(await pending()).toHaveLength(0);
    expect(await failures()).toHaveLength(1);
  });

  it('stops on 401 so the user can sign in again without losing anything', async () => {
    await enqueue({ id: 'a' });
    const out = await flush(async () => { throw err(401); });
    expect(out.stopped).toBe('auth');
    expect(await pending()).toHaveLength(1);
  });

  it('does not queue the same idempotency key twice', async () => {
    await enqueue({ id: 'same' }); await enqueue({ id: 'same' });
    expect(await pending()).toHaveLength(1);
  });
});
