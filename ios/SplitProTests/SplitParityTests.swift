import XCTest
@testable import SplitPro

final class SplitParityTests: XCTestCase {
  struct Fixture: Decodable {
    struct Input: Decodable { let id: Int; let share: String }
    struct Switch: Decodable { let kind: SplitKind; let expected: [Int64]; let valid: Bool }
    let name: String
    let cents: Int64
    let kind: SplitKind
    let payer: Int
    let people: [Input]
    let expected: [Int64]
    let valid: Bool
    let switches: [Switch]
  }
  func testTypeScriptParity() throws {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "splits", withExtension: "json", subdirectory: "Fixtures"))
    let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    XCTAssertEqual(fixtures.count, 30)
    for fixture in fixtures {
      let people = try fixture.people.map { SplitInput(id: $0.id, share: try XCTUnwrap(Decimal(string: $0.share))) }
      let result = SplitEngine.calculate(cents: fixture.cents, people: people, kind: fixture.kind, payer: fixture.payer)
      XCTAssertEqual(result.amounts, fixture.expected, fixture.name)
      XCTAssertEqual(result.valid, fixture.valid, fixture.name)
      if result.valid { XCTAssertEqual(result.amounts.reduce(0, +), 0, fixture.name) }
      for target in fixture.switches {
        let shares = SplitEngine.rebuild(cents: fixture.cents, people: people.map(\.id), amounts: result.amounts, kind: target.kind, payer: fixture.payer)
        let rebuilt = SplitEngine.calculate(cents: fixture.cents, people: zip(people, shares).map { SplitInput(id: $0.0.id, share: $0.1) }, kind: target.kind, payer: fixture.payer)
        XCTAssertEqual(rebuilt.amounts, target.expected, "\(fixture.name) → \(target.kind)")
        XCTAssertEqual(rebuilt.valid, target.valid, "\(fixture.name) → \(target.kind)")
      }
    }
  }
  func testMoneyParsingAndNegativeTies() {
    XCTAssertEqual(Money.cents("123.45"), 12345)
    XCTAssertNil(Money.cents("1.001"))
    XCTAssertNil(Money.cents("21474836.48"))
    XCTAssertNil(Money.cents("12abc"))
    XCTAssertEqual(Money.jsRound(Decimal(string: "-1.5")!), -1)
    XCTAssertEqual(Money.jsRound(Decimal(string: "1.5")!), 2)
  }
  func testSuperJSONBigInt() throws {
    let encoded = try SuperJSON.encode(["amount": Int64.max], annotations: ["amount": ["bigint"]])
    let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    let roundTrip = try SuperJSON.normalize(envelope["json"]!, meta: envelope["meta"] as? [String: Any]) as? [String: NSNumber]
    XCTAssertEqual(roundTrip?["amount"]?.int64Value, Int64.max)
    let normalized = try SuperJSON.normalize(["amount": "9223372036854775807"], meta: ["values": ["amount": ["bigint"]]]) as? [String: NSNumber]
    XCTAssertEqual(normalized?["amount"]?.int64Value, Int64.max)
    XCTAssertThrowsError(try SuperJSON.normalize(["amount": "9223372036854775808"], meta: ["values": ["amount": ["bigint"]]]))
  }
}
