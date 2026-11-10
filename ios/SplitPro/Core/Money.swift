import Foundation

enum Money {
  static func cents(_ text: String) -> Int64? {
    let normalized = text.replacingOccurrences(of: Locale.current.decimalSeparator ?? ".", with: ".")
    guard normalized.range(of: #"^[+-]?[0-9]+(?:\.[0-9]{0,2})?$"#, options: .regularExpression) != nil,
          let value = Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX")) else { return nil }
    let scaled = value * 100
    var source = scaled
    var rounded = Decimal()
    NSDecimalRound(&rounded, &source, 0, .plain)
    guard rounded == scaled, abs(rounded) <= Decimal(2_147_483_647) else { return nil }
    return NSDecimalNumber(decimal: rounded).int64Value
  }
  static func format(_ cents: Int64, _ currency: String) -> String {
    (Decimal(cents) / 100).formatted(.currency(code: currency))
  }
  // JavaScript Math.round rounds ties towards positive infinity, including negative ties.
  static func jsRound(_ value: Decimal) -> Int64 {
    var source = value + Decimal(string: "0.5")!
    var result = Decimal()
    NSDecimalRound(&result, &source, 0, .down)
    return NSDecimalNumber(decimal: result).int64Value
  }
}

enum SplitKind: String, CaseIterable, Codable {
  case equal = "EQUAL", percentage = "PERCENTAGE", shares = "SHARE", exact = "EXACT", adjustment = "ADJUSTMENT"
  var title: String {
    switch self {
    case .equal: "Equally"
    case .percentage: "By percentage"
    case .shares: "By shares"
    case .exact: "Exact amounts"
    case .adjustment: "By adjustment"
    }
  }
}

struct SplitInput {
  var id: Int
  var share: Decimal
}

struct SplitResult {
  var amounts: [Int64]
  var valid: Bool
}

enum SplitEngine {
  /// Mirrors calculateSplitShareBasedOnAmount: readable inputs only when they preserve every cent.
  static func rebuild(cents: Int64, people: [Int], amounts: [Int64], kind: SplitKind, payer: Int) -> [Decimal] {
    let sign: Int64 = cents < 0 ? -1 : 1
    let total = Decimal(abs(cents))
    let owed = people.indices.map { sign * ((people[$0] == payer ? cents : 0) - amounts[$0]) }
    func pick(_ candidates: [[Decimal]]) -> [Decimal] {
      candidates.first { shares in
        calculate(cents: cents, people: zip(people, shares).map { SplitInput(id: $0.0, share: $0.1) }, kind: kind, payer: payer).amounts == amounts
      } ?? candidates.last ?? []
    }
    switch kind {
    case .equal: return owed.map { $0 == 0 ? 0 : 1 }
    case .percentage:
      guard total != 0 else { return owed.map { _ in 0 } }
      var candidates: [[Decimal]] = []
      for scale in [1, 10, 100] {
        var units = owed.map { Money.jsRound(Decimal($0) / total * 100 * Decimal(scale)) }
        let remainder = Int64(100 * scale) - units.reduce(0, +)
        if let largest = units.indices.max(by: { units[$0] < units[$1] }), abs(remainder) <= people.count {
          units[largest] += remainder
        }
        candidates.append(units.map { Decimal($0) / Decimal(scale) })
      }
      candidates.append(owed.map { Decimal($0) / total * 100 })
      return pick(candidates)
    case .shares:
      guard let smallest = owed.filter({ $0 > 0 }).min() else { return owed.map { _ in 0 } }
      var candidates = (1...100).map { scale in
        owed.map { Decimal(Money.jsRound(Decimal($0) * Decimal(scale) / Decimal(smallest))) }
      }.filter { $0.allSatisfy { abs($0) <= 100 } }
      candidates.append(owed.map { Decimal(Money.jsRound(Decimal($0) / Decimal(smallest) * 100)) / 100 })
      candidates.append(owed.map { Decimal($0) / Decimal(smallest) })
      return pick(candidates)
    case .exact: return owed.map { Decimal($0) / 100 }
    case .adjustment:
      let smallest = owed.min() ?? 0
      return owed.map { Decimal($0 - smallest) / 100 }
    }
  }

  static func calculate(cents: Int64, people: [SplitInput], kind: SplitKind, payer: Int) -> SplitResult {
    guard !people.isEmpty else { return SplitResult(amounts: [], valid: false) }
    guard cents != 0 else { return SplitResult(amounts: people.map { _ in 0 }, valid: true) }
    let total = Decimal(abs(cents))
    let shares = people.map(\.share)
    let sum = shares.reduce(0, +)
    var valid = true
    let owed: [Decimal]
    switch kind {
    case .equal:
      let count = shares.filter { $0 != 0 }.count
      valid = count > 0
      owed = shares.map { $0 == 0 || count == 0 ? 0 : total / Decimal(count) }
    case .percentage:
      valid = Money.jsRound(sum * 100) == 10_000
      owed = shares.map { total * $0 / 100 }
    case .shares:
      valid = sum > 0
      owed = shares.map { valid ? total * $0 / sum : 0 }
    case .exact:
      valid = Money.jsRound(sum * 100) == abs(cents)
      owed = shares.map { $0 * 100 }
    case .adjustment:
      valid = Money.jsRound(sum * 100) <= abs(cents)
      owed = shares.map { (total - sum * 100) / Decimal(people.count) + $0 * 100 }
    }
    let sign: Decimal = cents < 0 ? -1 : 1
    var amounts = people.indices.map { index in
      Money.jsRound((people[index].id == payer ? Decimal(cents) : 0) - sign * owed[index])
    }
    let adjustable = people.indices.filter { owed[$0] != 0 }.sorted { people[$0].id < people[$1].id }
    if valid && !adjustable.isEmpty {
      var imbalance = amounts.reduce(0, +)
      var index = 0
      while imbalance != 0 {
        let correction: Int64 = imbalance > 0 ? -1 : 1
        amounts[adjustable[index % adjustable.count]] += correction
        imbalance += correction
        index += 1
      }
    }
    return SplitResult(amounts: amounts, valid: valid)
  }
}
