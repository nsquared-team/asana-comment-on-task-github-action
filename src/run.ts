import { setFailed, setOutput } from "@actions/core";
import * as utils from "./utils";
import { buildEvent } from "./event";
import { handleCiStatus } from "./handlers/ci";
import { handlePullRequest } from "./handlers/pullRequest";
import {
  handleReview,
  reconcileOpenPullRequests,
  reconcileReviewState,
} from "./handlers/review";
import { handleComment } from "./handlers/comment";

export const run = async (context: any) => {
  try {
    utils.validateTrigger(context.eventName);
    const event = buildEvent(context);

    setOutput("event", event.eventName);
    setOutput("action", event.action);

    // CI-status invocations (comment-text: approved / rejected /
    // edit_pr_description) come from the consumer repos' CI pipelines and
    // only sync the CI verdict — they never post PR comments.
    // A scheduled or manual run has no event to mirror; it restates every
    // open pull request instead.
    if (
      event.eventName === "schedule" ||
      event.eventName === "workflow_dispatch"
    ) {
      await reconcileOpenPullRequests(event);
      return;
    }

    if (event.eventName === "pull_request" && event.ciStatus) {
      await handleCiStatus(event);
    } else {
      switch (event.eventName) {
        case "pull_request":
          await handlePullRequest(event);
          break;
        case "pull_request_review":
          await handleReview(event);
          break;
        case "issue_comment":
        case "pull_request_review_comment":
          await handleComment(event);
          break;
      }
    }

    // Each handler mirrors one transition; the reconcile restates the whole
    // review state afterwards, so a PR in review carries its approvals
    // whichever event got it there. A CI rejection has just parked the task
    // on purpose, and a description edit never touches Asana.
    if (event.ciStatus === "" || event.ciStatus === "approved") {
      await reconcileReviewState(event);
    }
  } catch (error) {
    if (utils.isAxiosError(error)) {
      console.log(error.response?.data || "Unknown error");
    }
    if (error instanceof Error) setFailed(error.message);
    else setFailed("Unknown error");
  }
};
