// Role -> permission map. Every protected endpoint checks a permission server-side.
export const ROLES = [
  "owner",
  "admin",
  "dispatcher",
  "accountant",
  "driver",
  "attendant",
  "viewer",
];
export const PERMISSIONS = [
  "vehicles:read",
  "vehicles:write",
  "drivers:read",
  "drivers:write",
  "routes:read",
  "routes:write",
  "trips:read",
  "trips:write",
  "trips:dispatch",
  "trips:operate",
  "passengers:read",
  "passengers:write",
  "tracking:read",
  "maintenance:read",
  "maintenance:write",
  "expenses:read",
  "expenses:write",
  "reports:read",
  "settings:write",
  "users:write",
];
const all = [...PERMISSIONS];
const readOnly = PERMISSIONS.filter((p) => p.endsWith(":read"));
export const ROLE_PERMISSIONS = {
  owner: all,
  admin: all,
  dispatcher: [
    "vehicles:read",
    "drivers:read",
    "routes:read",
    "routes:write",
    "trips:read",
    "trips:write",
    "trips:dispatch",
    "trips:operate",
    "passengers:read",
    "passengers:write",
    "tracking:read",
    "maintenance:read",
    "reports:read",
  ],
  accountant: [
    "vehicles:read",
    "expenses:read",
    "expenses:write",
    "maintenance:read",
    "reports:read",
  ],
  // Drivers/attendants may only operate trips they are assigned to (enforced in the events module).
  driver: ["trips:read", "routes:read", "trips:operate", "passengers:read"],
  attendant: ["trips:read", "routes:read", "trips:operate", "passengers:read"],
  viewer: readOnly,
};
export const can = (role, p) => ROLE_PERMISSIONS[role]?.includes(p) ?? false;
