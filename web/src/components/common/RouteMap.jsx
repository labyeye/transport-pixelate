import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

function ClickToAdd({ onAdd }) {
  useMapEvents({ click: (e) => onAdd?.(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Route preview. Straight lines join stops in order (not road geometry; no routing provider is configured). */
export function RouteMap({ stops, onAdd, height = 280 }) {
  const pts = stops.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng),
  );
  const center = pts.length ? [pts[0].lat, pts[0].lng] : [20.5937, 78.9629];
  return (
    <div className="border-2 border-black" style={{ height }}>
      <MapContainer
        key={pts.length ? "p" : "e"}
        center={center}
        zoom={pts.length ? 12 : 4}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {onAdd && <ClickToAdd onAdd={onAdd} />}
        {pts.length > 1 && (
          <Polyline
            positions={pts.map((s) => [s.lat, s.lng])}
            pathOptions={{ color: "#024BAB", weight: 3, dashArray: "6 6" }}
          />
        )}
        {pts.map((s, i) => (
          <CircleMarker
            key={i}
            center={[s.lat, s.lng]}
            radius={9}
            pathOptions={{
              color: "#0a0a0a",
              weight: 2,
              fillColor: "#FA731C",
              fillOpacity: 1,
            }}
          >
            <Tooltip
              permanent
              direction="center"
              className="!bg-transparent !border-0 !shadow-none !text-white font-bold"
            >
              {i + 1}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
