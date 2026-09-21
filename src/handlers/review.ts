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

const OTTO_LOGIN = "otto-bot-git";

const pullRequestUrl = (event: SyncEvent) =>
  `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.PULLS_URL}${event.prNumber}`;

// GitHub pages its lists, so one read of a long PR's reviews or timeline
// would drop the latest entries - the ones a verdict turns on.
const readAllPages = async (url: string, pageSize: number) => {
  const entries: any[] = [];
  for (let page = 1; ; page++) {
    const batch = (await githubAxios.get(`${url}&page=${page}`)).data;
    entries.push(...batch);
    if (batch.length < pageSize) return entries;
  }
};

// A review its author has not submitted yet carries no time and no verdict,
// and one from an account GitHub has since deleted carries no user; neither
// can count for anyone, so no reader has to guard against them.
const readReviews = async (githubUrl: string) => {
  const reviews = await readAllPages(
    `${githubUrl}${REQUESTS.REVIEWS_URL}`,
    REQUESTS.REVIEWS_PAGE_SIZE
  );
  return reviews.filter(
    (review: any) => review.user?.login && review.submitted_at
  );
};

// Otto's standing verdict on the PR. It requests changes on a new Critical
// or High finding, approves on none, and files anything in between as a
// comment-only report. That report answers a request without proving the
// earlier findings fixed, so it inherits a changes-request that stands and
// otherwise counts as an approval. A dismissed review is withdrawn whichever
// way it went: a person overruled otto's changes-request, or its approval no
// longer counts and the dismissal asked otto again (see the dismissed
// handler), which is what keeps the stage closed.
const ottoVerdict = (reviews: any[]) => {
  const own = reviews
    .filter((review: any) => review.user.login === OTTO_LOGIN)
    .sort((a: any, b: any) => a.submitted_at.localeCompare(b.submitted_at));
  let verdict: string | undefined;
  for (const review of own) {
    if (review.state === "DISMISSED") continue;
    if (review.state !== "COMMENTED") verdict = review.state;
    else if (verdict !== "CHANGES_REQUESTED") verdict = "APPROVED";
  }
  return verdict;
};

// Otto answers a request with an approval or with a comment-only report.
const ottoAnswered = (event: SyncEvent) =>
  event.username === OTTO_LOGIN &&
  ["approved", "commented"].includes(event.reviewState);

// Otto reviews before the peer developers on the PRs it is added to. While
// GitHub still waits on it, or its standing verdict is a changes-request,
// the PR may still need work, so no human tier is handed a Review subtask
// and the task is not promoted. A PR otto was never asked onto and has no
// standing verdict on is not waiting on it: the cascade runs PEER_DEV -> DEV
// -> QA as before. Asking otto again after it approved closes the stage
// until it answers; the subtasks already handed out stay. Dismissing otto's
// approval re-requests it once, as for any reviewer; dismissing its
// changes-request overrules it, and otto is not asked again. Otherwise the
// author asks it again by hand, once the PR is ready for another pass.
const awaitingOtto = (reviews: any[], requestedReviewers: any[]) => {
  if (requestedReviewers.some((r: any) => r.githubName === OTTO_LOGIN)) {
    return true;
  }
  const verdict = ottoVerdict(reviews);
  return Boolean(verdict) && verdict !== "APPROVED";
};

// The handlers that hand out reviews from the webhook payload alone read the
// reviews here, and only when there is someone to call and a task to call
// them on.
export const reviewersToCall = async (event: SyncEvent, reviewers: any[]) => {
  if (!reviewers.length || !event.taskIds.length) return [];
  let reviews: any[];
  try {
    reviews = await readReviews(pullRequestUrl(event));
  } catch (error) {
    // Losing the read must neither stall the sync nor call a peer onto a PR
    // otto may still be reviewing: nobody is called this run, and the next
    // event's re-check puts that right.
    console.warn("Failed to read the reviews:", error);
    return [];
  }
  return awaitingOtto(reviews, event.requestedReviewers) ? [] : reviewers;
};

