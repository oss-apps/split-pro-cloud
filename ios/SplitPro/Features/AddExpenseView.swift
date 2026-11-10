import SwiftUI

struct AddExpenseView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let friend: Person?
  @State private var amount = ""
  @State private var description = ""
  @State private var currency = "USD"
  @State private var date = Date()
  @State private var payer = 0
  @State private var selected: Set<Int> = []
  @State private var kind = SplitKind.equal
  @State private var values: [Int: String] = [:]
  @State private var saving = false
  @State private var failure: String?
  @State private var saved = false
  @State private var initialized = false
  @ScaledMetric(relativeTo: .largeTitle) private var amountSize = 48
  @FocusState private var focus: Field?
  private enum Field: Hashable { case amount, description, share(Int) }
  private var people: [Person] { ([model.user].compactMap { $0 } + model.friends).filter { selected.contains($0.id) } }
  private var cents: Int64 { Money.cents(amount) ?? 0 }
  private var result: SplitResult {
    SplitEngine.calculate(cents: cents, people: people.map {
      SplitInput(id: $0.id, share: kind == .equal ? 1 : Decimal(string: values[$0.id] ?? "0") ?? 0)
    }, kind: kind, payer: payer)
  }
  private var canSave: Bool {
    Money.cents(amount) != nil && cents > 0 && !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && people.count >= 2 && selected.contains(payer) && result.valid && !saving
  }
  var body: some View {
    NavigationStack {
      Form {
        Section {
          VStack(alignment: .leading, spacing: 12) {
            Text("AMOUNT").font(.caption.weight(.semibold)).tracking(1.3).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              Text(currency).font(.title3.weight(.medium)).foregroundStyle(.secondary)
              TextField("0.00", text: $amount).font(.system(size: amountSize, weight: .semibold, design: .rounded))
                .keyboardType(.decimalPad).focused($focus, equals: .amount)
                .accessibilityIdentifier("expense.amount")
                .accessibilityLabel("Amount in \(currency)")
            }
            TextField("What was it for?", text: $description)
              .font(.title3).focused($focus, equals: .description).submitLabel(.done)
              .onSubmit { focus = nil }.accessibilityIdentifier("expense.description")
          }.padding(.vertical, 12)
        }
        Section {
          Picker("Currency", selection: $currency) {
            ForEach(["USD", "INR", "EUR", "GBP", "JPY", "AUD", "CAD"], id: \.self) { Text($0).tag($0) }
          }
          Menu {
            Picker("Paid by", selection: $payer) {
              ForEach(people) { Text($0.id == model.user?.id ? "You" : $0.displayName).tag($0.id) }
            }
          } label: {
            HStack {
              Label("Paid by", systemImage: "creditcard")
              Spacer()
              Text(payer == model.user?.id ? "You" : people.first { $0.id == payer }?.displayName ?? "Choose")
                .foregroundStyle(.secondary)
              Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(.tertiary)
            }
          }.foregroundStyle(.primary).accessibilityIdentifier("expense.payer")
          DatePicker("Date", selection: $date, displayedComponents: .date)
        }
        Section {
          NavigationLink {
            Form {
              ForEach([model.user].compactMap { $0 } + model.friends) { person in
                Toggle(isOn: Binding(get: { selected.contains(person.id) }, set: { included in
                  if included { selected.insert(person.id) }
                  else if person.id != payer && person.id != model.user?.id { selected.remove(person.id) }
                })) {
                  HStack { Avatar(person: person); Text(person.id == model.user?.id ? "You" : person.displayName) }
                }.disabled(person.id == payer || person.id == model.user?.id)
                  .accessibilityIdentifier("participant.\(person.id)")
                  .accessibilityLabel(person.id == model.user?.id ? "You" : person.displayName)
              }
            }.navigationTitle("Participants").navigationBarTitleDisplayMode(.inline)
          } label: {
            HStack { Label("With you and", systemImage: "person.2"); Spacer(); Text("\(max(0, people.count - 1)) friends").foregroundStyle(.secondary) }
          }
          NavigationLink {
            splitEditor
          } label: {
            HStack { Label("Split", systemImage: "divide"); Spacer(); Text(kind.title).foregroundStyle(.secondary) }
          }.accessibilityIdentifier("expense.split")
        } footer: {
          if people.count >= 2 && kind == .equal {
            Text("Split equally between \(people.count) people. About \(Money.format(cents / Int64(people.count), currency)) each.")
          } else if people.count < 2 { Text("Choose at least one friend to split this expense.") }
        }
        if let failure { Section { Label(failure, systemImage: "exclamationmark.triangle").foregroundStyle(Brand.owing) } }
      }
      .navigationTitle("Add Expense").navigationBarTitleDisplayMode(.inline)
      .scrollDismissesKeyboard(.interactively)
      .disabled(saving)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button { save() } label: { if saving { ProgressView() } else { Text("Add").bold() } }
            .disabled(!canSave).accessibilityIdentifier("expense.save")
        }
        ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { focus = nil }.accessibilityIdentifier("keyboard.done") }
      }
      .interactiveDismissDisabled(saving)
      .sensoryFeedback(.success, trigger: saved)
      .onAppear {
        guard !initialized else { return }
        initialized = true
        payer = model.user?.id ?? 0
        selected = Set(([model.user, friend].compactMap { $0 }).map(\.id))
      }
    }
  }
  private var splitEditor: some View {
    Form {
      Section {
        Picker("Split type", selection: $kind) {
          ForEach(SplitKind.allCases, id: \.self) { Text($0.title).tag($0) }
        }.accessibilityIdentifier("split.kind")
      } footer: {
        Text(kind == .adjustment ? "Add each person's extra amount. The remainder is shared equally." : "Every cent is accounted for. Remainders are assigned in a stable order.")
      }
      Section("\(people.count) people · \(Money.format(cents, currency))") {
        ForEach(Array(people.enumerated()), id: \.element.id) { index, person in
          HStack(spacing: 12) {
            Avatar(person: person)
            VStack(alignment: .leading, spacing: 4) {
              Text(person.id == model.user?.id ? "You" : person.displayName)
              Text(Money.format(abs(result.amounts[index] - (person.id == payer ? cents : 0)), currency))
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if kind == .equal { Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.accent) }
            else {
              TextField("0", text: Binding(get: { values[person.id] ?? "" }, set: { values[person.id] = $0 }))
                .multilineTextAlignment(.trailing).keyboardType(.decimalPad)
                .focused($focus, equals: .share(person.id)).frame(width: 80)
                .accessibilityIdentifier("split.value.\(index)")
                .accessibilityLabel("\(person.displayName)'s split")
              if kind == .percentage { Text("%").foregroundStyle(.secondary) }
            }
          }.padding(.vertical, 4)
        }
      }
      Section {
        Label(result.valid ? "All accounted for" : "The split doesn't add up yet", systemImage: result.valid ? "checkmark.circle" : "exclamationmark.circle")
          .foregroundStyle(result.valid ? Brand.owed : Brand.owing)
      }
    }.navigationTitle("Split Expense").navigationBarTitleDisplayMode(.inline)
      .onChange(of: kind) { oldKind, newKind in
        let previous = SplitEngine.calculate(cents: cents, people: people.map {
          SplitInput(id: $0.id, share: oldKind == .equal ? 1 : Decimal(string: values[$0.id] ?? "0") ?? 0)
        }, kind: oldKind, payer: payer)
        let shares = SplitEngine.rebuild(cents: cents, people: people.map(\.id), amounts: previous.amounts, kind: newKind, payer: payer)
        values = Dictionary(uniqueKeysWithValues: zip(people, shares).map { ($0.0.id, NSDecimalNumber(decimal: $0.1).stringValue) })
      }
  }
  private func save() {
    guard canSave else { return }
    focus = nil
    saving = true
    failure = nil
    Task {
      defer { saving = false }
      do {
        let draft = ExpenseDraft(name: description.trimmingCharacters(in: .whitespacesAndNewlines),
          amount: Decimal(cents) / 100, currency: currency, paidBy: payer, splitType: kind,
          expenseDate: ISO8601DateFormatter().string(from: date),
          participants: people.enumerated().map { index, person in
            ExpenseDraft.Participant(userId: person.id, amount: Decimal(result.amounts[index]) / 100)
          })
        try await model.api.saveExpense(draft)
        saved = true
        await model.refresh()
        dismiss()
      } catch { failure = error.localizedDescription }
    }
  }
}
