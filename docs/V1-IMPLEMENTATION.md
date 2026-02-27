# V1-IMPLEMENTATION.md — Detailed Implementation Specs

> **Origin**: V1-ROADMAP.md (pre-strategic-review implementation plan)
> **Purpose**: Detailed data models, API endpoints, protocol changes, and acceptance criteria for all chat-completeness tasks. Referenced by `docs/ROADMAP.md` for implementation details.
> **Task Numbering**: Remapped to align with unified ROADMAP. Original V1-ROADMAP numbers in parentheses where they differ.

---

## Task Number Mapping

V0 tasks (TASK-0001 through TASK-0010) are all DONE. V1 tasks start at TASK-0011. TASK-0009 and TASK-0010 are reserved for V0 reactions and uploads to match shipped history.

| ROADMAP Task | Feature | Original V1-ROADMAP # | Track |
|-------------|---------|----------------------|-------|
| TASK-0011 | Agent Thinking Timeline | — (new) | Agent |
| TASK-0012 | Multi-Stream | — (new) | Agent |
| TASK-0013 | Provider Abstraction | — (new) | Agent |
| TASK-0014 | Message Edit & Delete | was TASK-0008 | Chat |
| TASK-0015 | @Mentions (enhance existing V0 behavior) | was TASK-0011 | Chat |
| TASK-0016 | Unread Indicators | was TASK-0012 | Chat |
| TASK-0017 | README + Demo | — (new) | Launch |
| TASK-0018 | MCP Tool Interface | — (new) | Agent |
| TASK-0019 | Direct Messages | was TASK-0013 | Chat |
| TASK-0020 | Channel Charter / Swarms | — (new) | Agent |
| TASK-0021 | Stream Rewind + Checkpoints | — (new) | Agent |
| TASK-0022 | Message Search | was TASK-0014 | Chat |
| TASK-0023 | Server Settings UI | was TASK-0015 | Chat |
| TASK-0024 | User Profile & Settings | was TASK-0016 | Chat |
| TASK-0025 | File & Image Uploads (enhance existing V0 behavior) | was TASK-0017 | Chat |
| TASK-0026 | JSON Schema Contracts | — (new) | Infra |
| TASK-0027 | gRPC/Protobuf | — (new) | Infra |
| TASK-0028 | Agent Memory (pgvector) | — (new) | Agent |
| TASK-0029 | Notification System | was TASK-0019 | Chat |
| TASK-0030 | Emoji Reactions (enhance existing V0 behavior) | was TASK-0018 | Chat |
| TASK-0031 | X-Ray Observability | — (new) | Agent |
| TASK-0032 | Branching Conversations | — (new) | Agent |
| TASK-0033 | Caddy HTTPS (already shipped) | was TASK-0021 | Deploy |
| TASK-0034 | Admin Dashboard | was TASK-0022 | Deploy |
| TASK-0035 | Data Export | was TASK-0023 | Deploy |
| TASK-0036 | Mobile Responsive | was TASK-0020 | Deploy |

---

## TASK-0014: Message Edit & Delete

**Priority**: P0 — Launch
**Track**: Chat (Track B)

### Data Model Changes

```prisma
model Message {
  // ... existing fields ...
  editedAt    DateTime?   // null if never edited
  isDeleted   Boolean     @default(false)  // soft delete
}
```

### Protocol Changes

New WebSocket events on `room:{channelId}`:

**Client → Server:**

| Event | Payload | Description |
|---|---|---|
| `message_edit` | `{messageId, content}` | Edit own message |
| `message_delete` | `{messageId}` | Delete a message |

**Server → Client (broadcast):**

| Event | Payload | Description |
|---|---|---|
| `message_edited` | `{messageId, content, editedAt}` | Message was edited |
| `message_deleted` | `{messageId, deletedBy}` | Message was deleted |

### Implementation

