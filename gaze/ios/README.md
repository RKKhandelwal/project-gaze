# Gaze iOS App

Native SwiftUI iOS app for Project Gaze. Read-only v1: lists courts with live availability.

## Setup (one-time, ~5 min)

### 1. Create the Xcode project

Xcode's `.xcodeproj` format can't be generated outside Xcode, so create it once:

1. Open Xcode → **File → New → Project**
2. **iOS → App**, click **Next**
3. Fill in:
   - **Product Name:** `Gaze`
   - **Team:** your personal Apple ID (free)
   - **Organization Identifier:** `com.rkk.gaze` (or whatever you prefer)
   - **Interface:** SwiftUI
   - **Language:** Swift
   - **Storage:** None
4. Save to `/Users/rui/Desktop/claudeEXP/gaze/ios/` — **uncheck "Create Git repository"** (already inside the monorepo)
5. Xcode will create `gaze/ios/Gaze.xcodeproj` and a default `Gaze/` folder

### 2. Replace the default files

Xcode generated a `Gaze/ContentView.swift` and `Gaze/GazeApp.swift` — **delete those** (move to trash from the Xcode navigator), then drag the folders from the monorepo into Xcode's navigator:

- Drag `Gaze/Models/` into the project
- Drag `Gaze/Services/` into the project
- Drag `Gaze/Views/` into the project
- Drag `Gaze/GazeApp.swift` into the project
- Drag `Gaze/Config.swift` into the project

When the dialog appears, choose **"Create folder references"** and check **"Add to targets: Gaze"**.

### 3. Add the Supabase Swift SDK

1. In Xcode: **File → Add Package Dependencies…**
2. URL: `https://github.com/supabase/supabase-swift`
3. Dependency Rule: **Up to Next Major Version** from `2.0.0`
4. Add the **Supabase** product to the `Gaze` target

### 4. Set the Supabase anon key

1. Go to https://supabase.com/dashboard/project/jteplcdbfdsiyzhfqkxh/settings/api
2. Copy the **anon public** key (not service_role)
3. In Xcode, open `Config.swift` and replace `REPLACE_WITH_ANON_KEY` with the value

### 5. Run

Select your iPhone simulator (or plug in a real device), press ⌘R. You should see 8 courts.

## Structure

```
Gaze/
├── GazeApp.swift              # @main entry point
├── Config.swift               # API + Supabase URLs and keys
├── Models/
│   └── Court.swift            # Decodable model for /api/courts response
├── Services/
│   ├── CourtsAPI.swift        # REST client — fetches from Next.js server
│   └── CourtsModel.swift      # @Observable — state + Supabase Realtime subscription
└── Views/
    ├── CourtsView.swift       # Root list view
    └── CourtRow.swift         # Row for a single court
```

## Data flow

- **Initial load + pull-to-refresh:** GET `https://project-gaze.vercel.app/api/courts`
- **Live updates:** subscribe to Supabase `events` table INSERTs via the Swift SDK. On any insert, refetch `/api/courts` (simplest correct approach; cheap since there are only 8 courts).

## What's not in v1

Auth, locations list, history, predictions, favorites. All deferred to v2.
