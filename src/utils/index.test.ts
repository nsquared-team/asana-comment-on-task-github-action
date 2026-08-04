import * as utils from "./index";
import * as ERRORS from "../constants/errors";

describe("validateTrigger", () => {
  test("throws for unsupported events, including push", () => {
    expect(() => utils.validateTrigger("push")).toThrow(ERRORS.WRONG_TRIGGER);
    expect(() => utils.validateTrigger("workflow_dispatch")).toThrow(
      ERRORS.WRONG_TRIGGER
    );
  });

  test("accepts the supported events", () => {
    expect(() => utils.validateTrigger("pull_request")).not.toThrow();
    expect(() => utils.validateTrigger("pull_request_review")).not.toThrow();
    expect(() =>
      utils.validateTrigger("pull_request_review_comment")
    ).not.toThrow();
    expect(() => utils.validateTrigger("issue_comment")).not.toThrow();
  });
});

describe("extractAsanaTaskIds", () => {
  test("extracts ids from task/ and /0/ url formats and dedupes", () => {
    const description = [
      "Task: https://app.asana.com/0/1202711048810575/1234567890/f",
      "Also https://app.asana.com/1/123/project/456/task/9876543210",
      "Dup https://app.asana.com/0/1202711048810575/1234567890",
    ].join("\n");
    expect(utils.extractAsanaTaskIds(description)).toEqual([
      "1234567890",
      "9876543210",
    ]);
  });

  test("returns empty for no links or empty body", () => {
    expect(utils.extractAsanaTaskIds(undefined)).toEqual([]);
    expect(utils.extractAsanaTaskIds("no links here")).toEqual([]);
  });
});

describe("pickReviewerTier", () => {
  const peer = { githubName: "p", team: "PEER_DEV" };
  const dev = { githubName: "d", team: "DEV" };
  const qa = { githubName: "q", team: "QA" };

  test("peer devs outrank dev, dev outranks qa", () => {
    expect(utils.pickReviewerTier([qa, dev, peer])).toEqual([peer]);
    expect(utils.pickReviewerTier([qa, dev])).toEqual([dev]);
    expect(utils.pickReviewerTier([qa])).toEqual([qa]);
  });

  test("ignores unknown (undefined) reviewers instead of crashing", () => {
    expect(utils.pickReviewerTier([undefined, qa])).toEqual([qa]);
    expect(utils.pickReviewerTier([])).toEqual([]);
  });
});

describe("findUserByGithubName", () => {
  test("returns undefined for unknown users", () => {
    expect(utils.findUserByGithubName("dependabot[bot]")).toBeUndefined();
    expect(utils.findUserByGithubName(undefined)).toBeUndefined();
  });
});

describe("isReviewTier", () => {
  test("only the three human tiers count as a review tier", () => {
    expect(utils.isReviewTier({ team: "PEER_DEV" })).toBe(true);
    expect(utils.isReviewTier({ team: "DEV" })).toBe(true);
    expect(utils.isReviewTier({ team: "QA" })).toBe(true);
    expect(utils.isReviewTier({ team: "BOT" })).toBe(false);
    expect(utils.isReviewTier(undefined)).toBe(false);
  });
});

describe("isAxiosError", () => {
  test("a non-object throw returns false instead of throwing in the catch", () => {
    expect(() => utils.isAxiosError(null)).not.toThrow();
    expect(utils.isAxiosError(null)).toBe(false);
    expect(utils.isAxiosError(undefined)).toBe(false);
    expect(utils.isAxiosError(new Error("plain"))).toBe(false);
    expect(utils.isAxiosError({ isAxiosError: true })).toBe(true);
  });
});
