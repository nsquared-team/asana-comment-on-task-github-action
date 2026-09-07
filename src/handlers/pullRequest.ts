import * as SECTIONS from "../constants/sections";
import * as asana from "../asana";
import * as utils from "../utils";
import { postCommentToTasks } from "./comment";
import { SyncEvent } from "../event";

// No live PR to track (draft, or closed without merging) means the task is
// back with its author.
const moveTasksToInProgress = async (event: SyncEvent) => {
  for (const taskId of event.taskIds) {
    await asana.moveTaskToSection(
      taskId,
      SECTIONS.IN_PROGRESS,
      SECTIONS.PROTECTED_FROM_DRAFT
    );
  }
};

const moveTasksToReview = async (event: SyncEvent, activeTier: any[]) => {
  for (const taskId of event.taskIds) {
    await asana.moveTaskToSection(taskId, SECTIONS.TESTING_REVIEW);
    for (const reviewer of activeTier) {
      await asana.addRequestedReview(taskId, reviewer, event.prUrl);
    }
  }
};

const HANDLED_ACTIONS = [
  "opened",
  "reopened",
  "converted_to_draft",
  "ready_for_review",
  "review_requested",
  "closed",
];

export const handlePullRequest = async (event: SyncEvent) => {
  if (!HANDLED_ACTIONS.includes(event.action)) return;

  const activeTier = utils.pickReviewerTier(event.requestedReviewers);

  // Opened and reopened both mirror whatever state the PR is in right now:
  // draft means the task is being worked on, ready means it is up for review.
  // (Falls through so the "PR is open" comment still posts.)
  if (event.action === "opened" || event.action === "reopened") {
    if (event.isDraft) await moveTasksToInProgress(event);
    else await moveTasksToReview(event, activeTier);
  }

  if (event.action === "converted_to_draft") {
    await moveTasksToInProgress(event);
    // Pending review requests are stale once the author pulls the PR back.
    for (const taskId of event.taskIds) {
      await asana.deleteReviewSubtasks(taskId);
    }
    return;
  }

  // Only a ready-for-review PR puts its task in Testing / Review.
  if (event.action === "ready_for_review") {
    await moveTasksToReview(event, activeTier);
    return;
  }

  if (event.action === "review_requested") {
    if (event.isDraft) return;
    for (const taskId of event.taskIds) {
      await asana.moveTaskToSection(taskId, SECTIONS.TESTING_REVIEW);
      // Each review_requested event carries exactly one reviewer; creating
      // only that reviewer's subtask keeps parallel workflow runs from
      // duplicating each other's subtasks.
      if (
        event.eventReviewer &&
        activeTier.some(
          (reviewer: any) =>
            reviewer.githubName === event.eventReviewer.githubName
        )
      ) {
        await asana.addRequestedReview(
          taskId,
          event.eventReviewer,
          event.prUrl
        );
      }
    }
    return;
  }

  // Only an abandoned PR clears its pending approval subtasks - nobody is
  // waiting on them anymore. A merge deletes nothing: the subtasks are the
  // record of who signed off and who never answered, and an approval given
  // moments before an auto-merge can still read as pending here because the
  // review event that mirrors it runs in a parallel workflow run.
  if (event.action === "closed") {
    const targetSection = event.prMerged
      ? SECTIONS.sectionForMerge(event.repoFullName, event.prBaseRef)
      : SECTIONS.IN_PROGRESS;

    for (const taskId of event.taskIds) {
      if (!event.prMerged) {
        const approvalSubtasks = await asana.getAllApprovalSubtasks(
          taskId,
          asana.ottoUser()
        );
        await asana.deleteApprovalTasks(approvalSubtasks);
      } else {
        // The code is in, so an unanswered review is now an FYI. Relabelling
        // ahead of the section decision is deliberate: a stacked merge ships
        // nothing and moves nothing, but its reviews are just as finished.
        await asana.relabelReviewSubtasksAsFyi(taskId, event.prBaseRef);
      }
      // A merge into a non-release branch ships nothing, so it moves nothing.
      if (!targetSection) continue;
      await asana.moveTaskToSection(
        taskId,
        targetSection,
        // Abandoning a PR must not drag a task out of Blocked or a release
        // column; a merge is allowed to move the task anywhere.
        event.prMerged ? undefined : SECTIONS.PROTECTED_FROM_DRAFT
      );
      // Tasks are never auto-completed: they stay open until verified in
      // production and closed by a human.
    }
  }

  // Comment + followers for opened / reopened / closed.
  const followers: string[] = [];
  const senderUser = utils.findUserByGithubName(event.username);
  if (senderUser) followers.push(senderUser.asanaId);
  for (const reviewer of activeTier) followers.push(reviewer.asanaId);

  let commentText = "";
  if (event.action === "closed" && event.prMerged) {
    commentText = `<body> <a href="${event.prUrl}">PR #${event.prNumber}</a> is merged and ${event.prState}. </body>`;
  } else {
    commentText = `<body> <a href="${event.prUrl}">PR #${event.prNumber}</a> is ${event.prState}. </body>`;
  }

  for (const taskId of event.taskIds) {
    await asana.addFollowers(taskId, followers);
  }
  await postCommentToTasks(event, commentText);
};
