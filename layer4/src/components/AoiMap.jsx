import { useEffect } from "react";
import { GeoJSON, LayersControl, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { tone } from "../lib/format.js";

// Polygon stroke per status tone; kept in step with --tone-* in styles.css.
const TONE_COLOR = { good: "#2F7D5B", open: "#C58A12", dispute: "#B4532A", bad: "#A3243B", none: "#7A8A83" };

function FitTo({ features, padding }) {
  const map = useMap();
  const key = features.map((f) => f.id).join("|");
  useEffect(() => {
    if (!features.length) return;
    const bounds = L.geoJSON({ type: "FeatureCollection", features }).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [padding, padding], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/**
 * Satellite basemap with project AOIs.
 * items: [{ id, name, geometry, verification? }]
 */
export default function AoiMap({ items, selectedId, onSelect, height = "100%", padding = 40 }) {
  const features = items
    .filter((i) => i.geometry)
    .map((i) => ({ type: "Feature", id: i.id, geometry: i.geometry, properties: { name: i.name, tone: tone(i.verification) } }));

  return (
    <MapContainer center={[0, 0]} zoom={2} style={{ height, width: "100%" }} worldCopyJump>
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Satellite">
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Imagery © Esri, Maxar, Earthstar Geographics"
            maxZoom={18}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Map">
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
        </LayersControl.BaseLayer>
      </LayersControl>
      {features.map((f) => {
        const selected = f.id === selectedId;
        const color = TONE_COLOR[f.properties.tone];
        return (
          <GeoJSON
            key={`${f.id}-${selected}-${f.properties.tone}`}
            data={f}
            style={{ color: selected ? "#FFFFFF" : color, weight: selected ? 3 : 2, fillColor: color, fillOpacity: selected ? 0.35 : 0.22 }}
            eventHandlers={onSelect ? { click: () => onSelect(f.id) } : undefined}
          >
            <Tooltip sticky>{f.properties.name}</Tooltip>
          </GeoJSON>
        );
      })}
      <FitTo features={features} padding={padding} />
    </MapContainer>
  );
}
