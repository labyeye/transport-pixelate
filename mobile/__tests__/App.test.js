// Renders each main screen from fake data to prove it mounts and shows the right content for each role.
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: {}, addEventListener: () => () => {}, fetch: async () => ({ isConnected: true }) }));
jest.mock('@react-native-community/geolocation', () => ({ __esModule: true, default: { watchPosition: jest.fn(() => 1), clearWatch: jest.fn(), setRNConfiguration: jest.fn() } }));
jest.mock('react-native-background-actions', () => ({ __esModule: true, default: { start: jest.fn(async () => {}), stop: jest.fn(async () => {}), isRunning: () => false } }));
jest.mock('react-native-safe-area-context', () => {
  const R = require('react');
  return { SafeAreaProvider: ({ children }) => children, SafeAreaView: ({ children }) => R.createElement(R.Fragment, null, children), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@react-navigation/native', () => ({ NavigationContainer: ({ children }) => children, useNavigation: () => ({ navigate: jest.fn() }) }));

const mockTrip = {
  _id: 't1', tripNumber: 'TRP-00001', status: 'assigned', scheduledDate: new Date().toLocaleDateString('en-CA'), scheduledDeparture: new Date(Date.now() + 3600000).toISOString(), myRole: 'driver',
  route: { code: 'R1', name: 'Kothrud Campus', stops: [{ sequence: 1, name: 'Depot', location: { lat: 1, lng: 1 } }, { sequence: 2, name: 'School', location: { lat: 2, lng: 2 } }] },
  vehicle: { registrationNumber: 'MH12AB1234' }, driver: { name: 'Ramesh Patil' },
};
let mockUser = { name: 'Ramesh Patil', email: 'r@x.com', role: 'driver', permissions: ['trips:read', 'trips:operate', 'requests:create'] };

jest.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, can: p => mockUser.permissions.includes(p), offlineRestore: false, logout: jest.fn(), refreshUser: jest.fn(), login: jest.fn() }) }));
jest.mock('../src/contexts/TripsContext', () => ({
  useTrips: () => ({ me: { driver: { status: 'active' }, organization: { name: 'Demo' }, contacts: [{ name: 'Dina Dispatch', phone: '999', role: 'dispatcher' }], rules: { earliestStartMinutes: 60, latestStartHours: 12 } }, trips: [mockTrip], loading: false, stale: false, error: null, refresh: jest.fn(), act: jest.fn(), recordEvent: jest.fn(), emergency: jest.fn() }),
}));
jest.mock('../src/contexts/SyncContext', () => ({ useSync: () => ({ online: true, queue: { pending: 2, failed: 0 }, syncing: false, sync: jest.fn() }) }));
jest.mock('../src/lib/useApi', () => ({
  useApi: path => {
    const data = {
      '/notifications/unread-count': { count: 3 },
      '/dashboard': { trips: { today: 5, inProgress: 1, completed: 2, delayed: 0, cancelled: 1 }, vehicles: { available: 4, maintenance: 1 }, maintenance: { inWorkshop: 1 }, requests: { pending: 2 }, expiries: [{ label: 'MH12AB1234', document: 'insurance', expired: true, expiryDate: '2026-01-01' }], costs: null },
      '/tracking/vehicles': [{ vehicle: { _id: 'v1', registrationNumber: 'MH12AB1234' }, position: { recordedAt: new Date().toISOString(), lat: 1, lng: 1, speedKmh: 30 }, trip: { tripNumber: 'TRP-00001', driver: { name: 'Ramesh' } } }],
      '/vehicles': [{ _id: 'v1', registrationNumber: 'MH12AB1234', status: 'available', capacity: 40, odometer: 1000, documents: {} }],
      '/notifications': [{ _id: 'n1', title: 'New trip TRP-00001', body: 'You are assigned', severity: 'info', createdAt: new Date().toISOString() }],
    }[path] ?? [];
    return { data, meta: { sourceConfigured: true, unreadCount: 1 }, error: null, loading: false, refreshing: false, refresh: jest.fn(), reload: jest.fn() };
  },
}));
jest.mock('../src/lib/api', () => ({ api: { get: jest.fn(async () => ({ data: { passengers: [] } })), post: jest.fn(), put: jest.fn() }, getBaseUrl: () => 'http://x', setBaseUrl: jest.fn() }));

