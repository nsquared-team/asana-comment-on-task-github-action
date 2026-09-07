export const INBOX = "Inbox (new ideas)";
export const RECURRING = "Recurring";
export const NEEDS_SPEC = "Needs Spec";
export const ROCKS = "Rocks";
export const SOON = "Soon";
export const BUGS = "Bugs 🙄🙁😦😢😭";
export const BLOCKED_WAITING = "Blocked / Waiting";
export const BLOCKED = "Blocked";
export const NEXT = "Next";
export const IN_PROGRESS = "In Progress";
export const TESTING_REVIEW = "Testing / Review";
export const APPROVED = "Approved";
export const RELEASED_ALPHA = "Released in Alpha";
export const RELEASED_BETA = "Released in Beta";
export const RELEASED = "Released";
export const RELEASED_PAID = "Released (paid editions)";
export const RELEASED_FREE = "Released (free wp.org)";
export const UPDATE_WEB_DOC = "Update Website/Documentation";
export const PROMOTE_NOTIFY = "Promote / Notify";
export const DONE = "Done";
export const SOMEDAY = "Someday";

// Section names differ across boards ("Blocked" on the app boards,
// "Blocked / Waiting" elsewhere) — always match both.
export const BLOCKED_SECTIONS = [BLOCKED, BLOCKED_WAITING];

export const RELEASED_SECTIONS = [
  RELEASED_ALPHA,
  RELEASED_BETA,
  RELEASED,
  RELEASED_PAID,
  RELEASED_FREE,
];

// Demotions never pull a task out of active work or released columns.
export const PROTECTED_FROM_DEMOTION = [IN_PROGRESS, ...RELEASED_SECTIONS];

// The draft rule is the one transition that respects Blocked.
export const PROTECTED_FROM_DRAFT = [...BLOCKED_SECTIONS, ...RELEASED_SECTIONS];

// Repos with staged releases map the merge base branch to a release column;
// every other repo just lands in Done. Tasks are never auto-completed.
const RELEASE_SECTION_BY_BASE: { [base: string]: string } = {
  master: RELEASED_ALPHA,
  beta: RELEASED_BETA,
  production: RELEASED,
};

// The branches a merge actually ships to. An "FYI Review" label names one of
// these; every other merge base is a sub-PR.
export const RELEASE_BRANCHES = Object.keys(RELEASE_SECTION_BY_BASE);

const STAGED_RELEASE_REPOS = ["aaardvark-app", "blinkmetrics-app"];

// undefined means "merged, but nothing shipped" - a stacked PR landing on
// another feature branch of a staged-release repo. Those tasks keep their
// section; only a merge into a real release branch moves them.
export const sectionForMerge = (
  repoName: string,
  baseRef: string
): string | undefined => {
  const shortName = repoName.split("/").pop() || repoName;
  if (STAGED_RELEASE_REPOS.includes(shortName)) {
    return RELEASE_SECTION_BY_BASE[baseRef];
  }
  return DONE;
};
