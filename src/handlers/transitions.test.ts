import asanaAxios from "../requests/asanaAxios";
import githubAxios from "../requests/githubAxios";
import { handlePullRequest } from "./pullRequest";
import { handleCiStatus } from "./ci";
import { handleReview, reconcileReviewState } from "./review";
import { handleComment } from "./comment";
import { run as runSync } from "../run";
import { SyncEvent } from "../event";
import * as INPUTS from "../constants/inputs";
import { getInput, setFailed } from "@actions/core";

jest.mock("@actions/core", () => ({
  getInput: jest.fn(() => ""),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
}));
jest.mock("../requests/asanaAxios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock("../requests/githubAxios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
  },
}));

const asanaGet = asanaAxios.get as jest.Mock;
const asanaPost = asanaAxios.post as jest.Mock;
const asanaPut = asanaAxios.put as jest.Mock;
const asanaDelete = asanaAxios.delete as jest.Mock;
const githubGet = githubAxios.get as jest.Mock;
const githubPost = githubAxios.post as jest.Mock;
const githubPatch = githubAxios.patch as jest.Mock;

const SECTION_GIDS: { [name: string]: string } = {
  Next: "sec-next",
  Blocked: "sec-blocked",
  "In Progress": "sec-inprogress",
  "Testing / Review": "sec-testing",
  Approved: "sec-approved",
  "Released in Alpha": "sec-alpha",
  "Released in Beta": "sec-beta",
  Released: "sec-released",
  Done: "sec-done",
};

const sectionsPayload = Object.keys(SECTION_GIDS).map((name) => ({
  gid: SECTION_GIDS[name],
  name,
}));

interface MockOptions {
  taskSection?: string;
  taskSections?: string[];
  taskCompleted?: boolean;
  subtasks?: any[];
  stories?: any[];
}

const mockAsana = ({
  taskSection = "Next",
  taskSections,
  taskCompleted = false,
  subtasks = [],
  stories = [],
}: MockOptions = {}) => {
  const sections = taskSections || [taskSection];
  asanaGet.mockImplementation((url: string) => {
    if (url.includes("/subtasks"))
      return Promise.resolve({ data: { data: subtasks } });
    if (url.includes("/stories"))
      return Promise.resolve({ data: { data: stories } });
    if (url.includes("/sections"))
      return Promise.resolve({ data: { data: sectionsPayload } });
    return Promise.resolve({
      data: {
        data: {
          completed: taskCompleted,
          memberships: sections.map((name, index) => ({
            section: { name },
            project: { gid: `proj-${index + 1}` },
          })),
        },
      },
    });
  });
  asanaPost.mockResolvedValue({ status: 201, data: {} });
  asanaPut.mockResolvedValue({ status: 200, data: {} });
  asanaDelete.mockResolvedValue({ status: 200, data: {} });
};

const movesTo = (sectionName: string) =>
  asanaPost.mock.calls.filter(([url]: [string]) =>
    url.includes(`/sections/${SECTION_GIDS[sectionName]}/addTask`)
  );

const baseEvent = (overrides: Partial<SyncEvent> = {}): SyncEvent => ({
  eventName: "pull_request",
  action: "opened",
  repoFullName: "nsquared-team/some-repo",
  taskIds: ["111"],
  prNumber: 42,
  isPullRequest: true,
  prAuthor: "the-author",
  prUrl: "https://github.com/nsquared-team/some-repo/pull/42",
  prState: "open",
  prMerged: false,
  prBaseRef: "main",
  isDraft: false,
  reviewState: "",
  reviewBody: "",
  commentUrl: "",
  rawCommentBody: "",
  commentPath: "",
  commentLine: undefined,
  commentSubjectType: "",
  commentInReplyTo: undefined,
  username: "hsein-bitar",
  requestedReviewers: [],
  eventReviewer: undefined,
  ciStatus: "",
  actionUrl: "https://github.com/nsquared-team/some-repo/actions/runs/1",
  prDescriptionInput: "",
  ...overrides,
});

const OTTO_ASANA_ID = "1202470392325800";
const PEER = {
  githubName: "MariamElZaatari",
  asanaId: "1202256129588512",
  team: "PEER_DEV",
};
const QA = {
  githubName: "gnarza",
  asanaId: "1172261355139211",
  team: "QA",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("draft rule", () => {
  test("PR opened as draft moves the task to In Progress", async () => {
    mockAsana();
    await handlePullRequest(baseEvent({ action: "opened", isDraft: true }));
    expect(movesTo("In Progress")).toHaveLength(1);
  });

  test("draft move respects a task parked in Blocked", async () => {
    mockAsana({ taskSection: "Blocked" });
    await handlePullRequest(baseEvent({ action: "opened", isDraft: true }));
    expect(movesTo("In Progress")).toHaveLength(0);
  });

  test("converted_to_draft moves to In Progress and deletes pending Review subtasks but keeps the CI subtask", async () => {
    mockAsana({
      subtasks: [
        {
          gid: "review-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: "1202470392325800" },
          assignee: { gid: "1202852209355924" },
        },
        {
          gid: "ci-1",
          name: "Automated CI Testing",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: "1202470392325800" },
          assignee: { gid: "1202470392325800" },
        },
      ],
    });
    await handlePullRequest(
      baseEvent({ action: "converted_to_draft", isDraft: true })
    );
    expect(movesTo("In Progress")).toHaveLength(1);
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/review-1");
    expect(asanaDelete).not.toHaveBeenCalledWith("/tasks/ci-1");
  });
});

describe("ready for review", () => {
  test("moves the task to Testing / Review even out of Blocked and creates the tier reviewer subtask", async () => {
    mockAsana({ taskSection: "Blocked" });
    await handlePullRequest(
      baseEvent({
        action: "ready_for_review",
        requestedReviewers: [
          {
            githubName: "MariamElZaatari",
            asanaId: "1202256129588512",
            team: "PEER_DEV",
          },
        ],
      })
    );
    expect(movesTo("Testing / Review")).toHaveLength(1);
    const subtaskCreates = asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/tasks/111/subtasks")
    );
    expect(subtaskCreates).toHaveLength(1);
    expect(subtaskCreates[0][1].data.assignee).toBe("1202256129588512");
  });

  test("review_requested on a draft PR does nothing", async () => {
    mockAsana();
    await handlePullRequest(
      baseEvent({ action: "review_requested", isDraft: true })
    );
    expect(asanaPost).not.toHaveBeenCalled();
  });

  test("review_requested creates a subtask only for the event's reviewer", async () => {
    mockAsana();
    const amin = {
      githubName: "aminabdulkhalek",
      asanaId: "1202393076412167",
      team: "PEER_DEV",
    };
    await handlePullRequest(
      baseEvent({
        action: "review_requested",
        requestedReviewers: [PEER, amin],
        eventReviewer: amin,
      })
    );
    const subtaskCreates = asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/tasks/111/subtasks")
    );
    expect(subtaskCreates).toHaveLength(1);
    expect(subtaskCreates[0][1].data.assignee).toBe(amin.asanaId);
  });
});

