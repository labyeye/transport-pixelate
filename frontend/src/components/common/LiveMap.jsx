import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

export const FRESH_COLOR = {
  live: "#00C48C",
  stale: "#FFD60A",
  offline: "#9CA3AF",
  no_signal: "#9CA3AF",
};

function Fit({ points, focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 14));
    else if (points.length)
      map.fitBounds(
        points.map((p) => [p.lat, p.lng]),
        { padding: [40, 40], maxZoom: 15 },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.lat, focus?.lng, points.length]);
  return null;
}

export function LiveMap({ markers, selectedId, onSelect, trail }) {
  const withPos = markers.filter((m) => m.lat != null);
  const focus = withPos.find((m) => m.id === selectedId);
  return (
    <div className="border-2 border-black h-[420px] lg:h-full min-h-[320px]">
      <MapContainer
        center={[20.5937, 78.9629]}
        zoom={4}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Fit points={withPos} focus={focus} />
        {trail?.length > 1 && (
          <Polyline
            positions={trail.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: "#024BAB", weight: 3 }}
          />
        )}
        {withPos.map((m) => (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lng]}
            radius={m.id === selectedId ? 13 : 9}
            pathOptions={{
              color: "#0a0a0a",
              weight: m.id === selectedId ? 3 : 2,
              fillColor: FRESH_COLOR[m.freshness],
              fillOpacity: m.freshness === "live" ? 1 : 0.6,
            }}
            eventHandlers={{ click: () => onSelect(m.id) }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {m.label}
              {m.freshness !== "live" ? ` (${m.freshness})` : ""}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
