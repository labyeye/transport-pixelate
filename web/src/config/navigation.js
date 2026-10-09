import {
  LayoutDashboard,
  Navigation,
  Route,
  Truck,
  UserRound,
  Users,
} from "lucide-react";
// Only modules that are actually built appear here; add entries as modules land.
export const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
        permission: "vehicles:read",
      },
    ],
  },
  {
    label: "Fleet",
    items: [
      {
        title: "Vehicles",
        href: "/vehicles",
        icon: Truck,
        permission: "vehicles:read",
      },
      {
        title: "Drivers & Staff",
        href: "/drivers",
        icon: Users,
        permission: "drivers:read",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        title: "Routes",
        href: "/routes",
        icon: Route,
        permission: "routes:read",
      },
      {
        title: "Trips",
        href: "/trips",
        icon: Navigation,
        permission: "trips:read",
      },
    ],
  },
];
export const getNavGroups = (can) =>
  NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => can(i.permission)),
  })).filter((g) => g.items.length);