describe("CI status", () => {
  test("rejected bumps the task to Next and records the verdict", async () => {
    mockAsana({ taskSection: "Testing / Review" });
    await handleCiStatus(
      baseEvent({ action: "synchronize", ciStatus: "rejected" })
    );
    expect(movesTo("Next")).toHaveLength(1);
    const subtaskCreates = asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/tasks/111/subtasks")
    );
    expect(subtaskCreates).toHaveLength(1);
    expect(subtaskCreates[0][1].data.approval_status).toBe("rejected");
  });

  test("rejected does not demote a task that is In Progress", async () => {
    mockAsana({ taskSection: "In Progress" });
    await handleCiStatus(
      baseEvent({ action: "synchronize", ciStatus: "rejected" })
    );
    expect(movesTo("Next")).toHaveLength(0);
  });

  test("red-to-green promotes to Testing / Review only when the PR is not a draft", async () => {
    const rejectedCiSubtask = {
      gid: "ci-1",
      name: "Automated CI Testing",
      resource_subtype: "approval",
      approval_status: "rejected",
      completed: true,
      created_by: { gid: "1202470392325800" },
      assignee: { gid: "1202470392325800" },
    };

    mockAsana({ subtasks: [rejectedCiSubtask] });
    await handleCiStatus(
      baseEvent({ action: "synchronize", ciStatus: "approved", isDraft: true })
    );
    expect(movesTo("Testing / Review")).toHaveLength(0);
    expect(asanaPut).toHaveBeenCalledWith(
      "/tasks/ci-1",
      expect.objectContaining({
        data: expect.objectContaining({ approval_status: "approved" }),
      })
    );

    jest.clearAllMocks();
    mockAsana({ subtasks: [rejectedCiSubtask] });
    await handleCiStatus(
      baseEvent({ action: "synchronize", ciStatus: "approved", isDraft: false })
    );
    expect(movesTo("Testing / Review")).toHaveLength(1);
  });
});

describe("the CI sandbox block in the PR description", () => {
  const HEADING = "## CI/QA Testing Sandbox";
  const TAIL =
    "Please comment and open a new review on this pull request if you find any issues when testing the preview release zip files.";
  const GUARD = "A list of unique sandbox sites was created";

  // ssa-plugin's two writes per CI run, structurally as ci.yml sends them: the
  // untested-zips job first, the sandbox-sites job second. Both end with TAIL;
  // only the second carries GUARD.
  const untestedZips = (run: string) =>
    `UNTESTED ZIP FILES run=${run}\n${TAIL}`;
  const sandboxSites = (run: string) => `${GUARD} run=${run}\n${TAIL}`;

  const edit = async (currentBody: string, prDescriptionInput: string) => {
    jest.clearAllMocks();
    mockAsana();
    githubGet.mockResolvedValue({ data: { body: currentBody } });
    githubPatch.mockResolvedValue({ data: {} });
    await handleCiStatus(
      baseEvent({
        action: "synchronize",
        ciStatus: "edit_pr_description",
        prDescriptionInput,
      })
    );
    return githubPatch.mock.calls[0][1].body as string;
  };

  const stamps = (body: string) =>
    [...body.matchAll(/run=([A-Z-]+)/g)].map((match) => match[1]);

  test("a CI run leaves two blocks and both are from that run", async () => {
    // The consumer writes twice per run, so a refresh that only touches ONE
    // block leaves the untested-zips half frozen - stale S3 links that expire
    // in seven days - and a refresh that replaces from the FIRST heading
    // deletes that half outright. Both were shipped and both were wrong.
    let body = "Author's description.\n\nWhat this PR does.";
    for (const run of ["RUN-A", "RUN-B"]) {
      body = await edit(body, untestedZips(run));
      body = await edit(body, sandboxSites(run));
    }

    expect(body.split(HEADING)).toHaveLength(3); // two headings
    expect(stamps(body)).toEqual(["RUN-B", "RUN-B"]);
    expect(body).toContain("UNTESTED ZIP FILES run=RUN-B");
    expect(body).toContain(`${GUARD} run=RUN-B`);
    expect(body).not.toContain("RUN-A");
    expect(body).toContain("Author's description.");
  });

  test("a $& in the sandbox input is written literally, not expanded into the match", async () => {
    const body = await edit(
      `intro\n\n${HEADING} (old) ## \n ${sandboxSites("RUN-A")}`,
      "$&SANDBOX"
    );
    expect(body).toContain("$&SANDBOX");
    expect(body).not.toContain(GUARD);
  });

  test("the first run appends the block instead of replacing anything", async () => {
    const body = await edit("## Summary\nwhat this PR does", "first");
    expect(body).toContain("## Summary");
    expect(body).toContain("first");
  });
});

describe("reviews", () => {
  const commentReview = (overrides: Partial<SyncEvent> = {}) =>
    baseEvent({
      eventName: "pull_request_review",
      action: "submitted",
      reviewState: "commented",
      reviewBody: "looks good, one thought",
      rawCommentBody: "looks good, one thought",
      commentUrl: "https://github.com/r/pull/42#review-1",
      ...overrides,
    });

  test("a comment review from a tier reviewer is a rejection", async () => {
    mockAsana({
      taskSection: "Testing / Review",
      subtasks: [
        {
          gid: "rev-sub-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: PEER.asanaId },
        },
      ],
    });
    await handleReview(commentReview({ username: PEER.githubName }));
    expect(asanaPut).toHaveBeenCalledWith("/tasks/rev-sub-1", {
      data: { approval_status: "changes_requested" },
    });
    expect(movesTo("Next")).toHaveLength(1);
    expect(asanaPut).toHaveBeenCalledWith(
      "/tasks/111",
      expect.objectContaining({ data: { completed: false } })
    );
  });

  // GitHub files every inline comment as a review of its own; a review that
  // opened a thread is a verdict, one that only replied is conversation.
  const inlineComments = (inReplyTo?: number) =>
    githubGet.mockResolvedValue({
      data: [{ pull_request_review_id: 7, in_reply_to_id: inReplyTo }],
    });

  test("a comment review that only leaves notes on the diff is still a rejection", async () => {
    mockAsana({ taskSection: "Testing / Review" });
    inlineComments();
    await handleReview(
      commentReview({ username: PEER.githubName, reviewBody: "", reviewId: 7 })
    );
    expect(movesTo("Next")).toHaveLength(1);
  });

  test.each([
    [
      "a reply in a thread",
      { username: PEER.githubName, reviewBody: "", reviewId: 7 },
      1,
    ],
    [
      "the author's own notes on their diff",
      { username: PEER.githubName, prAuthor: PEER.githubName },
      undefined,
    ],
    ["a bot's comment review", { username: "otto-bot-git" }, undefined],
  ])("%s never demotes the task", async (_label, overrides, inReplyTo) => {
    mockAsana({ taskSection: "Testing / Review" });
    inlineComments(inReplyTo);
    await handleReview(commentReview(overrides));
    expect(movesTo("Next")).toHaveLength(0);
    expect(asanaPut).not.toHaveBeenCalledWith(
      "/tasks/111",
      expect.objectContaining({ data: { completed: false } })
    );
  });

  test("changes_requested demotes to Next and reopens the task", async () => {
    mockAsana({ taskSection: "Testing / Review" });
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "submitted",
        reviewState: "changes_requested",
        reviewBody: "please fix",
        rawCommentBody: "please fix",
        commentUrl: "https://github.com/r/pull/42#review-2",
      })
    );
    expect(movesTo("Next")).toHaveLength(1);
    expect(asanaPut).toHaveBeenCalledWith("/tasks/111", {
      data: { completed: false },
    });
  });

  test("unknown reviewer does not crash the sync and never promotes to Approved", async () => {
    mockAsana();
    githubGet.mockResolvedValue({ data: [] });
    await expect(
      handleReview(
        baseEvent({
          eventName: "pull_request_review",
          action: "submitted",
          reviewState: "approved",
          reviewBody: "ship it",
          rawCommentBody: "ship it",
          username: "dependabot[bot]",
          commentUrl: "https://github.com/r/pull/42#review-3",
        })
      )
    ).resolves.not.toThrow();
    expect(movesTo("Approved")).toHaveLength(0);
  });

  test("a known approval that completes every tier moves the task to Approved", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: "MariamElZaatari" },
          state: "APPROVED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "submitted",
        reviewState: "approved",
        username: "MariamElZaatari",
        commentUrl: "https://github.com/r/pull/42#review-4",
      })
    );
    expect(movesTo("Approved")).toHaveLength(1);
  });

  test("an approval on a draft PR never cascades or promotes", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: "MariamElZaatari" },
          state: "APPROVED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "submitted",
        reviewState: "approved",
        username: "MariamElZaatari",
        isDraft: true,
        commentUrl: "https://github.com/r/pull/42#review-5",
      })
    );
    expect(githubGet).not.toHaveBeenCalled();
    expect(movesTo("Approved")).toHaveLength(0);
  });

  test("otto requesting changes demotes the task, reopens it, and clears pending review subtasks", async () => {
    mockAsana({
      taskSection: "Testing / Review",
      subtasks: [
        {
          gid: "rev-sub-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: "dev-asana-id" },
        },
        {
          gid: "ci-sub-1",
          name: "Automated CI Testing",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: OTTO_ASANA_ID },
        },
      ],
    });
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "submitted",
        reviewState: "changes_requested",
        username: "otto-bot-git",
        reviewBody: "issues found",
        rawCommentBody: "issues found",
        commentUrl: "https://github.com/r/pull/42#review-7",
      })
    );
    expect(movesTo("Next")).toHaveLength(1);
    expect(asanaPut).toHaveBeenCalledWith("/tasks/111", {
      data: { completed: false },
    });
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/rev-sub-1");
    expect(asanaDelete).not.toHaveBeenCalledWith("/tasks/ci-sub-1");
  });

  test("changes_requested does not demote a task that is In Progress", async () => {
    mockAsana({ taskSection: "In Progress" });
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "submitted",
        reviewState: "changes_requested",
        reviewBody: "please fix",
        rawCommentBody: "please fix",
        commentUrl: "https://github.com/r/pull/42#review-6",
      })
    );
    expect(movesTo("Next")).toHaveLength(0);
  });
});