- [ ] Add `editedAt` and `isDeleted` to Message model, run migration
- [ ] Add `message_edit` handler in Gateway `RoomChannel`:
  - Validate: author must be the message sender
  - Validate: message must not be a streaming message with status ACTIVE
  - Call internal API to update content + set editedAt
  - Broadcast `message_edited` to channel
- [ ] Add `message_delete` handler in Gateway `RoomChannel`:
  - Validate: author is sender OR user has `MANAGE_MESSAGES` permission
  - Call internal API to soft-delete (set `isDeleted = true`)
  - Broadcast `message_deleted` to channel
- [ ] Add internal API endpoints:
  - `PATCH /api/internal/messages/{id}` — update content, set editedAt
  - `DELETE /api/internal/messages/{id}` — soft delete
- [ ] Frontend:
  - Message hover actions: Edit (pencil icon), Delete (trash icon)
  - Edit mode: message content becomes an editable input, Enter to save, Escape to cancel
  - Edited messages show "(edited)" label next to timestamp
  - Deleted messages show "[message deleted]" placeholder or are removed from view
  - Context menu (right-click) on messages with edit/delete options
  - Confirmation dialog for delete
- [ ] Update `docs/PROTOCOL.md` with new events

### Acceptance Criteria
- [ ] User can edit own messages (content updates live for all clients)
- [ ] Edited messages show "(edited)" indicator
- [ ] User can delete own messages
- [ ] Users with MANAGE_MESSAGES can delete others' messages
- [ ] Streaming messages (ACTIVE) cannot be edited
- [ ] Bot messages cannot be edited by users
- [ ] Edit history is not stored (just current content + editedAt flag)

---

## TASK-0015: @Mentions with Autocomplete

**Priority**: P1 — Launch
**Track**: Chat (Track B)

### Current State
Autocomplete, mention rendering, and bot trigger-on-mention behavior are already shipped in V0. V1 work focuses on mention persistence (`MessageMention`) and stronger mention read-state semantics.

### Data Model

Option B (join table — recommended for "show me my mentions" queries):

```prisma
model MessageMention {
  id        String @id @db.VarChar(26)
  messageId String @db.VarChar(26)
  userId    String @db.VarChar(26)

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([messageId, userId])
  @@index([userId])
}
```

### Implementation

- [ ] **Mention parser** — detect `@username` patterns in message content
  - Parse on send (Gateway) and flag mentioned user IDs
  - Store mentioned user IDs in `MessageMention` join table
- [ ] **Autocomplete** — typing `@` in the message input shows a dropdown of channel members
  - Filter as user types after `@`
  - Enter/click inserts the mention
  - Mention renders as a highlighted chip/pill
- [ ] **Mention rendering** — `@username` in message content renders as a styled highlight
  - Clicking a mention opens the user's profile card
  - Mentions of the current user render with stronger highlight ("you were mentioned")
- [ ] **Mention notification** — when a user is mentioned:
  - Channel gets a special unread indicator (TASK-0016 handles the badge)
  - In Wave 3, this becomes a proper notification (TASK-0029)

### Acceptance Criteria
- [ ] Typing `@` shows autocomplete dropdown of channel members
- [ ] Selected mention inserts as styled text
- [ ] Mentions render as highlighted pills in messages
- [ ] Mentioned user sees stronger visual indicator
- [ ] Bot @mentions still trigger bot responses (existing behavior preserved)

---

## TASK-0016: Unread Indicators

**Priority**: P0 — Launch
**Track**: Chat (Track B)

### Data Model

```prisma
model ChannelReadState {
  id              String   @id @db.VarChar(26)
  userId          String   @db.VarChar(26)
  channelId       String   @db.VarChar(26)
  lastReadSeq     BigInt   @default(0)
  mentionCount    Int      @default(0)
  updatedAt       DateTime @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@unique([userId, channelId])
  @@index([userId])
}
```

### Implementation

