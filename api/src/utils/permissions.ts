// Role -> permission map. Every protected endpoint checks a permission server-side.
export const ROLES = ["owner", "admin", "dispatcher", "accountant", "driver", "attendant", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "vehicles:read", "vehicles:write",
  "drivers:read", "drivers:write",
  "routes:read", "routes:write",
  "trips:read", "trips:write", "trips:dispatch",
  "tracking:read",
  "maintenance:read", "maintenance:write",
  "expenses:read", "expenses:write",
  "reports:read",
  "settings:write", "users:write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS] as Permission[];
const readOnly = PERMISSIONS.filter((p) => p.endsWith(":read")) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: all,
  admin: all,
  dispatcher: [
    "vehicles:read", "drivers:read", "routes:read", "routes:write",
    "trips:read", "trips:write", "trips:dispatch", "tracking:read",
    "maintenance:read", "reports:read",
  ],
  accountant: ["vehicles:read", "expenses:read", "expenses:write", "maintenance:read", "reports:read"],
  driver: ["trips:read", "routes:read"],
  attendant: ["trips:read", "routes:read"],
  viewer: readOnly,
};

export const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role]?.includes(p) ?? false;
