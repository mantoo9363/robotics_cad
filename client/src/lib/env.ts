const DEFAULT_SIMULATION_SERVER_URL = "http://localhost:4020"; // 4010 is already the circuit project's simulation server

export const SIMULATION_SERVER_URL = (
  process.env.NEXT_PUBLIC_ROBOTICS_CAD_SERVER_URL ||
  process.env.NEXT_PUBLIC_SIMULATION_SERVER_URL ||
  DEFAULT_SIMULATION_SERVER_URL
).replace(/\/+$/, "");

export const CAD_STREAM_URL = `${SIMULATION_SERVER_URL}/cad-stream`;

export function getSimulationServerLabel() {
  try {
    const url = new URL(SIMULATION_SERVER_URL);
    return url.host;
  } catch {
    return SIMULATION_SERVER_URL;
  }
}
