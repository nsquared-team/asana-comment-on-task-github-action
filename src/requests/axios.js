"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const axios_retry_1 = __importDefault(require("axios-retry"));
const core_1 = require("@actions/core");
const inputs_1 = require("../constants/inputs");
const REQUESTS = __importStar(require("../constants/requests"));
const axiosInstance = axios_1.default.create({
    baseURL: REQUESTS.BASE_URL,
    headers: {
        Authorization: `Bearer ${(0, core_1.getInput)(inputs_1.ASANA_SECRET)}`,
    },
});
(0, axios_retry_1.default)(axiosInstance, {
    retries: REQUESTS.RETRIES,
    retryDelay: (retryCount) => retryCount * REQUESTS.RETRY_DELAY,
    retryCondition: (error) => {
        var _a;
        const status = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
        if (!status)
            return true;
        return String(status).startsWith("50");
    },
});
exports.default = axiosInstance;
