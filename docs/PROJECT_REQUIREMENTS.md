# Family Ledger — Project Requirements

**Status:** Draft for implementation  
**Purpose:** Define the product behavior, user experience, permissions, and acceptance criteria for the Family Ledger application.  
**Related document:** `ARCHITECTURE.md`

---

## 1. Product Summary

Family Ledger is a small private household application for tracking money that children owe their parents.

The application should make it extremely easy to record everyday expenses such as gas, food, phone bills, tickets, shared purchases, or other costs that a parent covered on a child's behalf. It should also make repayment expectations obvious by showing the child's total balance, minimum payment, due date, payment progress, and recent activity.

The system is not intended to behave like a bank, payment processor, or full accounting package. It is a shared family ledger and reminder system.

The primary design goal is **low friction**: adding an expense, checking a balance, or recording a payment should take only a few seconds from a phone.

---

## 2. Product Goals

The application must:

1. Give the household one trusted source of truth for what each child owes.
2. Allow authorized household members to record new expenses from anywhere.
3. Prevent children from reducing their own balance.
4. Allow parents to record repayments and make administrative corrections.
5. Clearly distinguish total balance from the amount currently due under a payment plan.
6. Remind children about upcoming or overdue payments.
7. Work well on both iPhone and Android without requiring native applications or app-store distribution.
8. Be installable to a phone home screen as a Progressive Web App (PWA).
9. Preserve a reliable audit trail so that balance changes can be explained later.
10. Operate within free hosting/service tiers for normal family usage.

---

## 3. Non-Goals

The initial product is not intended to provide:

- Bank account connectivity.
- Credit-card processing.
- Automatic transfers or payment collection.
- Interest calculations.
- Credit reporting.
- Tax/accounting functionality.
- Multi-currency support.
- Public registration.
- Multiple unrelated households in the same UI.
- A native iOS or Android application.
- Complex debt allocation such as assigning a repayment to specific individual expenses.

These can be reconsidered later if a real need develops.

---

## 4. Users and Roles

### 4.1 Parent

A Parent is a trusted household administrator.

Parents may:

- View every household member and ledger.
- Add expenses for any child.
- Record payments for any child.
- Edit or void incorrect entries.
- Create and modify payment plans.
- Send or schedule reminders.
- Manage household members and roles.
- View the audit history.
- Export or back up household data.

There should normally be at least two Parent accounts so either parent can manage the ledger independently.

### 4.2 Child

A Child is a household member with a personal ledger.

Children may:

- View their own current balance.
- View their own payment-plan status and due dates.
- View their own transaction history.
- Add a new expense that increases a child's balance, subject to the household policy described below.
- Add an optional note or description to an expense.
- Receive reminders.
- Manage notification permission on their own devices.
- Mark a transaction as disputed or add a comment if that feature is enabled later.

Children must never be able to:

- Record a payment.
- Enter a negative charge.
- Reduce a balance.
- Edit an existing amount downward.
- Delete or void a ledger transaction.
- Change a payment plan.
- Change roles or permissions.

These restrictions must be enforced by the backend/database security rules, not only by the user interface.

---

## 5. Household Expense Policy

The application should support either of the following household policies without requiring a redesign:

### Recommended default

Any authenticated household member may create a new positive expense for themselves or another child.

This supports situations such as:

- A child used a parent's card for gas and logs the expense immediately.
- One sibling covered a shared cost and records the appropriate child's expense.
- A parent records an expense later after reviewing a credit-card statement.

### Optional stricter mode

A household setting may restrict children to adding expenses only to their own ledger.

Regardless of policy, only Parents may create balance-decreasing entries.

---

## 6. Ledger Model

### 6.1 Transactions

Every balance change is represented as a ledger transaction.

A transaction should include at minimum:

- Transaction ID.
- Child/member whose balance is affected.
- Amount in integer cents.
- Transaction type.
- Description.
- Category.
- Date incurred.
- User who created it.
- Creation timestamp.
- Optional note.
- Optional source/reference information.
- Optional void/reversal state.

