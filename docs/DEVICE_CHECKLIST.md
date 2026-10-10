# Testing TripNest on a real phone

Everything so far was tested in desktop browsers (Microsoft Edge and Chromium) that imitate a phone. A few things only a real phone can show. This takes about 20 minutes. Do it on **your** phone and, if you can, on a second phone (your mom's), because the "two phones" steps need two.

Open https://michellefeliciano.github.io/tripnest/ and work through these. For each step, note **works**, **looks wrong** (take a screenshot) or **broken** (what you did, what you saw).

## 1. Install and open
- [ ] **iPhone (Safari):** a blue tip about Add to Home Screen appears on the Trips page. Tap Share, then Add to Home Screen. Open it from the icon: it should open full screen, with no Safari bars.
- [ ] **Android (Chrome):** an "Install TripNest" card appears on the Trips page. Tap **Install**. It should appear in your app list.
- [ ] Open it, then turn on airplane mode and open it again: it should still open, and your trips should be there.

## 2. Layout on a real screen
- [ ] **Bottom tab bar** (inside a trip): all five labels are fully visible, and on an iPhone with a home indicator (the thin bar at the very bottom) the buttons are not squashed or hidden behind it.
- [ ] **Top bar:** **Back** (left) and **Profile** (right) are easy to tap and do what you expect from every screen (Trips, New trip, Profile, inside a trip).
- [ ] Turn the phone **sideways**: nothing is hidden behind the notch or rounded corners.
- [ ] Change the phone's **text size** to large (Settings, Display): TripNest's text gets bigger and nothing is cut off.
- [ ] Switch the phone to **dark mode**: everything is readable.

## 3. The things a desktop could not check
- [ ] **Share trip…** (Export page) opens the phone's share sheet. Send it to yourself (Messages, email or AirDrop).
- [ ] **Open in Maps** on an itinerary item with an address opens **Apple Maps** (iPhone) or **Google Maps** (Android). **Directions** starts directions.
- [ ] **Weather** (Overview): tap Show the weather, then Find the place on the map. Real days appear. (This is the first time it talks to the live weather service.)
- [ ] **Calendar:** Export, choose a reminder time, Download calendar (.ics), open it, and add it to your calendar. A flight should have an alert; an all-day item and a hotel should not.

## 4. Backups
- [ ] Profile, tick **Protect with a password**, make a backup, and open the file in your email or Files app: it should look like scrambled text with no trip names.
- [ ] **Restore** that file (try a wrong password first, then the right one).
- [ ] The **backup reminder** is easy to understand (it only shows up after a week with no backup, so you may not see it).

## 5. Two phones, one trip (needs both phones)
1. On phone A make a trip with a couple of itinerary items and one expense. **Export, Share trip…** to phone B (AirDrop, Messages or email).
2. On phone B open the file with **Trips, Import a trip file**. It should simply be added. Open **Travelers** and make sure the right person is marked as you.
3. On phone B add an itinerary item and an expense, and delete one of A's items. Share the trip back to A.
4. On phone A, import it. TripNest should show a **"You already have this trip"** preview (for example "2 new, 1 removed"). Choose **Update my copy**.
5. Check on A: B's new item and expense are there, and the deleted item is gone (look in **Profile, Recently deleted** to bring it back).
6. Now edit the same item's title on **both** phones, share both ways, and import. Both phones should end up with the **newer** title.

## 6. Key info and countdown
- [ ] The trip header says how long until the trip ("Starts in 12 days").
- [ ] Overview, **Key info**, Add: type a flight number and hotel address. Close the app and reopen it with airplane mode on: it is still there.

## Reporting
Send me the list with a note on anything that was not **works**. A screenshot of anything that looks wrong is the most useful thing.
