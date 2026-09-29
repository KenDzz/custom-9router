import { handleModelAccess } from "@/lib/workspaces/modelAccessRoutes.js";

export const dynamic = "force-dynamic";
export const GET = handleModelAccess;
export const PATCH = handleModelAccess;