// A "Comment" review from a tier reviewer is a rejection here: they looked
// and did not approve, so the author answers it and re-requests them, exactly
// as for changes requested. GitHub files every inline comment as a review of
// its own, a lone reply in an existing thread included, so a comment review
// with no summary counts only when it opened a thread. The author annotating
// their own diff is never a verdict.
const isTierComment = (review: any, author: string) =>
  review.state === "COMMENTED" &&
  review.user.login !== author &&
  utils.isReviewTier(utils.findUserByGithubName(review.user.login));

const verdictOf = (review: any, author: string, threadOpeners: Set<number>) =>
  isTierComment(review, author) &&
  (review.body?.trim() || threadOpeners.has(review.id))
    ? "CHANGES_REQUESTED"
    : review.state;

// The reviews that opened a thread, read only when a verdict depends on it:
// a tier reviewer's comment review with no summary.
const findThreadOpeners = async (
  githubUrl: string,
  reviews: any[],
  author: string
) => {
  const openers = new Set<number>();
  const needed = reviews.some(
    (review) => isTierComment(review, author) && !review.body?.trim()
  );
  if (!needed) return openers;
  const comments = await readAllPages(
    `${githubUrl}${REQUESTS.REVIEW_COMMENTS_URL}`,
    REQUESTS.REVIEW_COMMENTS_PAGE_SIZE
  );
  for (const comment of comments) {
    if (!comment.in_reply_to_id) openers.add(comment.pull_request_review_id);
  }
  return openers;
};

// Latest definitive review per GitHub login, mapped in the user table or not.
const latestDefinitiveReviews = (
  reviews: any[],
  author: string,
  threadOpeners: Set<number>
) => {
  const latest: { [login: string]: any } = {};
  for (const review of reviews) {
    const login = review.user.login;
    const state = verdictOf(review, author, threadOpeners);
    if (!DEFINITIVE_REVIEW_STATES.includes(state)) continue;
    if (!latest[login] || latest[login].submitted_at < review.submitted_at) {
      latest[login] = { ...review, state };
    }
  }
  return latest;
};

// Latest definitive review per mapped reviewer. A dismissed approval has to
// stay in the tally as "no longer approved" - dropping the reviewer entirely
// would let their vacated slot read as satisfied. Anyone GitHub still lists
// as requested is pending, unless their latest review already approved: the
// approval keeps gating the tiers, but being asked again is recorded, and
// the task is not done while GitHub still waits on a tier reviewer.
//
// An approval is needed only once: it stands until its reviewer changes
// their own verdict or the review is dismissed. A later changes-request
// from someone else (otto's included) deliberately does NOT invalidate
// it - that mirrors GitHub's own semantics, where invalidating on revision
// is an explicit dismissal, never a side effect of another review.
const tallyReviews = (
  reviews: any[],
  requestedReviewers: any[],
  author: string,
  threadOpeners: Set<number>
) => {
  const latestReviews: { [githubName: string]: any } = {};
  const latestDefinitive = latestDefinitiveReviews(
    reviews,
    author,
    threadOpeners
  );
  for (const githubName of Object.keys(latestDefinitive)) {
    const reviewerObj = utils.findUserByGithubName(githubName);
    if (!reviewerObj) continue;
    latestReviews[githubName] = {
      state: latestDefinitive[githubName].state,
      timestamp: latestDefinitive[githubName].submitted_at,
      info: reviewerObj,
    };
  }
  for (const reviewer of requestedReviewers) {
    const existing = latestReviews[reviewer.githubName];
    if (!existing || existing.state !== "APPROVED") {
      latestReviews[reviewer.githubName] = {
        state: "PENDING",
        timestamp: null,
        info: reviewer,
      };
    }
    latestReviews[reviewer.githubName].requested = true;
  }
  return latestReviews;
};

// Whether GitHub asked this reviewer again after the review this run is for.
//
// `requested_reviewers` alone cannot answer it. GitHub takes a reviewer off
// that list when they review and puts them back when they are re-requested,
// but stamps no time on either, so the run for an approval sees one list that
// names the approver and cannot tell which of the two put them there: a read
// taken before GitHub caught up, or the author genuinely asking again. The
// timeline is the only place a request carries a time, so it is what decides,
// rather than a guess about which read was fresher. The review's own time is
// the event's: a timeline that has not caught up on the review yet must not
// read the request that preceded it as the newer fact.
//
// An unreadable timeline answers true: the approver stays listed, as they did
// before this check existed. The spare Review that costs is put right by the
// next event's re-check; a task promoted past a live reviewer would sit in
// Approved until that same re-check, and someone may merge on it meanwhile.
const readTimeline = (event: SyncEvent) =>
  readAllPages(
    `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.ISSUES_URL}${event.prNumber}${REQUESTS.TIMELINE_URL}`,
    REQUESTS.TIMELINE_PAGE_SIZE
  );

