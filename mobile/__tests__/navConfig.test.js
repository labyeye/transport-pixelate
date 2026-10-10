import { menuGroupsFor, REQUEST_TYPES_FOR_CREW } from '../src/navigation/navConfig';

const titles = u => menuGroupsFor(u).flatMap(g => g.items.map(i => i.title));

describe('menu by role', () => {
  it('crew see their work and account items only', () => {
    const t = titles({ role: 'driver', permissions: ['trips:read', 'trips:operate', 'requests:create'] });
    expect(t).toEqual(expect.arrayContaining(['My requests', 'Who to call', 'Notifications', 'My profile', 'Settings']));
    expect(t).not.toContain('Live vehicles');
    expect(t).not.toContain('Vehicles');
  });
  it('staff items follow permissions', () => {
    const dispatcher = titles({ role: 'dispatcher', permissions: ['tracking:read', 'requests:review', 'vehicles:read', 'drivers:read', 'requests:create'] });
    expect(dispatcher).toEqual(expect.arrayContaining(['Live vehicles', 'Requests to review', 'Vehicles', 'Drivers & staff']));
    expect(dispatcher).not.toContain('Outstanding fees');
    expect(dispatcher).not.toContain('Who to call');
    expect(titles({ role: 'accountant', permissions: ['billing:read'] })).toContain('Outstanding fees');
  });
  it('groups are ordered and never empty', () => {
    const g = menuGroupsFor({ role: 'owner', permissions: ['tracking:read', 'vehicles:read', 'billing:read'] });
    expect(g.every(x => x.items.length > 0)).toBe(true);
    expect(g[g.length - 1].label).toBe('Account');
  });
  it('crew can only file request types the server supports for them', () => {
    expect(REQUEST_TYPES_FOR_CREW.map(t => t.value)).toEqual(['trip_cancellation', 'schedule_change', 'special_requirement']);
  });
});
