import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, job, route } from "@office/sdk";
import {
  AnswerInput, answerEvent, FileQuery, GifQuery, PartInput, PartParams, purgeAbandonedUploads, searchGifs, startUpload, uploadPart, UploadInput, vote, VoteInput,
  AddMembersInput, addMembers, createGroup, deleteMessage, DirectInput, EditInput, editMessage, getConversation, getFile, GroupInput,
  listConversations, listMessages, listPeople, markRead, MemberParams, MessagesQuery, openDirect, removeMember, RenameInput, renameGroup,
  SendInput, sendMessage, unreadCount,
} from "./service.ts";

const CHAT = "messages:chat.use";
const Id = z.object({ id: z.uuid() });

export default defineModule({
  manifest: {
    key: "messages",
    name: "Messages",
    version: "1.0.0",
    office: "^1.0",
    description: "Chat with your colleagues: one-to-one or in named groups, with photos and files. Only the people in a chat can read it.",
    permissions: {
      declares: [{ key: CHAT, label: "Chat with colleagues" }],
      requires: ["core:members.read"],
    },
    icon: "messages",
    category: "team",
    roles: { manager: [CHAT], member: [CHAT], viewer: [CHAT] },
    entities: ["conversation", "message"],
    events: { emits: [{ type: "messages.conversation.created" }, { type: "messages.message.sent" }], subscribes: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "Messages", icon: "messages", route: "/chat", permission: CHAT, badge: "/unread" },
        { slot: "global.create", label: "Message", route: "/chat/new", permission: CHAT },
      ],
    },
    settings: {
      type: "object",
      properties: {
        giphyApiKey: {
          type: "string", title: "GIPHY API key (for GIF search)", "x-secret": true, maxLength: 200,
          description: "Free from developers.giphy.com. Without it people can still send their own GIF files. Search words go to GIPHY; messages never do.",
        },
      },
      additionalProperties: false,
    },
    api: { basePath: "/messages" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({ method: "GET", path: "/people", permission: CHAT, handler: (ctx) => listPeople(ctx) }),
    route({ method: "GET", path: "/unread", permission: CHAT, handler: (ctx) => unreadCount(ctx) }),
    route({ method: "GET", path: "/conversations", permission: CHAT, handler: (ctx) => listConversations(ctx) }),
    route({ method: "POST", path: "/conversations/direct", permission: CHAT, body: DirectInput, handler: (ctx, { body }) => openDirect(ctx, body) }),
    route({ method: "POST", path: "/conversations/group", permission: CHAT, status: 201, body: GroupInput, handler: (ctx, { body }) => createGroup(ctx, body) }),
    route({ method: "GET", path: "/conversations/:id", permission: CHAT, params: Id, handler: (ctx, { params }) => getConversation(ctx, params.id) }),
    route({ method: "PATCH", path: "/conversations/:id", permission: CHAT, params: Id, body: RenameInput, handler: (ctx, { params, body }) => renameGroup(ctx, params.id, body) }),
    route({ method: "POST", path: "/conversations/:id/members", permission: CHAT, params: Id, body: AddMembersInput, handler: (ctx, { params, body }) => addMembers(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/conversations/:id/members/:userId", permission: CHAT, params: MemberParams, handler: (ctx, { params }) => removeMember(ctx, params.id, params.userId) }),
    route({ method: "POST", path: "/conversations/:id/read", permission: CHAT, params: Id, handler: (ctx, { params }) => markRead(ctx, params.id) }),
    route({ method: "GET", path: "/conversations/:id/messages", permission: CHAT, params: Id, query: MessagesQuery, handler: (ctx, { params, query }) => listMessages(ctx, params.id, query) }),
    route({
      method: "POST", path: "/conversations/:id/messages", permission: CHAT, params: Id, body: SendInput, status: 201, bodyLimit: 8 * 1024 * 1024,
      handler: (ctx, { params, body }) => sendMessage(ctx, params.id, body),
    }),
    route({ method: "PATCH", path: "/messages/:id", permission: CHAT, params: Id, body: EditInput, handler: (ctx, { params, body }) => editMessage(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/messages/:id", permission: CHAT, params: Id, status: 204, handler: (ctx, { params }) => deleteMessage(ctx, params.id) }),
    route({ method: "GET", path: "/files/:id", permission: CHAT, params: Id, query: FileQuery, handler: (ctx, { params, query }) => getFile(ctx, params.id, query.part) }),
    route({ method: "POST", path: "/conversations/:id/uploads", permission: CHAT, params: Id, body: UploadInput, status: 201, handler: (ctx, { params, body }) => startUpload(ctx, params.id, body) }),
    route({
      method: "PUT", path: "/uploads/:id/parts/:idx", permission: CHAT, params: PartParams, body: PartInput, bodyLimit: 8 * 1024 * 1024,
      handler: (ctx, { params, body }) => uploadPart(ctx, params.id, params.idx, body),
    }),
    route({ method: "POST", path: "/messages/:id/vote", permission: CHAT, params: Id, body: VoteInput, handler: (ctx, { params, body }) => vote(ctx, params.id, body) }),
    route({ method: "POST", path: "/messages/:id/answer", permission: CHAT, params: Id, body: AnswerInput, handler: (ctx, { params, body }) => answerEvent(ctx, params.id, body) }),
    route({ method: "GET", path: "/gifs", permission: CHAT, query: GifQuery, handler: (ctx, { query }) => searchGifs(ctx, query) }),
  ],
  jobs: {
    purge_abandoned_uploads: job({ label: "Remove files that were uploaded but never sent", everyMinutes: 360, run: purgeAbandonedUploads }),
  },
});
