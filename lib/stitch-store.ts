import "server-only";
import { db } from "./db";
import { makeStitchRepo } from "./stitch-repo";

/** Stitching data access for the app (service-role client). */
export const supabaseStitchRepo = makeStitchRepo(db);
