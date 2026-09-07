import { info } from "@actions/core";
import asanaAxios from "./requests/asanaAxios";
import * as REQUESTS from "./constants/requests";
import { users } from "./constants/users";
import * as utils from "./utils";

export const ottoUser = () => utils.findUserByGithubName("otto-bot-git");

// Asana caps a request that carries `limit` at one page and hands back an
// offset for the rest; without following it a long-lived task's stories or
// subtasks are silently truncated.
export const getAllPages = async (url: string) => {
  const separator = url.includes("?") ? "&" : "?";
  let results: any[] = [];
  let offset: string | undefined;

  do {
    const pageUrl = offset ? `${url}${separator}offset=${offset}` : url;
    const response = await asanaAxios.get(pageUrl);
    results = results.concat(response.data.data || []);
    offset = response.data.next_page?.offset;
  } while (offset);

  return results;
};

export const moveTaskToSection = async (
  taskId: string,
  moveSection: string,
  doNotMoveSections?: string[]
) => {
  const taskUrl = `${REQUESTS.TASKS_URL}${taskId}`;
  const taskResponse = await asanaAxios.get(taskUrl);
  const task = taskResponse.data.data;

  // A task parked in a protected section stays put in *every* project it
  // belongs to - a per-membership skip would still move it on the others.
  if (
    doNotMoveSections &&
    task.memberships.some((membership: any) =>
      doNotMoveSections.includes(membership.section?.name)
    )
  ) {
    return;
  }

  for (const membership of task.memberships) {
    // Asana inserts at the top of the section, so restating a task's
    // section on every event would keep reshuffling the board.
    if (membership.section?.name === moveSection) continue;
    const projectId = membership.project.gid;
    const sectionsUrl = `${REQUESTS.PROJECTS_URL}${projectId}${REQUESTS.SECTIONS_URL}`;
    const sectionsResponse = await asanaAxios.get(sectionsUrl);
    const sections = sectionsResponse.data.data;

    const section = sections.find(
      (candidate: any) => candidate.name === moveSection
    );

    if (section) {
      const url = `${REQUESTS.SECTIONS_URL}${section.gid}${REQUESTS.ADD_TASK_URL}`;
      await asanaAxios.post(url, {
        data: {
          task: taskId,
        },
      });
    }
  }
};

export const setTaskIncomplete = async (taskId: string) => {
  await asanaAxios.put(`${REQUESTS.TASKS_URL}${taskId}`, {
    data: {
      completed: false,
    },
  });
};

export const addFollowers = async (taskId: string, followers: string[]) => {
  const validFollowers = followers.filter(Boolean);
  if (!validFollowers.length) return;
  const url = `${REQUESTS.TASKS_URL}${taskId}${REQUESTS.ADD_FOLLOWERS_URL}`;
  return asanaAxios.post(url, {
    data: {
      followers: validFollowers,
    },
  });
};

export const getStories = async (taskId: string) => {
  const url = `${REQUESTS.TASKS_URL}${taskId}${REQUESTS.STORIES_URL}${REQUESTS.STORIES_LIST_PARAMS}`;
  return getAllPages(url);
};

export const getAllApprovalSubtasks = async (taskId: string, creator: any) => {
  const url = `${REQUESTS.TASKS_URL}${taskId}${REQUESTS.SUBTASKS_URL}`;
  const subtasks = await getAllPages(url);
  return subtasks.filter(
    (subtask: any) =>
      subtask.resource_subtype === "approval" &&
      !subtask.completed &&
      subtask.created_by &&
      subtask.created_by.gid === creator?.asanaId
  );
};

export const getApprovalSubtask = async (
  taskId: string,
  isComplete: boolean,
  assignee: any
) => {
  const url = `${REQUESTS.TASKS_URL}${taskId}${REQUESTS.SUBTASKS_URL}`;
  const subtasks = await getAllPages(url);
  return subtasks.find(
    (subtask: any) =>
      subtask.resource_subtype === "approval" &&
      subtask.completed === isComplete &&
      subtask.assignee &&
      subtask.assignee.gid === assignee?.asanaId
  );
};

export const deleteApprovalTasks = async (approvalSubtasks: any[]) => {
  for (const subtask of approvalSubtasks) {
    try {
      await asanaAxios.delete(`${REQUESTS.TASKS_URL}${subtask.gid}`);
      info(`Deleted approval subtask ${subtask.gid}`);
    } catch (error) {
      if (utils.isAxiosError(error) && error.response?.status === 404) {
        info(`Approval subtask ${subtask.gid} already deleted - skipping`);
        continue;
      }
      // A failed cleanup should not fail the whole sync.
      console.warn(`Failed to delete approval subtask ${subtask.gid}:`, error);
    }
  }
};

// Reviewer approval subtasks are named "Review"; the CI verdict subtask is
// named "Automated CI Testing" and must survive review cleanups.
export const deleteReviewSubtasks = async (taskId: string) => {
  const subtasks = await getAllApprovalSubtasks(taskId, ottoUser());
  const reviewSubtasks = subtasks.filter(
    (subtask: any) => subtask.name !== "Automated CI Testing"
  );
  await deleteApprovalTasks(reviewSubtasks);
};