- [ ] Create `ChannelReadState` model, run migration
- [ ] Track read state:
  - When user views a channel, update `lastReadSeq` to channel's current max sequence
  - When a new message arrives in a channel the user is NOT viewing, difference = unread count
  - When user is mentioned, increment `mentionCount`
  - When user views the channel, reset `mentionCount` to 0
- [ ] API endpoints:
  - `POST /api/servers/{serverId}/channels/{channelId}/read` — mark channel as read
  - `GET /api/servers/{serverId}/unread` — get unread state for all channels in a server
- [ ] Client-side:
  - Call "mark as read" when user navigates to a channel
  - Poll or WebSocket event for unread state updates
- [ ] UI indicators:
  - **Channel sidebar**: unread channel names are **bold white** (read channels are gray)
  - **Channel sidebar**: mention badge shows red circle with count (e.g., `@3`)
  - **Server sidebar**: server icon gets a white dot if any channel has unreads
  - **Server sidebar**: server icon gets a red badge if any channel has mentions
  - **"New messages" divider**: divider line between old and new messages

### Acceptance Criteria
- [ ] Channels with unread messages display bold in the sidebar
- [ ] Channels with unread mentions show red mention badge
- [ ] Server icons show unread dot indicator
- [ ] Navigating to a channel marks it as read
- [ ] "New messages" divider appears in message history
- [ ] Unread state persists across page refreshes
- [ ] Unread state syncs across multiple tabs/windows

---

## TASK-0019: Direct Messages

**Priority**: P1 — Wave 1
**Track**: Chat

### Data Model

```prisma
model DirectMessageChannel {
  id        String   @id @db.VarChar(26)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  participants DmParticipant[]
  messages     DirectMessage[]
}

model DmParticipant {
  id        String @id @db.VarChar(26)
  dmId      String @db.VarChar(26)
  userId    String @db.VarChar(26)

  dm   DirectMessageChannel @relation(fields: [dmId], references: [id], onDelete: Cascade)
  user User                 @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([dmId, userId])
  @@index([userId])
}

model DirectMessage {
  id        String   @id @db.VarChar(26)
  dmId      String   @db.VarChar(26)
  authorId  String   @db.VarChar(26)
  content   String   @db.Text
  editedAt  DateTime?
  isDeleted Boolean  @default(false)
  sequence  BigInt
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  dm     DirectMessageChannel @relation(fields: [dmId], references: [id], onDelete: Cascade)
  author User                 @relation(fields: [authorId], references: [id])

  @@index([dmId, sequence])
  @@index([dmId, id])
}
```

### Gateway Changes

New Phoenix Channel topic: `dm:{dmChannelId}`

Events mirror `room:` channel: `new_message`, `typing`, `message_edit`, `message_delete`, `sync`, `history`.

New module: `HiveGatewayWeb.DmChannel`

### Implementation

- [ ] Create DM models, run migration
- [ ] API endpoints:
  - `POST /api/dms` — create or get existing DM channel (body: `{userId}`)
  - `GET /api/dms` — list user's DM channels with last message preview
  - `GET /api/dms/{dmId}/messages` — message history
- [ ] Internal API:
  - `POST /api/internal/dms/messages` — persist DM message
  - `GET /api/internal/dms/messages` — fetch DM messages for sync/history
- [ ] Gateway:
  - `DmChannel` module handling `dm:{dmChannelId}` topic
  - Authorization: only participants can join
  - Same message/typing/edit/delete events as `RoomChannel`
  - Presence tracking per DM channel
- [ ] Frontend:
  - DM sidebar section — above or below server list
  - DM list view — conversations with last message preview and timestamp
  - DM chat view — same chat area component, reused
  - Start DM — click user in member list → "Send Message"
  - DM unread indicators — same bold/badge system as channels
- [ ] Sequence numbers: same Redis INCR pattern `hive:dm:{dmId}:seq`