describe("merge mapping", () => {
  const merged = (repoFullName: string, prBaseRef: string) =>
    baseEvent({
      action: "closed",
      prMerged: true,
      prState: "closed",
      repoFullName,
      prBaseRef,
    });

  test("aaardvark-app: master -> Released in Alpha", async () => {
    mockAsana();
    await handlePullRequest(merged("nsquared-team/aaardvark-app", "master"));
    expect(movesTo("Released in Alpha")).toHaveLength(1);
  });

  test("blinkmetrics-app: beta -> Released in Beta, production -> Released", async () => {
    mockAsana();
    await handlePullRequest(merged("nsquared-team/blinkmetrics-app", "beta"));
    expect(movesTo("Released in Beta")).toHaveLength(1);

    jest.clearAllMocks();
    mockAsana();
    await handlePullRequest(
      merged("nsquared-team/blinkmetrics-app", "production")
    );
    expect(movesTo("Released")).toHaveLength(1);
  });

  test("any other repo lands in Done and the task is never auto-completed", async () => {
    mockAsana();
    await handlePullRequest(merged("nsquared-team/ssa-plugin", "master"));
    expect(movesTo("Done")).toHaveLength(1);
    const completedCalls = asanaPut.mock.calls.filter(
      ([, payload]: [string, any]) => payload?.data?.completed === true
    );
    expect(completedCalls).toHaveLength(0);
  });

  test("a stacked merge into a non-release branch moves nothing", async () => {
    mockAsana({
      subtasks: [
        {
          gid: "review-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: PEER.asanaId },
        },
      ],
    });
    await handlePullRequest(
      merged("nsquared-team/aaardvark-app", "feature-parent")
    );
    const sectionMoves = asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/addTask")
    );
    expect(sectionMoves).toHaveLength(0);
    expect(asanaDelete).not.toHaveBeenCalled();
  });

  test("a merge deletes no approval subtasks, answered or pending", async () => {
    // The pending subtask stands in for an approval given just before an
    // auto-merge: the review event that mirrors it onto the subtask runs in
    // a parallel workflow run, so at merge time it can still read as pending.
    mockAsana({
      subtasks: [
        {
          gid: "review-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: PEER.asanaId },
        },
      ],
    });
    await handlePullRequest(merged("nsquared-team/aaardvark-app", "master"));
    expect(movesTo("Released in Alpha")).toHaveLength(1);
    expect(asanaDelete).not.toHaveBeenCalled();
  });
});

describe("PR closed without merging", () => {
  const closedUnmerged = (options: MockOptions = {}) => {
    mockAsana({
      subtasks: [
        {
          gid: "review-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: PEER.asanaId },
        },
      ],
      ...options,
    });
    return baseEvent({
      action: "closed",
      prMerged: false,
      prState: "closed",
    });
  };

  test("deletes the stale review subtasks and hands the task back to In Progress", async () => {
    const event = closedUnmerged({ taskSection: "Testing / Review" });
    await handlePullRequest(event);
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/review-1");
    expect(movesTo("In Progress")).toHaveLength(1);
  });

  test("does not drag a task out of Blocked or a released column", async () => {
    await handlePullRequest(closedUnmerged({ taskSection: "Blocked" }));
    expect(movesTo("In Progress")).toHaveLength(0);

    jest.clearAllMocks();
    await handlePullRequest(closedUnmerged({ taskSection: "Released" }));
    expect(movesTo("In Progress")).toHaveLength(0);
  });
});

describe("opened and reopened mirror the PR's current state", () => {
  test("a PR opened ready for review moves the task and creates the tier subtask", async () => {
    mockAsana();
    await handlePullRequest(
      baseEvent({
        action: "opened",
        isDraft: false,
        requestedReviewers: [PEER],
      })
    );
    expect(movesTo("Testing / Review")).toHaveLength(1);
    const subtaskCreates = asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/tasks/111/subtasks")
    );
    expect(subtaskCreates).toHaveLength(1);
    expect(subtaskCreates[0][1].data.assignee).toBe(PEER.asanaId);
  });

  test("a reopened ready PR goes back to Testing / Review", async () => {
    mockAsana({ taskSection: "Done" });
    await handlePullRequest(
      baseEvent({ action: "reopened", isDraft: false, prState: "open" })
    );
    expect(movesTo("Testing / Review")).toHaveLength(1);
  });

  test("a reopened draft PR goes back to In Progress", async () => {
    mockAsana({ taskSection: "Done" });
    await handlePullRequest(
      baseEvent({ action: "reopened", isDraft: true, prState: "open" })
    );
    expect(movesTo("In Progress")).toHaveLength(1);
  });
});

