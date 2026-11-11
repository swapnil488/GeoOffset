/**
 * Layer 2 (FastAPI dMRV engine) client.
 *
 * If Layer 2 can't be reached, reads fall back to a bundled snapshot of a
 * real Layer 2 run (src/demo/demoData.json) so the map and charts still work
 * in a review without the backend running. Writes never fall back.
 */
import demoData from "../demo/demoData.json";

export const LAYER2_URL = (import.meta.env.VITE_LAYER2_URL || "http://localhost:8000").replace(/\/$/, "");

let demoMode = false;
const listeners = new Set();
export const isDemoMode = () => demoMode;
export function onDemoModeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setDemoMode(v) {
  if (demoMode === v) return;
  demoMode = v;
  listeners.forEach((fn) => fn(v));
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${LAYER2_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Layer 2 isn't reachable at ${LAYER2_URL}. Start it with: uvicorn app.main:app --port 8000`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => `${d.loc?.slice(1).join(".")}: ${d.msg}`).join("; ")
      : data.detail;
    throw new ApiError(res.status, detail || `Layer 2 returned ${res.status}`);
  }
  return data;
}

async function read(path, demoValue) {
  try {
    const data = await request("GET", path);
    setDemoMode(false);
    return data;
  } catch (e) {
    if (e.status === 0 && demoValue !== undefined) {
      setDemoMode(true);
      return typeof demoValue === "function" ? demoValue() : demoValue;
    }
    throw e;
  }
}

const notInDemo = (what) => () => {
  throw new ApiError(404, `${what} isn't in the offline snapshot.`);
};

export const api = {
  health: () => request("GET", "/health"),

  listProjects: () => read("/projects", demoData.projects),

  getProject: (projectId) =>
    read(`/projects/${encodeURIComponent(projectId)}`, () => {
      const p = demoData.projects.find((x) => x.project_id === projectId);
      if (!p) notInDemo(`Project ${projectId}`)();
      return p;
    }),

  listVerifications: (projectId) =>
    read(`/projects/${encodeURIComponent(projectId)}/verifications`, () =>
      Object.values(demoData.verifications)
        .filter((v) => v.project_id === projectId)
        .map(({ aligned_observations, ...rest }) => rest),
    ),

  getVerification: (id) =>
    read(`/verifications/${id}`, () => demoData.verifications[String(id)] || notInDemo(`Verification ${id}`)()),

  listDisputes: (verificationId) =>
    read(`/verifications/${verificationId}/disputes`, () => demoData.disputes[String(verificationId)] || []),

  createProject: (body) => request("POST", "/projects", body),
  submitVerification: (projectId, layer1Export) =>
    request("POST", `/projects/${encodeURIComponent(projectId)}/verifications`, layer1Export),
  openDispute: (verificationId, body) => request("POST", `/verifications/${verificationId}/disputes`, body),
  resolveDispute: (disputeId, recheckPayload) =>
    request("POST", `/disputes/${disputeId}/resolve`, { recheck_payload: recheckPayload }),
  finalize: (verificationId) => request("POST", `/verifications/${verificationId}/finalize`),
};