### Acceptance Criteria
- [ ] User can start a DM with any user they share a server with
- [ ] DM messages persist and load history on open
- [ ] DM messages are real-time via WebSocket
- [ ] Edit and delete work in DMs
- [ ] Typing indicator works in DMs
- [ ] DM list shows in sidebar with last message preview
- [ ] Unread DM indicators work (bold + badge)
- [ ] DMs are private — only the two participants can see messages

---

## TASK-0022: Message Search

**Priority**: P1 — Wave 2
**Track**: Chat

### Implementation

- [ ] Add PostgreSQL full-text search index on `Message.content`:
  ```sql
  CREATE INDEX message_content_search_idx ON "Message"
  USING GIN (to_tsvector('english', content));
  ```
- [ ] API endpoint: `GET /api/servers/{serverId}/search?q={query}&channelId={optional}`
  - Returns matching messages with context (author, channel, timestamp)
  - Paginated results (limit 25 per page)
  - Highlight matching terms
- [ ] Search UI:
  - Search icon in channel header opens search panel (slides in from right)
  - Real-time results as you type (debounced 300ms)
  - Results show: content (highlighted), author, channel, timestamp
  - Click result navigates to message and scrolls to it
  - Filter by: channel, user, date range, has: file/link/mention
- [ ] Also search DMs: `GET /api/dms/search?q={query}`

### Acceptance Criteria
- [ ] Full-text search across all messages in a server
- [ ] Results highlight matching terms
- [ ] Click result jumps to message in channel
- [ ] Search is fast (<500ms for typical queries)
- [ ] Can filter by channel and user
- [ ] DM search works separately

---

## TASK-0023: Server Settings UI

**Priority**: P1 — Wave 2
**Track**: Chat

### Implementation

- [ ] New page: `/servers/{serverId}/settings` with sidebar navigation
- [ ] Settings sections:
  - **Overview** — server name, icon, description (edit)
  - **Channels** — list, reorder (drag-and-drop), create, edit, delete
  - **Roles** — role management (from V0 TASK-0008)
  - **Members** — member list with role badges, kick/ban, role assignment
  - **Bots** — bot management (move existing modal content here)
  - **Invites** — list active invites, create new, revoke existing
  - **Danger Zone** — delete server (owner only, confirmation)
- [ ] Only visible to users with `MANAGE_SERVER` permission

### Acceptance Criteria
- [ ] Server settings accessible from channel sidebar (gear icon)
- [ ] All sections functional with proper permission gating
- [ ] Changes save immediately (inline editing)
- [ ] Delete server requires typing server name as confirmation
- [ ] Only users with appropriate permissions see the settings link

---

## TASK-0024: User Profile & Settings

**Priority**: P1 — Wave 2
**Track**: Chat

### Implementation

- [ ] **User settings page** — gear icon next to username
  - **Profile** — display name, avatar (upload), username
  - **Account** — email, password change
  - **Appearance** — placeholder for theme selection
  - **Notifications** — placeholder for Wave 3
- [ ] **User profile card** — popup on username click
  - Display name, username, avatar, role(s), "Send Message" button, join date
- [ ] API endpoints:
  - `PATCH /api/users/me` — update profile
  - `PATCH /api/users/me/password` — change password (requires current)
  - `GET /api/users/{userId}` — public profile
- [ ] Avatar: local storage in `/uploads/avatars/` (S3-compatible later)

### Acceptance Criteria
- [ ] User can change display name, username, and avatar
- [ ] User can change password (requires current)
- [ ] Clicking username shows profile card
- [ ] Profile card has "Send Message" button for DM
- [ ] Avatar displays in messages, member list, and profile card

---

## TASK-0025: File & Image Uploads

**Priority**: P1 — Wave 2
**Track**: Chat

### Current State
Baseline attachments are already shipped in V0 (upload/download API, paperclip upload, inline image/file rendering). V1 work focuses on drag-and-drop, clipboard paste, progress UX, and richer metadata handling.

### Data Model