const wasRerequestedAfterReview = async (
  event: SyncEvent,
  githubName: string
) => {
  let entries: any[];
  try {
    entries = await readTimeline(event);
  } catch (error) {
    // The timeline only sharpens a guess; losing it must not stall the sync.
    console.warn(`Failed to read the timeline for ${githubName}:`, error);
    return true;
  }
  let lastRequestedAt = "";
  for (const entry of entries) {
    if (entry.requested_reviewer?.login !== githubName) continue;
    if (entry.event === "review_requested") {
      lastRequestedAt = entry.created_at;
    }
    // A request GitHub withdrew is not a request, and the withdrawal is
    // the later fact about that reviewer.
    if (entry.event === "review_request_removed") lastRequestedAt = "";
  }
  return lastRequestedAt > event.reviewSubmittedAt;
};

// What the review a dismissal is for had said. GitHub's payload and its
// reviews list report every dismissed review the same, so the timeline's
// entry for the dismissal is what tells otto's dismissed approval, which
// summons it back like a reviewer's, from its dismissed changes-request,
// which a person dismissed to overrule and otto is not asked to file again.
// An entry not there yet, or an unreadable timeline, answers true: asking
// otto once too often costs it a pass, while not asking it would open the
// peer stage on an approval that no longer stands.
const wasApprovalDismissed = async (event: SyncEvent) => {
  let entries: any[];
  try {
    entries = await readTimeline(event);
  } catch (error) {
    console.warn("Failed to read the timeline for the dismissal:", error);
    return true;
  }
  const dismissal = entries.find(
    (entry: any) =>
      entry.event === "review_dismissed" &&
      entry.dismissed_review?.review_id === event.reviewId
  );
  return !dismissal || dismissal.dismissed_review.state === "approved";
};

// A dismissed review blocks its tier, but nothing summons its reviewer
// back: they are no longer in requested_reviewers and their old subtask is
// answered - so nobody re-requests them by hand and the tally deadlocks
// silently. The dismissal re-requests them, which fires review_requested,
// whose handler re-creates the "Review" subtask once their tier is active -
// the same single path every other summons takes. Once, from the dismissal
// only: GitHub reports every dismissed review as DISMISSED whatever it was,
// so re-requesting from the tally would summon the reviewer back on every
// event, even after the author took them off the PR on purpose.
const rerequestReviewer = async (githubUrl: string, githubName: string) => {
  try {
    await githubAxios.post(`${githubUrl}${REQUESTS.REVIEWERS_URL}`, {
      reviewers: [githubName],
    });
  } catch (error) {
    // One unreachable reviewer must not stall the sync.
    console.warn(`Failed to re-request a review from ${githubName}:`, error);
  }
};

// Only the three human tiers gate the cascade. Bots review every PR here,
// and bucketing them into whichever tier the fallback happened to land on
// made their verdict silently block a tier they never sat in.
// With no reviews at all every tier flag stays true by default, so the
// promotion needs positive evidence: an approval from someone who actually
// sits in a review tier. A bot's or an unmapped user's approval is not a
// human sign-off and can never promote on its own.
const tierVerdict = (latestReviews: { [githubName: string]: any }) => {
  let approvedByPeer = true;
  let approvedByDev = true;
  let approvedByQa = true;
  for (const githubName of Object.keys(latestReviews)) {
    const review = latestReviews[githubName];
    if (review.state === "APPROVED") continue;
    const team = review.info.team;
    if (team === "PEER_DEV") approvedByPeer = false;
    else if (team === "DEV") approvedByDev = false;
    else if (team === "QA") approvedByQa = false;
  }
  const hasTierApproval = Object.values(latestReviews).some(
    (review: any) =>
      review.state === "APPROVED" && utils.isReviewTier(review.info)
  );
  const awaitsTierReviewer = Object.values(latestReviews).some(
    (review: any) => review.requested && utils.isReviewTier(review.info)
  );
  return {
    approvedByPeer,
    approvedByDev,
    approvedByQa,
    fullyApproved:
      hasTierApproval &&
      approvedByPeer &&
      approvedByDev &&
      approvedByQa &&
      !awaitsTierReviewer,
  };
};

