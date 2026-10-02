# Family Ledger redesign: summary for the owner

To see it, open `mockups/index.html` in a web browser. It shows every new screen on a phone (light and dark) and on a computer, using made-up families. Nothing in the real app has been changed yet.

## What the new app would feel like

You open it and the first thing you see is the answer to "what do I need to do?". For a parent, that is a short list at the top: "Alex is $15.00 behind" with two buttons right there (record a payment, send a reminder), then "Sam owes $30.00 on Sunday". Under that is one big number for the whole family, then a card for each child showing what they owe, whether they are on track, and a bar showing how much of this month's payment they have made. If nobody needs anything, that list simply isn't there and it says everyone is up to date.

For a child, it is simpler: "You owe $187.32", a clear note if a payment is late or coming up, one big "Add an expense" button, and the last few things that happened. Children never see anything that suggests they can lower their own balance.

The "install this app" banner and the "enable notifications" button are gone from the top of every screen. They now live in one quiet place, Settings, under "This device". On the home screen there is, at most, one small line at the very bottom ("Get a nudge when a payment is due. Turn on / dismiss"). If you dismiss it, it stays away for a month.

It looks like a modern app: bigger, clearer money amounts, soft cards, simple icons, a bottom menu on a phone (Home, Activity, a big + button, Family, Settings) and a side menu on a computer, and a dark mode that follows your phone.

## What changes for each person

- **Parents:** Home becomes a to-do list plus the family overview. Adding an expense or recording a payment is one tap from anywhere (the + button) or one tap on a child's own card. Recording a payment offers shortcuts: "catch up $15.00", "pay the minimum", "pay in full", and shows what the balance will be before you save. History gets a simple filter bar (child, expenses or payments) and you can open any entry to void it. Members, payment plans, categories, quick-add presets, and exports are no longer a pile of buttons on the home screen; they are in Family and Settings.
- **Children:** a calmer home with their balance, what is due, and one big button to add an expense. Their full history is one tap away (today it is hard to find).
- **Everyone:** the confusing "Parent / Child / Sign in" links at the top are gone; you only see what is yours. "Change my password" moves into Settings.

## What I found in the current app

The top of every screen is crowded with the install banner, the notification button, and (for everyone, including children) a leftover developer button for testing notifications, all before the real content. The home screens show small text and every number looks the same size, so nothing stands out. Payment plans are hidden inside the history page. There is no dark mode and no icons.

I could not take screenshots of the live app because it needs the local database (which needs Docker running) and a sign-in, so I worked from the code instead.

## How it would be built

In small steps, so the app always works. The first step is the quickest and fixes your main complaint on its own: moving the install and notification prompts into Settings and cleaning up the top menu. After that: the new look, the new menus, the new home screens, the add expense and payment screens, then history, then the family screens, then settings. None of this changes how money, permissions, or security work, and it costs nothing extra.

## What I need from you

You can answer these at any time; the first step does not depend on any of them.

1. **Wording for a late payment on a child's screen.** Gentle ("$15.00 was due Sep 15") or firm ("Overdue, please pay a parent")? Firm is clearer, gentle is kinder.
2. **A "Remind" button for parents** that sends a notification to a child's phone on the spot. It is handy, but it needs new behind-the-scenes work and could be used to nag. Want it, or are the automatic reminders enough?
3. **A little encouragement for kids** (for example "Paid on time two months in a row")? It might motivate them, but it adds a bit more to build and maintain. Or keep it plain?
4. **The family total on the parent home** ("$363.53 owed to the family"). Useful at a glance, but some people prefer each child's number kept separate. Show it or leave it out?
5. **The developer "test notification" button.** I suggest tucking it away in Settings, for parents only, rather than deleting it, in case notifications ever stop working. OK, or remove it entirely?
6. **Dark mode.** The mockups follow the phone's setting automatically, with a switch in Settings. Fine, or light only?
7. **Who can a child add an expense for?** Today a child can pick a sibling. The mockup locks it to themselves, which is simpler for them but a change from today. Which do you prefer?
