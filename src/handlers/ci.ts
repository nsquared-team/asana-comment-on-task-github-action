import githubAxios from "../requests/githubAxios";
import * as REQUESTS from "../constants/requests";
import * as SECTIONS from "../constants/sections";
import * as asana from "../asana";
import * as utils from "../utils";
import { SyncEvent } from "../event";

// CI runs fire on these pull_request actions in the consumer workflows.
const CI_ACTIONS = ["opened", "synchronize", "reopened", "ready_for_review"];

const CI_SUBTASK_NAME = "Automated CI Testing";

const SANDBOX_HEADING = "## CI/QA Testing Sandbox";

const editPrDescription = async (event: SyncEvent) => {
  const today = new Date();
  const [date, time] = today.toISOString().split("T");
  const formattedDate = `${date} ${time.substring(0, 5)} UTC`;
  const sandboxSection = `${SANDBOX_HEADING} (${formattedDate}) ## \n ${event.prDescriptionInput}`;

  const githubUrl = `${REQUESTS.REPOS_URL}${event.repoFullName}${REQUESTS.PULLS_URL}${event.prNumber}`;
  const prResponse = await githubAxios.get(githubUrl);
  const currentBody = prResponse.data.body || "";

  // The block is always appended at the end, so the one to refresh is the
  // trailing one. Finding it by index rather than by regex fixes three things at
  // once: the input is no longer a replacement string (a `$&` in it copied the
  // matched block back into the body), a greedy span no longer runs to the LAST
  // block and deletes the author's own sections in between, and the guard now
  // tests exactly what the replacement targets - previously it checked for a
  // sentence the pattern did not require, so trimming that sentence by hand made
  // the block silently stop refreshing forever.
  const start = currentBody.lastIndexOf(SANDBOX_HEADING);
  const body =
    start === -1
      ? `${currentBody}\n\n${sandboxSection}`
      : `${currentBody.slice(0, start)}${sandboxSection}`;

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
