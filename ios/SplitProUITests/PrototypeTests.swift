import XCTest

/// Explicit opt-in only: auth and reads against production, never expense writes.
final class PrototypeTests: XCTestCase {
  @MainActor func testSwiftUIReadOnlyProduction() throws {
    guard ProcessInfo.processInfo.environment["SPLITPRO_PROTOTYPE_TEST"] == "1" else {
      throw XCTSkip("Opt in to the production read-only smoke test")
    }
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launch()
    if app.tabBars.buttons["Account"].waitForExistence(timeout: 3) {
      app.tabBars.buttons["Account"].tap()
      app.buttons["Sign Out"].tap()
    }
    let path = try XCTUnwrap(ProcessInfo.processInfo.environment["SPLITPRO_REVIEW_CODE_FILE"])
    let code = try String(contentsOfFile: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    XCTAssertTrue(app.textFields["auth.email"].waitForExistence(timeout: 10))
    app.textFields["auth.email"].tap()
    app.textFields["auth.email"].typeText("review@splitpro.app")
    app.buttons["auth.continue"].tap()
    XCTAssertTrue(app.textFields["auth.code"].waitForExistence(timeout: 45))
    app.textFields["auth.code"].tap()
    app.textFields["auth.code"].typeText(code)
    app.buttons["auth.continue"].tap()
    XCTAssertTrue(app.buttons["expense.new"].waitForExistence(timeout: 45))
    XCTAssertFalse(app.staticTexts["Couldn't load balances"].waitForExistence(timeout: 3))
    app.buttons["expense.new"].tap()
    XCTAssertTrue(app.buttons["expense.save"].waitForExistence(timeout: 10))
    app.buttons["expense.save"].tap()
    XCTAssertTrue(app.alerts["Read-only prototype"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.alerts.staticTexts["Prototype build: saving is turned off"].exists)
    app.alerts.buttons["OK"].tap()
    XCTAssertTrue(app.buttons["expense.save"].exists)
  }

  @MainActor func testExpoReadOnlyProduction() throws {
    guard ProcessInfo.processInfo.environment["SPLITPRO_PROTOTYPE_TEST"] == "1" else {
      throw XCTSkip("Opt in to the production read-only smoke test")
    }
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "app.splitpro")
    app.activate()
    if !app.buttons["Add expense"].waitForExistence(timeout: 10) {
      if !app.staticTexts["Check your email"].firstMatch.exists {
        let email = app.textFields["Enter your email"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        email.tap()
        email.typeText("review@splitpro.app")
        app.buttons["Send code"].tap()
      }
      let input = app.textFields["Code"]
      XCTAssertTrue(app.staticTexts["Check your email"].firstMatch.waitForExistence(timeout: 45))
      let path = try XCTUnwrap(ProcessInfo.processInfo.environment["SPLITPRO_REVIEW_CODE_FILE"])
      let code = try String(contentsOfFile: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
      // The hidden OTP input is auto-focused, but can be absent from the accessibility tree.
      if input.exists { input.tap(); input.typeText(code) }
      else {
        for character in code.uppercased() {
          let key = app.keys[String(character)].firstMatch
          if !key.exists { app.keys["more"].tap() }
          key.tap()
        }
      }
    }
    let add = app.buttons["Add expense"].firstMatch
    XCTAssertTrue(add.waitForExistence(timeout: 45))
    add.tap()
    XCTAssertTrue(app.buttons["Add"].waitForExistence(timeout: 15))
    app.buttons["Add"].tap()
    XCTAssertTrue(app.alerts["Read-only prototype"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.alerts.staticTexts["Prototype build: saving is turned off"].exists)
    app.alerts.buttons["OK"].tap()
    XCTAssertTrue(app.buttons["Add"].exists)
  }
}
