import SwiftUI

struct CourtsView: View {
    let model: CourtsModel

    var body: some View {
        NavigationStack {
            Group {
                switch model.state {
                case .idle, .loading where model.courts.isEmpty:
                    ProgressView("Loading courts…")
                case .error(let message) where model.courts.isEmpty:
                    VStack(spacing: 12) {
                        Image(systemName: "wifi.exclamationmark")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                        Text("Couldn't load courts")
                            .font(.headline)
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Try again") {
                            Task { await model.refresh() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding()
                default:
                    List(model.courts) { court in
                        CourtRow(court: court)
                    }
                    .refreshable { await model.refresh() }
                }
            }
            .navigationTitle("Courts")
        }
    }
}
