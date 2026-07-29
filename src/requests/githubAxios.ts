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
  retryDelay: (retryCount) => retryCount * REQUESTS.RETRY_DELAY,
  retryCondition: (error) => {
    const status = error?.response?.status;
    if (!status) return true;
    return String(status).startsWith("50");
  },
});

export default githubAxios;
