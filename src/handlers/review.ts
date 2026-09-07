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

// Latest definitive review per GitHub login, mapped in the user table or not.
const latestDefinitiveReviews = (reviews: any[]) => {
  const latest: { [login: string]: any } = {};
  for (const review of reviews) {
    if (!DEFINITIVE_REVIEW_STATES.includes(review.state)) continue;
    const login = review.user.login;
    if (!latest[login] || latest[login].submitted_at < review.submitted_at) {
      latest[login] = review;
    }
  }
  return latest;
};

// A PR is fully approved only when every tier has signed off; approvals
// cascade PEER_DEV -> DEV -> QA, creating the next tier's subtasks as the
// previous tier completes.
const handleApprovalCascade = async (event: SyncEvent) => {
  const githubUrl = `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.PULLS_URL}${event.prNumber}`;

  // A conflicting PR has a diff nobody has reviewed yet - resolving the
  // conflict writes it. So while the conflict stands the cascade neither
  // hands the next tier a review nor promotes the task; once it is resolved,
  // standing approvals count again on the next review event.
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
  //
  // An approval is needed only once: it stands until its reviewer changes
  // their own verdict or the review is dismissed. A later changes-request
  // from someone else (otto's included) deliberately does NOT invalidate
  // it - that mirrors GitHub's own semantics, where invalidating on revision
  // is an explicit dismissal, never a side effect of another review.
  const latestReviews: { [githubName: string]: any } = {};
  const latestDefinitive = latestDefinitiveReviews(reviews);
  for (const githubName of Object.keys(latestDefinitive)) {
    const reviewerObj = utils.findUserByGithubName(githubName);
    if (!reviewerObj) continue;
    latestReviews[githubName] = {
      state: latestDefinitive[githubName].state,
      timestamp: latestDefinitive[githubName].submitted_at,
      info: reviewerObj,
    };
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

  // A dismissed approval blocks its tier, but nothing summons its reviewer
  // back: they are no longer in requested_reviewers and their old subtask is
  // answered - so nobody re-requests them by hand and the cascade deadlocks
  // silently. Re-requesting their review here fires review_requested, whose
  // handler re-creates the "Review" subtask once their tier is active - the
  // same single path every other summons takes. A standing changes-request
  // is deliberately not resummoned: the author answers it and re-requests.
  // (The requested_reviewers pass above already replaced anyone pending
  // with PENDING, so this only reaches reviewers nobody has re-requested.)
  for (const githubName of Object.keys(latestReviews)) {
    const review = latestReviews[githubName];
    if (review.state !== "DISMISSED") continue;
    if (!utils.isReviewTier(review.info)) continue;
    try {
      await githubAxios.post(`${githubUrl}${REQUESTS.REVIEWERS_URL}`, {
        reviewers: [githubName],
      });
    } catch (error) {
      // One unreachable reviewer must not stall the tally or the sync.
      console.warn(`Failed to re-request a review from ${githubName}:`, error);
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

// Every handler mirrors one transition. This runs after each of them and
// restates the invariant they all approximate: a pull request that is open,
// ready, mergeable, green and under no standing changes-request is in
// review, so each active-tier reviewer GitHub is still waiting on holds a
// pending Review subtask and the task sits in Testing / Review. It is what
// puts the approvals back once a conflict is resolved, and what repairs a
// transition that a missed or overlapping event left half-done. It reads
// the PR fresh rather than trusting the payload: a parallel run may have
// moved the PR on since the webhook fired.
export const reconcileReviewState = async (event: SyncEvent) => {
  if (!event.taskIds.length || !event.isPullRequest) return;

  const githubUrl = `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.PULLS_URL}${event.prNumber}`;
  const pullRequest = (await githubAxios.get(githubUrl)).data;
  if (pullRequest.state !== "open" || pullRequest.draft) return;
  // Unknown mergeability is not evidence here. The cascade reads it as
  // mergeable so an unanswered GitHub never parks a task; acting on it after
  // a conflict alert would hand back the very subtasks the alert cleared.
  if (pullRequest.mergeable !== true) return;

  const requestedLogins: string[] = (pullRequest.requested_reviewers || []).map(
    (reviewer: any) => reviewer.login
  );
  const activeTier = utils.pickReviewerTier(
    requestedLogins.map(utils.findUserByGithubName)
  );
  if (!activeTier.length) return;

  // A changes-request parks the task until the author re-requests that
  // reviewer - whoever made it, since the review handler parks on any.
  const reviews = (await githubAxios.get(`${githubUrl}${REQUESTS.REVIEWS_URL}`))
    .data;
  const latest = latestDefinitiveReviews(reviews);
  const changesRequestStands = Object.keys(latest).some(
    (login) =>
      latest[login].state === "CHANGES_REQUESTED" &&
      !requestedLogins.includes(login)
  );
  if (changesRequestStands) return;

  const otto = asana.ottoUser();
  for (const taskId of event.taskIds) {
    const ciSubtask = await asana.getApprovalSubtask(taskId, true, otto);
    if (ciSubtask?.approval_status === "rejected") continue;
    await asana.moveTaskToSection(taskId, SECTIONS.TESTING_REVIEW, [
      ...SECTIONS.BLOCKED_SECTIONS,
      ...SECTIONS.RELEASED_SECTIONS,
    ]);
    for (const reviewer of activeTier) {
      await asana.addRequestedReview(taskId, reviewer, event.prUrl);
    }
  }
};
