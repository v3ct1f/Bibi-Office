# Messages (`@office/module-messages`)

Chat between colleagues of one business, like Google Chat: one-to-one chats and named groups, photos and files,
unread counts, edit and delete your own messages. **Only the people in a chat can read it**, not even the owner or admins.

## Model

```
conversation (direct: exactly two people, one per pair, direct_key = both user ids sorted | group: has a name)
  ├─< member (user_id, role manager | member, last_read_at)
  ├─< message (text | system, sender, body, file?, edited_at, deleted_at)
  └─< file (photo / PDF / text / Word / Excel / PowerPoint, at most 5 MB, bytes in Postgres)
```

- **Direct chat**: `POST /conversations/direct { userId }` opens the chat with that colleague, or the existing one.
  You can't add people to it; start a group instead. Once the other person leaves the business, the chat is read-only.
- **Group**: whoever creates it is its manager. Anyone in the group can rename it and add people. Only managers remove
  others; anyone can leave. When the last manager leaves, the longest-standing member becomes manager; when the last
  person leaves, the group is deleted. Renames, additions, removals and leaving show in the chat as grey lines.
- New members start with nothing unread (`last_read_at` = when they joined) but can scroll back through the history.
- **Unread**: messages from others newer than your `last_read_at`. Opening a chat (or new messages arriving while it is
  open) marks it read. `GET /unread` → `{ count, conversations }` drives the number next to **Messages** in the menu.
- **Edit / delete**: only your own text messages. Deleting keeps a "This message was deleted" line for everyone and
  removes the file.
- **Files**: the type must match the content (images, PDF, text without NUL bytes, Office files are zip). Only members of
  the chat can download them. HTML, SVG and other types that could run in a browser are refused.
- **Live updates by polling** (no websockets yet): the open chat asks for new / edited / deleted messages every 3 s
  (`after` = last id, `since` = server time of the previous answer), the chat list every 5 s, the menu count every 10 s,
  all paused while the tab is hidden.

## API (`/api/v1/m/messages`, permission `messages:chat.use`)

| Method | Path |
|---|---|
| GET | `/people` (colleagues except you) · `/unread` · `/conversations` · `/conversations/:id` · `/files/:id` |
| GET | `/conversations/:id/messages?after&before&since&limit` → `{ data, changed, hasMore, now }` |
| POST | `/conversations/direct { userId }` · `/conversations/group { name, memberIds }` |
| PATCH | `/conversations/:id { name }` (groups) |
| POST / DELETE | `/conversations/:id/members { userIds }` · `/conversations/:id/members/:userId` (leave = your own id) |
| POST | `/conversations/:id/messages { body?, file?: { name, contentType, data(base64) } }` (body up to 8 MB) · `/conversations/:id/read` |
| PATCH / DELETE | `/messages/:id { body }` |

Every role gets `messages:chat.use` when a business adds the feature (manager, member, viewer; owner and admin always).
An API key without a person behind it can't chat.

## Events (payload v1)

`messages.conversation.created` `{ id, kind, name?, memberIds }`, `messages.message.sent` `{ id, conversationId, kind, senderId, hasFile }`.
Message text is never put in events, because events reach workflows and webhooks and chats are private. There are no
workflow triggers or actions for the same reason.

## UI

**Messages** in the menu (`nav.main`, with the unread count via the new manifest slot field `badge`), "+ New → Message"
(`global.create`, opens the new-chat window). One page: chat list on the left (search, New chat), the open chat on the
right (date dividers, Enter to send, Shift+Enter for a new line, attach button, hover your message to edit or delete;
group menu: Rename group, People, Leave group). On a phone the list and the chat take turns.

## Not yet

Instant delivery over websockets, email or push notifications for unread messages, reactions and replies in threads,
"seen by", typing indicators, searching inside messages, muting a chat, pinning chats.