describe("bots are not a review tier", () => {
  const approvalBy = (login: string) =>
    baseEvent({
      eventName: "pull_request_review",
      action: "submitted",
      reviewState: "approved",
      username: login,
      commentUrl: `https://github.com/o/r/pull/42#review-${login}`,
    });

  test("an approval while an earlier approver is asked again does not promote the task", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: PEER.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
        {
          user: { login: QA.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T01:00:00Z",
        },
      ],
    });
    await handleReview({
      ...approvalBy(QA.githubName),
      requestedReviewers: [PEER],
    });
    expect(movesTo("Approved")).toHaveLength(0);
  });

  test("an approval from otto alone never promotes the task", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: "otto-bot-git" },
          state: "APPROVED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    await handleReview(approvalBy("otto-bot-git"));
    expect(movesTo("Approved")).toHaveLength(0);
  });

  test("otto requesting changes does not block a tier that has fully approved", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: "otto-bot-git" },
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
        {
          user: { login: PEER.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T01:00:00Z",
        },
      ],
    });
    await handleReview(approvalBy(PEER.githubName));
    expect(movesTo("Approved")).toHaveLength(1);
  });

  test("an approval stands through a later changes-request from someone else", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: PEER.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
        {
          user: { login: "otto-bot-git" },
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-08-01T01:00:00Z",
        },
        {
          user: { login: "otto-bot-git" },
          state: "APPROVED",
          submitted_at: "2026-08-01T02:00:00Z",
        },
      ],
    });
    await handleReview(approvalBy("otto-bot-git"));
    expect(movesTo("Approved")).toHaveLength(1);
  });

  test("otto still pending neither pings QA nor blocks the human tiers", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: PEER.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T01:00:00Z",
        },
      ],
    });
    await handleReview({
      ...approvalBy(PEER.githubName),
      requestedReviewers: [
        { githubName: "otto-bot-git", asanaId: OTTO_ASANA_ID, team: "BOT" },
      ],
    });
    const subtaskCreates = asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/tasks/111/subtasks")
    );
    expect(subtaskCreates).toHaveLength(0);
    expect(movesTo("Approved")).toHaveLength(1);
  });
});

describe("dismissed reviews", () => {
  test("a dismissed approval stops counting as an approval", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: PEER.githubName },
          state: "DISMISSED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
        {
          user: { login: QA.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T01:00:00Z",
        },
      ],
    });
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "submitted",
        reviewState: "approved",
        username: QA.githubName,
        commentUrl: "https://github.com/o/r/pull/42#review-d1",
      })
    );
    expect(movesTo("Approved")).toHaveLength(0);
  });

  test("dismissing a review pulls the task back out of Approved", async () => {
    mockAsana({ taskSection: "Approved" });
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "dismissed",
        reviewState: "dismissed",
        username: PEER.githubName,
        commentUrl: "https://github.com/o/r/pull/42#review-d2",
      })
    );
    expect(movesTo("Testing / Review")).toHaveLength(1);
  });

  test("a dismissal never drags a released task backwards", async () => {
    mockAsana({ taskSection: "Released in Alpha" });
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "dismissed",
        reviewState: "dismissed",
        username: PEER.githubName,
        commentUrl: "https://github.com/o/r/pull/42#review-d3",
      })
    );
    expect(movesTo("Testing / Review")).toHaveLength(0);
  });
});

describe("a dismissed review summons its reviewer back", () => {
  const HSEIN = { githubName: "hsein-bitar", team: "PEER_DEV" };
  const rerequests = () =>
    githubPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/requested_reviewers")
    );
  const approvalBy = (login: string) =>
    baseEvent({
      eventName: "pull_request_review",
      action: "submitted",
      reviewState: "approved",
      username: login,
      commentUrl: `https://github.com/o/r/pull/42#review-${login}`,
    });
  const dismissalOf = (login: string) =>
    baseEvent({
      eventName: "pull_request_review",
      action: "dismissed",
      reviewState: "dismissed",
      username: login,
      commentUrl: `https://github.com/o/r/pull/42#review-${login}`,
    });

  test("an approval behind someone else's changes-request still counts and is not resummoned", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: HSEIN.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
        {
          user: { login: PEER.githubName },
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-08-01T01:00:00Z",
        },
        {
          user: { login: PEER.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T02:00:00Z",
        },
      ],
    });
    await handleReview(approvalBy(PEER.githubName));
    expect(rerequests()).toHaveLength(0);
    // Both standing verdicts are approvals, so the tier is satisfied.
    expect(movesTo("Approved")).toHaveLength(1);
  });

  test("the dismissal re-requests the reviewer", async () => {
    mockAsana();
    await handleReview(dismissalOf(HSEIN.githubName));
    expect(rerequests()).toHaveLength(1);
    expect(rerequests()[0][1]).toEqual({ reviewers: [HSEIN.githubName] });
  });

  test("a reviewer already re-requested by hand is not requested again", async () => {
    mockAsana();
    await handleReview({
      ...dismissalOf(HSEIN.githubName),
      requestedReviewers: [HSEIN],
    });
    expect(rerequests()).toHaveLength(0);
  });

  test("a bot's dismissed review is never resummoned", async () => {
    mockAsana();
    await handleReview(dismissalOf("otto-bot-git"));
    expect(rerequests()).toHaveLength(0);
  });

  // GitHub reports every dismissed review as DISMISSED, so a tally that
  // resummoned would drag back a reviewer the author took off on purpose.
  test("a later approval does not summon a dismissed reviewer again", async () => {
    mockAsana();
    githubGet.mockResolvedValue({
      data: [
        {
          user: { login: HSEIN.githubName },
          state: "DISMISSED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
        {
          user: { login: PEER.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T01:00:00Z",
        },
      ],
    });
    await handleReview(approvalBy(PEER.githubName));
    expect(rerequests()).toHaveLength(0);
    // The dismissed verdict still blocks the tier.
    expect(movesTo("Approved")).toHaveLength(0);
  });

  test("a failed re-request call neither throws nor stops the rest of the sync", async () => {
    mockAsana();
    githubPost.mockRejectedValue(new Error("boom"));
    await expect(
      handleReview(dismissalOf(HSEIN.githubName))
    ).resolves.not.toThrow();
    // The follower sync after the dismissal still runs after the failed call.
    const followerAdds = asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/addFollowers")
    );
    expect(followerAdds.length).toBeGreaterThan(0);
  });
});

describe("Asana list reads are paginated", () => {
  test("subtask reads follow next_page instead of stopping at one page", async () => {
    mockAsana();
    const pageOne = {
      data: {
        data: [
          {
            gid: "review-page-1",
            name: "Review",
            resource_subtype: "approval",
            completed: false,
            created_by: { gid: OTTO_ASANA_ID },
            assignee: { gid: PEER.asanaId },
          },
        ],
        next_page: { offset: "page-2-token" },
      },
    };
    const pageTwo = {
      data: {
        data: [
          {
            gid: "review-page-2",
            name: "Review",
            resource_subtype: "approval",
            completed: false,
            created_by: { gid: OTTO_ASANA_ID },
            assignee: { gid: QA.asanaId },
          },
        ],
      },
    };

    asanaGet.mockImplementation((url: string) => {
      if (url.includes("/subtasks"))
        return Promise.resolve(url.includes("offset=") ? pageTwo : pageOne);
      if (url.includes("/sections"))
        return Promise.resolve({ data: { data: sectionsPayload } });
      return Promise.resolve({
        data: {
          data: {
            memberships: [
              { section: { name: "Next" }, project: { gid: "proj-1" } },
            ],
          },
        },
      });
    });

    await handlePullRequest(
      baseEvent({ action: "converted_to_draft", isDraft: true })
    );
    // The second page's subtask is only reachable via the offset request.
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/review-page-1");
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/review-page-2");
  });
});

describe("section protection spans every project the task is in", () => {
  test("a task Blocked in one project does not move in the others", async () => {
    mockAsana({ taskSections: ["Blocked", "Next"] });
    await handlePullRequest(baseEvent({ action: "opened", isDraft: true }));
    expect(movesTo("In Progress")).toHaveLength(0);
  });

  test("an unprotected task still moves in every project it belongs to", async () => {
    mockAsana({ taskSections: ["Next", "Next"] });
    await handlePullRequest(baseEvent({ action: "opened", isDraft: true }));
    expect(movesTo("In Progress")).toHaveLength(2);
  });
});

