import SwiftUI

struct BalancesView: View {
  @Environment(AppModel.self) private var model
  @State private var search = ""
  @State private var adding = false
  @State private var selectedFriend: Person?
  var rows: [Balance] {
    (model.balances?.balances ?? []).filter { search.isEmpty || $0.friend.displayName.localizedCaseInsensitiveContains(search) }
  }
  var body: some View {
    NavigationStack {
      List {
        if search.isEmpty, let balances = model.balances {
          Section {
            VStack(alignment: .leading, spacing: 20) {
              Label("SHARED LIFE, SIMPLIFIED", systemImage: "sparkle").font(.caption2.weight(.semibold)).tracking(1.2).foregroundStyle(.secondary)
              HStack(alignment: .top, spacing: 22) {
                totalColumn("You're owed", totals: balances.youGet, color: Brand.owed, icon: "arrow.down.left")
                Divider()
                totalColumn("You owe", totals: balances.youOwe, color: Brand.owing, icon: "arrow.up.right")
              }
            }.padding(.vertical, 10)
          }
        }
        Section {
          ForEach(rows) { balance in
            Button { selectedFriend = balance.friend; adding = true } label: {
              HStack(spacing: 14) {
                Avatar(person: balance.friend)
                VStack(alignment: .leading, spacing: 5) {
                  Text(balance.friend.displayName).font(.body.weight(.medium)).foregroundStyle(.primary)
                  Text(balance.amount == 0 ? "Settled up" : balance.amount > 0 ? "owes you" : "you owe")
                    .font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 4) {
                  Text(Money.format(abs(balance.amount), balance.currency)).font(.body.weight(.semibold)).monospacedDigit()
                    .foregroundStyle(balance.amount >= 0 ? Brand.owed : Brand.owing)
                  if balance.hasMore == true { Text("+ other currencies").font(.caption2).foregroundStyle(.secondary) }
                }
              }.padding(.vertical, 8).contentShape(.rect)
            }.buttonStyle(.plain)
              .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button("Add expense", systemImage: "plus") { selectedFriend = balance.friend; adding = true }.tint(Brand.accent)
              }
              .contextMenu {
                Button("Add expense", systemImage: "plus.circle") { selectedFriend = balance.friend; adding = true }
                ShareLink(item: "Our SplitPro balance: \(Money.format(abs(balance.amount), balance.currency))") { Label("Share balance", systemImage: "square.and.arrow.up") }
              }
          }
        } header: { Text(search.isEmpty ? "Friends · \(rows.count)" : "Results") }
      }
      .listStyle(.insetGrouped)
      .navigationTitle("Balances")
      .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find a friend")
      .overlay {
        if model.loading && model.balances == nil { ProgressView("Getting your balances…") }
        else if let error = model.error, model.balances == nil {
          ContentUnavailableView { Label("Couldn't load balances", systemImage: "wifi.exclamationmark") } description: { Text(error) } actions: { Button("Try Again") { Task { await model.refresh() } } }
        } else if rows.isEmpty && !model.loading {
          if search.isEmpty {
            ContentUnavailableView("A fresh start", systemImage: "person.2", description: Text("Add an expense with a friend. Your shared balances will appear here."))
          } else { ContentUnavailableView.search(text: search) }
        }
      }
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Button("Add expense", systemImage: "plus") { selectedFriend = nil; adding = true }.accessibilityIdentifier("expense.new")
        }
      }
      .refreshable { await model.refresh() }
      .task { await model.refresh() }
      .sheet(isPresented: $adding) { AddExpenseView(friend: selectedFriend) }
    }
  }
  private func totalColumn(_ title: String, totals: [Total], color: Color, icon: String) -> some View {
    VStack(alignment: .leading, spacing: 9) {
      Label(title, systemImage: icon).font(.subheadline).foregroundStyle(.secondary)
      if totals.isEmpty { Text(Money.format(0, "USD")).font(.title2.bold()).foregroundStyle(color) }
      ForEach(totals, id: \.currency) { total in
        Text(Money.format(abs(total.amount), total.currency)).font(.title2.bold()).foregroundStyle(color).monospacedDigit().minimumScaleFactor(0.7)
      }
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct Avatar: View {
  let person: Person
  private var color: Color { [Brand.accent, .indigo, .orange, .purple, .blue][abs(person.id) % 5] }
  var body: some View {
    Text(person.displayName.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined())
      .font(.subheadline.weight(.semibold)).foregroundStyle(color)
      .frame(width: 46, height: 46).background(color.opacity(0.12), in: .circle).accessibilityHidden(true)
  }
}
