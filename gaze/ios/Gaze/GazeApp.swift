import SwiftUI

@main
struct GazeApp: App {
    @State private var model = CourtsModel()

    var body: some Scene {
        WindowGroup {
            CourtsView(model: model)
                .task {
                    await model.start()
                }
        }
    }
}