describe("review comment location names a line only when there is one", () => {
  const reviewComment = (overrides: Partial<SyncEvent> = {}) =>
    baseEvent({
      eventName: "pull_request_review_comment",
      action: "created",
      commentPath: ".github/workflows/asana.yaml",
      commentUrl:
        "https://github.com/nsquared-team/some-repo/pull/42#discussion_r1",
      rawCommentBody: "a note",
      ...overrides,
    });

  const postedBody = () =>
    asanaPost.mock.calls
      .map(([, payload]: [string, any]) => payload?.data?.html_text)
      .filter(Boolean)
      .at(-1) as string;

  test("a file-level comment names only the file", async () => {
    mockAsana();
    // GitHub reports original_line as 1 on a file-level comment rather than
    // leaving it empty, so a truthiness check on the line number labels the
    // comment "(Line 1)" and points the reader at a line it is not on.
    await handleComment(
      reviewComment({ commentSubjectType: "file", commentLine: 1 })
    );
    expect(postedBody()).toContain("on asana.yaml:");
    expect(postedBody()).not.toContain("Line");
  });

  test("a comment on a line still names that line", async () => {
    mockAsana();
    await handleComment(
      reviewComment({ commentSubjectType: "line", commentLine: 14 })
    );
    expect(postedBody()).toContain("on asana.yaml (Line 14):");
  });
});

describe("a merge conflict pauses the cascade", () => {
  const DEV = { githubName: "some-dev", asanaId: "dev-asana-id", team: "DEV" };

  // The cascade reads the PR itself for mergeability and the reviews list
  // separately, so the mock has to answer per URL.
  const mockGithub = (mergeable: boolean | null, reviews: any[]) =>
    githubGet.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith("/reviews") ? reviews : { mergeable },
      })
    );

  const peerApproval = (requestedReviewers: any[] = []) =>
    baseEvent({
      eventName: "pull_request_review",
      action: "submitted",
      reviewState: "approved",
      username: PEER.githubName,
      commentUrl: "https://github.com/r/pull/42#review-conflict",
      requestedReviewers,
    });

  const peerApproved = [
    {
      user: { login: PEER.githubName },
      state: "APPROVED",
      submitted_at: "2026-08-01T00:00:00Z",
    },
  ];

  const subtaskCreates = () =>
    asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/tasks/111/subtasks")
    );

  test("otto's conflict alert clears the pending review subtasks but keeps the CI subtask", async () => {
    mockAsana({
      taskSection: "Testing / Review",
      subtasks: [
        {
          gid: "rev-sub-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: DEV.asanaId },
        },
        {
          gid: "ci-sub-1",
          name: "Automated CI Testing",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: OTTO_ASANA_ID },
        },
      ],
    });
    await handleComment(
      baseEvent({
        eventName: "issue_comment",
        action: "created",
        username: "otto-bot-git",
        rawCommentBody:
          "This pull request has conflicts, please resolve those before we can evaluate the pull request.",
        commentUrl: "https://github.com/r/pull/42#issuecomment-1",
      })
    );
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/rev-sub-1");
    expect(asanaDelete).not.toHaveBeenCalledWith("/tasks/ci-sub-1");
    expect(movesTo("Next")).toHaveLength(1);
    expect(asanaPut).toHaveBeenCalledWith("/tasks/111", {
      data: { completed: false },
    });
  });

  test("an approval on a conflicting PR neither promotes the task nor hands the next tier a review", async () => {
    mockAsana();
    mockGithub(false, peerApproved);
    await handleReview(peerApproval([DEV]));
    expect(movesTo("Approved")).toHaveLength(0);
    expect(subtaskCreates()).toHaveLength(0);
  });

  test("the same approval on a mergeable PR does hand the next tier a review", async () => {
    mockAsana();
    mockGithub(true, peerApproved);
    await handleReview(peerApproval([DEV]));
    expect(subtaskCreates()).toHaveLength(1);
  });

  test("mergeability GitHub has not computed yet still promotes", async () => {
    mockAsana();
    mockGithub(null, peerApproved);
    await handleReview(peerApproval());
    expect(movesTo("Approved")).toHaveLength(1);
  });
});

describe("a merge turns the open reviews into FYI reviews", () => {
  const approvalSubtask = (overrides: any) => ({
    resource_subtype: "approval",
    completed: false,
    created_by: { gid: OTTO_ASANA_ID },
    assignee: { gid: PEER.asanaId },
    ...overrides,
  });

  const mockAsanaWithEverySubtaskShape = () =>
    mockAsana({
      subtasks: [
        approvalSubtask({ gid: "open-review", name: "Review" }),
        approvalSubtask({
          gid: "answered-review",
          name: "Review",
          completed: true,
        }),
        approvalSubtask({ gid: "already-fyi", name: "FYI Review" }),
        approvalSubtask({ gid: "ci-sub", name: "Automated CI Testing" }),
      ],
    });

  const renames = () =>
    asanaPut.mock.calls.filter(([, payload]: [string, any]) =>
      payload?.data?.name?.startsWith("FYI Review")
    );

  const closed = (
    prMerged: boolean,
    prBaseRef = "master",
    overrides: Partial<SyncEvent> = {}
  ) =>
    baseEvent({
      action: "closed",
      prMerged,
      prState: "closed",
      repoFullName: "nsquared-team/aaardvark-app",
      prBaseRef,
      ...overrides,
    });

  const fyiCreates = () =>
    asanaPost.mock.calls.filter(
      ([url, payload]: [string, any]) =>
        url.includes("/tasks/111/subtasks") &&
        payload?.data?.name?.startsWith("FYI Review")
    );

  test("only the open, unprefixed Review subtask is relabelled", async () => {
    mockAsanaWithEverySubtaskShape();
    await handlePullRequest(closed(true));
    expect(renames()).toEqual([
      [
        "/tasks/open-review",
        { data: { name: "FYI Review - merged to master" } },
      ],
    ]);
    expect(asanaDelete).not.toHaveBeenCalled();
  });

  test.each(["main", "beta", "production"])(
    "the label names the mainline branch the code landed on: %s",
    async (base) => {
      mockAsanaWithEverySubtaskShape();
      await handlePullRequest(closed(true, base));
      expect(renames()).toEqual([
        [
          "/tasks/open-review",
          { data: { name: `FYI Review - merged to ${base}` } },
        ],
      ]);
    }
  );

  test("a stacked merge relabels even though it moves the task nowhere", async () => {
    mockAsanaWithEverySubtaskShape();
    await handlePullRequest(closed(true, "feature-parent"));
    const sectionMoves = asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/addTask")
    );
    expect(sectionMoves).toHaveLength(0);
    expect(renames()).toEqual([
      [
        "/tasks/open-review",
        { data: { name: "FYI Review - merged to sub-PR" } },
      ],
    ]);
  });

  test("a PR closed without merging still deletes the subtasks instead", async () => {
    mockAsanaWithEverySubtaskShape();
    await handlePullRequest(closed(false));
    expect(renames()).toHaveLength(0);
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/open-review");
  });

  test("a requested reviewer the task carries no subtask for gets one created", async () => {
    mockAsana();
    await handlePullRequest(
      closed(true, "master", { requestedReviewers: [PEER] })
    );
    expect(fyiCreates()).toHaveLength(1);
    expect(fyiCreates()[0][1].data).toMatchObject({
      name: "FYI Review - merged to master",
      assignee: PEER.asanaId,
      approval_status: "pending",
      completed: false,
    });
  });

  test("the created subtask names the sub-PR the code landed on", async () => {
    mockAsana();
    await handlePullRequest(
      closed(true, "feature-parent", { requestedReviewers: [PEER] })
    );
    expect(fyiCreates()[0][1].data.name).toBe("FYI Review - merged to sub-PR");
  });

  test("a reviewer whose subtask this merge just relabelled is not given a second", async () => {
    mockAsanaWithEverySubtaskShape();
    await handlePullRequest(
      closed(true, "master", { requestedReviewers: [PEER] })
    );
    expect(renames()).toHaveLength(1);
    expect(fyiCreates()).toHaveLength(0);
    // The same reviewer already carries a bare "FYI Review" here, so the two
    // open reviews converge on the older one rather than both standing.
    expect(asanaDelete.mock.calls).toEqual([["/tasks/open-review"]]);
  });

  test("a reviewer who already answered is not given a second", async () => {
    mockAsana({
      subtasks: [
        approvalSubtask({
          gid: "answered-review",
          name: "Review",
          completed: true,
        }),
      ],
    });
    await handlePullRequest(
      closed(true, "master", { requestedReviewers: [PEER] })
    );
    expect(renames()).toHaveLength(0);
    expect(fyiCreates()).toHaveLength(0);
  });

  test("only the active tier gets one, not every requested reviewer", async () => {
    mockAsana();
    await handlePullRequest(
      closed(true, "master", { requestedReviewers: [PEER, QA] })
    );
    expect(fyiCreates()).toHaveLength(1);
    expect(fyiCreates()[0][1].data.assignee).toBe(PEER.asanaId);
  });

  test("a reviewer already carrying a duplicate pair is healed by the merge", async () => {
    mockAsana({
      subtasks: [
        approvalSubtask({
          gid: "review-older",
          name: "Review",
          created_at: "2026-09-02T21:02:19.100Z",
        }),
        approvalSubtask({
          gid: "fyi-newer",
          name: "FYI Review - merged to master",
          created_at: "2026-09-02T21:02:19.400Z",
        }),
      ],
    });
    await handlePullRequest(
      closed(true, "master", { requestedReviewers: [PEER] })
    );
    expect(fyiCreates()).toHaveLength(0);
    expect(asanaDelete).toHaveBeenCalledTimes(1);
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/fyi-newer");
  });

  // Asana shows a created subtask to the next read; the shared mock does not,
  // so the cascade cleanup that runs after a create is invisible without this.
  const mockAsanaWithCreatesVisible = (subtasks: any[]) => {
    mockAsana({ subtasks });
    asanaPost.mockImplementation((url: string, payload: any) => {
      if (url.includes("/subtasks"))
        subtasks.push(
          approvalSubtask({
            gid: "created-fyi",
            name: payload.data.name,
            assignee: { gid: payload.data.assignee },
          })
        );
      return Promise.resolve({ status: 201, data: {} });
    });
  };

  test("a merge that creates an FYI still deletes no approval subtask", async () => {
    mockAsanaWithCreatesVisible([
      approvalSubtask({
        gid: "qa-review",
        name: "Review",
        assignee: { gid: QA.asanaId },
      }),
    ]);
    await handlePullRequest(
      closed(true, "master", { requestedReviewers: [PEER] })
    );
    expect(fyiCreates()).toHaveLength(1);
    expect(asanaDelete).not.toHaveBeenCalled();
  });

  test("the FYI a merge creates survives the run that created it", async () => {
    mockAsanaWithCreatesVisible([
      approvalSubtask({ gid: "peer-review", name: "Review" }),
    ]);
    await handlePullRequest(
      closed(true, "master", { requestedReviewers: [QA] })
    );
    expect(fyiCreates()).toHaveLength(1);
    expect(asanaDelete).not.toHaveBeenCalled();
  });

  test("a PR closed without merging creates none", async () => {
    mockAsana();
    await handlePullRequest(
      closed(false, "master", { requestedReviewers: [PEER] })
    );
    expect(fyiCreates()).toHaveLength(0);
  });
});

