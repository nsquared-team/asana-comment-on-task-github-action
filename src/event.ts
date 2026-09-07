import { getInput } from "@actions/core";
import * as INPUTS from "./constants/inputs";
import * as utils from "./utils";

export const CI_STATUSES = ["approved", "rejected", "edit_pr_description"];

export interface SyncEvent {
  eventName: string;
  action: string;
  repoFullName: string;
  taskIds: string[];
  prNumber?: number;
  isPullRequest: boolean;
  prUrl: string;
  prState: string;
  prMerged: boolean;
  prBaseRef: string;
  isDraft: boolean;
  reviewState: string;
  reviewBody: string;
  commentUrl: string;
  rawCommentBody: string;
  commentPath: string;
  commentLine?: number;
  commentSubjectType: string;
  commentInReplyTo?: number;
  username?: string;
  requestedReviewers: any[];
  eventReviewer?: any;
  ciStatus: string;
  actionUrl: string;
  prDescriptionInput: string;
}

export const buildEvent = (context: any): SyncEvent => {
  const payload = context.payload;
  const pullRequest = payload.pull_request || payload.issue;
  const commentText = getInput(INPUTS.COMMENT_TEXT);

  const username =
    payload.comment?.user?.login ||
    payload.review?.user?.login ||
    payload.sender?.login;

  const requestedReviewers = (payload.pull_request?.requested_reviewers || [])
    .map((reviewer: any) => utils.findUserByGithubName(reviewer.login))
    .filter(Boolean);

  return {
    eventName: context.eventName,
    action: payload.action || "",
    // A schedule payload carries no repository; the runner's env does.
    repoFullName:
      payload.repository?.full_name || process.env.GITHUB_REPOSITORY || "",
    taskIds: utils.extractAsanaTaskIds(pullRequest?.body),
    prNumber: pullRequest?.number,
    // issue_comment also fires on plain issues, which have no PR to read.
    isPullRequest: Boolean(payload.pull_request || payload.issue?.pull_request),
    prUrl: pullRequest?.html_url || "",
    prState: pullRequest?.state || "",
    prMerged: payload.pull_request?.merged || false,
    prBaseRef: payload.pull_request?.base?.ref || "",
    isDraft: payload.pull_request?.draft || false,
    reviewState: payload.review?.state || "",
    reviewBody: payload.review?.body || "",
    commentUrl: payload.comment?.html_url || payload.review?.html_url || "",
    rawCommentBody: payload.comment?.body || payload.review?.body || "",
    commentPath: payload.comment?.path || "",
    commentLine: payload.comment?.original_line,
    // "file" for a whole-file review comment, "line" otherwise. GitHub still
    // reports original_line as 1 on a file-level comment, so this is the only
    // field that tells the two apart.
    commentSubjectType: payload.comment?.subject_type || "",
    commentInReplyTo: payload.comment?.in_reply_to_id,
    username,
    requestedReviewers,
    eventReviewer: payload.requested_reviewer
      ? utils.findUserByGithubName(payload.requested_reviewer.login)
      : undefined,
    ciStatus: CI_STATUSES.includes(commentText) ? commentText : "",
    actionUrl: getInput(INPUTS.ACTION_URL),
    prDescriptionInput: getInput(INPUTS.PR_DESCRIPTION),
  };
};
