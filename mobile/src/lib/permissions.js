// Mirrors the server's role model for deciding what to show. The server still enforces everything.
export const CREW_ROLES = ['driver', 'attendant'];
export const isCrew = user => CREW_ROLES.includes(user?.role);
export const can = (user, permission) => !!user?.permissions?.includes(permission);
