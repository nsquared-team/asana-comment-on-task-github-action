import githubAxios from "../requests/githubAxios";
import * as REQUESTS from "../constants/requests";
import * as SECTIONS from "../constants/sections";
import * as asana from "../asana";
import { ciSubtaskNotes, isCurrentCommit } from "../ciGate";
import { SyncEvent } from "../event";

// CI runs fire on these pull_request actions in the consumer workflows.
const CI_ACTIONS = ["opened", "synchronize", "reopened", "ready_for_review"];

const editPrDescription = async (event: SyncEvent) => {
  const today = new Date();
  const [date, time] = today.toISOString().split("T");
  const formattedDate = `${date} ${time.substring(0, 5)} UTC`;
  const sandboxSection = `## CI/QA Testing Sandbox (${formattedDate}) ## \n ${event.prDescriptionInput}`;

  const githubUrl = `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.PULLS_URL}${event.prNumber}`;
  const prResponse = await githubAxios.get(githubUrl);
  const currentBody = prResponse.data.body || "";

  // The span and the guard look wrong in isolation and are not: ssa-plugin
  // writes a block TWICE per CI run (ci.yml:956 untested zips, ci.yml:1672
  // sandbox sites), and both end with the same closing sentence. "A list of
  // unique sandbox sites was created" appears only in the second, so the guard
  // reads as "has the second job run yet". First job of a run collapses both
  // stale blocks into its own; second job finds no guard string and appends.
  // Two blocks, both current. Narrowing either half to one block leaves the
  // first frozen with its expiring S3 links - or deletes it outright.
  //
  // Only the replacement changes: as a string, a `$&` in prDescriptionInput
  // expanded to the whole matched block and copied it back into the PR body.
  let body = "";
  if (currentBody.includes("A list of unique sandbox sites was created")) {
    body = currentBody.replace(
      /## CI\/QA Testing Sandbox(.|\n|\r)*Please comment and open a new review on this pull request if you find any issues when testing the preview release zip files./gi,
      () => sandboxSection
    );
  } else {
    body = currentBody.concat(`\n\n${sandboxSection}`);
  }

  await githubAxios.patch(githubUrl, { body });
};

// A red parks the task and clears the reviews asked for the commit it broke.
// Answered reviews are completed subtasks, which the delete leaves alone.
const parkTask = async (taskId: string) => {
  await asana.deleteReviewSubtasks(taskId);
  await asana.moveTaskToSection(
    taskId,
    SECTIONS.NEXT,
    SECTIONS.PROTECTED_FROM_DEMOTION
  );
};

export const handleCiStatus = async (event: SyncEvent) => {
  if (!CI_ACTIONS.includes(event.action)) return;

  if (event.ciStatus === "edit_pr_description") {
    await editPrDescription(event);
    return;
  }

  const otto = asana.ottoUser();
  const taskNotes = ciSubtaskNotes(event);

  for (const taskId of event.taskIds) {
    // The record holds CI's latest word on the task: pending while a run is
    // testing a commit, then the verdict it reached.
    const ciSubtask = await asana.getCiSubtask(taskId);
    const previous = ciSubtask?.approval_status;

    // The red stands until CI reports again: that report is what tells the
    // green that follows that CI, not a person, parked the task.
    if (event.ciStatus === "pending" && previous === "rejected") continue;

    if (event.ciStatus === "rejected") await parkTask(taskId);

    if (ciSubtask) {
      await asana.updateApprovalSubtask(ciSubtask.gid, {
        due_on: new Date().toISOString().substring(0, 10),
        approval_status: event.ciStatus,
        html_notes: `<body>${taskNotes}</body>`,
      });
    } else {
      await asana.addApprovalTask(
        taskId,
        otto,
        asana.CI_SUBTASK_NAME,
        event.ciStatus,
        taskNotes
      );
    }

    // CI recovered, or finished the run it announced: only a ready PR whose
    // head is the tested commit re-enters review. Reviewers are called by the
    // re-check that follows, from GitHub's fresh list.
    if (
      event.ciStatus === "approved" &&
      (previous === "rejected" || previous === "pending") &&
      !event.isDraft &&
      (await isCurrentCommit(event, event.headSha))
    ) {
      // After a red only a review or release position is protected; after a
      // pending run the task may be parked for a changes-request or a
      // conflict, and stays parked.
      await asana.moveTaskToSection(
        taskId,
        SECTIONS.TESTING_REVIEW,
        previous === "rejected"
          ? [SECTIONS.APPROVED, ...SECTIONS.RELEASED_SECTIONS]
          : [
              SECTIONS.NEXT,
              SECTIONS.APPROVED,
              ...SECTIONS.BLOCKED_SECTIONS,
              ...SECTIONS.RELEASED_SECTIONS,
              SECTIONS.DONE,
            ]
      );
    }
  }
};