```prisma
model MessageAttachment {
  id          String @id @db.VarChar(26)
  messageId   String @db.VarChar(26)
  filename    String
  url         String
  contentType String
  sizeBytes   Int
  width       Int?    // for images
  height      Int?    // for images

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([messageId])
}
```

### Implementation

- [ ] **Upload endpoint**: `POST /api/uploads`
  - Multipart form data
  - Storage: `/uploads/{serverId}/{channelId}/{ulid}-{filename}`
  - Max: 10MB (configurable via `MAX_UPLOAD_SIZE_MB`)
  - Types: images (png, jpg, gif, webp), docs (pdf, txt, md), archives (zip)
- [ ] **Chat UI**:
  - Upload button (paperclip) next to input
  - Drag-and-drop onto chat area
  - Paste images from clipboard
  - Upload progress indicator
  - Images: inline previews (thumbnails, click to expand)
  - Files: download cards (icon, filename, size)
- [ ] Protocol: attachment data in `MessagePayload` as `attachments` array
- [ ] Docker: volume mount `uploads-data:/app/uploads`

### Acceptance Criteria
- [ ] Upload via button, drag-and-drop, or clipboard paste
- [ ] Images render as inline previews
- [ ] Non-image files render as download cards
- [ ] Upload progress visible
- [ ] File size limit enforced with clear error
- [ ] Files persist across container restarts

---

## TASK-0029: Notification System

**Priority**: P1 — Wave 3
**Track**: Chat

### Data Model

```prisma
model Notification {
  id          String   @id @db.VarChar(26)
  userId      String   @db.VarChar(26)
  type        String                        // "mention" | "dm" | "invite" | "role_change"
  title       String
  body        String
  linkUrl     String?
  sourceId    String?  @db.VarChar(26)
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead])
  @@index([userId, createdAt])
}
```

### Implementation

- [ ] Triggers: @mention, DM, invite, role change
- [ ] API: `GET /api/notifications`, `PATCH /api/notifications/{id}/read`, `POST /api/notifications/read-all`
- [ ] WebSocket: `user:{userId}` topic, `notification_new` event
- [ ] UI: bell icon, badge count, dropdown panel, click-to-navigate, mark all read
- [ ] Browser notifications (optional): request permission, show when tab unfocused

### Acceptance Criteria
- [ ] Notifications generated for mentions, DMs, invites, role changes
- [ ] Bell icon shows unread count
- [ ] Click notification navigates to source
- [ ] Mark individual and all as read
- [ ] Real-time delivery via WebSocket

---

## TASK-0030: Emoji Reactions

**Priority**: P2 — Wave 3
**Track**: Chat

### Current State
Baseline reactions are already shipped in V0 (Reaction model, API, picker, optimistic toggles). V1 work focuses on real-time reaction broadcast and expanded emoji UX.

### Data Model

```prisma
model Reaction {
  id        String @id @db.VarChar(26)
  messageId String @db.VarChar(26)
  userId    String @db.VarChar(26)
  emoji     String @db.VarChar(32)

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([messageId, userId, emoji])
  @@index([messageId])
}
```

### Protocol

- Client → Server: `reaction_add {messageId, emoji}`, `reaction_remove {messageId, emoji}`
- Server → Client: `reaction_added {messageId, userId, emoji}`, `reaction_removed {messageId, userId, emoji}`

### Implementation

- [ ] Hover message → smiley icon → emoji picker (~50 common emoji)
- [ ] Reaction pills below message: `👍 3  ❤️ 1`
- [ ] Click existing to toggle yours
- [ ] Hover pill to see who reacted

### Acceptance Criteria
- [ ] Add/remove reactions on any message
- [ ] Pills display with counts
- [ ] Toggle on click
- [ ] Hover shows reactors
- [ ] Real-time for all clients

---

## TASK-0033: Caddy HTTPS

**Priority**: P1 — Deploy
**Track**: Self-Hosting

