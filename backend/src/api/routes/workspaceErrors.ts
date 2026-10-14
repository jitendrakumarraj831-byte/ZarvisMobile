import type { Response } from "express";
import { WorkspaceError } from "../../workspace/workspaceService.js";

/** Sends a WorkspaceError as its status and code; anything else is left for the error middleware. */
export function sendWorkspaceError(err: unknown, res: Response): boolean {
  if (err instanceof WorkspaceError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}
