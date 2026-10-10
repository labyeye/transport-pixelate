// Smoke test: every screen renders from fake data without crashing.
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: {}, addEventListener: () => () => {}, fetch: async () => ({ isConnected: true }) }));
jest.mock('@react-native-community/geolocation', () => ({ __esModule: true, default: { watchPosition: jest.fn(() => 1), clearWatch: jest.fn(), setRNConfiguration: jest.fn() } }));
jest.mock('react-native-background-actions', () => ({ __esModule: true, default: { start: jest.fn(async () => {}), stop: jest.fn(async () => {}), isRunning: () => false } }));
jest.mock('@react-navigation/native', () => ({ NavigationContainer: ({ children }) => children, useNavigation: () => ({ navigate: jest.fn() }) }));

const mockTrip = {
  _id: 't1', tripNumber: 'TRP-00001', status: 'assigned', scheduledDate: '2030-01-15', scheduledDeparture: new Date(Date.now() + 3600000).toISOString(), myRole: 'driver',
  route: { code: 'R1', name: 'Route One', stops: [{ sequence: 1, name: 'A', location: { lat: 1, lng: 1 } }, { sequence: 2, name: 'B', location: { lat: 2, lng: 2 } }] },
  vehicle: { registrationNumber: 'MH12AB1234' },
};

jest.mock('../src/contexts/TripsContext', () => ({
  useTrips: () => ({ me: { driver: { status: 'active' }, organization: { name: 'Demo' }, contacts: [{ name: 'Dina', phone: '999' }], rules: { earliestStartMinutes: 60, latestStartHours: 12 } }, trips: [mockTrip], loading: false, stale: false, error: null, refresh: jest.fn(), act: jest.fn(), recordEvent: jest.fn(), emergency: jest.fn() }),
}));
jest.mock('../src/contexts/SyncContext', () => ({ useSync: () => ({ online: true, queue: { pending: 2, failed: 0 }, syncing: false, sync: jest.fn() }) }));
jest.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Dev Driver', email: 'd@x.com', role: 'driver' }, offlineRestore: false, logout: jest.fn() }) }));
jest.mock('../src/lib/api', () => ({ api: { get: jest.fn(async () => ({ data: { passengers: [] } })), post: jest.fn() }, getBaseUrl: () => 'http://x', setBaseUrl: jest.fn() }));

const render = async el => { let r; await ReactTestRenderer.act(async () => { r = ReactTestRenderer.create(el); }); return r; };
// Collect every string rendered anywhere in the tree (props can be circular, so don't stringify them).
const collect = n => (n == null ? [] : typeof n === 'string' ? [n] : Array.isArray(n) ? n.flatMap(collect) : collect(n.children));
const text = r => collect(r.toJSON()).join(' ');

describe('screens render', () => {
  it('home lists trips and surfaces queued updates', async () => {
    const Home = require('../src/screens/HomeScreen').default;
    const r = await render(<Home navigation={{ navigate: jest.fn() }} />);
    expect(text(r)).toContain('R1');
    expect(text(r)).toContain('2 update');
  });
  it('trip screen offers "I\'m ready" for an assigned trip', async () => {
    const Trip = require('../src/screens/TripScreen').default;
    const r = await render(<Trip route={{ params: { id: 't1' } }} navigation={{ navigate: jest.fn() }} />);
    expect(text(r)).toContain("I'm ready");
    expect(text(r)).toContain('Route One');
  });
  it('more screen shows who to call and sign out', async () => {
    const More = require('../src/screens/MoreScreen').default;
    const r = await render(<More />);
    expect(text(r)).toContain('Dina');
    expect(text(r)).toContain('Sign out');
  });
});
