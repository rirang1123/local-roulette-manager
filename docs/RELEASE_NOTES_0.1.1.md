# Release Notes 0.1.1

## Download

- `Roulette-Manager-portable-folder-0.1.1.zip`
- `Roulette Manager 0.1.1.exe`
- `Roulette Manager Setup 0.1.1.exe`

## Fixed

- Fixed Weflab roulette result parsing so a single result no longer saves the whole roulette item list as the result.
- Fixed nickname extraction for normal Weflab alert text.
- Fixed 10-pull roulette alerts so all 10 result items are collected as separate events.
- Preserved duplicate items inside the same 10-pull result list instead of collapsing them.
- Kept Weflab URL and roulette share URL input drafts when navigating between pages.

## Verification

- `npm.cmd run test:parser`
- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd run dist`
