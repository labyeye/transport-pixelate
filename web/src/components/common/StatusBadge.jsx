const TONES = {
  green: "nb-tag-green",
  blue: "nb-tag-blue",
  orange: "nb-tag-orange",
  red: "nb-tag-red",
  yellow: "nb-tag-yellow",
  gray: "nb-tag-white",
  purple: "nb-tag-purple",
};
export const VEHICLE_STATUS = {
  available: { label: "Available", tone: "green" },
  assigned: { label: "Assigned", tone: "blue" },
  on_trip: { label: "On Trip", tone: "orange" },
  maintenance: { label: "Maintenance", tone: "yellow" },
  out_of_service: { label: "Out of Service", tone: "red" },
  inactive: { label: "Inactive", tone: "gray" },
};
export const DRIVER_STATUS = {
  active: { label: "Active", tone: "green" },
  on_duty: { label: "On Duty", tone: "orange" },
  off_duty: { label: "Off Duty", tone: "gray" },
  on_leave: { label: "On Leave", tone: "yellow" },
  suspended: { label: "Suspended", tone: "red" },
  inactive: { label: "Inactive", tone: "gray" },
};
export function StatusBadge({ meta }) {
  if (!meta) return null;
  return (
    <span
      className={`nb-badge uppercase whitespace-nowrap ${TONES[meta.tone]}`}
    >
      {meta.label}
    </span>
  );
}

export const TRIP_STATUS = {
  draft: { label: "Draft", tone: "gray" },
  scheduled: { label: "Scheduled", tone: "blue" },
  assigned: { label: "Assigned", tone: "purple" },
  ready: { label: "Ready", tone: "green" },
  in_progress: { label: "In Progress", tone: "orange" },
  delayed: { label: "Delayed", tone: "yellow" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "red" },
  aborted: { label: "Aborted", tone: "red" },
};
