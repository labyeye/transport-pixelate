import {
  Bell,
  ClipboardList,
  FileText,
  Fuel,
  LayoutDashboard,
  MapPin,
  Navigation,
  Route,
  Truck,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

// Only modules that are actually built appear here; add entries as modules land.
// An item with no `permission` is shown to every signed-in user.
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
      {
        title: "Documents",
        href: "/documents",
        icon: FileText,
        permission: "vehicles:read",
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
      {
        title: "Live Tracking",
        href: "/tracking",
        icon: MapPin,
        permission: "tracking:read",
      },
      {
        title: "Passengers",
        href: "/passengers",
        icon: UserRound,
        permission: "passengers:read",
      },
      {
        title: "Requests",
        href: "/requests",
        icon: ClipboardList,
        permission: "requests:create",
      },
    ],
  },
  {
    label: "Costs",
    items: [
      {
        title: "Maintenance",
        href: "/maintenance",
        icon: Wrench,
        permission: "maintenance:read",
      },
      {
        title: "Fuel & Expenses",
        href: "/fuel-expenses",
        icon: Fuel,
        permission: "expenses:read",
      },
    ],
  },
  {
    label: "Account",
    items: [
      {
        title: "Notifications",
        href: "/notifications",
        icon: Bell,
        permission: "",
      },
    ],
  },
];

export const getNavGroups = (can) =>
  NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || can(i.permission)),
  })).filter((g) => g.items.length);
