export const RETRIES = 3;
export const RETRY_DELAY = 1000;
// Ceiling for a server-supplied Retry-After, so a long rate-limit window
// cannot stall a consumer's CI run.
export const MAX_RETRY_DELAY = 15000;
// A request that never got a response may still have been applied, so only
// methods that are safe to repeat are retried in that case.
export const IDEMPOTENT_METHODS = ["get", "head", "options", "put", "delete"];
export const BASE_ASANA_URL = "https://app.asana.com/api/1.0";
export const PROJECTS_URL = "/projects/";
export const TASKS_URL = "/tasks/";
export const SECTIONS_URL = "/sections/";
export const STORIES_URL = "/stories/";
export const SUBTASKS_URL =
  "/subtasks?limit=100&opt_fields=completed,resource_subtype,assignee,created_by,name,approval_status";
export const STORIES_LIST_PARAMS = "?limit=100";
export const ADD_FOLLOWERS_URL = "/addFollowers";
export const ADD_TASK_URL = "/addTask";
export const BASE_GITHUB_URL = "https://api.github.com/";
export const REPOS_URL = "/repos/";
export const PULLS_URL = "/pulls/";
export const REVIEWS_URL = "/reviews";
