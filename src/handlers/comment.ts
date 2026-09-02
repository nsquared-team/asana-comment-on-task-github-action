import { setOutput } from "@actions/core";
import asanaAxios from "../requests/asanaAxios";
import * as REQUESTS from "../constants/requests";
import * as SECTIONS from "../constants/sections";
import * as asana from "../asana";
import * as utils from "../utils";
import * as format from "../format";
import { SyncEvent } from "../event";

// Post the comment to every linked task, editing/deleting the matching
// existing story when the GitHub comment was edited/deleted.
export const postCommentToTasks = async (
  event: SyncEvent,
  commentText: string
) => {
  const otto = asana.ottoUser();
  let commentResult: any = "";

  for (const taskId of event.taskIds) {
    const url = `${REQUESTS.TASKS_URL}${taskId}${REQUESTS.STORIES_URL}`;
    const existingComment = event.commentUrl
      ? (await asana.getStories(taskId)).find(
          (story: any) =>
            story.resource_subtype === "comment_added" &&
            story.created_by &&
            story.created_by.gid === otto?.asanaId &&
            story.text.includes(event.commentUrl)
        )
      : undefined;

    if (existingComment && event.action === "deleted") {
      commentResult = await asanaAxios.delete(
        `${REQUESTS.STORIES_URL}${existingComment.gid}`
      );
    } else if (existingComment && event.action === "edited") {
      commentResult = await asanaAxios.put(
        `${REQUESTS.STORIES_URL}${existingComment.gid}`,
        {
          data: {
            html_text: commentText,
          },
        }
      );
    } else {
      commentResult = await asanaAxios.post(url, {
        data: {
          html_text: commentText,
        },
      });
    }
  }

  setOutput("commentStatus", commentResult.status);
  setOutput("comment", commentText);
};

export const buildFormattedBody = (event: SyncEvent) => {
  let mentionedAsanaIds: string[] = [];
  const body = format.linkifyBody(
    format.stripQuotesAndArrows(event.rawCommentBody),
    // Runs while the anchors are still placeholders, so a handle that happens to
    // appear inside a url cannot be linked inside that url's href - which
    // produced html_text Asana rejects, and left the real mention as plain text.
    (text) => {
      const mentions = format.replaceMentions(text);
      mentionedAsanaIds = mentions.mentionedAsanaIds;
      return mentions.body;
    }
  );
  return { body, mentionedAsanaIds };
};

export const handleComment = async (event: SyncEvent) => {
  const { body, mentionedAsanaIds } = buildFormattedBody(event);
  const isReply = format.isReplyComment(event.rawCommentBody);
  const userHTML = format.userMentionHTML(event.username);

  // Otto's conflict alert bounces the task out of review.
  const isMergeConflictAlert =
    event.eventName === "issue_comment" &&
    event.username === "otto-bot-git" &&
    body.includes("This pull request has conflicts");

  if (isMergeConflictAlert) {
    for (const taskId of event.taskIds) {
      // Resolving the conflict rewrites the diff, so the outstanding review
      // requests are for code that is about to change - same reasoning as a
      // changes-requested review.
      await asana.deleteReviewSubtasks(taskId);
      await asana.moveTaskToSection(
        taskId,
        SECTIONS.NEXT,
        SECTIONS.PROTECTED_FROM_DEMOTION
      );
      await asana.setTaskIncomplete(taskId);
    }
  }

  // Followers: the commenter plus anyone they mentioned.
  const followers: string[] = [...mentionedAsanaIds];
  const senderUser = utils.findUserByGithubName(event.username);
  if (senderUser) followers.push(senderUser.asanaId);
  for (const taskId of event.taskIds) {
    await asana.addFollowers(taskId, followers);
  }

  let commentText = "";
  if (event.eventName === "issue_comment") {
    if (isReply) {
      commentText = `<body> ${userHTML} <a href="${event.commentUrl}">replied</a>:\n\n${body} </body>`;
    } else {
      commentText =
        event.username === "otto-bot-git"
          ? `<body> ${body}\n<a href="${event.commentUrl}">Comment URL</a> </body>`
          : `<body> ${userHTML} <a href="${event.commentUrl}">commented</a>:\n\n${body} </body>`;
    }
  } else {
    // pull_request_review_comment: inline code comment with file context.
    // A file-level comment belongs to no line, so name only the file. GitHub
    // reports original_line as 1 for those rather than leaving it empty, so
    // the subject type decides - a line number alone cannot tell a file-level
    // comment apart from one genuinely on the first line.
    const files = event.commentPath.split("/");
    const fileName = files[files.length - 1];
    const isFileLevel = event.commentSubjectType === "file";
    const location =
      !isFileLevel && event.commentLine
        ? `${fileName} (Line ${event.commentLine})`
        : fileName;

    commentText = `<body> ${userHTML} is requesting the following <a href="${event.commentUrl}">changes</a> on ${location}:\n\n${body} </body>`;
    if (event.commentInReplyTo) {
      commentText = `<body> ${userHTML} <a href="${event.commentUrl}">replied</a> on ${location}:\n\n${body} </body>`;
    }
  }

  setOutput("commentBody", JSON.stringify(body));
  await postCommentToTasks(event, commentText);
};
