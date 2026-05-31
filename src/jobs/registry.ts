// Central job registry — both the BullMQ worker (keyed by job.name) and the SQS
// poller (keyed by message envelope `type`) dispatch through this map.
//
// Each module contributes its own job map (mirrors how masterRoutes merges
// module routes). Spread module maps here as they're added:
//   import { notificationJobs } from "../modules/notifications/jobs/index.js";
//   export const jobRegistry = { ...notificationJobs };
//
// Empty for now — handlers get wired in when the first job module ships.

export type JobHandler = (payload: unknown) => Promise<void>;

export const jobRegistry: Record<string, JobHandler> = {};
