// Single source for what each role sees in tabs and in the More menu.
import { Bell, ClipboardList, MapPin, Phone, Receipt, Settings, Truck, User, Users } from 'lucide-react-native';
import { CREW_ROLES } from '../lib/permissions';

// `perm` hides an item unless the user holds the permission; `crew` / `staff` limit it to a kind of user.
const ITEMS = [
  { group: 'Operations', screen: 'LiveVehicles', title: 'Live vehicles', desc: 'Where every vehicle is right now', icon: MapPin, perm: 'tracking:read', staff: true },
  { group: 'Operations', screen: 'RequestsReview', title: 'Requests to review', desc: 'Approve or reject transport requests', icon: ClipboardList, perm: 'requests:review', staff: true },
  { group: 'Fleet', screen: 'Vehicles', title: 'Vehicles', desc: 'Fleet list and status', icon: Truck, perm: 'vehicles:read', staff: true },
  { group: 'Fleet', screen: 'Drivers', title: 'Drivers & staff', desc: 'Licences and duty status', icon: Users, perm: 'drivers:read', staff: true },
  { group: 'Finance', screen: 'Outstanding', title: 'Outstanding fees', desc: 'Who owes what', icon: Receipt, perm: 'billing:read', staff: true },
  { group: 'My work', screen: 'MyRequests', title: 'My requests', desc: 'Ask dispatch for a change', icon: ClipboardList, perm: 'requests:create' },
  { group: 'My work', screen: 'Contacts', title: 'Who to call', desc: 'Dispatch and management numbers', icon: Phone, crew: true },
  { group: 'Account', screen: 'Notifications', title: 'Notifications', desc: 'Alerts and updates', icon: Bell },
  { group: 'Account', screen: 'Profile', title: 'My profile', desc: 'Name, phone and password', icon: User },
  { group: 'Account', screen: 'Settings', title: 'Settings', desc: 'Server, location sharing and sync', icon: Settings },
];

export function menuGroupsFor(user) {
  const crew = CREW_ROLES.includes(user?.role);
  const allowed = it => (!it.perm || user?.permissions?.includes(it.perm)) && (!it.crew || crew) && (!it.staff || !crew);
  const order = ['My work', 'Operations', 'Fleet', 'Finance', 'Account'];
  return order
    .map(label => ({ label, items: ITEMS.filter(it => it.group === label && allowed(it)) }))
    .filter(g => g.items.length);
}

export const REQUEST_TYPES_FOR_CREW = [
  { value: 'trip_cancellation', label: 'Cancel a trip' },
  { value: 'schedule_change', label: 'Change a trip time' },
  { value: 'special_requirement', label: 'Something else' },
];
