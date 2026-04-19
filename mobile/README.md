# Gaze Mobile (React Native)

React Native mobile app for Project Gaze, migrated from the native SwiftUI iOS app.

This app currently focuses on the same v1 scope as the previous iOS app:

- List courts
- Show live availability status
- Pull to refresh
- Realtime-triggered refreshes (via Supabase events)

---

## Why this app exists

The project was migrated to React Native to support a shared TypeScript type contract across:

- `mobile` (React Native app)
- `server` (Next.js API)
- `packages/types` (shared domain + API types)

This reduces model drift between clients and backend by making API response/request shapes compile-time checked in both apps.

---

## Workspace structure

At the monorepo root (`gaze/`):

- `mobile/` — React Native app
- `server/` — Next.js backend API
- `packages/types/` — shared TypeScript types package (`@gaze/types`)

---

## Prerequisites

- Node.js 20+
- npm 10+ (workspaces enabled)
- Xcode (for iOS simulator/device)
- CocoaPods (for iOS native dependencies)
- Android Studio + SDK (optional if testing Android)

---

## Install dependencies

From `gaze/`:

```bash
npm install
```

This installs dependencies for all workspaces (`server`, `mobile`, `packages/types`).

---

## Shared types usage

The app imports API/domain contracts from `@gaze/types`, for example:

- `Court`
- `CourtStatus`
- response/error types for endpoints

Any server contract changes should be made in `packages/types/src/index.ts` and then consumed by both app and backend.

---

## Configuration

Create/update environment config for the app with:

- API base URL (Next.js deployment)
- Supabase URL
- Supabase anon key (safe for client use)

Recommended values match existing project settings used by prior iOS client.

> Important: never use the Supabase service role key in the mobile app.

---

## Running the app

From `gaze/`:

```bash
npm run start:mobile
```

In another terminal, launch platform:

```bash
npm run ios:mobile
```

or

```bash
npm run android:mobile
```

---

## Data flow

1. Mobile fetches courts from `GET /api/courts`
2. It renders statuses (`available`, `occupied`, `no_sensor`)
3. It subscribes to Supabase realtime `events` inserts
4. On new event insert, it refetches `/api/courts`

This preserves the same v1 behavior from the former SwiftUI app.

---

## Migration notes (SwiftUI → React Native)

Migrated concepts:

- `Court` model in Swift → `Court` type from `@gaze/types`
- `CourtsAPI.fetchCourts()` → typed fetch client in React Native
- `CourtsModel` observable state → React state/store + async effects
- `CourtRow` SwiftUI view → React Native row component

Behavior retained:

- Initial loading state
- Error state with retry
- Pull-to-refresh
- Live updates when `events` table receives inserts

Known intentional differences:

- Native Swift-specific app lifecycle/hooks replaced with React Native equivalents
- UI visuals may differ slightly while preserving semantics and status meaning

---

## Quality checks

From `gaze/`:

```bash
npm run typecheck
```

This verifies shared type compatibility across:

- `@gaze/types`
- `server`
- `mobile`

---

## Backward compatibility strategy

During transition, both clients can coexist:

- Legacy SwiftUI iOS app (if still needed)
- New React Native app

Server API remains the source of truth and should continue returning shapes defined in `@gaze/types`.

---

## v1 limitations (unchanged)

Not included yet:

- Auth screens
- Locations/favorites flows
- History and predictions UI
- Admin actions

These can now be added with lower risk using shared contracts in `@gaze/types`.

---

## Next recommended steps

1. Add endpoint-specific shared response unions (success + error)
2. Add runtime validation (e.g., schema decoding) for network responses
3. Add CI guard to fail if server responses drift from shared contracts
4. Add screen modules for history/predictions using existing endpoints
5. Decommission old iOS Swift target once RN app is fully accepted