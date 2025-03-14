"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAxiosError = exports.validateProjectLists = exports.validateTrigger = exports.getProjectsFromInput = void 0;
const core_1 = require("@actions/core");
const ERRORS = __importStar(require("../constants/errors"));
const TRIGGERS = __importStar(require("../constants/triggers"));
const getProjectsFromInput = (inputName) => {
    const projects = (0, core_1.getInput)(inputName);
    if (!projects)
        return [];
    return projects.split("\n").map((gid) => `${gid}`);
};
exports.getProjectsFromInput = getProjectsFromInput;
const validateTrigger = (eventName) => {
    if (!TRIGGERS.allowed.includes(eventName))
        throw new Error(ERRORS.WRONG_TRIGGER);
};
exports.validateTrigger = validateTrigger;
const validateProjectLists = (allowedProjects, blockedProjects) => {
    if (allowedProjects.length > 0 && blockedProjects.length > 0)
        throw new Error(ERRORS.BOTH_PROJECT_LISTS_ARE_NOT_EMPTY);
};
exports.validateProjectLists = validateProjectLists;
const isAxiosError = (e) => e.isAxiosError;
exports.isAxiosError = isAxiosError;
