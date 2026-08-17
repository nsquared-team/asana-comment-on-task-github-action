import githubAxios from "../requests/githubAxios";
import * as REQUESTS from "../constants/requests";
import * as SECTIONS from "../constants/sections";
import * as asana from "../asana";
import * as utils from "../utils";
import * as format from "../format";
import { buildFormattedBody, postCommentToTasks } from "./comment";
import { SyncEvent } from "../event";

const SUBTASK_REVIEW_STATES = ["approved", "pending", "changes_requested"];

const DEFINITIVE_REVIEW_STATES = ["CHANGES_REQUESTED", "APPROVED", "DISMISSED"];

// A PR is fully approved only when every tier has signed off; approvals
// cascade PEER_DEV -> DEV -> QA, creating the next tier's subtasks as the
// previous tier completes.
const handleApprovalCascade = async (event: SyncEvent) => {
  const githubUrl = `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.PULLS_URL}${event.prNumber}`;

  // A conflicting PR has a diff nobody has reviewed yet - resolving the
  // conflict writes it. So no approval counts while the conflict stands: the
  // cascade neither hands the next tier a review nor promotes the task, and
  // the tier that already approved has to approve the resolved code again.
  // GitHub computes mergeability asynchronously and answers `null` until it
  // has, which reads as mergeable - otto's conflict alert is the signal that
  // parks the task, this guard only refuses to un-park it.
  const pullRequestResponse = await githubAxios.get(githubUrl);
  if (pullRequestResponse.data.mergeable === false) return [];

  const reviewsResponse = await githubAxios.get(
    `${githubUrl}${REQUESTS.REVIEWS_URL}`
  );
  const reviews = reviewsResponse.data;

  // Latest definitive review per reviewer. A dismissed approval has to stay
  // in the tally as "no longer approved" - dropping the reviewer entirely
  // would let their vacated slot read as satisfied.
  const latestReviews: { [githubName: string]: any } = {};
  let lastChangesRequestedAt = "";
  for (const review of reviews) {
    const githubName = review.user.login;
    const reviewerObj = utils.findUserByGithubName(githubName);
    if (!reviewerObj) continue;
    if (!DEFINITIVE_REVIEW_STATES.includes(review.state)) continue;
    if (
      review.state === "CHANGES_REQUESTED" &&
      review.submitted_at > lastChangesRequestedAt
    ) {
      lastChangesRequestedAt = review.submitted_at;
    }
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

  // An approval vouches only for the code that existed when it was given.
  // Once someone requests changes the PR is being revised, so every approval
  // that predates the newest standing changes-request (otto's included)
  // drops out of the tally until its reviewer approves again.
  for (const githubName of Object.keys(latestReviews)) {
    const review = latestReviews[githubName];
    if (
      review.state === "APPROVED" &&
      review.timestamp <= lastChangesRequestedAt
    ) {
      review.state = "STALE_APPROVED";
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
    // Only the three human tiers gate the cascade. Bots review every PR
    // here, and bucketing them into whichever tier the fallback happened to
    // land on made their verdict silently block a tier they never sat in.
    const team = review.info.team;
    if (team === "PEER_DEV") approvedByPeer = false;
    else if (team === "DEV") approvedByDev = false;
    else if (team === "QA") approvedByQa = false;
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

  // With no reviews at all every tier flag stays true by default, so the
  // promotion needs positive evidence: an approval from someone who actually
  // sits in a review tier. A bot's or an unmapped user's approval is not a
  // human sign-off and can never promote on its own.
  const hasTierApproval = Object.values(latestReviews).some(
    (review: any) =>
      review.state === "APPROVED" && utils.isReviewTier(review.info)
  );

  if (hasTierApproval && approvedByPeer && approvedByDev && approvedByQa) {
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
        SECTIONS.PROTECTED_FROM_DEMOTION
      );
      await asana.setTaskIncomplete(taskId);
    }
  }

  // A dismissed approval un-approves the PR, so the task cannot stay in
  // Approved waiting on a sign-off that no longer exists.
  if (event.action === "dismissed" && !event.isDraft) {
    for (const taskId of event.taskIds) {
      await asana.moveTaskToSection(
        taskId,
        SECTIONS.TESTING_REVIEW,
        SECTIONS.PROTECTED_FROM_DEMOTION
      );
    }
  }

  // The ready-for-review invariant extends to approvals: reviews submitted
  // on a draft PR never cascade or promote the task.
  let cascadeFollowers: string[] = [];
  if (
    event.action === "submitted" &&
    event.reviewState === "approved" &&
    !event.isDraft
  ) {
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
      // An edited review still posts: postCommentToTasks matches the story by
      // review URL and updates it in place.
      if (!body) return;
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
