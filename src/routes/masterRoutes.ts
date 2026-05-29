import { Router } from "express";
import { createAuthRoutes } from "../modules/auth/apis/routes.js";

export function createMasterRouter(): Router {
  const masterRouter = Router();
  masterRouter.use(createAuthRoutes());
  return masterRouter;
}
