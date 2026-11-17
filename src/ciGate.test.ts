import githubAxios from "./requests/githubAxios";
import { isCurrentCommit, testedCommitOf } from "./ciGate";
import { SyncEvent } from "./event";

jest.mock("@actions/core", () => ({
  getInput: jest.fn(() => ""),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
}));
jest.mock("./requests/asanaAxios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock("./requests/githubAxios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
  },
}));

const githubGet = githubAxios.get as jest.Mock;

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const event = {
  repoFullName: "nsquared-team/some-repo",
  prNumber: 42,
} as SyncEvent;

const compareOf = (
  status: string,
  subjects: string[],
  total = subjects.length
) => ({
  status,
  total_commits: total,
  commits: subjects.map((message) => ({ commit: { message } })),
});

// The PR read answers with `head`; the compare read with `compare`, or fails
// with `compareError`.
const mockGithub = ({
  head = SHA_B as string | undefined,
  compare = compareOf("ahead", ["Rework the query builder"]),
  compareError = undefined as any,
} = {}) =>
  githubGet.mockImplementation((url: string) => {
    if (url.includes("/compare/")) {
      return compareError
        ? Promise.reject(compareError)
        : Promise.resolve({ data: compare });
    }
    return Promise.resolve({ data: head ? { head: { sha: head } } : {} });
  });

const compareReads = () =>
  githubGet.mock.calls.filter(([url]: [string]) => url.includes("/compare/"));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("testedCommitOf", () => {
  /** If the tested commit is misread, a green result is judged against the wrong commit and either blocks a good PR or waves a stale one through. */
  test("reads the commit from the record's notes", () => {
    expect(
      testedCommitOf({
        notes: ` Click Here To Investigate Action \nTested commit: ${SHA_A}`,
      })
    ).toBe(SHA_A);
  });

  /** A record written before the commit was tracked must read as "no commit", not as an error. */
  test.each([
    [
      "notes with no commit line",
      { notes: " Click Here To Investigate Action " },
    ],
    ["no notes at all", {}],
    ["a commit line with no hex sha", { notes: "Tested commit: not-a-sha" }],
  ])("is empty for %s", (_label, record) => {
    expect(testedCommitOf(record)).toBe("");
  });
});

describe("isCurrentCommit", () => {
  /** A record from before commits were tracked is judged by its result alone; reading GitHub for it would hold every old PR. */
  test("an empty tested commit is current without reading GitHub", async () => {
    await expect(isCurrentCommit(event, "")).resolves.toBe(true);
    expect(githubGet).not.toHaveBeenCalled();
  });

  /** When the caller already knows the PR's head, asking GitHub again is a wasted round trip on every gated path. */
  test("the head commit itself is current without reading GitHub", async () => {
    await expect(isCurrentCommit(event, SHA_A, SHA_A)).resolves.toBe(true);
    expect(githubGet).not.toHaveBeenCalled();
  });

  /** Without a head from the caller, the PR itself must be read, or a stale green is never told apart from a current one. */
  test("reads the head from the PR when the caller gave none", async () => {
    mockGithub({ head: SHA_A });
    await expect(isCurrentCommit(event, SHA_A)).resolves.toBe(true);
    expect(githubGet).toHaveBeenCalledWith(
      "/repos/nsquared-team/some-repo/pulls/42"
    );
    expect(compareReads()).toHaveLength(0);
  });

  /** A PR whose head cannot be read must not be waved through as current. */
  test("a PR with no head is not current", async () => {
    mockGithub({ head: undefined });
    await expect(isCurrentCommit(event, SHA_A)).resolves.toBe(false);
  });

  /** Commits that only say "ci bypass" cannot change what CI tested, so a green on the commit before them still stands. */
  test("commits that are all ci bypass keep an older green current", async () => {
    mockGithub({
      compare: compareOf("ahead", [
        "Bump the changelog ci bypass",
        "Update the docs ci bypass\n\nbody text",
      ]),
    });
    await expect(isCurrentCommit(event, SHA_A, SHA_B)).resolves.toBe(true);
    expect(githubGet).toHaveBeenLastCalledWith(
      `/repos/nsquared-team/some-repo/compare/${SHA_A}...${SHA_B}`
    );
  });

  /** Only a commit's subject line can bypass CI; the phrase buried in a body must not let a real change through. */
  test("the phrase in a commit body does not count as a bypass", async () => {
    mockGithub({
      compare: compareOf("ahead", ["Fix typo in the readme\n\nci bypass"]),
    });
    await expect(isCurrentCommit(event, SHA_A, SHA_B)).resolves.toBe(false);
  });

  /** One real change after the tested commit means CI has not seen the PR's code, so the green must not clear review. */
  test("one commit that is not ci bypass makes the green stale", async () => {
    mockGithub({
      compare: compareOf("ahead", [
        "Bump the changelog ci bypass",
        "Rework the query builder",
      ]),
    });
    await expect(isCurrentCommit(event, SHA_A, SHA_B)).resolves.toBe(false);
  });

  /** The phrase is matched exactly, so a different casing must not slip a real change past CI. */
  test("the ci bypass phrase is case-sensitive", async () => {
    mockGithub({ compare: compareOf("ahead", ["Update docs CI Bypass"]) });
    await expect(isCurrentCommit(event, SHA_A, SHA_B)).resolves.toBe(false);
  });

  /** A rewritten or rebased branch has no clean path from the tested commit, so its green cannot be trusted. */
  test.each(["diverged", "behind", "identical"])(
    "a compare that is %s is stale",
    async (status) => {
      mockGithub({ compare: compareOf(status, ["Update docs ci bypass"]) });
      await expect(isCurrentCommit(event, SHA_A, SHA_B)).resolves.toBe(false);
    }
  );

  /** GitHub caps the commits a compare lists; a truncated list could hide a real change behind bypass commits. */
  test("a truncated commit list is stale", async () => {
    mockGithub({
      compare: compareOf("ahead", ["Update docs ci bypass"], 300),
    });
    await expect(isCurrentCommit(event, SHA_A, SHA_B)).resolves.toBe(false);
  });

  /** A tested commit GitHub no longer has (force-pushed away) is stale, not an error that fails the whole sync. */
  test("a compare that answers 404 is stale", async () => {
    mockGithub({
      compareError: Object.assign(new Error("Not Found"), {
        isAxiosError: true,
        response: { status: 404 },
      }),
    });
    await expect(isCurrentCommit(event, SHA_A, SHA_B)).resolves.toBe(false);
  });

  /** Any other GitHub failure is unknown, not "stale": it must surface instead of silently holding or clearing review. */
  test("any other compare error propagates", async () => {
    mockGithub({
      compareError: Object.assign(new Error("Server Error"), {
        isAxiosError: true,
        response: { status: 500 },
      }),
    });
    await expect(isCurrentCommit(event, SHA_A, SHA_B)).rejects.toThrow(
      "Server Error"
    );
  });
});
