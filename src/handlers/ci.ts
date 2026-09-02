import githubAxios from "../requests/githubAxios";
import * as REQUESTS from "../constants/requests";
import * as SECTIONS from "../constants/sections";
import * as asana from "../asana";
import * as utils from "../utils";
import { SyncEvent } from "../event";

// CI runs fire on these pull_request actions in the consumer workflows.
const CI_ACTIONS = ["opened", "synchronize", "reopened", "ready_for_review"];

const CI_SUBTASK_NAME = "Automated CI Testing";

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

export const handleCiStatus = async (event: SyncEvent) => {
  if (!CI_ACTIONS.includes(event.action)) return;

  if (event.ciStatus === "edit_pr_description") {
    await editPrDescription(event);
    return;
  }

  const otto = asana.ottoUser();
  const taskNotes = `<a href='${event.actionUrl}'> Click Here To Investigate Action </a>`;
  const activeTier = utils.pickReviewerTier(event.requestedReviewers);

  for (const taskId of event.taskIds) {
    // The CI verdict subtask completes itself when approved/rejected, so the
    // latest verdict lives on the completed subtask assigned to Otto.
    const ciSubtask = await asana.getApprovalSubtask(taskId, true, otto);

    if (ciSubtask) {
      // CI recovered: red -> green. Only a ready PR re-enters review.
      if (
        ciSubtask.approval_status === "rejected" &&
        event.ciStatus === "approved" &&
        !event.isDraft
      ) {
        await asana.moveTaskToSection(taskId, SECTIONS.TESTING_REVIEW, [
          SECTIONS.APPROVED,
          ...SECTIONS.RELEASED_SECTIONS,
        ]);
        for (const reviewer of activeTier) {
          await asana.addRequestedReview(taskId, reviewer, event.prUrl);
        }
      }

      // CI broke: green -> red. Review requests are stale; task goes back.
      if (
        ciSubtask.approval_status === "approved" &&
        event.ciStatus === "rejected"
      ) {
        await asana.deleteReviewSubtasks(taskId);
        await asana.moveTaskToSection(
          taskId,
          SECTIONS.NEXT,
          SECTIONS.PROTECTED_FROM_DEMOTION
        );
      }

      await asana.updateApprovalSubtask(ciSubtask.gid, {
        due_on: new Date().toISOString().substring(0, 10),
        approval_status: event.ciStatus,
        html_notes: `<body>${taskNotes}</body>`,
      });
      continue;
    }

    // First CI verdict for this task.
    if (event.ciStatus === "rejected") {
      await asana.deleteReviewSubtasks(taskId);
      await asana.moveTaskToSection(
        taskId,
        SECTIONS.NEXT,
        SECTIONS.PROTECTED_FROM_DEMOTION
      );
    }
    await asana.addApprovalTask(
      taskId,
      otto,
      CI_SUBTASK_NAME,
      event.ciStatus,
      taskNotes
    );
  }
};
