import { setFailed, setOutput } from "@actions/core";
import * as utils from "./utils";
import { buildEvent } from "./event";
import { handleCiStatus } from "./handlers/ci";
import { handlePullRequest } from "./handlers/pullRequest";
import { handleReview } from "./handlers/review";
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
    if (event.eventName === "pull_request" && event.ciStatus) {
      await handleCiStatus(event);
      return;
    }

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
  } catch (error) {
    if (utils.isAxiosError(error)) {
      console.log(error.response?.data || "Unknown error");
    }
    if (error instanceof Error) setFailed(error.message);
    else setFailed("Unknown error");
  }
};