### Current State
Already shipped. Keep this section as operational reference and for regression validation.

### Implementation

- [ ] Add Caddy service to `docker-compose.yml` (optional, production only)
- [ ] `docker-compose.prod.yml` overlay
- [ ] Automatic HTTPS via Let's Encrypt
- [ ] Proxy: `https://{domain}/` → web:3000, `wss://{domain}/socket` → gateway:4001
- [ ] Environment: `DOMAIN=chat.example.com`

### Acceptance Criteria
- [ ] `docker-compose -f docker-compose.yml -f docker-compose.prod.yml up` starts with HTTPS
- [ ] Automatic certificate provisioning
- [ ] WebSocket upgrade works through Caddy
- [ ] HTTP redirects to HTTPS

---

## TASK-0034: Admin Dashboard

**Priority**: P2 — Deploy
**Track**: Self-Hosting

### Implementation

- [ ] `/admin` page — instance admin only (first user or `ADMIN_USER_ID` env var)
- [ ] Sections: Overview (stats), Users (list/disable/reset), Servers (list/delete), System (health), Logs (recent errors)

### Acceptance Criteria
- [ ] Shows instance-wide statistics
- [ ] Admin can manage users and servers
- [ ] System health visible
- [ ] Non-admin blocked

---

## TASK-0035: Data Export

**Priority**: P2 — Deploy
**Track**: Self-Hosting

### Implementation

- [ ] Server export (owner): `POST /api/servers/{serverId}/export` → JSON archive
- [ ] User export (any user): `POST /api/users/me/export` → JSON archive (GDPR)
- [ ] Admin export: `POST /api/admin/export` → full instance backup
- [ ] No API keys or passwords in exports
- [ ] Large exports as background jobs

### Acceptance Criteria
- [ ] Server owner can export server data
- [ ] Users can export own data
- [ ] Admin can export full instance
- [ ] < 5 min for typical server
- [ ] No secrets in exports

---

## TASK-0036: Mobile Responsive Polish

**Priority**: P1 — Deploy
**Track**: Self-Hosting

### Implementation

- [ ] Mobile layout (< 768px): single column, slide-out sidebars, bottom nav
- [ ] Touch: long-press context menu, pull-to-refresh, 44px+ targets
- [ ] Input: sticky bottom, auto-resize, mobile upload
- [ ] Performance: lazy images, virtual scroll, reduced animations

### Acceptance Criteria
- [ ] Fully usable on iPhone and Android browsers
- [ ] Three-column collapses to single with slide-outs
- [ ] All features work on mobile
- [ ] Keyboard doesn't break layout
- [ ] No horizontal scrolling

---

## Files to Create / Modify (All Tasks)

### New Files