// A PR is fully approved only when every tier has signed off; approvals
// cascade PEER_DEV -> DEV -> QA, creating the next tier's subtasks as the
// previous tier completes. `requestedReviewers` is who GitHub still waits on
// once this approval is in.
const handleApprovalCascade = async (
  event: SyncEvent,
  requestedReviewers: any[]
) => {
  const githubUrl = pullRequestUrl(event);

  // A conflicting PR has a diff nobody has reviewed yet - resolving the
  // conflict writes it. So while the conflict stands the cascade neither
  // hands the next tier a review nor promotes the task; once it is resolved,
  // standing approvals count again on the next review event.
  // GitHub computes mergeability asynchronously and answers `null` until it
  // has, which reads as mergeable - otto's conflict alert is the signal that
  // parks the task, this guard only refuses to un-park it.
  const pullRequestResponse = await githubAxios.get(githubUrl);
  if (pullRequestResponse.data.mergeable === false) return [];

  const author = pullRequestResponse.data.user?.login;
  const reviews = await readReviews(githubUrl);
  // Otto's stage comes first: while the PR waits on it the cascade hands no
  // tier a review and promotes nothing, like the conflict guard above.
  if (awaitingOtto(reviews, requestedReviewers)) return [];

  const threadOpeners = await findThreadOpeners(githubUrl, reviews, author);
  const latestReviews = tallyReviews(
    reviews,
    requestedReviewers,
    author,
    threadOpeners
  );
  const { approvedByPeer, approvedByDev, approvedByQa, fullyApproved } =
    tierVerdict(latestReviews);

  const devReviewers = requestedReviewers.filter(
    (reviewer: any) => reviewer.team === "DEV"
  );
  const qaReviewers = requestedReviewers.filter(
    (reviewer: any) => reviewer.team === "QA"
  );

  const followers: string[] = [];

  // Otto's answer opening the stage is what calls the peers: they were
  // requested while the PR still waited on otto, so that request called
  // nobody. Whoever GitHub still waits on in the tier is called, and one
  // already holding a Review is never handed a second. DEV and QA follow
  // from the peers' approvals below, as on any PR.
  if (ottoAnswered(event)) {
    const peerReviewers = requestedReviewers.filter(
      (reviewer: any) => reviewer.team === "PEER_DEV"
    );
    for (const reviewer of peerReviewers) followers.push(reviewer.asanaId);
    for (const taskId of event.taskIds) {
      await asana.addRequestedReviews(taskId, peerReviewers, event.prUrl);
    }
  }

  if (approvedByPeer && !approvedByDev) {
    for (const reviewer of devReviewers) followers.push(reviewer.asanaId);
    for (const taskId of event.taskIds) {
      await asana.addRequestedReviews(taskId, devReviewers, event.prUrl);
    }
  }

  if (approvedByPeer && approvedByDev && !approvedByQa) {
    for (const reviewer of qaReviewers) followers.push(reviewer.asanaId);
    for (const taskId of event.taskIds) {
      await asana.addRequestedReviews(taskId, qaReviewers, event.prUrl);
    }
  }

  if (fullyApproved) {
    for (const taskId of event.taskIds) {
      await asana.moveTaskToSection(taskId, SECTIONS.APPROVED);
    }
  }

  return followers;
};

