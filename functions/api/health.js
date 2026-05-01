import { health, json, jsonError } from "../_lib/videoradar.js";

export async function onRequestGet({ env }) {
  try {
    return json(await health(env));
  } catch (error) {
    return jsonError(error);
  }
}
