import SwiftUI

struct CourtRow: View {
    let court: Court

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(statusColor)
                .frame(width: 12, height: 12)
            VStack(alignment: .leading, spacing: 2) {
                Text(court.name)
                    .font(.headline)
                Text(statusLabel)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let lastUpdated = court.lastUpdated {
                Text(lastUpdated, style: .relative)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch court.status {
        case .available: .green
        case .occupied: .red
        case .noSensor: .gray
        }
    }

    private var statusLabel: String {
        switch court.status {
        case .available: "Available"
        case .occupied: "Occupied"
        case .noSensor: "No sensor"
        }
    }
}
