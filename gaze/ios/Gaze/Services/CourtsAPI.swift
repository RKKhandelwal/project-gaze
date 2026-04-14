import Foundation

struct CourtsAPI {
    func fetchCourts() async throws -> [Court] {
        let url = Config.apiBaseURL.appendingPathComponent("api/courts")
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode([Court].self, from: data)
    }
}
