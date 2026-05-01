import { history, json, jsonError } from "../_lib/videoradar.js";

export async function onRequestGet({ env }) {
  try {
    return json(await history(env));
  } catch (error) {
    return jsonError(error);
  }
}