export const handleReview = async (event: SyncEvent) => {
  const reviewer = utils.findUserByGithubName(event.username);
  const review = {
    id: event.reviewId,
    state: event.reviewState.toUpperCase(),
    body: event.reviewBody,
    user: { login: event.username },
  };
  const threadOpeners = await findThreadOpeners(
    pullRequestUrl(event),
    [review],
    event.prAuthor
  );
  const verdict = verdictOf(
    review,
    event.prAuthor,
    threadOpeners
  ).toLowerCase();

  // GitHub's payload still lists this review's reviewer as requested: the
  // list is read before the review takes them off it. The review is the
  // fresher fact, so its reviewer is not requested in this run. Counting
  // them handed an approver a second Review as their approval was being
  // mirrored: their just-answered subtask looked like a request nobody had
  // served.
  const stillRequested = event.requestedReviewers.filter(
    (requested: any) => requested.githubName !== event.username
  );

  // Mirror the reviewer's verdict onto their approval subtask.
  if (event.action === "submitted" && SUBTASK_REVIEW_STATES.includes(verdict)) {
    const activeTier = utils.pickReviewerTier(stillRequested);
    for (const taskId of event.taskIds) {
      const approvalSubtask = await asana.getApprovalSubtask(
        taskId,
        false,
        reviewer
      );
      if (approvalSubtask) {
        await asana.updateApprovalSubtask(approvalSubtask.gid, {
          approval_status: verdict,
        });
      }
      // An approval takes its reviewer off GitHub's list without summoning
      // anyone, so the add helper may never run: one of two peers signing off
      // leaves a single reviewer holding the PR and nothing to retitle them.
      // The re-check would, but it stands down while GitHub has yet to say the
      // PR is mergeable. Only an approval leaves a pending subtask to retitle:
      // a changes-request clears the whole set just below, and naming a
      // blocker here only to delete it would notify the reviewer of a title
      // that never mattered.
      if (verdict === "approved") {
        await asana.syncBlockingReviewTitles(taskId, activeTier);
      }
    }
  }

  // Changes requested: the task goes back to the queue.
  if (event.action === "submitted" && verdict === "changes_requested") {
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
  // Approved waiting on a sign-off that no longer exists. Its reviewer is
  // summoned back here, unless someone already re-requested them by hand -
  // otto included when it is its approval that was dismissed, since that
  // closes the peer stage; its dismissed changes-request was overruled.
  if (event.action === "dismissed" && !event.isDraft) {
    for (const taskId of event.taskIds) {
      await asana.moveTaskToSection(
        taskId,
        SECTIONS.TESTING_REVIEW,
        SECTIONS.PROTECTED_FROM_DEMOTION
      );
    }
    const alreadyRequested = event.requestedReviewers.some(
      (requested: any) => requested.githubName === event.username
    );
    if (reviewer && !alreadyRequested) {
      const summonsBack =
        utils.isReviewTier(reviewer) ||
        (event.username === OTTO_LOGIN && (await wasApprovalDismissed(event)));
      if (summonsBack) {
        await rerequestReviewer(pullRequestUrl(event), reviewer.githubName);
      }
    }
  }

  // The ready-for-review invariant extends to approvals: reviews submitted
  // on a draft PR never cascade or promote the task. Otto's comment-only
  // report runs the cascade the way its approval does: it is otto's answer,
  // and whether it opens the stage is its standing verdict's call.
  let cascadeFollowers: string[] = [];
  if (
    event.action === "submitted" &&
    (event.reviewState === "approved" || ottoAnswered(event)) &&
    !event.isDraft
  ) {
    cascadeFollowers = await handleApprovalCascade(event, stillRequested);
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
// pending Review subtask and the task sits in Testing / Review - or in
// Approved once every tier has signed off. Unless the PR is waiting on otto,
// whose stage comes first: then the task is in review and nobody else is
// called yet. It is what puts the approvals
// back once a conflict is resolved, and what repairs a transition that a
// missed or overlapping event left half-done. It reads the PR fresh rather
// than trusting the payload: a parallel run may have moved the PR on since
// the webhook fired.
export const reconcileReviewState = async (event: SyncEvent) => {
  if (!event.taskIds.length || !event.isPullRequest) return;

  const githubUrl = pullRequestUrl(event);
  const pullRequest = (await githubAxios.get(githubUrl)).data;
  if (pullRequest.state !== "open" || pullRequest.draft) return;
  // Unknown mergeability is not evidence here. The cascade reads it as
  // mergeable so an unanswered GitHub never parks a task; acting on it after
  // a conflict alert would hand back the very subtasks the alert cleared.
  if (pullRequest.mergeable !== true) return;

  // The run for an approval reads the PR before GitHub has taken the approver
  // off its list; the approval is the fresher fact, so the approver is not
  // requested in this run and is handed no second "Review".
  //
  // Unless GitHub really was asked to summon them again, which the timeline
  // is what settles. The stale entry and a genuine re-request put the same
  // login in the same list, so dropping it on the shape of the event alone
  // would promote the task to Approved while GitHub still waits on that
  // reviewer, and it would sit there until the next event's re-check.
  //
  // The timeline is read only when there is something to settle: an answer
  // with the fresh list still naming its reviewer - a tier reviewer's
  // approval, or otto's approval or comment-only report, since its listing
  // decides whether the peers are called. Once GitHub has caught up there is
  // no entry to explain.
  const listed: any[] = pullRequest.requested_reviewers || [];
  const approverStillListed =
    event.eventName === "pull_request_review" &&
    event.action === "submitted" &&
    ((event.reviewState === "approved" &&
      utils.isReviewTier(utils.findUserByGithubName(event.username))) ||
      ottoAnswered(event)) &&
    listed.some((reviewer: any) => reviewer.login === event.username);
  const justApproved =
    approverStillListed &&
    !(await wasRerequestedAfterReview(event, event.username as string))
      ? event.username
      : undefined;
  const requestedLogins: string[] = listed
    .map((reviewer: any) => reviewer.login)
    .filter((login: string) => login !== justApproved);
  const requestedReviewers = requestedLogins
    .map(utils.findUserByGithubName)
    .filter(Boolean);
  const activeTier = utils.pickReviewerTier(requestedReviewers);

  // A changes-request parks the task until the author re-requests that
  // reviewer - whoever made it, since the review handler parks on any.
  const reviews = await readReviews(githubUrl);
  const author = pullRequest.user?.login;
  const threadOpeners = await findThreadOpeners(githubUrl, reviews, author);
  const latest = latestDefinitiveReviews(reviews, author, threadOpeners);
  const changesRequestStands = Object.keys(latest).some(
    (login) =>
      latest[login].state === "CHANGES_REQUESTED" &&
      !requestedLogins.includes(login)
  );
  if (changesRequestStands) return;

  const latestReviews = tallyReviews(
    reviews,
    requestedReviewers,
    author,
    threadOpeners
  );
  const { fullyApproved } = tierVerdict(latestReviews);
  const waitingOnOtto = awaitingOtto(reviews, requestedReviewers);
  // An approver asked again keeps their approval in the tally, but GitHub
  // is waiting on them: their fresh Review subtask stays pending.
  const approvedAsanaIds = Object.values(latestReviews)
    .filter((review: any) => review.state === "APPROVED" && !review.requested)
    .map((review: any) => review.info.asanaId);

  const otto = asana.ottoUser();
  const leaveAlone = [
    ...SECTIONS.BLOCKED_SECTIONS,
    ...SECTIONS.RELEASED_SECTIONS,
    SECTIONS.DONE,
  ];
  for (const taskId of event.taskIds) {
    // A task a person closed is finished, whatever its pull request says.
    if ((await asana.getTask(taskId)).completed) continue;
    const ciSubtask = await asana.getApprovalSubtask(taskId, true, otto);
    if (ciSubtask?.approval_status === "rejected") continue;

    // A review whose run overlapped the run creating its subtask mirrored
    // its verdict onto nothing, leaving a pending approval nobody will
    // answer. GitHub's verdict wins.
    for (const subtask of await asana.getAllApprovalSubtasks(taskId, otto)) {
      if (
        asana.isPendingReviewSubtask(subtask) &&
        approvedAsanaIds.includes(subtask.assignee?.gid)
      ) {
        await asana.updateApprovalSubtask(subtask.gid, {
          approval_status: "approved",
        });
      }
    }
    // This read of GitHub's list is the fresh one, so it is where a title a
    // handler set from a stale payload is put right - on the two exits below
    // as well, which never reach the add helper.
    await asana.syncBlockingReviewTitles(taskId, activeTier);

    if (fullyApproved && !waitingOnOtto) {
      await asana.moveTaskToSection(taskId, SECTIONS.APPROVED, leaveAlone);
      continue;
    }
    if (!activeTier.length) continue;
    await asana.moveTaskToSection(taskId, SECTIONS.TESTING_REVIEW, leaveAlone);
    if (waitingOnOtto) continue;
    await asana.addRequestedReviews(taskId, activeTier, event.prUrl);
  }
};
