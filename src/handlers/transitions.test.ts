import asanaAxios from "../requests/asanaAxios";
import githubAxios from "../requests/githubAxios";
import { handlePullRequest } from "./pullRequest";
import { handleCiStatus } from "./ci";
import { handleReview } from "./review";
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
  subtasks?: any[];
  stories?: any[];
}

const mockAsana = ({
  taskSection = "Next",
  subtasks = [],
  stories = [],
}: MockOptions = {}) => {
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
          memberships: [
            { section: { name: taskSection }, project: { gid: "proj-1" } },
          ],
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
  commentInReplyTo: undefined,
  username: "hsein-bitar",
  requestedReviewers: [],
  eventReviewer: undefined,
  ciStatus: "",
  actionUrl: "https://github.com/nsquared-team/some-repo/actions/runs/1",
  prDescriptionInput: "",
  ...overrides,
});

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
});
