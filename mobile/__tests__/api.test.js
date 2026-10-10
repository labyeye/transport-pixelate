import { request, setAccessToken, setBaseUrl, setSignedOutHandler, ApiError } from '../src/lib/api';
import { secure } from '../src/lib/storage';

const ok = body => ({ ok: true, status: 200, json: async () => body });
const fail = (status, body = {}) => ({ ok: false, status, json: async () => body });

beforeEach(async () => {
  await setBaseUrl('http://api.test/api/v1');
  setAccessToken('old-access');
  await secure.setTokens({ refreshToken: 'refresh-1' });
  setSignedOutHandler(() => {});
});

describe('api client', () => {
  it('sends the bearer token and parses JSON', async () => {
    const f = jest.fn(async () => ok({ data: 1 }));
    expect((await request('/x', {}, f)).data).toBe(1);
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer old-access');
    expect(f.mock.calls[0][0]).toBe('http://api.test/api/v1/x');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const calls = [];
    const f = jest.fn(async (url, opts) => {
      calls.push(url);
      if (url.endsWith('/auth/refresh')) return ok({ data: { accessToken: 'new-access', refreshToken: 'refresh-2' } });
      return opts.headers.Authorization === 'Bearer new-access' ? ok({ data: 'secret' }) : fail(401);
    });
    expect((await request('/trips', {}, f)).data).toBe('secret');
    expect(calls.filter(u => u.endsWith('/auth/refresh'))).toHaveLength(1);
    expect((await secure.getTokens()).refreshToken).toBe('refresh-2');
  });

  it('signs out only when the refresh token is genuinely rejected', async () => {
    const out = jest.fn();
    setSignedOutHandler(out);
    const f = jest.fn(async url => (url.endsWith('/auth/refresh') ? fail(401) : fail(401)));
    await expect(request('/trips', {}, f)).rejects.toBeInstanceOf(ApiError);
    expect(out).toHaveBeenCalled();
    expect(await secure.getTokens()).toBeNull();
  });

  it('does NOT sign out when offline during a refresh', async () => {
    const out = jest.fn();
    setSignedOutHandler(out);
    await secure.setTokens({ refreshToken: 'refresh-1' });
    const f = jest.fn(async url => {
      if (url.endsWith('/auth/refresh')) throw new Error('network down');
      return fail(401);
    });
    await expect(request('/trips', {}, f)).rejects.toMatchObject({ status: 0, network: true });
    expect(out).not.toHaveBeenCalled();
    expect((await secure.getTokens()).refreshToken).toBe('refresh-1'); // still signed in
  });

  it('reports network failures as status 0', async () => {
    const f = jest.fn(async () => { throw new TypeError('Network request failed'); });
    await expect(request('/x', {}, f)).rejects.toMatchObject({ status: 0, network: true });
  });

  it('surfaces server messages and validation details', async () => {
    const f = jest.fn(async () => fail(409, { message: 'Too early', errors: ['a'] }));
    await expect(request('/x', { method: 'POST', body: {} }, f)).rejects.toMatchObject({ status: 409, message: 'Too early', errors: ['a'] });
  });
});