describe("a review body that links to its own pull request", () => {
  // otto's code-review report opens with a markdown link labelled with the PR
  // url itself. The scrape read both urls plus the `](` between them as one
  // "url" and handed it to new RegExp, whose `(` opened a group nothing closed.
  // The throw propagated out of handleReview into run.ts, which setFailed the
  // action: the review never reached Asana and the check went red on every
  // report - PRs 4054, 4184, 4237, 4308, 4326, 4515 and 4521 all hit it.
  const PR_URL = "https://github.com/nsquared-team/blinkmetrics-app/pull/4237";
  const OTTO_REPORT = [
    "# Code Review Report",
    "",
    `**Fix scorecard digest giving up (and lying) when data is permanently stale** \u00b7 [${PR_URL}](${PR_URL}) \u00b7 @ali-al-najjar`,
  ].join("\n");

  const postedStory = () =>
    asanaPost.mock.calls.filter(([url]: [string]) => url.includes("/stories"));

  test("otto's report is posted to Asana instead of failing the action", async () => {
    mockAsana();
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "submitted",
        reviewState: "changes_requested",
        username: "otto-bot-git",
        // buildFormattedBody reads rawCommentBody; reviewBody is written by
        // buildEvent and read nowhere, so setting only it would prove nothing.
        rawCommentBody: OTTO_REPORT,
        commentUrl: `${PR_URL}#pullrequestreview-1`,
      })
    );

    expect(postedStory()).toHaveLength(1);
    const html = postedStory()[0][1].data.html_text as string;
    expect(html).toContain(`<a href="${PR_URL}">`);
    expect(html).not.toContain(`](${PR_URL})`);
  });
});

describe("mentions and links in the same comment", () => {
  const storyHtml = () =>
    asanaPost.mock.calls
      .filter(([url]: [string]) => url.includes("/stories"))
      .map(([, payload]: [string, any]) => payload.data.html_text)[0] as string;

  const comment = (body: string) =>
    handleComment(
      baseEvent({
        eventName: "issue_comment",
        action: "created",
        rawCommentBody: body,
        commentUrl: "https://github.com/o/r/pull/1#issuecomment-1",
      })
    );

  test("a handle inside a url is not linked inside that url's href", async () => {
    // Mentions were replaced by string needle, which hits the FIRST match
    // anywhere - the one inside the url. The href came back with an Asana
    // anchor spliced into it (html_text Asana rejects outright) and the real
    // mention below was the one left as plain text.
    mockAsana();
    await comment(
      "see https://x.com/@MariamElZaatari/status/1 and cc @MariamElZaatari"
    );

    const html = storyHtml();
    expect(html).toContain(
      '<a href="https://x.com/@MariamElZaatari/status/1">'
    );
    expect(html).not.toMatch(/<a href="[^"]*<a /);
    expect(html).not.toContain("cc @MariamElZaatari");
  });

  test("a handle inside a markdown link's label is left as text", async () => {
    // Deliberate: the label sits inside a finished anchor and linking it would
    // nest one anchor inside another, which is what the old code produced. The
    // trade is that a mention written this way adds no follower.
    mockAsana();
    await comment("[ping @MariamElZaatari](https://example.com/x)");

    const html = storyHtml();
    expect(html).toContain("ping @MariamElZaatari");
    expect(html).not.toMatch(/<a href="[^"]*<a /);
  });
});

