import Foundation
import Observation
import Supabase

@Observable
@MainActor
final class CourtsModel {
    enum LoadState {
        case idle
        case loading
        case loaded
        case error(String)
    }

    var courts: [Court] = []
    var state: LoadState = .idle

    private let api = CourtsAPI()
    private let supabase = SupabaseClient(
        supabaseURL: Config.supabaseURL,
        supabaseKey: Config.supabaseAnonKey
    )
    private var realtimeTask: Task<Void, Never>?

    func start() async {
        await refresh()
        subscribeToEvents()
    }

    func refresh() async {
        state = .loading
        do {
            courts = try await api.fetchCourts()
            state = .loaded
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    private func subscribeToEvents() {
        realtimeTask?.cancel()
        realtimeTask = Task { [weak self] in
            guard let self else { return }
            let channel = supabase.channel("court-events")
            let inserts = channel.postgresChange(
                InsertAction.self,
                schema: "public",
                table: "events"
            )
            try? await channel.subscribeWithError()
            for await _ in inserts {
                await self.refresh()
            }
        }
    }
}