const mounted = [];
const render = async el => {
  let r;
  await ReactTestRenderer.act(async () => { r = ReactTestRenderer.create(el); });
  // Let effects that read local storage settle before asserting.
  await ReactTestRenderer.act(async () => { await new Promise(res => setTimeout(res, 0)); });
  mounted.push(r);
  return r;
};
afterEach(async () => { while (mounted.length) { const r = mounted.pop(); await ReactTestRenderer.act(async () => r.unmount()); } });
// Collect every string rendered anywhere in the tree (props can be circular, so don't stringify them).
const collect = n => (n == null ? [] : typeof n === 'string' ? [n] : Array.isArray(n) ? n.flatMap(collect) : collect(n.children));
const text = r => collect(r.toJSON()).join(' ');
const nav = { navigate: jest.fn(), goBack: jest.fn() };

describe('crew screens', () => {
  it('home greets, shows KPI tiles and today\'s trip', async () => {
    const r = await render(React.createElement(require('../src/screens/crew/CrewHomeScreen').default, { navigation: nav }));
    const t = text(r);
    expect(t).toMatch(/Good (morning|afternoon|evening)\s*,\s*Ramesh/);
    expect(t).toContain('Trips today');
    expect(t).toMatch(/R1\s+·\s+Kothrud Campus/);
    expect(t).toContain('2 updates waiting to send');
  });
  it('trips list filters and shows the trip', async () => {
    const r = await render(React.createElement(require('../src/screens/crew/CrewTripsScreen').default, { navigation: nav }));
    expect(text(r)).toContain('TRP-00001');
    expect(text(r)).toMatch(/Today\s+\(1\)/);
  });
  it('trip detail offers "I\'m ready" for an assigned trip and lists stops', async () => {
    const r = await render(React.createElement(require('../src/screens/crew/TripDetailScreen').default, { route: { params: { id: 't1' } }, navigation: nav }));
    const t = text(r);
    expect(t).toContain("I'm ready");
    expect(t).toContain('Depot');
    expect(t).toContain('Call Dina Dispatch');
    expect(t).not.toContain('EMERGENCY'); // only offered once the trip is ready or under way
  });
  it('offers emergency and finish controls on a live trip', async () => {
    mockTrip.status = 'in_progress';
    const r = await render(React.createElement(require('../src/screens/crew/TripDetailScreen').default, { route: { params: { id: 't1' } }, navigation: nav }));
    const t = text(r);
    expect(t).toContain('EMERGENCY');
    expect(t).toContain('Finish trip');
    expect(t).toContain('Report a problem');
    expect(t).not.toContain("I'm ready");
    mockTrip.status = 'assigned';
  });
  it('more menu groups items for crew and hides staff-only ones', async () => {
    const r = await render(React.createElement(require('../src/screens/shared/MenuScreen').default, { navigation: nav }));
    const t = text(r);
    expect(t).toContain('Who to call');
    expect(t).toContain('My requests');
    expect(t).not.toContain('Live vehicles');
    expect(t).not.toContain('Outstanding fees');
  });
});

describe('manager screens', () => {
  beforeAll(() => { mockUser = { name: 'Asha Verma', email: 'a@x.com', role: 'owner', permissions: ['trips:read', 'tracking:read', 'requests:review', 'requests:create', 'vehicles:read', 'drivers:read', 'billing:read'] }; });
  it('dashboard shows KPIs, request notice and expiring documents', async () => {
    const r = await render(React.createElement(require('../src/screens/manager/ManagerDashboardScreen').default, { navigation: nav }));
    const t = text(r);
    expect(t).toContain('Trips today');
    expect(t).toContain('2 requests waiting for review');
    expect(t).toContain('Documents needing attention');
  });
  it('live vehicles shows freshness', async () => {
    const r = await render(React.createElement(require('../src/screens/manager/LiveVehiclesScreen').default, {}));
    expect(text(r)).toContain('MH12AB1234');
    expect(text(r)).toMatch(/Live/);
  });
  it('menu exposes staff destinations', async () => {
    const r = await render(React.createElement(require('../src/screens/shared/MenuScreen').default, { navigation: nav }));
    const t = text(r);
    ['Live vehicles', 'Requests to review', 'Vehicles', 'Drivers & staff', 'Outstanding fees'].forEach(x => expect(t).toContain(x));
    expect(t).not.toContain('Who to call');
  });
  it('notifications list renders', async () => {
    const r = await render(React.createElement(require('../src/screens/shared/NotificationsScreen').default, {}));
    expect(text(r)).toContain('New trip TRP-00001');
  });
});
