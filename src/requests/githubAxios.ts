import axios from "axios";
import axiosRetry from "axios-retry";
import { getInput } from "@actions/core";
import { GITHUB_PAT } from "../constants/inputs";
import * as REQUESTS from "../constants/requests";

// eslint-disable-next-line import/no-named-as-default-member -- axios.create is the documented API
const githubAxios = axios.create({
  baseURL: REQUESTS.BASE_GITHUB_URL,
  headers: {
    Authorization: `Bearer ${getInput(GITHUB_PAT)}`,
  },
});

axiosRetry(githubAxios, {
  retries: REQUESTS.RETRIES,
  retryDelay: (retryCount, error) => {
    const retryAfter = Number(error?.response?.headers?.["retry-after"]);
    if (retryAfter > 0)
      return Math.min(retryAfter * 1000, REQUESTS.MAX_RETRY_DELAY);
    return retryCount * REQUESTS.RETRY_DELAY;
  },
  retryCondition: (error) => {
    const status = error?.response?.status;
    // Retrying a PR-description PATCH that already landed would append the
    // sandbox block twice.
    if (!status)
      return REQUESTS.IDEMPOTENT_METHODS.includes(
        (error?.config?.method || "").toLowerCase()
      );
    return status === 429 || String(status).startsWith("50");
  },
});

export default githubAxios;
