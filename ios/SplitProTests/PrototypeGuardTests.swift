import XCTest
@testable import SplitPro

final class PrototypeGuardTests: XCTestCase {
  func testMutationTransportFailsClosed() async throws {
    guard Prototype.readOnly else { throw XCTSkip("Compile with PROTOTYPE_READONLY") }
    let api = APIClient()
    for path in ["api/trpc/user.addOrEditExpense", "api/trpc/group.addOrEditExpense",
                 "api/trpc/user.deleteExpense", "api/trpc/user.remind", "api/other-write"] {
      do {
        _ = try await api.request(path: path, body: Data("{}".utf8))
        XCTFail("Prototype allowed a write")
      } catch {
        XCTAssertEqual(error.localizedDescription, Prototype.message)
      }
    }
  }
}
