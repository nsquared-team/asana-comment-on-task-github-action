import asanaAxios from "../requests/asanaAxios";
import githubAxios from "../requests/githubAxios";
import { handlePullRequest } from "./pullRequest";
import { handleCiStatus } from "./ci";
import { handleReview } from "./review";
import { handleComment } from "./comment";
import { SyncEvent } from "../event";

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
  subtasks?: any[];
  stories?: any[];
}

const mockAsana = ({
  taskSection = "Next",
  taskSections,
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
    mockAsana();
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

describe("reviews", () => {
  test("a comment review never demotes the task", async () => {
    mockAsana();
    await handleReview(
      baseEvent({
        eventName: "pull_request_review",
        action: "submitted",
        reviewState: "commented",
        reviewBody: "looks good, one thought",
        rawCommentBody: "looks good, one thought",
        commentUrl: "https://github.com/r/pull/42#review-1",
      })
    );
    expect(movesTo("Next")).toHaveLength(0);
    expect(asanaPut).not.toHaveBeenCalledWith(
      "/tasks/111",
      expect.objectContaining({ data: { completed: false } })
    );
  });

  test("changes_requested demotes to Next and reopens the task", async () => {
    mockAsana();
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
    // The review is still over, so its subtask still goes.
    expect(asanaDelete).toHaveBeenCalledWith("/tasks/review-1");
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

  test("an approval that predates otto's changes-request no longer counts", async () => {
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
    expect(movesTo("Approved")).toHaveLength(0);
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
