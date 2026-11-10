import XCTest

final class AppleSignInTests: XCTestCase {
  private func optIn() throws {
    guard ProcessInfo.processInfo.environment["SPLITPRO_PROTOTYPE_TEST"] == "1" else {
      throw XCTSkip("Opt in to production authentication smoke tests")
    }
  }

  @MainActor func testExpoSignInScreen() throws {
    try optIn()
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "app.splitpro")
    app.activate()
    if app.buttons["Cancel"].exists && app.buttons["Add"].exists { app.buttons["Cancel"].tap() }
    if app.tabBars.buttons["Account"].waitForExistence(timeout: 3) {
      app.tabBars.buttons["Account"].tap()
      let signOut = app.buttons["Sign out"].firstMatch
      for _ in 0..<6 {
        if signOut.exists && signOut.isHittable { break }
        if app.scrollViews.firstMatch.exists { app.scrollViews.firstMatch.swipeUp(velocity: .slow) }
        else { app.swipeUp(velocity: .slow) }
      }
      XCTAssertTrue(signOut.exists, app.debugDescription)
      signOut.tap()
      if app.alerts.firstMatch.waitForExistence(timeout: 3) {
        app.alerts.buttons["Sign out"].tap()
      }
    }
    XCTAssertTrue(app.buttons["Continue with Apple"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.textFields["Enter your email"].exists)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "build7-signin"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  @MainActor func testSwiftUISignInScreen() throws {
    try optIn()
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launch()
    if app.tabBars.buttons["Account"].waitForExistence(timeout: 3) {
      app.tabBars.buttons["Account"].tap()
      app.buttons["Sign Out"].tap()
    }
    XCTAssertTrue(app.buttons["auth.apple"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.textFields["auth.email"].exists)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "build8-signin"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