```
# Launch (Track B Chat)
packages/web/components/chat/message-actions.tsx
packages/web/components/chat/edit-message-input.tsx
packages/web/components/chat/mention-autocomplete.tsx
packages/web/components/chat/unread-divider.tsx
packages/web/lib/hooks/use-unread.ts

# Wave 1
packages/web/components/dm/dm-sidebar.tsx
packages/web/components/dm/dm-list.tsx
packages/web/components/dm/dm-chat.tsx
packages/web/app/(app)/dms/page.tsx
packages/web/app/(app)/dms/[dmId]/page.tsx
packages/web/app/api/dms/route.ts
packages/web/app/api/dms/[dmId]/messages/route.ts
packages/web/app/api/dms/search/route.ts
packages/web/app/api/internal/dms/messages/route.ts
gateway/lib/hive_gateway_web/channels/dm_channel.ex

# Wave 2
packages/web/components/search/search-panel.tsx
packages/web/components/search/search-result.tsx
packages/web/app/(app)/servers/[serverId]/settings/page.tsx
packages/web/app/(app)/servers/[serverId]/settings/layout.tsx
packages/web/components/settings/server-overview.tsx
packages/web/components/settings/server-channels.tsx
packages/web/components/settings/server-roles.tsx
packages/web/components/settings/server-members.tsx
packages/web/components/settings/server-bots.tsx
packages/web/components/settings/server-invites.tsx
packages/web/components/settings/server-danger.tsx
packages/web/app/(app)/settings/page.tsx
packages/web/components/settings/user-profile.tsx
packages/web/components/settings/user-account.tsx
packages/web/components/user/user-profile-card.tsx
packages/web/app/api/users/me/route.ts
packages/web/app/api/users/me/password/route.ts
packages/web/app/api/users/[userId]/route.ts
packages/web/app/api/servers/[serverId]/search/route.ts
packages/web/app/api/uploads/route.ts
packages/web/components/chat/file-upload-button.tsx
packages/web/components/chat/image-preview.tsx
packages/web/components/chat/file-card.tsx

# Wave 3
packages/web/components/chat/emoji-picker.tsx
packages/web/components/chat/reaction-pills.tsx
packages/web/components/notifications/notification-bell.tsx
packages/web/components/notifications/notification-panel.tsx
packages/web/app/api/notifications/route.ts
packages/web/app/api/notifications/[id]/read/route.ts

# Deploy
docker-compose.prod.yml
Caddyfile
packages/web/app/(app)/admin/page.tsx
packages/web/app/(app)/admin/layout.tsx
packages/web/components/admin/admin-overview.tsx
packages/web/components/admin/admin-users.tsx
packages/web/components/admin/admin-servers.tsx
packages/web/components/admin/admin-system.tsx
packages/web/app/api/admin/route.ts
packages/web/app/api/servers/[serverId]/export/route.ts
packages/web/app/api/users/me/export/route.ts
packages/web/app/api/admin/export/route.ts
```

### Modified Files

```
prisma/schema.prisma                                      — every wave adds models/fields
docker-compose.yml                                        — Wave 2 (upload volume), Deploy (Caddy)
.env.example                                              — each wave adds variables
packages/web/components/chat/message-item.tsx              — Launch (edit/delete), Wave 3 (reactions)
packages/web/components/chat/message-input.tsx             — Launch (mentions), Wave 2 (upload)
packages/web/components/chat/message-list.tsx              — Launch (unread divider)
packages/web/components/chat/chat-area.tsx                 — Launch, Wave 2
packages/web/components/layout/channel-sidebar.tsx         — Launch (unread bold/badges)
packages/web/components/layout/server-sidebar.tsx          — Launch (unread dots), Wave 1 (DM section)
packages/web/components/layout/member-list.tsx             — Wave 1 (DM action)
packages/web/app/(app)/layout.tsx                          — Wave 3 (notification bell), Deploy (mobile nav)
gateway/lib/hive_gateway_web/channels/room_channel.ex      — Launch (edit/delete), Wave 3 (reactions)
gateway/lib/hive_gateway_web/channels/user_socket.ex       — Wave 1 (DM channel auth)
gateway/lib/hive_gateway/application.ex                    — Wave 1 (DM support)
packages/shared/types/message.ts                           — Launch (editedAt, mentions), Wave 2 (attachments), Wave 3 (reactions)
packages/shared/types/user.ts                              — Wave 2 (profile fields)
docs/PROTOCOL.md                                          — every wave adds events/contracts
docs/DECISIONS.md                                         — each wave appends decisions
```

---

## Conventions

Follow existing rules from `CLAUDE.md` and `docs/OPERATIONS.md`:

- **IDs**: ULIDs everywhere
- **Contracts**: Update `docs/PROTOCOL.md` BEFORE writing code for any new cross-service event
- **Commits**: `type(scope): description` — feat, fix, docs, refactor, chore, test
- **Migrations**: One per task, named descriptively
- **Testing**: Verify `docker-compose up` works after every task
- **Logging**: Structured JSON logs in all services
- **Boundary**: Go owns orchestration, Elixir owns transport (DEC-0019)