### 6.2 Transaction types

The minimum required transaction types are:

#### Expense / Charge

A positive amount that increases what the child owes.

Examples:

- `+$42.17 Gas`
- `+$60.00 Phone bill`
- `+$18.35 Dinner`

Children and Parents may create expenses when allowed by household policy.

#### Payment

A negative amount that represents money the child has repaid.

Example:

- `-$25.00 Payment`

Only Parents may record payments.

### 6.3 Corrections

Existing financial history should not silently disappear.

Preferred behavior:

- Transactions are normally immutable after creation.
- Parents may correct mistakes using an explicit edit/void workflow.
- Every administrative change must be written to an audit log.
- A voided transaction is excluded from active balance calculations but remains visible in history/audit data.

### 6.4 Balance

For each child:

`balance = sum(active ledger transaction amounts)`

A positive balance means the child owes the parents money.

The UI should normally clamp display language around zero rather than presenting confusing negative debt. If overpayment is permitted, the system may show a credit balance explicitly.

---

## 7. Payment Plans

A payment plan defines the minimum repayment expectation for a child. It is distinct from the ledger balance.

Example:

- Total balance: `$187.32`
- Minimum monthly payment: `$40.00`
- Due date: September 15
- Paid toward current period: `$25.00`
- Remaining minimum due: `$15.00`

### 7.1 Required payment-plan capabilities

Parents must be able to configure:

- Child.
- Minimum payment amount.
- Frequency.
- Due-date rule.
- Start date.
- Optional end date.
- Active/inactive state.

Initial frequency support should include:

- Monthly.

The model should not prevent adding weekly, biweekly, or custom schedules later.

### 7.2 Payment periods

The system should represent each expected payment window as a payment period.

A period should determine:

- Amount required.
- Amount paid during the period.
- Amount remaining.
- Due date.
- Status.

Suggested statuses:

- Upcoming
- Due
- Partially Paid
- Satisfied
- Overdue
- Waived

### 7.3 Payment allocation

For the initial version, payments do not need to be allocated to specific expense transactions.

A payment reduces the child's overall balance and counts toward the applicable payment period according to deterministic business rules.

Recommended rule:

- Payments made after the start of the current payment period and on/before its due date count toward that period.
- Parent adjustments may override/waive a period when necessary.

The exact rule must be documented in code and covered by automated tests.

---

## 8. Categories and Presets

Expenses should support simple categories such as:

- Gas
- Food
- Phone
- Auto
- Entertainment
- School
- Household
- Other

Parents should be able to maintain configurable quick-add presets, for example:

- `+$20 Gas`
- `+$50 Phone`
- `+$10 Food`

A quick preset should prefill the form but still allow the amount or description to be changed before submission.

---

## 9. Reminders and Notifications

### 9.1 Web Push

The primary reminder channel should be standards-based Web Push delivered through the installed PWA.

The application should support notifications for:

- Upcoming minimum payment.
- Payment due today.
- Overdue payment.
- Parent-triggered manual reminder.
- Optional notification when a significant new expense is added.

### 9.2 Reminder preferences

Notification behavior should be configurable enough to avoid becoming annoying.

At minimum:

- Notifications are opt-in at the device/browser level.
- A child may have more than one device subscription.
- Parents can see whether a child has at least one active push subscription.
- The system records notification events to prevent duplicate reminders.

Potential default schedule:

- A few days before due date.
- Morning of due date.
- Periodic overdue reminder, with conservative frequency.

Exact timing should be configurable rather than hard-coded into business logic.

### 9.3 Calendar integration

Calendar integration may be provided later as an optional convenience.

It is not the primary reminder mechanism and must not be required for the core product to function.

---

## 10. Authentication and Household Access

The application is private and does not support open registration.

Every person must authenticate using an individual account.

The system should support:

