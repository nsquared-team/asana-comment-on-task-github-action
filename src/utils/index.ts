import { AxiosError } from "axios";
import * as ERRORS from "../constants/errors";
import * as TRIGGERS from "../constants/triggers";
import { users } from "../constants/users";

export const validateTrigger = (eventName: string) => {
  if (!TRIGGERS.allowed.includes(eventName))
    throw new Error(ERRORS.WRONG_TRIGGER);
};

export const isAxiosError = (e: any): e is AxiosError => e.isAxiosError;

export const findUserByGithubName = (githubName?: string) =>
  users.find((user) => user.githubName === githubName);

export const extractAsanaTaskIds = (description?: string): string[] => {
  const links =
    description?.match(/\bhttps?:\/\/\b(app\.asana\.com)\b\S+/gi) || [];
  const ids = links
    .map((link) => {
      const match = link.match(/task\/(\d+)|\/0\/\d+\/(\d+)/);
      return match ? match[1] || match[2] : null;
    })
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
};

// Review responsibility cascades PEER_DEV -> DEV -> QA: only the
// highest-priority tier present among the requested reviewers is active.
export const pickReviewerTier = (reviewers: any[]): any[] => {
  const known = reviewers.filter(Boolean);
  const peer = known.filter((reviewer) => reviewer.team === "PEER_DEV");
  if (peer.length) return peer;
  const dev = known.filter((reviewer) => reviewer.team === "DEV");
  if (dev.length) return dev;
  return known.filter((reviewer) => reviewer.team === "QA");
};
