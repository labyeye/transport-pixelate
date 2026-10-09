import { LayoutDashboard, Truck, Users, type LucideIcon } from "lucide-react";

export interface NavItem { title: string; href: string; icon: LucideIcon; permission: string }
export interface NavGroup { label: string; items: NavItem[] }

// Only modules that are actually built appear here; add entries as modules land.
export const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", items: [{ title: "Dashboard", href: "/", icon: LayoutDashboard, permission: "vehicles:read" }] },
  {
    label: "Fleet",
    items: [
      { title: "Vehicles", href: "/vehicles", icon: Truck, permission: "vehicles:read" },
      { title: "Drivers & Staff", href: "/drivers", icon: Users, permission: "drivers:read" },
    ],
  },
];

export const getNavGroups = (can: (p: string) => boolean): NavGroup[] =>
  NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) })).filter((g) => g.items.length);
