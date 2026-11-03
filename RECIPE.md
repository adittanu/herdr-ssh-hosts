# SSH Hosts

A Termius-style SSH manager for Herdr. A new dialog, opened with `ctrl-shift-h`, lists your saved servers grouped by name. Clicking a host opens `ssh` to it in a new tab. You can add, edit, delete and search hosts, and import the ones from `~/.ssh/config`.

![SSH Hosts](preview.png)

## What you see

A centered dialog, 520 x 480 px, on the popover background (`t.popover`), 18px padding.

- **Header:** "SSH hosts" (15px, semibold) on the left, "Esc" (11px, `dim`) on the right.
- **Search box:** 34px tall, 8px radius, `input` border that turns `accent` while focused, placeholder "Search hosts".
- **Host list** (scrolls, about 300px high): group headings in 11px `dim` caps with a count ("PRODUCTION · 2"), then one 46px row per host:
  - a 30px rounded tile (`raised`) with a server icon in `accent`;
  - the label (13px, medium) over `user@host[:port]` (11.5px, `dim`); an imported ssh-config host shows its alias instead;
  - on the right three 26px icon buttons: plus (split right), pencil (edit), trash (delete, `blocked` color).
  Hosts with no group go under "Ungrouped". Empty state: "No saved hosts yet." with a hint line.
- **Footer:** a solid "+ New host" button, an outlined "Import ~/.ssh/config" button, and the hint "Enter connects the first match" (11px, `dim`) on the right.
- **Form view** (replaces the list): fields Label, Host or IP, User, Port, Group, Identity file (optional), each a 34px input, then Cancel and Save buttons.

## How it behaves

- Typing in search filters by label, host, user, group or alias. Enter connects the first match in a new tab.
- Clicking a row opens a new tab named after the host, running the ssh command. The dialog closes.
- Plus on a row runs `pane.split` to the right with the ssh command instead.
- Pencil opens the form filled in; trash removes the host at once and saves.
- Save needs a host (imported alias hosts are exempt) and a numeric port, otherwise a `blocked`-colored message shows under the fields. Enter in any field saves.
- Import reads `~/.ssh/config`, adds every named (non-wildcard) `Host` not already saved, in group "ssh config", and posts a toast with the count. Imported entries connect with `ssh <alias>`, so ssh applies its own config.
- Esc leaves the form for the list, and closes the dialog from the list.
- The mod has no agent-status display; agent statuses (working, blocked, done, idle) do not change it.

## Built from

Files: `mods/ssh-hosts/main.js`, `mod.json`, and five icons `server.svg`, `plus.svg`, `pencil.svg`, `trash.svg`, `x.svg` (24px viewBox, `stroke="currentColor"`, stroke-width 2, round caps, Lucide-style; used through `svg("mods/ssh-hosts/<name>.svg")`). `x.svg` is unused and can be omitted.

- `mod.json`: `{ "place": "none", "overlay": { "width": 520, "height": 480 } }`. It only appears when opened.
- `keys.json` snippet, merged into `global`: `"ctrl-shift-h": "mod.open:ssh-hosts"`. Ask before replacing an existing `ctrl-shift-h`.
- `main.js` default-exports a `View`; uses `gpui-kit` (`div`, `svg`), `gpui-base` (`v_flex`, `h_flex`, `InputState`, `Input`) and `herdr` (`run`, `props`, `closeOverlay`, `theme`, `appHome`, `home`, `readTextFile`, `writeTextFile`, `notify`).
- One `InputState` for search and one per form field. Each has `change`, `focus`, `blur` and `submit` handlers; the focused one gets the `accent` border.
- Storage: `<appHome>/data/ssh-hosts.json` as `{ "hosts": [ { label, host, user, port, group, identity, alias? } ] }`. Read with `readTextFile` in `init`; written with `writeTextFile(path, text, previousText)`, remembering the last text read or written so the stale-snapshot check passes. A failed write shows "Couldn't save: ..." in the list.
- ssh argv: alias host -> `["ssh", alias]`. Otherwise `["ssh", "-p", port (if not 22), "-i", identity (`~` replaced by `home()`, if set), "user@host"]` (no `user@` if user is empty).
- Commands: `tab.new { name, argv }`, `pane.split { direction: "right", argv }`.
- Programs it runs: `ssh`, through those commands (not `exec`). It reads `~/.ssh/config` and writes only the data file. No network access of its own.

## Watch out

- Open the dialog with `herdr-app do "mod.open:ssh-hosts"`. `mod.open --name ...` is wrong: the argument is the value after the colon.
- `mod.json` must carry the `overlay` size, or the dialog is narrow and the footer hint is cut off.
- Do not export anything besides the default class from `main.js`.
- Wait for the focus timer: `cx.timer.after(600, ...)` re-focuses search, because the first focus call is lost while the dialog opens.
- Passwords are never stored. Use ssh keys or type the password in the terminal that opens.
- The Identity file path is passed to `-i` as given; `~` expands only at the start.
- Hosts can't be reordered or moved between groups except by editing the Group field.
- Connections are plain local ssh terminals, not Herdr machines (`hc machine add`).
- Assumes `ssh` is on PATH (OpenSSH ships with current Windows).
- Delete has no confirmation or undo.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/ssh-hosts` passes and `herdr-app status` shows no errors.
- `ctrl-shift-h` opens the dialog; Esc closes it.
- Saving a host in the form adds it under its group, and `data/ssh-hosts.json` contains it.
- Clicking the host opens a new tab named after it that runs `ssh user@host`; the plus button opens it as a right split.
- Search narrows the list and Enter connects the first match.
- Pencil edits and trash deletes, and both persist after closing and reopening.
- Import adds the named hosts of `~/.ssh/config` once; running it again says nothing new.
