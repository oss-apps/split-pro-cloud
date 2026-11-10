import Foundation
import Security

struct Person: Codable, Identifiable, Hashable {
  let id: Int
  let name: String?
  let email: String?
  var displayName: String { name ?? email ?? "Friend" }
}
struct Balance: Decodable, Identifiable {
  let friendId: Int
  let amount: Int64
  let currency: String
  let friend: Person
  let hasMore: Bool?
  var id: Int { friendId }
}
struct Total: Decodable { let currency: String; let amount: Int64 }
struct BalancesResponse: Decodable {
  let balances: [Balance]
  let youOwe: [Total]
  let youGet: [Total]
}
struct SignInResponse: Decodable { let token: String; let user: Person }
struct ExpenseDraft: Encodable {
  struct Participant: Encodable { let userId: Int; let amount: Decimal }
  let name: String
  let amount: Decimal
  let currency: String
  let paidBy: Int
  let splitType: SplitKind
  let expenseDate: String
  let participants: [Participant]
  let category = "general"
}
struct APIError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

enum Keychain {
  static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "app.splitpro.proto", kSecAttrAccount as String: "session"] }
  static func read() -> String? {
    var q = query
    q[kSecReturnData as String] = true
    var result: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
  static func save(_ token: String?) throws {
    SecItemDelete(query as CFDictionary)
    guard let token else { return }
    var q = query
    q[kSecValueData as String] = Data(token.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(q as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw APIError(message: "Could not securely save your session (\(status)).")
    }
  }
}

/// Non-batched tRPC HTTP transport. Superjson preserves Date and BigInt annotations.
struct APIClient {
  let baseURL: URL
  var token: String?
  init(token: String? = nil) {
    baseURL = URL(string: ProcessInfo.processInfo.environment["SPLITPRO_API_URL"]
      ?? Bundle.main.object(forInfoDictionaryKey: "SplitProAPIURL") as? String
      ?? "http://localhost:3192")!
    self.token = token
  }
  func auth<T: Decodable>(_ path: String, body: [String: String], as: T.Type) async throws -> T {
    let data = try await request(path: "api/mobile/auth/\(path)", body: JSONSerialization.data(withJSONObject: body))
    return try JSONDecoder().decode(T.self, from: data)
  }
  func saveExpense(_ expense: ExpenseDraft) async throws {
    struct Created: Decodable { let id: String }
    let encoded = try JSONEncoder().encode(expense)
    let input = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
    _ = try await call("user.addOrEditExpense", input: input, mutation: true, annotations: ["expenseDate": ["Date"]], as: Created.self)
  }
  func call<T: Decodable>(_ procedure: String, input: [String: Any]? = nil, mutation: Bool = false,
                          annotations: [String: [String]] = [:], as: T.Type) async throws -> T {
    let encoded = try input.map { try SuperJSON.encode($0, annotations: annotations) }
    let data = try await request(path: "api/trpc/\(procedure)", body: mutation ? encoded : nil,
      queryInput: mutation ? nil : encoded.flatMap { String(data: $0, encoding: .utf8) })
    let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    if let error = object?["error"] as? [String: Any] {
      let payload = error["json"] as? [String: Any] ?? error
      throw APIError(message: payload["message"] as? String ?? "Request failed")
    }
    guard let result = object?["result"] as? [String: Any],
          let payload = result["data"] as? [String: Any], let json = payload["json"] else {
      throw APIError(message: "Unexpected server response")
    }
    let normalized = try SuperJSON.normalize(json, meta: payload["meta"] as? [String: Any])
    return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: normalized, options: [.fragmentsAllowed]))
  }
  func request(path: String, body: Data?, queryInput: String? = nil) async throws -> Data {
    var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
    if let queryInput { components.queryItems = [URLQueryItem(name: "input", value: queryInput)] }
    var request = URLRequest(url: components.url!)
    request.httpMethod = body == nil ? "GET" : "POST"
    request.httpBody = body
    request.timeoutInterval = 30
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      let error = object?["error"] as? [String: Any]
      let details = error?["json"] as? [String: Any] ?? error
      throw APIError(message: object?["error"] as? String ?? details?["message"] as? String
        ?? "The server could not complete your request. Please try again.")
    }
    return data
  }
}

enum SuperJSON {
  static func encode(_ json: Any, annotations: [String: [String]]) throws -> Data {
    func walk(_ value: Any, path: String) throws -> Any {
      if annotations[path]?.first == "bigint" {
        let text = (value as? NSNumber)?.stringValue ?? value as? String ?? ""
        guard let integer = Int64(text) else { throw APIError(message: "Invalid Int64 money value") }
        return String(integer)
      }
      if let dictionary = value as? [String: Any] {
        return try dictionary.reduce(into: [String: Any]()) { result, item in
          result[item.key] = try walk(item.value, path: path.isEmpty ? item.key : "\(path).\(item.key)")
        }
      }
      if let array = value as? [Any] {
        return try array.enumerated().map { try walk($0.element, path: path.isEmpty ? "\($0.offset)" : "\(path).\($0.offset)") }
      }
      return value
    }
    var envelope: [String: Any] = ["json": try walk(json, path: "")]
    if !annotations.isEmpty { envelope["meta"] = ["values": annotations] }
    return try JSONSerialization.data(withJSONObject: envelope)
  }

  static func normalize(_ json: Any, meta: [String: Any]?) throws -> Any {
    let annotations = meta?["values"] as? [String: [String]] ?? [:]
    func walk(_ value: Any, path: String) throws -> Any {
      if annotations[path]?.first == "bigint", let string = value as? String {
        guard let integer = Int64(string) else { throw APIError(message: "Money exceeds Int64 range") }
        return NSNumber(value: integer)
      }
      if let dictionary = value as? [String: Any] {
        return try dictionary.reduce(into: [String: Any]()) { result, item in
          result[item.key] = try walk(item.value, path: path.isEmpty ? item.key : "\(path).\(item.key)")
        }
      }
      if let array = value as? [Any] {
        return try array.enumerated().map { try walk($0.element, path: path.isEmpty ? "\($0.offset)" : "\(path).\($0.offset)") }
      }
      return value
    }
    return try walk(json, path: "")
  }
}
