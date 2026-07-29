import githubAxios from "../requests/githubAxios";
import * as REQUESTS from "../constants/requests";
import * as SECTIONS from "../constants/sections";
import * as asana from "../asana";
import * as utils from "../utils";
import * as format from "../format";
import { buildFormattedBody, postCommentToTasks } from "./comment";
import { SyncEvent } from "../event";

const SUBTASK_REVIEW_STATES = ["approved", "pending", "changes_requested"];

// A PR is fully approved only when every tier has signed off; approvals
// cascade PEER_DEV -> DEV -> QA, creating the next tier's subtasks as the
// previous tier completes.
const handleApprovalCascade = async (event: SyncEvent) => {
  const githubUrl = `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.PULLS_URL}${event.prNumber}${REQUESTS.REVIEWS_URL}`;
  const reviewsResponse = await githubAxios.get(githubUrl);
  const reviews = reviewsResponse.data;

  // Latest definitive review (approved / changes requested) per reviewer.
  const latestReviews: { [githubName: string]: any } = {};
  for (const review of reviews) {
    const githubName = review.user.login;
    const reviewerObj = utils.findUserByGithubName(githubName);
    if (!reviewerObj) continue;
    if (review.state !== "CHANGES_REQUESTED" && review.state !== "APPROVED")
      continue;
    if (
      !latestReviews[githubName] ||
      latestReviews[githubName].timestamp < review.submitted_at
    ) {
      latestReviews[githubName] = {
        state: review.state,
        timestamp: review.submitted_at,
        info: reviewerObj,
      };
    }
  }

  // A reviewer still in requested_reviewers has a re-requested (pending)
  // review, unless their latest review already approved.
  for (const reviewer of event.requestedReviewers) {
    const existing = latestReviews[reviewer.githubName];
    if (!existing || existing.state !== "APPROVED") {
      latestReviews[reviewer.githubName] = {
        state: "PENDING",
        timestamp: null,
        info: reviewer,
      };
    }
  }

  let approvedByPeer = true;
  let approvedByDev = true;
  let approvedByQa = true;
  for (const githubName of Object.keys(latestReviews)) {
    const review = latestReviews[githubName];
    if (review.state === "APPROVED") continue;
    const team = review.info.team;
    if (team === "PEER_DEV") approvedByPeer = false;
    else if (team === "DEV") approvedByDev = false;
    else approvedByQa = false;
  }

  const devReviewers = event.requestedReviewers.filter(
    (reviewer: any) => reviewer.team === "DEV"
  );
  const qaReviewers = event.requestedReviewers.filter(
    (reviewer: any) => reviewer.team === "QA"
  );

  const followers: string[] = [];

  if (approvedByPeer && !approvedByDev) {
    for (const reviewer of devReviewers) {
      followers.push(reviewer.asanaId);
      for (const taskId of event.taskIds) {
        await asana.addRequestedReview(taskId, reviewer, event.prUrl);
      }
    }
  }

  if (approvedByPeer && approvedByDev && !approvedByQa) {
    for (const reviewer of qaReviewers) {
      followers.push(reviewer.asanaId);
      for (const taskId of event.taskIds) {
        await asana.addRequestedReview(taskId, reviewer, event.prUrl);
      }
    }
  }

  if (approvedByPeer && approvedByDev && approvedByQa) {
    for (const taskId of event.taskIds) {
      await asana.moveTaskToSection(taskId, SECTIONS.APPROVED);
    }
  }

  return followers;
};

export const handleReview = async (event: SyncEvent) => {
  const reviewer = utils.findUserByGithubName(event.username);

  // Mirror the reviewer's verdict onto their approval subtask.
  if (
    event.action === "submitted" &&
    SUBTASK_REVIEW_STATES.includes(event.reviewState)
  ) {
    for (const taskId of event.taskIds) {
      const approvalSubtask = await asana.getApprovalSubtask(
        taskId,
        false,
        reviewer
      );
      if (approvalSubtask) {
        await asana.updateApprovalSubtask(approvalSubtask.gid, {
          approval_status: event.reviewState,
        });
      }
    }
  }

  // Changes requested: the task goes back to the queue.
  if (
    event.action === "submitted" &&
    event.reviewState === "changes_requested"
  ) {
    for (const taskId of event.taskIds) {
      await asana.deleteReviewSubtasks(taskId);
      await asana.moveTaskToSection(
        taskId,
        SECTIONS.NEXT,
        SECTIONS.RELEASED_SECTIONS
      );
      await asana.setTaskIncomplete(taskId);
    }
  }

  let cascadeFollowers: string[] = [];
  if (event.action === "submitted" && event.reviewState === "approved") {
    cascadeFollowers = await handleApprovalCascade(event);
  }

  // Followers: reviewer, active tier, mentioned users, cascade additions.
  const { body, mentionedAsanaIds } = buildFormattedBody(event);
  const followers = [...mentionedAsanaIds, ...cascadeFollowers];
  if (reviewer) followers.push(reviewer.asanaId);
  for (const tierReviewer of utils.pickReviewerTier(event.requestedReviewers)) {
    followers.push(tierReviewer.asanaId);
  }
  for (const taskId of event.taskIds) {
    await asana.addFollowers(taskId, followers);
  }

  // Mirror the review itself as a comment.
  const userHTML = format.userMentionHTML(event.username);
  let commentText = "";
  switch (event.reviewState) {
    case "commented":
    case "changes_requested":
      if (!body || event.action === "edited") return;
      commentText = `<body> ${userHTML} is requesting the following <a href="${event.commentUrl}">changes</a>:\n\n${body} </body>`;
      if (event.reviewState === "commented") {
        commentText = `<body> ${userHTML} <a href="${event.commentUrl}">commented</a>:\n\n${body} </body>`;
      }
      break;
    case "approved":
      if (!body) return;
      commentText = `<body> ${userHTML} approved with the following <a href="${event.commentUrl}">comment</a>:\n\n${body} </body>`;
      break;
    default:
      commentText = `<body> <a href="${event.commentUrl}">PR #${event.prNumber}</a> is ${event.reviewState} by ${userHTML} </body>`;
      break;
  }

  await postCommentToTasks(event, commentText);
};
