# Admin module UI/UX workflow review

## Scope

This change focuses only on the five admin work areas: membership card, points card/ticket library, event tickets, calendar, and booking.

## Confirmed implementation boundary

- No database schema changes.
- No API contract changes.
- No authentication or authorization changes.
- No membership, ticket, calendar, or booking business-rule changes.
- Existing form ids, event hooks, and server-side authorization remain unchanged.

## Workflow improvements

### Membership card

- Membership-tier settings are presented as clearer level cards.
- Tier configuration and member directory are visually separated.
- Search/result count and member row actions have stronger hierarchy.
- Mobile row actions retain large touch targets.

### Points card and ticket library

- List and editor are separated into an explicit selection/editing workflow.
- Desktop lists stay visible while editing long forms.
- Reward nodes and prize configuration are grouped as distinct sub-sections.
- Save/archive/delete actions remain visible at the bottom of long editors.
- Destructive actions are visually separated from the primary save action.

### Event tickets

- Audience tier selection becomes a clear selectable group.
- Date-range controls are grouped and visually distinguished from ticket copy.
- Primary create action is prioritized ahead of delete.
- Quota, accent, prize and date configuration retain responsive layout.

### Calendar

- Desktop uses a calendar + editor two-column workspace when space allows.
- Today, weekends, holidays and events have clearer visual distinction.
- Calendar item editing stays visible beside the calendar on large screens.
- Existing item list becomes easier to scan and remains horizontally usable on mobile.
- Batch editor is visually separated from single-item editing.

### Booking

- Booking settings, stats, service management and confirmation queue use a consistent card hierarchy.
- Service and booking cards have stronger status/selection cues.
- Booking subtabs use segmented navigation.
- Mobile stats remain horizontally scannable without compressing text.
- Action groups collapse to large full-width controls on narrow screens.

## Mobile interaction

When a user selects or creates a points card, ticket, event ticket or calendar item on a narrow viewport, the page guides them to the matching editor only when that editor is not already near the visible area. This reduces repeated manual scrolling without changing selection logic.

## Verification

`MemberWebsocket-dev/tests/admin_ui_workflow_polish.test.js` verifies:

- the stylesheet is loaded;
- all five module selectors are present;
- a mobile breakpoint is present;
- editor action hierarchy exists;
- CSS braces are balanced;
- mobile list-to-editor guidance is wired for the four list/editor workflows.
