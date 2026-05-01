import { json, jsonError, saveVideo } from "../_lib/videoradar.js";

export async function onRequestPost({ request, env }) {
  try {
    return json(await saveVideo(env, await request.json()));
  } catch (error) {
    return jsonError(error);
  }
}
