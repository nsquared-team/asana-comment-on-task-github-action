import githubAxios from "./requests/githubAxios";
import * as REQUESTS from "./constants/requests";
import * as asana from "./asana";
import * as utils from "./utils";
import { SyncEvent } from "./event";

// A reviewer is asked only for the commit CI passed, so a red, running or
// out-of-date result holds every call and promotion.

const TESTED_COMMIT = /Tested commit: ([0-9a-f]{7,40})/;
const BYPASS_MARKER = "ci bypass";

export const ciSubtaskNotes = (event: SyncEvent) => {
  const link = `<a href='${event.actionUrl}'> Click Here To Investigate Action </a>`;
  return event.headSha ? `${link}\nTested commit: ${event.headSha}` : link;
};

export const testedCommitOf = (ciSubtask: any): string =>
  ciSubtask?.notes?.match(TESTED_COMMIT)?.[1] || "";

const readHeadSha = async (event: SyncEvent) => {
  const url = `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.PULLS_URL}${event.prNumber}`;
  return (await githubAxios.get(url)).data.head?.sha as string | undefined;
};

// A commit pushed after CI passed still counts when its subject carries the
// bypass marker: CI cancels its own run on those, so no result for them will
// ever come. Anything else, or a history that is not a straight extension of
// the tested commit, is untested code.
export const isCurrentCommit = async (
  event: SyncEvent,
  testedSha: string,
  headSha?: string
): Promise<boolean> => {
  if (!testedSha) return true;
  const head = headSha || (await readHeadSha(event));
  if (!head) return false;
  if (head === testedSha) return true;

  const url = `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.COMPARE_URL}${testedSha}...${head}`;
  let comparison: any;
  try {
    comparison = (await githubAxios.get(url)).data;
  } catch (error) {
    if (utils.isAxiosError(error) && error.response?.status === 404) {
      return false;
    }
    throw error;
  }

  return (
    comparison.status === "ahead" &&
    comparison.commits.length === comparison.total_commits &&
    comparison.commits.every((entry: any) =>
      entry.commit.message.split("\n")[0].includes(BYPASS_MARKER)
    )
  );
};

export const ciClearsReview = async (
  event: SyncEvent,
  taskId: string,
  headSha?: string
): Promise<boolean> => {
  const record = await asana.getCiSubtask(taskId);
  if (!record) return true;
  if (record.approval_status !== "approved") return false;
  return isCurrentCommit(event, testedCommitOf(record), headSha);
};
