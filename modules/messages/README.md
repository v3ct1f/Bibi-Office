# Messages (`@office/module-messages`)

Chat between colleagues of one business, like Google Chat: one-to-one chats and named groups, with WhatsApp-style extras: photos, videos,
documents, audio, camera pictures, voice messages, polls, events, contact cards, emoji, stickers and GIFs; unread counts, edit and delete your own messages. **Only the people in a chat can read it**, not even the owner or admins.

## Model

```
conversation (direct: exactly two people, one per pair, direct_key = both user ids sorted | group: has a name)
  ├─< member (user_id, role manager | member, last_read_at)
  ├─< message (text | system | poll | event | contact | sticker | gif, sender, body, file?, data jsonb, edited_at, deleted_at, updated_at)
  │     ├─< poll_vote (user_id, option_id)          for polls
  │     └─< event_answer (user_id, going|maybe|no)  for events
  └─< file (photo / video / audio / PDF / text / Word / Excel / PowerPoint, at most 16 MB, complete?)
        └─< file_part (idx 0..15, up to 4 MB each, bytes in Postgres)
```

- **Direct chat**: `POST /conversations/direct { userId }` opens the chat with that colleague, or the existing one.
  You can't add people to it; start a group instead. Once the other person leaves the business, the chat is read-only.
- **Group**: whoever creates it is its manager. Anyone in the group can rename it and add people. Only managers remove
  others; anyone can leave. When the last manager leaves, the longest-standing member becomes manager; when the last
  person leaves, the group is deleted. Renames, additions, removals and leaving show in the chat as grey lines.
- New members start with nothing unread (`last_read_at` = when they joined) but can scroll back through the history.
- **Unread**: messages from others newer than your `last_read_at`. Opening a chat (or new messages arriving while it is
  open) marks it read. `GET /unread` → `{ count, conversations }` drives the number next to **Messages** in the menu.
- **Edit / delete**: only your own written messages can be edited (not voice, polls, etc.); you can delete any of your own. Deleting keeps a "This message was deleted" line for everyone and
  removes the file.
- **Files**: up to 16 MB, sent in parts of 4 MB: `POST /conversations/:id/uploads` → `{ id, partSize, partCount }`, then
  `PUT /uploads/:id/parts/:idx { data }` for each part, then the message names the `fileId`. The first part's bytes
  must match the type (images, mp4/mov, webm, mp3/m4a/ogg/wav, PDF, text without NUL bytes, Office files are zip). Only
  the uploader can add parts or send it, only once. Uploads never sent are removed every 6 hours. Downloads come part by
  part (`GET /files/:id?part=n`), only for members. HTML, SVG and other types that could run in a browser are refused.
- **Kinds of message** (`POST .../messages`, `kind` defaults to `text`):
  - `text`: `body`, optional `fileId` (photo, video, audio, document; the body is the caption) and `voice { durationMs }`
    to mark a recording made in the app as a voice message.
  - `poll`: `question`, 2 to 12 `options`, `multiple`. `POST /messages/:id/vote { optionIds }` replaces your votes.
  - `event`: `title`, `startsAt`, optional `endsAt`, `location`, `description`. `POST /messages/:id/answer { answer }`
    (going, maybe, no). The card offers an `.ics` file to add it to your own calendar.
  - `contact`: `name` plus a phone or email (company, job title optional). People who may add Contacts can save it there.
  - `sticker`: one built-in emoji shown big, or your own picture (made into a 512 px square PNG in the browser).
  - `gif`: a GIF from GIPHY search (`GET /gifs?q=`). Search needs a free GIPHY key in the feature's settings
    (`giphyApiKey`, kept as a secret); without it the search is off and people can still send GIF files.
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
| POST | `/conversations/:id/messages { kind?, … }` (see kinds above; small files may still come inline as `file: { name, contentType, data }`) · `/conversations/:id/read` |
| POST / PUT | `/conversations/:id/uploads { name, contentType, sizeBytes }` · `/uploads/:id/parts/:idx { data }` |
| GET | `/files/:id?part=n` · `/gifs?q=` |
| POST | `/messages/:id/vote { optionIds }` · `/messages/:id/answer { answer }` |
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
right (date dividers, Enter to send, Shift+Enter for a new line, paste a picture to attach it; **+** opens Document, Photos & videos,
Camera, Audio, Contact, Poll, Event, New sticker; the smiley opens Emoji / GIFs / Stickers; the microphone records a
voice message (up to 10 minutes) when the box is empty; videos and audio load when you press play; hover your message to edit or delete;
group menu: Rename group, People, Leave group). On a phone the list and the chat take turns.

## Not yet

Files bigger than 16 MB (would need object storage), forwarding messages, location sharing, view-once photos, instant delivery over websockets, email or push notifications for unread messages, reactions and replies in threads,
"seen by", typing indicators, searching inside messages, muting a chat, pinning chats.