// Once the PR is merged nobody is waiting on an unanswered review, but the
// subtask still records who never answered - so it is relabelled rather than
// deleted. The label names the mainline branch the code landed on; a merge
// into any other branch is a sub-PR whose code has not shipped. Matching the
// bare name leaves an already-prefixed subtask ("FYI Review ..." from an
// earlier merge event, or any other "... Review") untouched, which is what
// makes a repeated merge event a no-op. getAllApprovalSubtasks only returns
// incomplete subtasks, so an answered review keeps its name.
const NAMED_MERGE_BASES = ["main", "master", "beta", "production"];

export const relabelReviewSubtasksAsFyi = async (
  taskId: string,
  baseRef: string
) => {
  const landedOn = NAMED_MERGE_BASES.includes(baseRef) ? baseRef : "sub-PR";
  const subtasks = await getAllApprovalSubtasks(taskId, ottoUser());
  for (const subtask of subtasks) {
    if (subtask.name !== "Review") continue;
    await updateApprovalSubtask(subtask.gid, {
      name: `FYI Review - merged to ${landedOn}`,
    });
  }
};

export const cleanupApprovalTasks = async (taskId: string) => {
  const approvalSubtasks = await getAllApprovalSubtasks(taskId, ottoUser());
  const teamIds = (team: string) =>
    users.filter((user) => user.team === team).map((user) => user.asanaId);
  const qaIds = teamIds("QA");
  const devIds = teamIds("DEV");

  const assignedTo = (subtask: any) => subtask.assignee?.gid;

  // QA subtasks only exist once every other tier has approved.
  if (
    approvalSubtasks.some((subtask: any) => qaIds.includes(assignedTo(subtask)))
  ) {
    if (
      approvalSubtasks.some(
        (subtask: any) => !qaIds.includes(assignedTo(subtask))
      )
    ) {
      await deleteApprovalTasks(
        approvalSubtasks.filter((subtask: any) =>
          qaIds.includes(assignedTo(subtask))
        )
      );
    }
  }

  // DEV subtasks only exist once peer devs have approved.
  if (
    approvalSubtasks.some((subtask: any) =>
      devIds.includes(assignedTo(subtask))
    )
  ) {
    if (
      approvalSubtasks.some(
        (subtask: any) =>
          !devIds.includes(assignedTo(subtask)) &&
          !qaIds.includes(assignedTo(subtask))
      )
    ) {
      await deleteApprovalTasks(
        approvalSubtasks.filter((subtask: any) =>
          devIds.includes(assignedTo(subtask))
        )
      );
    }
  }
};

export const addApprovalTask = async (
  taskId: string,
  assignee: any,
  taskName: string,
  approvalStatus: string,
  notes: string
) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  await asanaAxios.post(`${REQUESTS.TASKS_URL}${taskId}/subtasks`, {
    data: {
      assignee: assignee?.asanaId,
      approval_status: approvalStatus,
      completed: false,
      due_on: tomorrow.toISOString().substring(0, 10),
      resource_subtype: "approval",
      name: taskName,
      html_notes: `<body>${notes}</body>`,
    },
  });
  await cleanupApprovalTasks(taskId);
};

const createdBefore = (a: any, b: any) => {
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? -1 : 1;
  return a.gid.length - b.gid.length || (a.gid < b.gid ? -1 : 1);
};

// Asana enforces no uniqueness on subtasks, and two sync runs for one PR
// routinely overlap (ready_for_review and review_requested land in the same
// second), so both pass the existence check in addRequestedReview before
// either create is visible. Re-reading after the create and keeping only the
// oldest pending "Review" per assignee makes the racers converge: each sees
// the same set and picks the same survivor, and a delete that loses the race
// 404s and is skipped.
const deleteDuplicateReviewSubtasks = async (taskId: string, reviewer: any) => {
  const subtasks = await getAllApprovalSubtasks(taskId, ottoUser());
  const reviews = subtasks
    .filter(
      (subtask: any) =>
        subtask.name === "Review" && subtask.assignee?.gid === reviewer?.asanaId
    )
    .sort(createdBefore);
  await deleteApprovalTasks(reviews.slice(1));
};

export const addRequestedReview = async (
  taskId: string,
  reviewer: any,
  pullRequestUrl: string
) => {
  const existing = await getApprovalSubtask(taskId, false, reviewer);
  if (!existing) {
    const notes = `<a href='${pullRequestUrl}'> Click Here To Start Your Review </a>`;
    await addApprovalTask(taskId, reviewer, "Review", "pending", notes);
  }
  // Runs on the existing path too, so a task that already carries a
  // duplicate pair heals on the next event that touches the reviewer.
  await deleteDuplicateReviewSubtasks(taskId, reviewer);
};

export const updateApprovalSubtask = async (
  subtaskGid: string,
  fields: { [key: string]: any }
) => {
  await asanaAxios.put(`${REQUESTS.TASKS_URL}${subtaskGid}`, {
    data: fields,
  });
};