- Parent-created household membership/invitations.
- Persistent sessions on trusted phones.
- Secure sign-out.
- Password reset/recovery using the authentication provider's supported mechanisms.
- Role-based authorization.

A user must never gain access to another household's private information through guessed IDs, modified API requests, or client-side manipulation.

Even if the first implementation contains only one household, the data model should include a household boundary so authorization rules remain explicit and safe.

---

## 11. Core User Experience

### 11.1 UX principles

The application should feel like a tiny purpose-built utility rather than accounting software.

Priorities:

1. Important information should be visible immediately.
2. Common actions should require as few taps as possible.
3. Currency entry must be fast on a phone.
4. The UI should clearly distinguish money owed from money currently due.
5. Destructive or balance-decreasing actions should be visually distinct and require appropriate authorization.
6. The application must work well with one hand on a phone.
7. Desktop support is required but mobile is the primary interaction surface.

### 11.2 Child home screen

The Child home screen should prioritize:

- Current total owed.
- Current minimum payment status.
- Due date.
- Payment progress.
- Primary `Add Expense` action.
- Recent activity.

Example information hierarchy:

```text
You Owe
$187.32

$15 still due Sep 15
$25 of $40 paid

[ + Add Expense ]

Recent Activity
Gas                    +$42.17
Payment                 -$25.00
Phone                   +$60.00
```

A child should not be shown controls that imply they can record a repayment themselves.

### 11.3 Parent home screen

The Parent dashboard should give a household-level overview.

Example:

```text
Family Ledger

Alex
$187.32 owed
$15 due Sep 15

Katie
$63.81 owed
September payment satisfied

Ryan
$0.00
All caught up

[ + Expense ]    [ Record Payment ]
```

Each child card should show:

- Name.
- Current balance.
- Current payment-plan status.
- Due/overdue state.
- Quick access to the child's ledger.

### 11.4 Add Expense flow

The most common transaction flow should be optimized for speed.

Minimum form fields:

- Child.
- Amount.
- Category.
- Description/note.
- Date, defaulting to today.

Expected flow:

1. Tap `Add Expense`.
2. Enter/select amount.
3. Select a category or preset.
4. Confirm child.
5. Save.

On the child's own account, the child selector may default to or be locked to themselves depending on household policy.

### 11.5 Record Payment flow

Parent-only.

Minimum fields:

- Child.
- Payment amount.
- Payment date.
- Optional note/method.

The confirmation screen should show both:

- Resulting balance.
- Effect on the current minimum payment period.

### 11.6 History

Ledger history should display newest entries first and clearly identify:

- Expenses.
- Payments.
- Voided/corrected entries.
- Who created the entry.
- Date.
- Description/category.

Filtering by category/date/type is useful but not required for the earliest MVP.

---

## 12. PWA Requirements

The application must:

- Be installable from supported mobile browsers.
- Include a valid web app manifest.
- Run in standalone display mode when installed.
- Include appropriate application icons.
- Use a service worker.
- Support Web Push where the platform permits it.
- Detect when notification/PWA installation steps require user action and provide clear onboarding instructions.
- Remain usable as a normal responsive website when not installed.

Offline-first transaction editing is not required for the initial release.

A temporary network failure should produce a clear retry/error state rather than silently losing data.

---

## 13. Auditability

Every security-sensitive or balance-affecting action must be attributable to a user.

The audit trail should include at minimum:

- Entity affected.
- Entity ID.
- Action.
- Actor/user.
- Previous values when applicable.
- New values when applicable.
- Timestamp.

Audit history must not be editable by normal users.

---

## 14. Data Export and Backup

Parents must be able to export household data.

Initial export formats:

- CSV for ledger transactions.
- JSON for complete application backup/export.

The JSON export should be sufficient to reconstruct the important business data if the hosted database were lost.

The application should not imply that the free cloud provider is the only copy of irreplaceable data.

---

## 15. Security Requirements

The application must:

