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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApprovalSubtask = exports.addApprovalTask = exports.moveTaskToSection = exports.getAllApprovalSubtasks = exports.deleteApprovalTasks = exports.cleanupApprovalTasks = exports.addRequestedReview = exports.run = void 0;
const core_1 = require("@actions/core");
const github_1 = require("@actions/github");
const utils = __importStar(require("./utils"));
const INPUTS = __importStar(require("./constants/inputs"));
const asanaAxios_1 = __importDefault(require("./requests/asanaAxios"));
const REQUESTS = __importStar(require("./constants/requests"));
const SECTIONS = __importStar(require("./constants/sections"));
const users_1 = require("./constants/users");
const githubAxios_1 = __importDefault(require("./requests/githubAxios"));
const allowedProjects = utils.getProjectsFromInput(INPUTS.ALLOWED_PROJECTS);
const blockedProjects = utils.getProjectsFromInput(INPUTS.BLOCKED_PROJECTS);
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3;
    try {
        // Validate Inputs
        const eventName = github_1.context.eventName;
        const action = github_1.context.payload.action;
        utils.validateTrigger(eventName);
        utils.validateProjectLists(allowedProjects, blockedProjects);
        console.log("context.payload", github_1.context.payload);
        // Store Constant Values
        const today = new Date();
        const ci_status = (0, core_1.getInput)(INPUTS.COMMENT_TEXT);
        const action_url = (0, core_1.getInput)(INPUTS.ACTION_URL);
        const todayArray = today.toISOString().split('T');
        const timeArray = todayArray[1].split(':');
        const formattedDate = todayArray[0] + " " + timeArray[0] + ":" + timeArray[1] + " UTC";
        const new_pr_description = `## CI/QA Testing Sandbox (${formattedDate}) ## \n ${(0, core_1.getInput)(INPUTS.PR_DESCRIPTION)}`;
        const mentionUrl = "https://app.asana.com/0/";
        const repoName = (_a = github_1.context.payload.repository) === null || _a === void 0 ? void 0 : _a.full_name;
        const pullRequestDescription = ((_b = github_1.context.payload.pull_request) === null || _b === void 0 ? void 0 : _b.body) || ((_c = github_1.context.payload.issue) === null || _c === void 0 ? void 0 : _c.body);
        const pullRequestId = ((_d = github_1.context.payload.pull_request) === null || _d === void 0 ? void 0 : _d.number) || ((_e = github_1.context.payload.issue) === null || _e === void 0 ? void 0 : _e.number);
        const pullRequestURL = ((_f = github_1.context.payload.pull_request) === null || _f === void 0 ? void 0 : _f.html_url) || ((_g = github_1.context.payload.issue) === null || _g === void 0 ? void 0 : _g.html_url);
        const pullRequestState = ((_h = github_1.context.payload.pull_request) === null || _h === void 0 ? void 0 : _h.state) || ((_j = github_1.context.payload.issue) === null || _j === void 0 ? void 0 : _j.state);
        const pullRequestMerged = ((_k = github_1.context.payload.pull_request) === null || _k === void 0 ? void 0 : _k.merged) || false;
        const pullRequestBaseBranch = ((_l = github_1.context.payload.pull_request) === null || _l === void 0 ? void 0 : _l.base.ref) || "";
        const acceptedReviewStates = ["approved", "pending", "changes_requested"];
        const reviewState = ((_m = github_1.context.payload.review) === null || _m === void 0 ? void 0 : _m.state) || "";
        const reviewBody = ((_o = github_1.context.payload.review) === null || _o === void 0 ? void 0 : _o.body) || "";
        const commentUrl = ((_p = github_1.context.payload.comment) === null || _p === void 0 ? void 0 : _p.html_url) ||
            ((_q = github_1.context.payload.review) === null || _q === void 0 ? void 0 : _q.html_url) ||
            "";
        // Store Conditions
        const prClosedMerged = eventName === "pull_request" &&
            action === "closed" &&
            ((_r = github_1.context.payload.pull_request) === null || _r === void 0 ? void 0 : _r.merged);
        const prReviewChangesRequested = eventName === "pull_request_review" &&
            reviewState === "changes_requested";
        const prReviewCommented = eventName === "pull_request_review" &&
            reviewState === "commented";
        const prReviewRequested = eventName === "pull_request" &&
            !((_s = github_1.context.payload.pull_request) === null || _s === void 0 ? void 0 : _s.draft) &&
            action === "review_requested";
        const prReadyForReview = eventName === "pull_request" &&
            action === "ready_for_review";
        const prReviewSubmitted = eventName === "pull_request_review" && action === "submitted";
        const prApproved = eventName === "pull_request_review" &&
            action === "submitted" &&
            reviewState === "approved";
        const prSynchronize = eventName === "pull_request" &&
            action === "synchronize";
        const prPush = eventName === "push";
        // Store User That Triggered Job
        const username = ((_t = github_1.context.payload.comment) === null || _t === void 0 ? void 0 : _t.user.login) ||
            ((_u = github_1.context.payload.review) === null || _u === void 0 ? void 0 : _u.user.login) ||
            ((_v = github_1.context.payload.sender) === null || _v === void 0 ? void 0 : _v.login);
        const userObj = users_1.users.find((user) => user.githubName === username);
        const userUrl = mentionUrl.concat(userObj === null || userObj === void 0 ? void 0 : userObj.asanaUrlId);
        const userHTML = `<a href="${userUrl}">@${userObj === null || userObj === void 0 ? void 0 : userObj.asanaName}</a>`;
        // Store Otto
        const ottoObj = users_1.users.find((user) => user.githubName === "otto-bot-git");
        // Store Requested Reviewers
        const requestedReviewers = ((_w = github_1.context.payload.pull_request) === null || _w === void 0 ? void 0 : _w.requested_reviewers) || [];
        let requestedReviewersObjs = [];
        for (const reviewer of requestedReviewers) {
            const reviewerObj = users_1.users.find((user) => user.githubName === reviewer.login);
            requestedReviewersObjs.push(reviewerObj);
        }
        let QA_requestedReviewersObjs = requestedReviewersObjs.filter((reviewer) => reviewer.team === "QA") || [];
        let DEV_requestedReviewersObjs = requestedReviewersObjs.filter((reviewer) => reviewer.team === "DEV") || [];
        let PEER_DEV_requestedReviewersObjs = requestedReviewersObjs.filter((reviewer) => reviewer.team === "PEER_DEV") || [];
        // Add User to Followers
        const followersStatus = [];
        let followers = [userObj === null || userObj === void 0 ? void 0 : userObj.asanaId];
        // Add Requested Reviewers to Followers
        for (const reviewer of !PEER_DEV_requestedReviewersObjs.length ? (!DEV_requestedReviewersObjs.length ? QA_requestedReviewersObjs : DEV_requestedReviewersObjs) : PEER_DEV_requestedReviewersObjs) {
            followers.push(reviewer === null || reviewer === void 0 ? void 0 : reviewer.asanaId);
        }
        // Get Task IDs From PR Description
        const asanaTasksLinks = pullRequestDescription === null || pullRequestDescription === void 0 ? void 0 : pullRequestDescription.match(/\bhttps?:\/\/\b(app\.asana\.com)\b\S+/gi);
        const asanaTasksIds = (asanaTasksLinks === null || asanaTasksLinks === void 0 ? void 0 : asanaTasksLinks.map((link) => {
            let taskNumberMatch = link === null || link === void 0 ? void 0 : link.match(/task\/(\d+)|\/\d+\/(\d+)\/f/);
            if (taskNumberMatch) {
                if (taskNumberMatch[1]) {
                    return taskNumberMatch[1];
                }
                if (taskNumberMatch[2]) {
                    return taskNumberMatch[2];
                }
            }
            return null;
        }).filter(id => id)) || [];
        console.log("asanaTasksIds", asanaTasksIds);
        // Check if Automated CI Testing
        if (prSynchronize || prPush) {
            if (ci_status === "edit_pr_description") {
                // Retrieve Body of PR
                const githubUrl = `${REQUESTS.REPOS_URL}${repoName}${REQUESTS.PULLS_URL}${pullRequestId}`;
                let pullRequestDescription = (yield githubAxios_1.default.get(githubUrl).then((response) => response.data.body)) || "";
                let body = "";
                if (pullRequestDescription === null || pullRequestDescription === void 0 ? void 0 : pullRequestDescription.includes("A list of unique sandbox sites was created")) {
                    body = pullRequestDescription.replace(/## CI\/QA Testing Sandbox(.|\n|\r)*Please comment and open a new review on this pull request if you find any issues when testing the preview release zip files./ig, new_pr_description);
                }
                else {
                    body = (pullRequestDescription === null || pullRequestDescription === void 0 ? void 0 : pullRequestDescription.concat("\n\n" + new_pr_description)) || "";
                }
                yield githubAxios_1.default.patch(githubUrl, {
                    body
                });
                return;
            }
            const task_notes = `<a href='${action_url}'> Click Here To Investigate Action </a>`;
            for (const id of asanaTasksIds) {
                if (id) {
                    const approvalSubtask = yield (0, exports.getApprovalSubtask)(id, true, ottoObj);
                    // Check If Subtask Found
                    if (approvalSubtask) {
                        // Check If Subtask rejected -> approved
                        // Add Review Subtasks for PEER or DEV or QA
                        if (approvalSubtask.approval_status === "rejected" && ci_status === "approved") {
                            (0, exports.moveTaskToSection)(id, SECTIONS.TESTING_REVIEW, [SECTIONS.APPROVED, SECTIONS.RELEASED_BETA, SECTIONS.RELEASED_PAID, SECTIONS.RELEASED_FREE]);
                            for (const reviewer of !PEER_DEV_requestedReviewersObjs.length ? (!DEV_requestedReviewersObjs.length ? QA_requestedReviewersObjs : DEV_requestedReviewersObjs) : PEER_DEV_requestedReviewersObjs) {
                                (0, exports.addRequestedReview)(id, reviewer, pullRequestURL);
                            }
                        }
                        // Check if Subtask approved -> rejected
                        // Delete All approval tasks and move to next
                        if (approvalSubtask.approval_status === "approved" && ci_status === "rejected") {
                            const approvalSubtasks = yield (0, exports.getAllApprovalSubtasks)(id, ottoObj);
                            (0, exports.deleteApprovalTasks)(approvalSubtasks);
                            (0, exports.moveTaskToSection)(id, SECTIONS.NEXT, [SECTIONS.IN_PROGRESS, SECTIONS.RELEASED_BETA, SECTIONS.RELEASED_PAID, SECTIONS.RELEASED_FREE]);
                        }
                        yield asanaAxios_1.default.put(`${REQUESTS.TASKS_URL}${approvalSubtask.gid}`, {
                            data: {
                                due_on: today.toISOString().substring(0, 10),
                                approval_status: ci_status,
                                html_notes: "<body>" + task_notes + "</body>"
                            },
                        });
                        continue;
                    }
                }
                console.log("ci_status", ci_status);
                if (ci_status === "rejected") {
                    if (id) {
                        const approvalSubtasks = yield (0, exports.getAllApprovalSubtasks)(id, ottoObj);
                        (0, exports.deleteApprovalTasks)(approvalSubtasks);
                        (0, exports.moveTaskToSection)(id, SECTIONS.NEXT, [SECTIONS.IN_PROGRESS, SECTIONS.RELEASED_BETA, SECTIONS.RELEASED_PAID, SECTIONS.RELEASED_FREE]);
                    }
                }
                if (id) {
                    (0, exports.addApprovalTask)(id, ottoObj, "Automated CI Testing", ci_status, task_notes);
                }
            }
            return;
        }
        // Get Arrows and Replace Them   
        let commentBody = ((_x = github_1.context.payload.comment) === null || _x === void 0 ? void 0 : _x.body) || ((_y = github_1.context.payload.review) === null || _y === void 0 ? void 0 : _y.body) || "";
        const isReply = commentBody.charAt(0) === ">";
        if (commentBody.includes(">") || commentBody.includes("<")) {
            if (isReply) {
                const lines = commentBody.split("\n");
                commentBody = lines.filter(function (line) {
                    return line.indexOf(">") !== 0;
                });
                commentBody.shift();
                commentBody = commentBody.join("");
            }
            commentBody = commentBody.replace(/>/g, "");
            commentBody = commentBody.replace(/</g, "");
        }
        // Get Images/Links and Attach Them 
        const links = commentBody.match(/\bhttps?:\/\/\S+[\w|\/]/gi) || [];
        links.forEach((link) => {
            const linkRegex = link.replace(/\//gi, "\\/");
            const linkSite = link.replace(/.+\/\/|www.|\..+/g, '');
            const capitalLinkSite = linkSite.charAt(0).toUpperCase() + linkSite.slice(1);
            // Images
            if (commentBody.includes(`src="${link}"`)) {
                const imageRegex = new RegExp(`img[\\w\\W]+?${linkRegex}"`, 'gi');
                commentBody = commentBody.replace(imageRegex, `<a href="${link}"> 🔗 Image Attachment 🔗 </a>`);
                // HyperLinks
            }
            else if (commentBody.includes(`(${link})`)) {
                const hyperlinkRegex = new RegExp(`\\[(.+?)\\]\\(${linkRegex}\\)`, 'gi');
                var hyperlink = hyperlinkRegex.exec(commentBody) || `🔗 ${capitalLinkSite} Link 🔗 `;
                commentBody = commentBody.replace(hyperlinkRegex, `<a href="${link}"> 🔗 ${hyperlink[1]} 🔗 </a>`);
                // Links
            }
            else {
                let defaultRegex = new RegExp(`\\S*?(${linkRegex}[^\\/]).*?`, 'gi');
                const match = commentBody.match(defaultRegex);
                if (!match) {
                    link = link.replace(/\?/gi, "\\?");
                    defaultRegex = new RegExp(`\\S*?(${link}).*?`, 'gi');
                }
                link = link.replace(/\/$/, '');
                commentBody = commentBody.replace(defaultRegex, `<a href="${link}"> 🔗 ${capitalLinkSite} Link 🔗 </a>`);
            }
        });
        // Get Mentioned Users In Comment
        const mentions = commentBody.match(/@\S+\w/gi) || []; // @user1 @user2
        for (const mention of mentions) {
            const mentionUserObj = users_1.users.find((user) => user.githubName === mention.substring(1, mention.length));
            // Add to Followers
            if (mentionUserObj) {
                followers.push(mentionUserObj.asanaId);
            }
            // Add To Comment
            const mentionUserUrl = mentionUrl.concat(mentionUserObj === null || mentionUserObj === void 0 ? void 0 : mentionUserObj.asanaUrlId);
            const mentionHTML = `<a href="${mentionUserUrl}">@${mentionUserObj === null || mentionUserObj === void 0 ? void 0 : mentionUserObj.asanaName}</a>`;
            commentBody = commentBody.replace(mention, mentionHTML);
        }
        // Check if PR has Merge Conflicts
        const prMergeConflicts = eventName === "issue_comment" &&
            username === "otto-bot-git" &&
            commentBody.includes("This pull request has conflicts");
        if (prMergeConflicts) {
            // Move Asana Task To Next Section and Mark Incomplete
            for (const id of asanaTasksIds) {
                if (id) {
                    (0, exports.moveTaskToSection)(id, SECTIONS.NEXT, [SECTIONS.IN_PROGRESS, SECTIONS.RELEASED_BETA, SECTIONS.RELEASED_PAID, SECTIONS.RELEASED_FREE]);
                    yield asanaAxios_1.default.put(`${REQUESTS.TASKS_URL}${id}`, {
                        data: {
                            completed: false,
                        },
                    });
                }
            }
        }
        if (prReviewRequested || prReadyForReview) {
            // Move Tasks to Testing Review
            for (const id of asanaTasksIds) {
                if (id) {
                    (0, exports.moveTaskToSection)(id, SECTIONS.TESTING_REVIEW);
                }
            }
            // Create Approval Tasks For Reviewers
            for (const reviewer of !PEER_DEV_requestedReviewersObjs.length ? (!DEV_requestedReviewersObjs.length ? QA_requestedReviewersObjs : DEV_requestedReviewersObjs) : PEER_DEV_requestedReviewersObjs) {
                for (const id of asanaTasksIds) {
                    if (id) {
                        (0, exports.addRequestedReview)(id, reviewer, pullRequestURL);
                    }
                }
            }
            // Delete Duplicate Tasks
            setTimeout(function () {
                return __awaiter(this, void 0, void 0, function* () {
                    for (const id of asanaTasksIds) {
                        // Get Duplicate Approval Tasks
                        const isDuplicate = [];
                        if (id) {
                            const approvalSubtasks = yield (0, exports.getAllApprovalSubtasks)(id, ottoObj);
                            approvalSubtasks.reduce((counter, subtask) => {
                                isDuplicate[subtask.gid] = false;
                                if (!subtask.completed) {
                                    counter[subtask.assignee.gid] = ++counter[subtask.assignee.gid] || 0;
                                }
                                if (counter[subtask.assignee.gid] > 0) {
                                    isDuplicate[subtask.gid] = true;
                                }
                                return counter;
                            }, {});
                            // Delete Approval Tasks
                            const duplicateApprovalSubtasks = approvalSubtasks.filter((subtask) => isDuplicate[subtask.gid]);
                            if (duplicateApprovalSubtasks.length > 0) {
                                (0, exports.deleteApprovalTasks)(duplicateApprovalSubtasks);
                            }
                        }
                    }
                });
            }, 20000); // Timeout 20 seconds in case another job is still creating tasks
        }
        if (prReviewSubmitted) {
            for (const id of asanaTasksIds) {
                if (id) {
                    const approvalSubtask = yield (0, exports.getApprovalSubtask)(id, false, userObj);
                    // Update Approval Subtask Of User
                    if (approvalSubtask) {
                        // Get Correct State
                        let finalState = "";
                        if (prReviewCommented && reviewBody) {
                            finalState = "changes_requested";
                        }
                        else if (acceptedReviewStates.includes(reviewState)) {
                            finalState = reviewState;
                        }
                        if (finalState) {
                            yield asanaAxios_1.default.put(`${REQUESTS.TASKS_URL}${approvalSubtask.gid}`, {
                                data: {
                                    approval_status: finalState,
                                },
                            });
                        }
                    }
                }
            }
        }
        // Check If PR Closed and Merged 
        if (prClosedMerged) {
            setTimeout(() => __awaiter(void 0, void 0, void 0, function* () {
                for (const id of asanaTasksIds) {
                    if (id) {
                        const approvalSubtasks = yield (0, exports.getAllApprovalSubtasks)(id, ottoObj);
                        (0, exports.deleteApprovalTasks)(approvalSubtasks);
                        (0, exports.moveTaskToSection)(id, pullRequestBaseBranch !== "master" ? SECTIONS.DONE : SECTIONS.RELEASED_BETA);
                        if (pullRequestBaseBranch !== "master") {
                            yield asanaAxios_1.default.put(`${REQUESTS.TASKS_URL}${id}`, {
                                data: {
                                    completed: true,
                                },
                            });
                        }
                    }
                }
            }), 60000);
        }
        // Check If PR Review is Changes Requested 
        if (prReviewChangesRequested) {
            setTimeout(() => __awaiter(void 0, void 0, void 0, function* () {
                for (const id of asanaTasksIds) {
                    if (id) {
                        const approvalSubtasks = yield (0, exports.getAllApprovalSubtasks)(id, ottoObj);
                        (0, exports.deleteApprovalTasks)(approvalSubtasks);
                        (0, exports.moveTaskToSection)(id, SECTIONS.NEXT);
                        yield asanaAxios_1.default.put(`${REQUESTS.TASKS_URL}${id}`, {
                            data: {
                                completed: false,
                            },
                        });
                    }
                }
            }), 60000);
        }
        // Check If PR Review is Commented 
        if (prReviewCommented) {
            setTimeout(() => __awaiter(void 0, void 0, void 0, function* () {
                for (const id of asanaTasksIds) {
                    if (id) {
                        (0, exports.moveTaskToSection)(id, SECTIONS.NEXT);
                        yield asanaAxios_1.default.put(`${REQUESTS.TASKS_URL}${id}`, {
                            data: {
                                completed: false,
                            },
                        });
                    }
                }
            }), 60000);
        }
        // Check if PR Review Approved
        if (prApproved) {
            // Retrieve All Reviews of PR
            const githubUrl = `${REQUESTS.REPOS_URL}${repoName}${REQUESTS.PULLS_URL}${pullRequestId}${REQUESTS.REVIEWS_URL}`;
            let reviews = yield githubAxios_1.default.get(githubUrl).then((response) => response.data);
            let is_approved_by_qa = true;
            let is_approved_by_dev = true;
            let is_approved_by_peer = true;
            // Get Latest Reviews
            let latest_reviews = [];
            for (let i = 0; i < reviews.length; i++) {
                const review = reviews[i];
                const githubName = review.user.login;
                const state = review.state;
                const timestamp = review.submitted_at;
                const reviewerObj = users_1.users.find((user) => user.githubName === githubName);
                if (state === "CHANGES_REQUESTED" || state === "APPROVED") {
                    if (!latest_reviews[githubName] || latest_reviews[githubName].timestamp < timestamp) {
                        latest_reviews[githubName] = {
                            state,
                            timestamp,
                            info: reviewerObj
                        };
                    }
                }
            }
            // Add Pending Reviews
            for (let i = 0; i < requestedReviewersObjs.length; i++) {
                const reviewer = requestedReviewersObjs[i];
                const githubName = reviewer.githubName;
                if (!latest_reviews[githubName] || latest_reviews[githubName].state !== "APPROVED") {
                    latest_reviews[githubName] = {
                        state: "PENDING",
                        timestamp: null,
                        info: reviewer
                    };
                }
            }
            // Check if PEER/QA/DEV Reviewers Approved
            for (var reviewer in latest_reviews) {
                const review = latest_reviews[reviewer];
                const team = review.info.team;
                const state = review.state;
                if (state !== "APPROVED") {
                    team === "PEER" ? is_approved_by_peer = false : (team === "DEV" ? is_approved_by_dev = false : is_approved_by_qa = false);
                }
            }
            ;
            // Check If Should Create DEV Tasks
            if (is_approved_by_peer && !is_approved_by_dev) {
                DEV_requestedReviewersObjs.forEach((reviewer) => __awaiter(void 0, void 0, void 0, function* () {
                    followers.push(reviewer === null || reviewer === void 0 ? void 0 : reviewer.asanaId);
                    for (const id of asanaTasksIds) {
                        if (id) {
                            (0, exports.addRequestedReview)(id, reviewer, pullRequestURL);
                        }
                    }
                }));
            }
            // Check If Should Create QA Tasks
            if (is_approved_by_peer && is_approved_by_dev && !is_approved_by_qa) {
                QA_requestedReviewersObjs.forEach((reviewer) => __awaiter(void 0, void 0, void 0, function* () {
                    followers.push(reviewer === null || reviewer === void 0 ? void 0 : reviewer.asanaId);
                    for (const id of asanaTasksIds) {
                        if (id) {
                            (0, exports.addRequestedReview)(id, reviewer, pullRequestURL);
                        }
                    }
                }));
            }
            // Check If Should Move To Approved
            if (is_approved_by_peer && is_approved_by_dev && is_approved_by_qa) {
                for (const id of asanaTasksIds) {
                    if (id) {
                        (0, exports.moveTaskToSection)(id, SECTIONS.APPROVED);
                    }
                }
            }
        }
        // Call Asana Axios To Add Followers To the Tasks
        for (const id of asanaTasksIds) {
            const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.ADD_FOLLOWERS_URL}`;
            followers = followers.filter(function (follower) {
                return follower !== undefined;
            });
            const followersResult = yield asanaAxios_1.default.post(url, {
                data: {
                    followers,
                },
            });
            followersStatus.push({ taskId: id, status: followersResult.status });
        }
        // Get Correct Dynamic Comment
        let commentText = "";
        switch (eventName) {
            case "issue_comment": {
                if (isReply) {
                    commentText = `<body> ${userHTML} <a href="${commentUrl}">replied</a>:\n\n${commentBody} </body>`;
                }
                else {
                    commentText =
                        username === "otto-bot-git"
                            ? `<body> ${commentBody}\n<a href="${commentUrl}">Comment URL</a> </body>`
                            : `<body> ${userHTML} <a href="${commentUrl}">commented</a>:\n\n${commentBody} </body>`;
                }
                break;
            }
            case "pull_request_review":
                switch (reviewState) {
                    case "commented":
                    case "changes_requested":
                        if (!commentBody || action === "edited") {
                            return;
                        }
                        commentText = `<body> ${userHTML} is requesting the following <a href="${commentUrl}">changes</a>:\n\n${commentBody} </body>`;
                        break;
                    case "approved":
                        if (!commentBody) {
                            return;
                        }
                        commentText = `<body> ${userHTML} approved with the following <a href="${commentUrl}">comment</a>:\n\n${commentBody} </body>`;
                        break;
                    default:
                        commentText = `<body> <a href="${commentUrl}">PR #${pullRequestId}</a> is ${reviewState} by ${userHTML} </body>`;
                        break;
                }
                break;
            case "pull_request":
                if (action === "review_requested" ||
                    action === "ready_for_review" ||
                    action === "edited") {
                    return;
                }
                else if (action === "closed" && pullRequestMerged) {
                    commentText = `<body> <a href="${pullRequestURL}">PR #${pullRequestId}</a> is merged and ${pullRequestState}. </body>`;
                }
                else {
                    commentText = `<body> <a href="${pullRequestURL}">PR #${pullRequestId}</a> is ${pullRequestState}. </body>`;
                }
                break;
            case "pull_request_review_comment": {
                const path = (_z = github_1.context.payload.comment) === null || _z === void 0 ? void 0 : _z.path;
                const files = path.split("/");
                const fileName = files[files.length - 1];
                commentText = `<body> ${userHTML} is requesting the following <a href="${commentUrl}">changes</a> on ${fileName} (Line ${(_0 = github_1.context.payload.comment) === null || _0 === void 0 ? void 0 : _0.original_line}):\n\n${commentBody} </body>`;
                if ((_1 = github_1.context.payload.comment) === null || _1 === void 0 ? void 0 : _1.in_reply_to_id) {
                    commentText = `<body> ${userHTML} <a href="${commentUrl}">replied</a> on ${fileName} (Line ${(_2 = github_1.context.payload.comment) === null || _2 === void 0 ? void 0 : _2.original_line}):\n\n${commentBody} </body>`;
                }
                break;
            }
        }
        // Post Comment to Asana
        let commentResult = "";
        for (const id of asanaTasksIds) {
            const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.STORIES_URL}`;
            let comments = yield asanaAxios_1.default.get(url);
            const comment = comments.data.data.find((comment) => comment.resource_subtype === "comment_added" &&
                (comment.created_by && comment.created_by.gid === (ottoObj === null || ottoObj === void 0 ? void 0 : ottoObj.asanaId)) &&
                comment.text.includes(commentUrl));
            if (comment) {
                switch (action) {
                    case "deleted":
                        commentResult = yield asanaAxios_1.default.delete(`${REQUESTS.STORIES_URL}${comment.gid}`);
                        break;
                    case "edited":
                        commentResult = yield asanaAxios_1.default.put(`${REQUESTS.STORIES_URL}${comment.gid}`, {
                            data: {
                                html_text: commentText,
                            },
                        });
                        break;
                    default:
                        commentResult = yield asanaAxios_1.default.post(url, {
                            data: {
                                html_text: commentText,
                            },
                        });
                        break;
                }
            }
            else {
                commentResult = yield asanaAxios_1.default.post(url, {
                    data: {
                        html_text: commentText,
                    },
                });
            }
        }
        // Prepare Comment Text for SetOutput Command
        commentText = commentText.replace(/\(/g, "\\(");
        commentText = commentText.replace(/\)/g, "\\)");
        commentText = commentText.replace(/\</g, "\\<");
        commentText = commentText.replace(/\>/g, "\\>");
        commentText = commentText.replace(/\"/g, "");
        commentText = commentText.replace(/\'/g, "");
        (0, core_1.setOutput)(`commentBody`, JSON.stringify(commentBody));
        (0, core_1.setOutput)(`event`, eventName);
        (0, core_1.setOutput)(`action`, action);
        (0, core_1.setOutput)(`followersStatus`, followersStatus);
        (0, core_1.setOutput)("commentStatus", commentResult.status);
        (0, core_1.setOutput)("comment", commentText);
    }
    catch (error) {
        if (utils.isAxiosError(error)) {
            console.log(error.response);
            console.log(((_3 = error.response) === null || _3 === void 0 ? void 0 : _3.data) || "Unknown error");
        }
        if (error instanceof Error)
            (0, core_1.setFailed)(error.message);
        else
            (0, core_1.setFailed)("Unknown error");
    }
});
exports.run = run;
const addRequestedReview = (id, reviewer, pull_request_url) => __awaiter(void 0, void 0, void 0, function* () {
    const approvalSubtask = yield (0, exports.getApprovalSubtask)(id, false, reviewer);
    // If Request Reviewer already has incomplete subtask
    if (approvalSubtask) {
        return;
    }
    const action_url = pull_request_url;
    const task_notes = `<a href='${action_url}'> Click Here To Start Your Review </a>`;
    (0, exports.addApprovalTask)(id, reviewer, "Review", "pending", task_notes);
});
exports.addRequestedReview = addRequestedReview;
const cleanupApprovalTasks = (id) => __awaiter(void 0, void 0, void 0, function* () {
    const ottoObj = users_1.users.find((user) => user.githubName === "otto-bot-git");
    // get all approval subtasks
    const approvalSubtasks = yield (0, exports.getAllApprovalSubtasks)(id, ottoObj);
    (0, core_1.info)("Approval Subtasks:" + JSON.stringify(approvalSubtasks));
    // we should not have any QA tasks if other team tasks are pending
    const QATeamAsanaIDs = users_1.users.filter((user) => user.team === "QA").map((user) => user.asanaId);
    const DevAsanaIDS = users_1.users.filter((user) => user.team === "DEV").map((user) => user.asanaId);
    const PeerDevAsanaIDS = users_1.users.filter((user) => user.team === "PEER_DEV").map((user) => user.asanaId);
    if (approvalSubtasks.some((subtask) => QATeamAsanaIDs.includes(subtask.assignee.gid))) {
        (0, core_1.info)("QA Team Tasks are pending");
        // if some other team tasks are pending, delete QA tasks
        if (approvalSubtasks.some((subtask) => !QATeamAsanaIDs.includes(subtask.assignee.gid))) {
            (0, core_1.info)("Some other team tasks are pending");
            const QA_approvalSubtasks = approvalSubtasks.filter((subtask) => QATeamAsanaIDs.includes(subtask.assignee.gid));
            (0, exports.deleteApprovalTasks)(QA_approvalSubtasks);
        }
    }
    // we should not have any tasks assigned to Nathan or Natalie MacLees if other peer dev tasks are pending
    if (approvalSubtasks.some((subtask) => DevAsanaIDS.includes(subtask.assignee.gid))) {
        (0, core_1.info)("DEV Team Tasks are pending");
        // if some peer dev tasks are pending, delete DEV tasks
        if (approvalSubtasks.some((subtask) => !DevAsanaIDS.includes(subtask.assignee.gid) && !QATeamAsanaIDs.includes(subtask.assignee.gid))) {
            (0, core_1.info)("Peer Dev Team Tasks are pending");
            const DEV_approvalSubtasks = approvalSubtasks.filter((subtask) => DevAsanaIDS.includes(subtask.assignee.gid));
            (0, exports.deleteApprovalTasks)(DEV_approvalSubtasks);
        }
    }
});
exports.cleanupApprovalTasks = cleanupApprovalTasks;
const deleteApprovalTasks = (approvalSubtasks) => __awaiter(void 0, void 0, void 0, function* () {
    var _4, _5;
    // Delete Approval Tasks
    for (const subtask of approvalSubtasks) {
        try {
            yield asanaAxios_1.default.delete(`${REQUESTS.TASKS_URL}${subtask.gid}`);
            (0, core_1.info)(`Successfully deleted approval task: ${subtask.gid}`);
        }
        catch (error) {
            if (utils.isAxiosError(error)) {
                // Handle 404 errors - task might already be deleted
                if (((_4 = error.response) === null || _4 === void 0 ? void 0 : _4.status) === 404) {
                    (0, core_1.info)(`Approval task ${subtask.gid} already deleted or not found - skipping`);
                    continue;
                }
                // Log other HTTP errors but don't fail the entire action
                console.warn(`Failed to delete approval task ${subtask.gid}:`, ((_5 = error.response) === null || _5 === void 0 ? void 0 : _5.data) || "Unknown error");
                console.log("Full error response:", error.response);
            }
            else if (error instanceof Error) {
                console.warn(`Error deleting approval task ${subtask.gid}: ${error.message}`);
            }
            else {
                console.warn(`Unknown error deleting approval task ${subtask.gid}:`, error);
            }
        }
    }
});
exports.deleteApprovalTasks = deleteApprovalTasks;
const getAllApprovalSubtasks = (id, creator) => __awaiter(void 0, void 0, void 0, function* () {
    let approvalSubtasks = [];
    const url = `${REQUESTS.TASKS_URL}${id}${REQUESTS.SUBTASKS_URL}`;
    const subtasks = yield asanaAxios_1.default.get(url);
    approvalSubtasks = subtasks.data.data.filter((subtask) => subtask.resource_subtype === "approval" &&
        !subtask.completed &&
        (subtask.created_by && subtask.created_by.gid === (creator === null || creator === void 0 ? void 0 : creator.asanaId)));
    return approvalSubtasks;
});
exports.getAllApprovalSubtasks = getAllApprovalSubtasks;
const moveTaskToSection = (id, moveSection, donotMoveSections) => __awaiter(void 0, void 0, void 0, function* () {
    // Get Task
    const taskUrl = `${REQUESTS.TASKS_URL}${id}`;
    const task = yield asanaAxios_1.default.get(taskUrl).then((response) => response.data.data);
    for (const membership of task.memberships) {
        // Check If Task Should Not Move
        if (donotMoveSections && donotMoveSections.includes(membership.section.name)) {
            continue;
        }
        // Get Sections of Project
        const projectId = membership.project.gid;
        const sectionsUrl = `${REQUESTS.PROJECTS_URL}${projectId}${REQUESTS.SECTIONS_URL}`;
        const sections = yield asanaAxios_1.default.get(sectionsUrl).then((response) => response.data.data);
        // Get Section To Move Task To
        const section = sections.find((section) => section.name === moveSection);
        // Move Task
        if (section) {
            const url = `${REQUESTS.SECTIONS_URL}${section.gid}${REQUESTS.ADD_TASK_URL}`;
            yield asanaAxios_1.default.post(url, {
                data: {
                    task: id,
                },
            });
        }
    }
});
exports.moveTaskToSection = moveTaskToSection;
const addApprovalTask = (id, requestedReviewer, taskName, approvalStatus, notes) => __awaiter(void 0, void 0, void 0, function* () {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Create Approval Subtasks For Requested Reviewer
    yield asanaAxios_1.default.post(`${REQUESTS.TASKS_URL}${id}${REQUESTS.SUBTASKS_URL}`, {
        data: {
            assignee: requestedReviewer === null || requestedReviewer === void 0 ? void 0 : requestedReviewer.asanaId,
            approval_status: approvalStatus,
            completed: false,
            due_on: tomorrow.toISOString().substring(0, 10),
            resource_subtype: "approval",
            name: taskName,
            html_notes: "<body>" + notes + "</body>"
        },
    });
    yield (0, exports.cleanupApprovalTasks)(id);
});
exports.addApprovalTask = addApprovalTask;
const getApprovalSubtask = (asanaTaskId, is_complete, assignee) => __awaiter(void 0, void 0, void 0, function* () {
    const url = `${REQUESTS.TASKS_URL}${asanaTaskId}${REQUESTS.SUBTASKS_URL}` + ',approval_status';
    const subtasks = yield asanaAxios_1.default.get(url);
    const approvalSubtask = subtasks.data.data.find((subtask) => subtask.resource_subtype === "approval" &&
        subtask.completed === is_complete &&
        (subtask.assignee && subtask.assignee.gid === (assignee === null || assignee === void 0 ? void 0 : assignee.asanaId)));
    return approvalSubtask;
});
exports.getApprovalSubtask = getApprovalSubtask;
(0, exports.run)();