describe("overlapping runs leave one Review subtask per reviewer", () => {
  const reviewFor = (gid: string, createdAt: string) => ({
    gid,
    name: "Review",
    resource_subtype: "approval",
    completed: false,
    created_by: { gid: OTTO_ASANA_ID },
    assignee: { gid: PEER.asanaId },
    created_at: createdAt,
  });

  // The existence check before the create sees nothing; only the re-read
  // after this run's create sees what the parallel run created too.
  const mockSubtasksAfterCreate = (afterCreate: any[]) => {
    mockAsana();
    asanaGet.mockImplementation((url: string) => {
      if (url.includes("/subtasks")) {
        const created = asanaPost.mock.calls.some(([postUrl]: [string]) =>
          postUrl.includes("/tasks/111/subtasks")
        );
        return Promise.resolve({ data: { data: created ? afterCreate : [] } });
      }
      if (url.includes("/sections"))
        return Promise.resolve({ data: { data: sectionsPayload } });
      return Promise.resolve({
        data: {
          data: {
            memberships: [
              { section: { name: "Next" }, project: { gid: "proj-1" } },
            ],
          },
        },
      });
    });
  };

  test("the newer duplicate is deleted whichever run created it", async () => {
    mockSubtasksAfterCreate([
      reviewFor("review-newer", "2026-09-02T21:02:19.400Z"),
      reviewFor("review-older", "2026-09-02T21:02:19.100Z"),
    ]);
    await handlePullRequest(
      baseEvent({ action: "ready_for_review", requestedReviewers: [PEER] })
    );
    expect(asanaDelete).toHaveBeenCalledTimes(1);
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/review-newer");
  });

  test("a task already carrying a duplicate pair is healed without creating a third", async () => {
    mockAsana({
      subtasks: [
        reviewFor("review-older", "2026-09-02T21:02:19.100Z"),
        reviewFor("review-newer", "2026-09-02T21:02:19.400Z"),
      ],
    });
    await handlePullRequest(
      baseEvent({ action: "ready_for_review", requestedReviewers: [PEER] })
    );
    const subtaskCreates = asanaPost.mock.calls.filter(([url]: [string]) =>
      url.includes("/tasks/111/subtasks")
    );
    expect(subtaskCreates).toHaveLength(0);
    expect(asanaDelete).toHaveBeenCalledTimes(1);
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/review-newer");
  });

  test("a Review and the FYI Review it became converge on one", async () => {
    mockAsana({
      subtasks: [
        reviewFor("review-older", "2026-09-02T21:02:19.100Z"),
        {
          ...reviewFor("fyi-newer", "2026-09-02T21:02:19.400Z"),
          name: "FYI Review - merged to master",
        },
      ],
    });
    await handlePullRequest(
      baseEvent({ action: "ready_for_review", requestedReviewers: [PEER] })
    );
    expect(asanaDelete).toHaveBeenCalledTimes(1);
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/fyi-newer");
  });

  test("a run with no rival deletes nothing", async () => {
    mockSubtasksAfterCreate([
      reviewFor("review-only", "2026-09-02T21:02:19.100Z"),
    ]);
    await handlePullRequest(
      baseEvent({ action: "ready_for_review", requestedReviewers: [PEER] })
    );
    expect(asanaDelete).not.toHaveBeenCalled();
  });
});

