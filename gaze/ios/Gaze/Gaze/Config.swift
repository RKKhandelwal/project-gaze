import Foundation

enum Config {
    static let apiBaseURL = URL(string: "https://project-gaze.vercel.app")!

    static let supabaseURL = URL(string: "https://jteplcdbfdsiyzhfqkxh.supabase.co")!

    // Anon (public) key — safe to ship in the app.
    // Replace with the anon key from Supabase → Project Settings → API.
    static let supabaseAnonKey = "sb_publishable_yYVAsVC9W0-AE6GKjR6lyw_WbBRWXN-"
}
