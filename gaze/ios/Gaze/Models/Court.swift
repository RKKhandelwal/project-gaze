import Foundation

struct Court: Identifiable, Decodable, Hashable {
    let courtId: String
    let name: String
    let status: Status
    let lastUpdated: Date?

    var id: String { courtId }

    enum Status: String, Decodable {
        case available
        case occupied
        case noSensor = "no_sensor"
    }

    enum CodingKeys: String, CodingKey {
        case courtId = "court_id"
        case name
        case status
        case lastUpdated = "last_updated"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        courtId = try c.decode(String.self, forKey: .courtId)
        name = try c.decode(String.self, forKey: .name)
        let raw = try c.decode(String.self, forKey: .status)
        status = Status(rawValue: raw) ?? .available
        if let iso = try c.decodeIfPresent(String.self, forKey: .lastUpdated) {
            lastUpdated = ISO8601DateFormatter.withFractionalSeconds.date(from: iso)
                ?? ISO8601DateFormatter().date(from: iso)
        } else {
            lastUpdated = nil
        }
    }
}

extension ISO8601DateFormatter {
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
