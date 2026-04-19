# Project Gaze Workspace

Monorepo for Project Gaze with:

- `server/` — Next.js API backend
- `mobile/` — React Native (Expo) app
- `packages/types/` — shared TypeScript API/domain contracts
- `sensor/` — sensor-side Python code
- `scripts/` — developer tooling scripts (including tmux launcher)

---

## Prerequisites

- Node.js 20+
- npm 10+
- tmux (for split-pane launch script)
- Xcode / Android tooling if you want to run mobile simulators

---

## Install

From `gaze/`:

```bash
npm install
```

---

## Environment setup

Create `server/.env.local` (based on `server/.env.example`) and provide:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Mobile runtime config lives in `mobile/app.json` under `expo.extra`:

- `apiBaseUrl`
- `supabaseUrl`
- `supabaseAnonKey`

> Do not put service-role keys in the mobile config.

---

## Run with tmux (recommended)

Use the launcher script to start backend + mobile dev servers in one tmux session:

```bash
./scripts/dev-tmux.sh
```

Optional custom tmux session name:

```bash
./scripts/dev-tmux.sh my-session-name
```

What it does:

- Pane 1: `npm run dev:server`
- Pane 2: `npm run start:mobile`

If the session already exists, the script prints attach instructions instead of creating duplicates.

### tmux commands

Attach:

```bash
tmux attach -t gaze-dev
```

(Or your custom name.)

Detach from session (inside tmux):

- `Ctrl-b`, then `d`

Stop all dev processes by killing session:

```bash
tmux kill-session -t gaze-dev
```

---

## Run manually (without tmux)

Terminal 1:

```bash
npm run dev:server
```

Terminal 2:

```bash
npm run start:mobile
```

Then use Expo controls (`i` for iOS, `a` for Android) or run:

```bash
npm run ios:mobile
npm run android:mobile
```

---

## Workspace scripts

From repo root (`gaze/`):

- `npm run dev:server` — start Next.js API locally
- `npm run start:mobile` — start Expo dev server
- `npm run ios:mobile` — run iOS app
- `npm run android:mobile` — run Android app
- `npm run typecheck` — typecheck all workspaces
- `npm run lint:server` / `npm run lint:mobile` — lint apps

---

## Shared types workflow

Shared contracts live in `packages/types/src/index.ts` and are consumed by both `server` and `mobile` via `@gaze/types`.

Typical flow for API contract updates:

1. Edit shared types in `packages/types/src/index.ts`
2. Update server implementation to match
3. Update mobile usage if needed
4. Run:

```bash
npm run typecheck
```

This catches contract drift early across apps.