describe("every event restates the review state", () => {
  const ciSubtask = (approvalStatus: string) => ({
    gid: "ci-sub",
    name: "Automated CI Testing",
    resource_subtype: "approval",
    approval_status: approvalStatus,
    completed: true,
    created_by: { gid: OTTO_ASANA_ID },
    assignee: { gid: OTTO_ASANA_ID },
  });

  const readyPr = (overrides: any = {}) => ({
    state: "open",
    draft: false,
    mergeable: true,
    requested_reviewers: [{ login: PEER.githubName }],
    ...overrides,
  });

  const mockGithub = (
    pullRequest: any,
    reviews: any[] = [],
    comments: any[] = []
  ) =>
    githubGet.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith("/reviews")
          ? reviews
          : url.includes("/comments")
          ? comments
          : pullRequest,
      })
    );

  const reviewCreates = () =>
    asanaPost.mock.calls.filter(
      ([url, payload]: [string, any]) =>
        url.includes("/tasks/111/subtasks") && payload.data.name === "Review"
    );

  const commentEvent = baseEvent({
    eventName: "issue_comment",
    action: "created",
    commentUrl: "https://github.com/r/pull/42#issuecomment-3",
  });

  afterEach(() => {
    (getInput as jest.Mock).mockImplementation(() => "");
  });

  // The exact production sequence: the conflict alert cleared the Review
  // subtasks and parked the task, the author merged the base branch, otto
  // reported the conflict resolved. Driven through the entry point so the
  // wiring after the comment handler is what is under test.
  test("otto's conflict-resolved comment puts the approvals back and returns the task to review", async () => {
    mockAsana({ taskSection: "Next", subtasks: [ciSubtask("approved")] });
    mockGithub(readyPr());
    await runSync({
      eventName: "issue_comment",
      payload: {
        action: "created",
        issue: {
          number: 42,
          state: "open",
          html_url: "https://github.com/nsquared-team/some-repo/pull/42",
          body: "https://app.asana.com/0/123/111",
          pull_request: {},
        },
        comment: {
          user: { login: "otto-bot-git" },
          body: "Conflicts have been resolved. A maintainer will review the pull request shortly.",
          html_url:
            "https://github.com/nsquared-team/some-repo/pull/42#issuecomment-2",
        },
        repository: { full_name: "nsquared-team/some-repo" },
        sender: { login: "otto-bot-git" },
      },
    });
    expect(setFailed).not.toHaveBeenCalled();
    expect(movesTo("Testing / Review")).toHaveLength(1);
    expect(reviewCreates()).toHaveLength(1);
    expect(reviewCreates()[0][1].data.assignee).toBe(PEER.asanaId);
  });

  // The CI handler only re-enters review on a red-to-green verdict; a green
  // run on an already-green subtask used to leave a parked task parked.
  test("a green CI run on an already-green verdict still restores the approvals", async () => {
    (getInput as jest.Mock).mockImplementation((name: string) =>
      name === INPUTS.COMMENT_TEXT ? "approved" : ""
    );
    mockAsana({ taskSection: "Next", subtasks: [ciSubtask("approved")] });
    mockGithub(readyPr());
    await runSync({
      eventName: "pull_request",
      payload: {
        action: "synchronize",
        pull_request: {
          number: 42,
          state: "open",
          draft: false,
          html_url: "https://github.com/nsquared-team/some-repo/pull/42",
          body: "https://app.asana.com/0/123/111",
          requested_reviewers: [{ login: PEER.githubName }],
        },
        repository: { full_name: "nsquared-team/some-repo" },
        sender: { login: PEER.githubName },
      },
    });
    expect(setFailed).not.toHaveBeenCalled();
    expect(movesTo("Testing / Review")).toHaveLength(1);
    expect(reviewCreates()).toHaveLength(1);
  });

  test("a PR CI has not judged yet still gets its approvals", async () => {
    mockAsana();
    mockGithub(readyPr());
    await reconcileReviewState(commentEvent);
    expect(movesTo("Testing / Review")).toHaveLength(1);
    expect(reviewCreates()).toHaveLength(1);
  });

  test.each([
    ["a draft", readyPr({ draft: true })],
    ["a closed PR", readyPr({ state: "closed" })],
    ["a standing conflict", readyPr({ mergeable: false })],
    ["mergeability GitHub has not computed", readyPr({ mergeable: null })],
    ["a PR nobody is asked to review", readyPr({ requested_reviewers: [] })],
  ])("%s is left alone", async (_label, pullRequest) => {
    mockAsana({ subtasks: [ciSubtask("approved")] });
    mockGithub(pullRequest);
    await reconcileReviewState(commentEvent);
    expect(movesTo("Testing / Review")).toHaveLength(0);
    expect(reviewCreates()).toHaveLength(0);
  });

  test("a red CI verdict is left alone", async () => {
    mockAsana({ subtasks: [ciSubtask("rejected")] });
    mockGithub(readyPr());
    await reconcileReviewState(commentEvent);
    expect(movesTo("Testing / Review")).toHaveLength(0);
    expect(reviewCreates()).toHaveLength(0);
  });

  test("a standing changes-request keeps the task parked until its reviewer is re-requested", async () => {
    const changesRequested = [
      {
        user: { login: "some-outsider" },
        state: "CHANGES_REQUESTED",
        submitted_at: "2026-08-01T00:00:00Z",
      },
    ];
    mockAsana({ subtasks: [ciSubtask("approved")] });
    mockGithub(readyPr(), changesRequested);
    await reconcileReviewState(commentEvent);
    expect(reviewCreates()).toHaveLength(0);

    jest.clearAllMocks();
    mockAsana({ subtasks: [ciSubtask("approved")] });
    mockGithub(
      readyPr({
        requested_reviewers: [
          { login: PEER.githubName },
          { login: "some-outsider" },
        ],
      }),
      changesRequested
    );
    await reconcileReviewState(commentEvent);
    expect(reviewCreates()).toHaveLength(1);
  });

  test("a changes-request its reviewer later replaced with an approval no longer parks the task", async () => {
    mockAsana({ subtasks: [ciSubtask("approved")] });
    mockGithub(readyPr(), [
      {
        user: { login: QA.githubName },
        state: "CHANGES_REQUESTED",
        submitted_at: "2026-08-01T00:00:00Z",
      },
      {
        user: { login: QA.githubName },
        state: "APPROVED",
        submitted_at: "2026-08-02T00:00:00Z",
      },
    ]);
    await reconcileReviewState(commentEvent);
    expect(reviewCreates()).toHaveLength(1);
  });

  const silentComment = {
    id: 9,
    user: { login: PEER.githubName },
    state: "COMMENTED",
    body: "",
    submitted_at: "2026-08-02T00:00:00Z",
  };
  const opened = [{ pull_request_review_id: 9, in_reply_to_id: null }];

  test.each([
    ["with a summary", { ...silentComment, body: "one more thing" }, []],
    ["that only leaves notes on the diff", silentComment, opened],
  ])(
    "a tier reviewer's comment review %s stands as a rejection until they are re-requested",
    async (_label, review, comments) => {
      const commented = [
        {
          user: { login: PEER.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
        review,
      ];
      mockAsana({ subtasks: [ciSubtask("approved")] });
      mockGithub(readyPr({ requested_reviewers: [] }), commented, comments);
      await reconcileReviewState(commentEvent);
      expect(movesTo("Approved")).toHaveLength(0);
      expect(reviewCreates()).toHaveLength(0);

      jest.clearAllMocks();
      mockAsana({ subtasks: [ciSubtask("approved")] });
      mockGithub(readyPr(), commented, comments);
      await reconcileReviewState(commentEvent);
      expect(reviewCreates()).toHaveLength(1);
    }
  );

  test.each([
    [
      "a reply in a thread",
      readyPr({ requested_reviewers: [] }),
      [{ pull_request_review_id: 9, in_reply_to_id: 1 }],
    ],
    [
      "the author's own notes on their diff",
      readyPr({ requested_reviewers: [], user: { login: PEER.githubName } }),
      opened,
    ],
  ])("%s is not a rejection", async (_label, pullRequest, comments) => {
    mockAsana({ subtasks: [ciSubtask("approved")] });
    mockGithub(
      pullRequest,
      [
        {
          user: { login: QA.githubName },
          state: "APPROVED",
          submitted_at: "2026-08-01T00:00:00Z",
        },
        silentComment,
      ],
      comments
    );
    await reconcileReviewState(commentEvent);
    expect(movesTo("Approved")).toHaveLength(1);
  });

  test.each([
    ["a task a person completed", { taskCompleted: true }],
    ["a task in Done", { taskSection: "Done" }],
  ])("%s is not pulled back into review", async (_label, options) => {
    mockAsana({ ...options, subtasks: [ciSubtask("approved")] });
    mockGithub(readyPr());
    await reconcileReviewState(commentEvent);
    expect(movesTo("Testing / Review")).toHaveLength(0);
  });

  test("a task parked in Blocked gets its approvals but stays put", async () => {
    mockAsana({ taskSection: "Blocked", subtasks: [ciSubtask("approved")] });
    mockGithub(readyPr());
    await reconcileReviewState(commentEvent);
    expect(movesTo("Testing / Review")).toHaveLength(0);
    expect(reviewCreates()).toHaveLength(1);
  });

  test("a task already in review with its approvals in place is not given a second one", async () => {
    mockAsana({
      taskSection: "Testing / Review",
      subtasks: [
        ciSubtask("approved"),
        {
          gid: "rev-sub-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_at: "2026-08-01T00:00:00Z",
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: PEER.asanaId },
        },
      ],
    });
    mockGithub(readyPr());
    await reconcileReviewState(commentEvent);
    expect(reviewCreates()).toHaveLength(0);
    expect(asanaDelete).not.toHaveBeenCalled();
  });

  test("a comment on an issue that is not a pull request never reads one", async () => {
    mockAsana();
    await reconcileReviewState(
      baseEvent({ eventName: "issue_comment", isPullRequest: false })
    );
    expect(githubGet).not.toHaveBeenCalled();
  });

  const peerApproved = {
    user: { login: PEER.githubName },
    state: "APPROVED",
    submitted_at: "2026-08-01T00:00:00Z",
  };

  // The cascade ignores an approval given while the PR is conflicting, and
  // nothing re-ran the tally once the conflict was gone.
  test("every tier approved with nobody pending moves the task to Approved", async () => {
    mockAsana({ subtasks: [ciSubtask("approved")] });
    mockGithub(readyPr({ requested_reviewers: [] }), [peerApproved]);
    await reconcileReviewState(commentEvent);
    expect(movesTo("Approved")).toHaveLength(1);
    expect(movesTo("Testing / Review")).toHaveLength(0);
  });

  test("a pending Review subtask whose reviewer already approved on GitHub is marked approved", async () => {
    mockAsana({
      subtasks: [
        {
          gid: "rev-sub-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: PEER.asanaId },
        },
      ],
    });
    mockGithub(readyPr({ requested_reviewers: [] }), [peerApproved]);
    await reconcileReviewState(commentEvent);
    expect(asanaPut).toHaveBeenCalledWith("/tasks/rev-sub-1", {
      data: { approval_status: "approved" },
    });
  });

  test("restating a task already in Testing / Review leaves the board order alone", async () => {
    mockAsana({
      taskSection: "Testing / Review",
      subtasks: [ciSubtask("approved")],
    });
    mockGithub(readyPr());
    await reconcileReviewState(commentEvent);
    expect(movesTo("Testing / Review")).toHaveLength(0);
    expect(reviewCreates()).toHaveLength(1);
  });

  test("an approver asked to review again is waited on, not marked approved", async () => {
    mockAsana({
      subtasks: [
        {
          gid: "rev-sub-1",
          name: "Review",
          resource_subtype: "approval",
          completed: false,
          created_by: { gid: OTTO_ASANA_ID },
          assignee: { gid: PEER.asanaId },
        },
      ],
    });
    mockGithub(readyPr(), [peerApproved]);
    await reconcileReviewState(commentEvent);
    expect(asanaPut).not.toHaveBeenCalledWith("/tasks/rev-sub-1", {
      data: { approval_status: "approved" },
    });
    expect(movesTo("Approved")).toHaveLength(0);
    expect(movesTo("Testing / Review")).toHaveLength(1);
  });

  test("a dismissed reviewer is not summoned again by the re-check", async () => {
    mockAsana();
    mockGithub(readyPr({ requested_reviewers: [] }), [
      { ...peerApproved, state: "DISMISSED" },
    ]);
    await reconcileReviewState(commentEvent);
    expect(githubPost).not.toHaveBeenCalled();
    expect(movesTo("Approved")).toHaveLength(0);
  });
});
