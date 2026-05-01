import { json, jsonError, searchVideos } from "../_lib/videoradar.js";

export async function onRequestGet({ request, env }) {
  try {
    return json(await searchVideos(env, new URL(request.url)));
  } catch (error) {
    return jsonError(error);
  }
}
