# Figma Make Prompt

Design and generate a complete frontend dashboard for a SaaS product named **KickBot Dashboard**.

Important constraints:
- Use **mock data only**.
- **Do not connect to any backend or API yet**.
- Build the UI so backend integration can be added later with minimal changes.
- Include all key pages and reusable components.
- Use a clean, modern SaaS design style.
- Ensure full responsive behavior for desktop and mobile.

## Product context
KickBot Dashboard is used by Discord server admins to:
- authenticate with Discord
- invite the bot
- see manageable Discord guilds
- configure alert channels per guild
- manage tracked Kick streamers
- view notification history

## Design direction
- Visual style: modern B2B SaaS, clean spacing, subtle shadows, polished cards, clear hierarchy.
- Typography: readable, professional, strong emphasis on headings and section labels.
- Color system: neutral base with vibrant green accents inspired by Kick.
- Components: consistent button styles, inputs, tables, tags, badges, toasts, modals, empty states.
- Interaction polish: hover states, loading states, skeletons, error states.
- Accessibility: good contrast, keyboard-friendly navigation patterns.

## Required pages/screens

1. **Login Page**
- Brand logo/title
- “Continue with Discord” primary CTA
- Short text explaining required permissions
- Security note footer

2. **Auth Callback / Loading Page**
- Loading indicator
- Success and error mock states
- Redirecting text

3. **Dashboard Home (Guild Selector)**
- Top navigation with user avatar menu
- Search + filter for guilds
- Guild cards/list showing:
  - guild name/icon
  - bot status (in guild / not in guild)
  - configured channel badge (or not configured)
  - tracked streamer count
  - “Open Guild” action
- Empty state when no manageable guilds

4. **Guild Overview Page**
- Header with guild icon/name
- Quick stats cards:
  - tracked streamers
  - active streamers
  - recent notifications
- Panel for alert channel configuration
- Short onboarding tips panel

5. **Guild Config Page**
- Form for alert channel selection (mock dropdown)
- Save/cancel actions
- Success/error toast examples

6. **Streamers Management Page**
- Table/list with columns:
  - streamer username
  - platform
  - status (enabled/disabled)
  - live state
  - last notified at
  - actions
- Add streamer modal/form
- Enable/disable toggle action
- Delete confirmation modal
- Duplicate streamer warning state
- Empty state when no streamers

7. **Notification History Page**
- Paginated table/list
- Columns:
  - sent time
  - streamer
  - platform
  - status
  - message ID
- Filters (date range, streamer search)
- Empty and loading states

8. **Bot Invite Helper Page**
- Card with invite explanation
- “Copy invite link” and “Open invite” buttons
- Post-invite checklist

9. **Settings / Account Menu States**
- Profile dropdown
- Logout action
- Session expired modal mock

10. **Error States**
- 401 unauthorized screen
- 403 no guild permission screen
- Generic server error screen

## Reusable components to generate
- Sidebar + topbar navigation variants
- Guild card component
- Stat card component
- Data table component (desktop) + card list variant (mobile)
- Form controls: input/select/toggle
- Modal dialog system
- Toast/alert system
- Status badges (success/warning/error/neutral)
- Pagination controls
- Skeleton loaders

## Mock data requirements
Create realistic mock datasets for:
- authenticated Discord user
- at least 8 guilds with varied bot/config states
- streamer lists with mixed enabled/disabled/live values
- notification history entries across multiple dates

Use believable IDs/usernames/channel labels, but no real tokens or secrets.

## Responsive behavior requirements
- Desktop: left sidebar + topbar layout
- Tablet: collapsible sidebar
- Mobile: bottom nav or compact top nav, stacked cards instead of wide tables

## Handoff readiness
- Name layers/components clearly.
- Organize pages and components so engineers can map them to routes and DTOs later.
- Keep copy and structure practical for production implementation.