- Use HTTPS in production.
- Never expose Supabase service-role credentials to the browser.
- Enforce authorization with database Row Level Security and/or trusted server functions.
- Validate all monetary operations server-side.
- Store money as integer cents, never binary floating point.
- Prevent a Child from inserting any transaction that reduces a balance.
- Prevent a Child from changing an existing transaction into a lower/negative amount.
- Prevent unauthorized role changes.
- Keep push subscription endpoint data private.
- Keep audit records protected from ordinary modification.

Client-side checks are for user experience only and are never the security boundary.

---

## 16. Reliability and Data Integrity

The system should favor correctness over clever automation.

Required safeguards:

- Transaction writes should be atomic.
- Duplicate submissions should be minimized or made idempotent where appropriate.
- Payment-period calculations must be deterministic.
- Dates must use the household's configured time zone when determining `today`, `due`, and `overdue` states.
- Deleted users must not cause historical ledger records to lose attribution.
- Schema migrations must be versioned and source-controlled.

---

## 17. Accessibility

The application should follow normal accessible web application practices, including:

- Keyboard-accessible controls.
- Proper labels for form fields.
- Semantic headings and landmarks.
- Sufficient contrast.
- Do not rely on color alone for due/overdue/paid status.
- Respect reduced-motion preferences.
- Touch targets appropriate for phones.
- Screen-reader-friendly currency and status labels.

---

## 18. Initial Household Settings

Suggested configurable household settings:

- Household name.
- Household time zone.
- Whether children may add expenses for other children.
- Default expense categories.
- Quick-add presets.
- Default reminder schedule.
- Whether optional new-expense notifications are enabled.

---

## 19. MVP Scope

The first useful release should contain:

### Phase 1 — Core ledger

- Authentication.
- Household/member roles.
- Parent dashboard.
- Child dashboard.
- Add expense.
- Record payment.
- Balance calculation.
- Transaction history.
- Database authorization/RLS.
- Audit logging.

### Phase 2 — Payment plans

- Monthly minimum payment plan.
- Payment periods.
- Due/overdue/satisfied calculations.
- Payment progress UI.

### Phase 3 — PWA and reminders

- Installable PWA.
- Service worker.
- Push subscription management.
- Scheduled reminders.
- Manual parent reminder.

### Phase 4 — Administration and polish

- Categories and presets.
- Export/backup.
- Member management.
- Notification preferences.
- Better transaction filtering.
- Onboarding/install guidance.

---

## 20. Acceptance Criteria

The product is ready for normal family use when all of the following are true:

1. A Parent can sign in from a phone outside the home network and see the household dashboard.
2. A Child can sign in from either iPhone or Android and see only information they are authorized to access.
3. A Child can add a positive expense and the balance increases correctly.
4. A Child cannot reduce a balance using the UI, direct API calls, modified requests, or database client credentials exposed to the browser.
5. A Parent can record a payment and both total balance and current payment-period progress update correctly.
6. A Parent can correct/void an incorrect transaction without erasing the audit history.
7. A monthly payment plan correctly identifies upcoming, due, satisfied, partial, and overdue states.
8. The app can be installed to a supported phone home screen and launches in standalone PWA mode.
9. A supported installed PWA can subscribe to push notifications and receive a test reminder.
10. Scheduled reminder processing does not generate duplicate notifications for the same reminder event.
11. All production traffic uses HTTPS.
12. A Parent can export the ledger and a complete JSON backup.
13. The normal household workload remains within the selected providers' free tiers.

---

## 21. Future Ideas

Potential later enhancements include:

- Comments/disputes on transactions.
- Receipt photos.
- Recurring automatic charges.
- Multiple payment-plan frequencies.
- Balance charts and trends.
- Optional calendar feed.
- Parent approval workflow for child-entered expenses.
- Shared expenses split between multiple children.
- Allowance/credit transactions.
- Home Assistant integration.
- Optional custom domain.

None of these should complicate the initial core ledger unnecessarily.
