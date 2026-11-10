import XCTest

final class SmokeTests: XCTestCase {
  @MainActor func testLaunch() {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
  }

  @MainActor func testScreenshotJourney() throws {
    continueAfterFailure = false
    guard ProcessInfo.processInfo.environment["SPLITPRO_CAPTURE"] == "1" else {
      throw XCTSkip("Run explicitly with the local capture server and seeded backend")
    }
    let app = XCUIApplication()
    for theme in ["light", "dark"] {
      bridge("theme=\(theme)")
      app.launchArguments = ["-AppleLocale", "en_US", "-AppleLanguages", "(en)"]
      app.launch()
      if app.tabBars.buttons["Account"].waitForExistence(timeout: 3) {
        app.tabBars.buttons["Account"].tap()
        app.buttons["Sign Out"].tap()
      }
      XCTAssertTrue(app.textFields["auth.email"].waitForExistence(timeout: 10))
      capture("signin-\(theme)")
      app.textFields["auth.email"].tap()
      app.textFields["auth.email"].typeText("alex@example.test")
      app.buttons["auth.continue"].tap()
      XCTAssertTrue(app.textFields["auth.code"].waitForExistence(timeout: 45))
      capture("signin-code-\(theme)")
      app.textFields["auth.code"].tap()
      app.textFields["auth.code"].typeText("SWIFT26")
      app.buttons["auth.continue"].tap()
      XCTAssertTrue(app.buttons["expense.new"].waitForExistence(timeout: 45))
      XCTAssertTrue(app.staticTexts["Sam Wilson"].waitForExistence(timeout: 30))
      capture("balances-\(theme)")
      app.swipeUp()
      capture("balances-collapsed-\(theme)")
      app.swipeDown()
      app.swipeDown()
      let search = app.searchFields.firstMatch
      XCTAssertTrue(search.waitForExistence(timeout: 5))
      search.tap()
      search.typeText("Jamie")
      capture("search-\(theme)")
      if app.buttons["Cancel"].exists { app.buttons["Cancel"].tap() }
      else { app.buttons["Close"].tap() }
      let row = app.staticTexts["Sam Wilson"]
      row.press(forDuration: 1.2)
      capture("balance-context-\(theme)")
      app.tapCoordinate(x: 0.08, y: 0.45)
      app.buttons["expense.new"].tap()
      XCTAssertTrue(app.textFields["expense.amount"].waitForExistence(timeout: 5))
      capture("expense-empty-\(theme)")
      app.textFields["expense.amount"].tap()
      app.textFields["expense.amount"].typeText("86.57")
      app.textFields["expense.description"].tap()
      app.textFields["expense.description"].typeText("Groceries for the weekend")
      app.buttons["keyboard.done"].tap()
      app.buttons.containing(.staticText, identifier: "With you and").firstMatch.tap()
      let priya = app.switches.matching(NSPredicate(format: "label == %@", "Priya Sharma")).firstMatch
      let jamie = app.switches.matching(NSPredicate(format: "label == %@", "Jamie Chen")).firstMatch
      XCTAssertTrue(priya.waitForExistence(timeout: 5))
      priya.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
      jamie.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
      capture("participants-\(theme)")
      app.navigationBars.buttons.element(boundBy: 0).tap()
      XCTAssertTrue(app.staticTexts["2 friends"].waitForExistence(timeout: 5))
      capture("expense-filled-\(theme)")
      app.buttons["expense.payer"].tap()
      capture("expense-paidby-menu-\(theme)")
      app.tapCoordinate(x: 0.08, y: 0.35)
      app.buttons["expense.split"].tap()
      capture("split-equal-\(theme)")
      app.buttons["split.kind"].tap()
      capture("split-menu-\(theme)")
      app.buttons["By shares"].tap()
      capture("split-editor-\(theme)")
      app.navigationBars.buttons.element(boundBy: 0).tap()
      XCTAssertTrue(app.buttons["expense.save"].isEnabled)
      app.buttons["expense.save"].tap()
      XCTAssertTrue(app.buttons["expense.new"].waitForExistence(timeout: 30))
      capture("balances-after-save-\(theme)")
      app.terminate()
    }
  }

  @MainActor private func capture(_ name: String) {
    // XCTest waits for the UI to become idle before the host takes a simctl screenshot.
    let attachment = XCTAttachment(screenshot: XCUIApplication().screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    bridge("name=\(name)")
  }
  private func bridge(_ query: String) {
    let done = expectation(description: "simctl capture")
    URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:3193/?\(query)")!) { _, _, error in
      XCTAssertNil(error)
      done.fulfill()
    }.resume()
    wait(for: [done], timeout: 15)
  }
}

extension XCUIApplication {
  func tapCoordinate(x: CGFloat, y: CGFloat) {
    coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap()
  }
}
