import turfArea from "@turf/area";
import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Parse an uploaded/pasted AOI. Accepts a GeoJSON Feature, FeatureCollection
 * (first feature) or bare Polygon geometry — the same shapes Layer 1's aoi.py takes.
 */
export function parseAoi(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON. Paste a GeoJSON Polygon or Feature.");
  }
  const geometry =
    obj.type === "FeatureCollection" ? obj.features?.[0]?.geometry : obj.type === "Feature" ? obj.geometry : obj;
  if (!geometry || geometry.type !== "Polygon") {
    throw new Error(`The AOI must be a Polygon (got ${geometry?.type || "nothing"}).`);
  }
  const ring = geometry.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) throw new Error("The polygon needs at least 4 points in its outer ring.");
  const [f, l] = [ring[0], ring[ring.length - 1]];
  if (f[0] !== l[0] || f[1] !== l[1]) throw new Error("The polygon ring isn't closed: the first and last points must match.");

  const areaKm2 = turfArea({ type: "Feature", geometry, properties: {} }) / 1e6;
  return { raw: obj, geometry, areaKm2, aoiHash: aoiHashOf(geometry), name: obj.properties?.name };
}

/**
 * On-chain AOI hash: keccak256 of the re-stringified Polygon geometry.
 * Hashing the geometry only (not Feature properties) means the hash computed
 * from an uploaded file and from Layer 2's stored copy of it are identical.
 */
export const aoiHashOf = (geometry) =>
  keccak256(toUtf8Bytes(JSON.stringify({ type: geometry.type, coordinates: geometry.coordinates })));
