---
name: designsystem-haptics
description: Use when an app built with the design system should vibrate - deciding whether a control gets a haptic and which kind (selection, impact, success, warning, error, the brand's signature), wiring Haptics and data-haptic, adding the reader's off switch (HapticsSetting), or reviewing a page that buzzes. Haptics confirm a gesture; they never carry meaning alone.
---

# Haptics with the design system

The full guide, with the research and the support matrix, is «Foundations / Haptics». The module is `lib/haptics` (`haptic(kind)`), on
`navigator.vibrate`: Chrome and Samsung Internet on Android (and PWAs installed from them) feel it; Safari, iOS and Firefox feel nothing,
and nothing is lost.

## Principles

1. **Confirm a gesture, never start one.** In the handler of a click, change or key, once the outcome is known. Never on hover, scroll,
   focus, page load, a timer or a live update.
2. **Never alone.** Every buzz has its words, symbol or position on screen: the error under the field, a `Banner`, a moved row announced.
3. **Few and semantic.** Use the kinds for their meanings; an app never writes milliseconds or calls `navigator.vibrate` itself.
4. **Rare.** Not every button buzzes. If the reader feels it often, take it away.
5. **The reader decides.** `HapticsSetting` on the settings page; their «off» is never overridden.

## The kinds

| Kind | For |
| --- | --- |
| `selection` | A value changed: a switch, a choice, a step forward, a row moved |
| `impact-light`, `impact-medium` | Something snapped into place, or landed (a pull to refresh released) |
| `success` | It worked, and the screen says so (saved, sent) |
| `warning` | Confirming something destructive, or done with a caveat |
| `error` | It did not work, with the error shown |
| `signature` | The app's own (Medier's «play», Start's sunrise, by `data-brand`): only at the end of onboarding, which `FirstRun` already does |

## Setting it up in an app

- Once, in the layout: `<Haptics />` (React/Next.js), or in Astro `listenForHaptics()` from `lib/haptics` in a `<script>`. It plays the
  controls marked `data-haptic="<kind>"`, also in server-drawn markup. `CheckboxList`, `ToggleMatrix` and `ChoiceCards` are marked
  `selection` already; `FirstRun`, `ReorderList` and `SegmentedToggle` buzz without it.
- `HapticsSetting` («Vibrasjon») in the «Effekter» `SettingsSection` of the settings page. It is kept in the browser (`localStorage` `ds-haptics`), not in
  the `prefs` cookie: it is the phone that vibrates.
- Mark sparingly: `data-haptic="warning"` on the button that confirms a deletion; `haptic("success")` in a script after a save that is
  confirmed on screen.
- `data-haptics="off"` on `<html>` or an element turns them off there (a preview, a kiosk). Under `prefers-reduced-motion`, without a choice
  of the reader's, only `success`, `warning` and `error` are felt.

## Don't

- Buzz on navigation, on every button, or on what the reader did not do.
- Let a rhythm be the only way to tell success from error.
- Use the signature for routine actions.
- Fake iOS haptics by clicking a hidden switch or overlaying one: WebKit has closed it, and it pollutes focus and the accessibility tree.
  Where a control is on or off, a native `<input type="checkbox" switch>` gives an iPhone its own tap honestly (as `HapticsSetting` does).

Words in a setting follow **designsystem-content**; the signature is part of the brand (**designsystem-brand**); a page that buzzes is
reviewed with **designsystem-review**.
