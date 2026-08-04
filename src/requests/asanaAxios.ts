import axios from "axios";
import axiosRetry from "axios-retry";
import { getInput } from "@actions/core";
import { ASANA_PAT } from "../constants/inputs";
import * as REQUESTS from "../constants/requests";

// eslint-disable-next-line import/no-named-as-default-member -- axios.create is the documented API
const asanaAxios = axios.create({
  baseURL: REQUESTS.BASE_ASANA_URL,
  headers: {
    Authorization: `Bearer ${getInput(ASANA_PAT)}`,
  },
});

axiosRetry(asanaAxios, {
  retries: REQUESTS.RETRIES,
  retryDelay: (retryCount, error) => {
    const retryAfter = Number(error?.response?.headers?.["retry-after"]);
    if (retryAfter > 0)
      return Math.min(retryAfter * 1000, REQUESTS.MAX_RETRY_DELAY);
    return retryCount * REQUESTS.RETRY_DELAY;
  },
  retryCondition: (error) => {
    const status = error?.response?.status;
    // Retrying a POST that timed out after Asana already applied it would
    // duplicate a comment or an approval subtask.
    if (!status)
      return REQUESTS.IDEMPOTENT_METHODS.includes(
        (error?.config?.method || "").toLowerCase()
      );
    // 429 is Asana's rate limit and is exactly what a retry is for.
    return status === 429 || String(status).startsWith("50");
  },
});

export default asanaAxios;
