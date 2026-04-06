# frontend_global_admin_prompt.md

Build a modern SaaS-style **Global Bot Admin** dashboard for a Discord/Kick notifier platform.

Important constraints:
- Use **mock data only**.
- Do **not** connect to any backend yet.
- Build reusable components so API integration can be added later.
- Access to this area is for **global admins only** (show guarded UX states).
- Must be responsive for desktop and mobile.

## Product context
This admin area manages global Discord bot presence behavior (not guild-specific settings).
Global admins can configure rotating bot status messages shown in Discord presence.

## Design direction
- Clean, modern SaaS admin panel
- Professional visual hierarchy
- Light + dark aware styling (or one polished mode if simpler)
- Accessible color contrast and clear form validation states
- Crisp tables/cards with sensible spacing

## Pages to generate

1. **Global Settings Page**
- Header with title: "Global Bot Settings"
- Summary cards:
  - Rotation enabled/disabled
  - Rotation interval (seconds)
  - Enabled status messages count
  - Last updated timestamp
- Settings form fields:
  - Rotation enabled toggle
  - Rotation interval selector/input (seconds)
  - Default status enabled toggle
  - Default activity type select (PLAYING, WATCHING, LISTENING, COMPETING, CUSTOM)
  - Default status text input
- Save/Cancel actions
- Inline validation and error banners

2. **Status Messages Management Page/Section**
- Table/list of status messages with columns:
  - Drag handle (for reorder)
  - Text
  - Activity type
  - Use placeholders (yes/no)
  - Enabled toggle
  - Updated at
  - Actions (Edit/Delete)
- Add Status button
- Empty state when none exists
- Bulk reorder UX with drag-and-drop behavior

3. **Add/Edit Status Modal**
- Fields:
  - Status text
  - Activity type dropdown
  - Enabled toggle
  - Use placeholders toggle
- Validation:
  - Text required
  - Max length helper
- Save + Cancel buttons

4. **Status Preview Panel**
- Live preview card showing how selected status appears in Discord presence style
- Show placeholder chips and rendered preview examples:
  - {guildCount}
  - {trackedStreamerCount}
  - {liveStreamerCount}
  - {userCount}
  - {botName}
- Mock rendered example text updates when form changes

5. **Access Control States**
- State A: authorized global admin sees full page
- State B: unauthorized user sees friendly "403 Global admin required" page with back button

## Components to include
- `GlobalSettingsForm`
- `StatusMessagesTable`
- `StatusMessageRow`
- `StatusMessageModal`
- `StatusPreviewCard`
- `AdminAccessGuard`
- `ConfirmDeleteDialog`
- `Toast/Alert` system

## Mock data contract (shape only)
Use strongly typed mock objects matching this shape:

```ts
type ActivityType = "PLAYING" | "WATCHING" | "LISTENING" | "COMPETING" | "CUSTOM";

interface GlobalBotConfig {
  id: string;
  rotationEnabled: boolean;
  rotationIntervalSeconds: number;
  defaultStatusEnabled: boolean;
  defaultStatusText: string | null;
  defaultActivityType: ActivityType | null;
  updatedAt: string;
}

interface BotStatusMessage {
  id: string;
  text: string;
  activityType: ActivityType;
  isEnabled: boolean;
  sortOrder: number;
  usePlaceholders: boolean;
  updatedAt: string;
}
```

## UX behavior with mock state
- Toggling switches should update local UI state.
- Reordering should update `sortOrder` locally.
- Save buttons should simulate async loading and show success toast.
- Delete should require confirmation.
- Show disabled states while "saving".

## Responsive requirements
- Desktop: table layout with side preview panel.
- Tablet/mobile: stacked cards, bottom-sheet modal style acceptable.
- Keep all primary actions reachable without horizontal scrolling.

## Deliverable expectation
Generate all page layouts and components with mock data wiring only, production-style structure, and clean component boundaries so backend API integration can be plugged in later.
