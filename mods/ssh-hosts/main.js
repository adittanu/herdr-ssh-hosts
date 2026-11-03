// SSH Hosts: a Termius-style host manager that lives in its own tab.
// Left: groups. Middle: search + NEW HOST + a grid of host cards.
// Right: the host form while adding or editing.
// Single click selects a card, double click (or the play button) opens ssh in a new tab.
// Hosts live in <appHome>/data/ssh-hosts.json.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, theme, appHome, home, readTextFile, writeTextFile, notify } from "herdr";
import { fromLiteTerm, mergeHosts, toLiteTerm } from "./liteterm.js";

const ICON = (n) => `mods/ssh-hosts/${n}.svg`;
const FIELDS = [
  ["label", "Label", "prod-api"],
  ["host", "Address", "203.0.113.10"],
  ["user", "Username", "root"],
  ["port", "Port", "22"],
  ["group", "Group", "Production"],
  ["identity", "Identity file (optional)", "~/.ssh/id_ed25519"],
];

// Named hosts from ~/.ssh/config (no wildcard patterns).
function parseConfig(text) {
  const out = [];
  let cur = null;
  for (const raw of (text ?? "").split("\n")) {
    const m = raw.trim().match(/^([^\s#=]+)\s*=?\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "host") {
      const name = value.split(/\s+/).find((h) => h && !/[*?!]/.test(h));
      cur = name ? { label: name, alias: name, host: "", user: "", port: "", identity: "", group: "ssh config" } : null;
      if (cur) out.push(cur);
    } else if (key === "match") cur = null;
    else if (cur && key === "hostname") cur.host = value;
    else if (cur && key === "user") cur.user = value;
    else if (cur && key === "port") cur.port = value;
    else if (cur && key === "identityfile") cur.identity = value;
  }
  return out;
}

function sshArgv(h) {
  if (h.alias) return ["ssh", h.alias];
  const argv = ["ssh"];
  if (h.port && h.port !== "22") argv.push("-p", String(h.port));
  if (h.identity) argv.push("-i", h.identity.replace(/^~/, home()));
  argv.push(h.user ? `${h.user}@${h.host}` : h.host);
  return argv;
}

const target = (h) => (h.alias && !h.host ? h.alias : `${h.user ? h.user + "@" : ""}${h.host}${h.port && h.port !== "22" ? ":" + h.port : ""}`);
const subtitle = (h) => ["ssh", h.user || (h.alias ? h.alias : "")].filter(Boolean).join(", ");

export default class SshHosts extends View {
  init(_props, cx) {
    this.hosts = [];
    this.raw = null; // file text as last read, for writeTextFile's check
    this.loaded = false;
    this.query = "";
    this.group = null; // null = all hosts
    this.selected = null; // index into this.hosts
    this.form = false;
    this.transfer = false; // the Import / Export panel
    this.busy = false;
    this.note = ""; // result line in the transfer panel
    this.noteError = false;
    this.overwrite = null; // path the next Export may replace
    this.editing = null; // index being edited, or null for a new host
    this.values = {};
    this.pathInput = InputState.new({ placeholder: "C:\\Users\\you\\Downloads\\liteterm-hosts.json", value: `${home()}/Downloads/liteterm-hosts.json` });
    this.pathInput.on("change", (_e, cx) => { this.overwrite = null; cx.notify(); });
    this.pathInput.on("focus", (_e, cx) => { this.focusedField = "path"; cx.notify(); });
    this.pathInput.on("blur", (_e, cx) => { if (this.focusedField === "path") this.focusedField = null; cx.notify(); });
    this.pathInput.on("submit", (_e, cx) => this.importFile(this.pathInput.value(), cx));
    this.focusedField = null;
    this.error = "";
    this.handle = cx.focus_handle();

    this.search = InputState.new({ placeholder: "Find a host" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.focusedField = "search"; cx.notify(); });
    this.search.on("blur", (_e, cx) => { if (this.focusedField === "search") this.focusedField = null; cx.notify(); });
    this.search.on("submit", () => {
      const first = this.filtered()[0];
      if (first) this.connect(first.h, "tab");
    });

    this.inputs = {};
    for (const [key, , ph] of FIELDS) {
      const s = InputState.new({ placeholder: ph });
      s.on("change", (_e, cx) => { this.values[key] = s.value(); cx.notify(); });
      s.on("focus", (_e, cx) => { this.focusedField = key; cx.notify(); });
      s.on("blur", (_e, cx) => { if (this.focusedField === key) this.focusedField = null; cx.notify(); });
      s.on("submit", (_e, cx) => this.save(cx));
      this.inputs[key] = s;
    }

    cx.spawn(async (cx) => {
      this.raw = await readTextFile(this.file()).catch(() => null);
      try { this.hosts = this.raw ? JSON.parse(this.raw).hosts ?? [] : []; } catch { this.hosts = []; }
      this.loaded = true;
      cx.notify();
    });
  }

  file() { return `${appHome()}/data/ssh-hosts.json`; }

  async persist() {
    const text = JSON.stringify({ hosts: this.hosts }, null, 2);
    try {
      await writeTextFile(this.file(), text, this.raw);
      this.raw = text;
      this.error = "";
    } catch (e) {
      this.error = `Couldn't save: ${e}`;
    }
  }

  groups() {
    const m = new Map();
    for (const h of this.hosts) m.set(h.group || "Ungrouped", (m.get(h.group || "Ungrouped") ?? 0) + 1);
    return [...m.entries()];
  }

  filtered() {
    const q = this.query.trim().toLowerCase();
    return this.hosts
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => this.group === null || (h.group || "Ungrouped") === this.group)
      .filter(({ h }) => !q || [h.label, h.host, h.user, h.group, h.alias].some((v) => (v ?? "").toLowerCase().includes(q)));
  }

  connect(h, place) {
    if (place === "split") run("pane.split", { direction: "right", argv: sshArgv(h) });
    else run("tab.new", { name: h.label || target(h), argv: sshArgv(h) });
  }

  openTransfer(cx) {
    this.form = false;
    this.transfer = true;
    this.note = "";
    this.overwrite = null;
    cx.notify();
  }

  // Paths people type: "~" is home, and quotes pasted from Explorer are dropped.
  cleanPath(p) {
    return (p ?? "").trim().replace(/^"(.*)"$/, "$1").replace(/^~(?=[\\/]|$)/, home());
  }

  say(text, isError = false) { this.note = text; this.noteError = isError; }

  importFile(path, cx) {
    path = this.cleanPath(path);
    if (!path || this.busy) return;
    this.busy = true;
    this.overwrite = null;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(path);
        if (text === null) throw new Error("No file at that path.");
        const { added, skipped } = mergeHosts(this.hosts, fromLiteTerm(text));
        this.hosts.push(...added);
        if (added.length) await this.persist();
        this.say(`Imported ${added.length} host${added.length === 1 ? "" : "s"}${skipped ? `, ${skipped} already here` : ""}.${this.error ? " " + this.error : ""}`, Boolean(this.error));
      } catch (e) {
        this.say(String(e.message ?? e), true);
      }
      this.busy = false;
      cx.notify();
    });
    cx.notify();
  }

  exportFile(path, cx) {
    path = this.cleanPath(path);
    if (!path || this.busy) return;
    if (!this.hosts.length) { this.say("There are no hosts to export.", true); cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const existing = await readTextFile(path).catch(() => null);
        if (existing !== null && this.overwrite !== path) {
          this.overwrite = path;
          this.say("That file exists. Press Export again to replace it.", true);
        } else {
          await writeTextFile(path, toLiteTerm(this.hosts), existing);
          this.overwrite = null;
          this.say(`Exported ${this.hosts.length} hosts to ${path}`);
        }
      } catch (e) {
        this.say(`Couldn't write the file: ${e.message ?? e}`, true);
      }
      this.busy = false;
      cx.notify();
    });
    cx.notify();
  }

  edit(index, cx) {
    this.transfer = false;
    this.form = true;
    this.editing = index;
    this.error = "";
    const h = index === null ? { group: this.group ?? "" } : this.hosts[index];
    for (const [key] of FIELDS) {
      this.values[key] = h[key] ?? "";
      this.inputs[key].set_value(h[key] ?? "");
    }
    cx.notify();
    cx.timer.after(80, () => this.inputs.label.focus());
  }

  save(cx) {
    const v = this.values;
    const alias = this.editing !== null ? this.hosts[this.editing].alias : undefined;
    if (!v.host?.trim() && !alias) { this.error = "Address is required."; cx.notify(); return; }
    if (v.port && !/^\d{1,5}$/.test(v.port.trim())) { this.error = "Port must be a number."; cx.notify(); return; }
    // Keep what the form doesn't show (an imported password, authMethod, os).
    const entry = this.editing !== null ? { ...this.hosts[this.editing] } : {};
    for (const [key] of FIELDS) entry[key] = (v[key] ?? "").trim();
    if (alias) entry.alias = alias;
    if (!entry.label) entry.label = entry.host || alias;
    if (this.editing === null) { this.hosts.push(entry); this.selected = this.hosts.length - 1; }
    else this.hosts[this.editing] = entry;
    this.form = false;
    cx.spawn(async (cx) => { await this.persist(); cx.notify(); });
    cx.notify();
  }

  remove(index, cx) {
    this.hosts.splice(index, 1);
    this.selected = null;
    if (this.group !== null && !this.groups().some(([g]) => g === this.group)) this.group = null;
    cx.spawn(async (cx) => { await this.persist(); cx.notify(); });
    cx.notify();
  }

  importConfig(cx) {
    cx.spawn(async (cx) => {
      const found = parseConfig(await readTextFile(`${home()}/.ssh/config`).catch(() => null));
      const have = new Set(this.hosts.map((h) => h.alias).filter(Boolean));
      const fresh = found.filter((f) => !have.has(f.alias));
      this.hosts.push(...fresh);
      await this.persist();
      notify({ title: "SSH hosts", body: fresh.length ? `Imported ${fresh.length} from ~/.ssh/config` : "Nothing new in ~/.ssh/config", level: "info" });
      cx.notify();
    });
  }

  key(e, cx) {
    if (e.key === "escape" && (this.form || this.transfer)) { this.form = false; this.transfer = false; this.error = ""; cx.stop_propagation(); cx.notify(); }
  }

  button(t, id, text, primary, action, icon) {
    return h_flex().id(id).h(32).px(14).gap(6).items_center().flex_none().rounded(8)
      .border_1().border_color(primary ? t.accent : t.input).bg(primary ? t.accent : t.raised)
      .text_color(primary ? t.accent_foreground : t.foreground).text_size(12.5).font_semibold().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action)
      .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(13)))
      .child(text);
  }

  iconButton(t, id, icon, action, danger) {
    return div().id(id).w(26).h(26).rounded(6).flex().items_center().justify_center().flex_none().cursor_pointer()
      .text_color(danger ? t.blocked : t.muted).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(ICON(icon)).size(14));
  }

  navItem(t, id, label, count, active, action) {
    return h_flex().id(id).h(30).px(10).gap(8).items_center().flex_none().rounded(7).cursor_pointer()
      .bg(active ? t.selected : t.chrome).text_color(active ? t.foreground : t.muted).text_size(12.5)
      .hover((s) => s.bg(t.hover)).on_click(action)
      .child(div().flex_1().min_w(0).truncate().child(label))
      .child(div().text_size(11).text_color(t.dim).child(String(count)));
  }

  sidebar(t) {
    return v_flex().w(210).flex_none().h_full().p(12).gap(2).bg(t.chrome).border_r(1).border_color(t.border)
      .child(h_flex().items_center().gap(8).px(4).pb(12)
        .child(div().w(26).h(26).rounded(7).flex().items_center().justify_center().bg(t.accent).text_color(t.accent_foreground).child(svg(ICON("server")).size(14)))
        .child(div().text_size(14).font_semibold().child("SSH Hosts")))
      .child(div().px(10).pt(4).pb(6).text_size(11).font_medium().text_color(t.dim).child("VAULT"))
      .child(this.navItem(t, "nav-all", "All hosts", this.hosts.length, this.group === null, (_e, cx) => { this.group = null; cx.notify(); }))
      .child(div().px(10).pt(14).pb(6).text_size(11).font_medium().text_color(t.dim).child("GROUPS"))
      .children(this.groups().map(([g, n]) => this.navItem(t, `nav-${g}`, g, n, this.group === g, (_e, cx) => { this.group = g; cx.notify(); })))
      .child(div().flex_1())
      .child(v_flex().gap(8)
        .child(this.button(t, "ssh-transfer", "Import / Export", false, (_e, cx) => this.openTransfer(cx), "swap"))
        .child(this.button(t, "ssh-import", "Import ~/.ssh/config", false, (_e, cx) => this.importConfig(cx))));
  }

  card(t, { h, i }) {
    const sel = this.selected === i;
    return h_flex().id(`card-${i}`).w(268).h(66).px(12).gap(12).items_center().flex_none().rounded(10).cursor_pointer()
      .border_1().border_color(sel ? t.accent : t.border).bg(sel ? t.raised : t.surface)
      .hover((s) => s.bg(t.raised))
      .on_mouse_down("left", (e, cx) => {
        if (e.click_count === 2) this.connect(h, "tab");
        else { this.selected = i; cx.notify(); }
      })
      .child(div().w(40).h(40).rounded(9).flex().items_center().justify_center().flex_none().bg(t.accent + "26").text_color(t.accent).child(svg(ICON("server")).size(20)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().text_size(13.5).font_semibold().text_color(t.foreground).truncate().child(h.label))
        .child(div().text_size(11.5).text_color(t.dim).truncate().child(sel ? target(h) : subtitle(h))))
      .when(sel, (el) => el
        .child(this.iconButton(t, `go-${i}`, "terminal", () => this.connect(h, "tab")))
        .child(this.iconButton(t, `split-${i}`, "split", () => this.connect(h, "split")))
        .child(this.iconButton(t, `edit-${i}`, "pencil", (cx) => this.edit(i, cx)))
        .child(this.iconButton(t, `del-${i}`, "trash", (cx) => this.remove(i, cx), true)));
  }

  main(t) {
    const rows = this.filtered();
    const grid = rows.length
      ? h_flex().flex_wrap().gap(12).content_start().children(rows.map((r) => this.card(t, r)))
      : v_flex().pt(80).items_center().gap(8)
          .child(div().w(56).h(56).rounded(14).flex().items_center().justify_center().bg(t.raised).text_color(t.dim).child(svg(ICON("server")).size(26)))
          .child(div().text_size(14).font_medium().child(this.hosts.length ? "No host matches" : "Add your first host"))
          .child(div().text_size(12).text_color(t.dim).child(this.hosts.length ? "Try another search or group." : "Press NEW HOST, or import your ~/.ssh/config."));
    return v_flex().flex_1().min_w(0).h_full()
      .child(h_flex().h(60).px(20).gap(12).items_center().flex_none().border_b(1).border_color(t.border)
        .child(div().flex_1().max_w(520).child(
          Input.new(this.search).h(34).px(12).rounded(8).border_1()
            .border_color(this.focusedField === "search" ? t.accent : t.input).bg(t.background).text_size(13).text_color(t.foreground)))
        .child(div().flex_1())
        .child(this.button(t, "ssh-new", "NEW HOST", true, (_e, cx) => this.edit(null, cx), "plus")))
      .child(v_flex().id("hosts-scroll").flex_1().min_h(0).px(20).py(16).gap(12).overflow_y_scroll()
        .child(h_flex().items_baseline().gap(8)
          .child(div().text_size(18).font_semibold().child(this.group ?? "Hosts"))
          .child(div().text_size(12).text_color(t.dim).child(`${rows.length} host${rows.length === 1 ? "" : "s"}`)))
        .child(!this.loaded ? div().text_size(12.5).text_color(t.dim).child("Loading...") : grid)
        .when(Boolean(this.error) && !this.form, (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error))));
  }

  formPanel(t) {
    return v_flex().w(320).flex_none().h_full().p(18).bg(t.chrome).border_l(1).border_color(t.border)
      .child(h_flex().items_center().pb(6)
        .child(div().flex_1().text_size(15).font_semibold().child(this.editing === null ? "New host" : "Edit host"))
        .child(this.iconButton(t, "form-close", "x", (cx) => { this.form = false; this.error = ""; cx.notify(); })))
      .child(v_flex().id("form-scroll").flex_1().min_h(0).overflow_y_scroll()
        .children(FIELDS.map(([key, label]) => v_flex()
          .child(div().pt(10).pb(5).text_size(11.5).text_color(t.dim).child(label))
          .child(Input.new(this.inputs[key]).h(34).px(10).rounded(8).border_1()
            .border_color(this.focusedField === key ? t.accent : t.input).bg(t.background).text_size(13).text_color(t.foreground)))))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(this.button(t, "ssh-cancel", "Cancel", false, (_e, cx) => { this.form = false; this.error = ""; cx.notify(); }))
        .child(this.button(t, "ssh-save", "Save", true, (_e, cx) => this.save(cx))));
  }

  transferPanel(t) {
    const close = (cx) => { this.transfer = false; cx.notify(); };
    return v_flex().w(340).flex_none().h_full().p(18).bg(t.chrome).border_l(1).border_color(t.border)
      .child(h_flex().items_center().pb(6)
        .child(div().flex_1().text_size(15).font_semibold().child("Import / Export"))
        .child(this.iconButton(t, "transfer-close", "x", close)))
      .child(div().pt(4).text_size(12).line_height("17px").text_color(t.muted).child("A LiteTerm hosts file (.json). You can also drop one onto this tab to import it."))
      .child(div().pt(14).pb(5).text_size(11.5).text_color(t.dim).child("File path"))
      .child(Input.new(this.pathInput).h(34).px(10).rounded(8).border_1()
        .border_color(this.focusedField === "path" ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
      .child(h_flex().pt(14).gap(8)
        .child(this.button(t, "ssh-do-import", "Import", true, (_e, cx) => this.importFile(this.pathInput.value(), cx), "plus"))
        .child(this.button(t, "ssh-do-export", "Export", false, (_e, cx) => this.exportFile(this.pathInput.value(), cx))))
      .when(Boolean(this.note), (el) => el.child(div().pt(14).text_size(12).line_height("17px").text_color(this.noteError ? t.blocked : t.working).child(this.note)))
      .child(div().flex_1())
      .child(div().text_size(11.5).line_height("16px").text_color(t.dim).child("Import skips hosts already saved (same name, address, user and port). Passwords in a LiteTerm file are kept and exported back as plain text; they are not used to connect."));
  }

  render() {
    const t = theme();
    return h_flex().id("ssh-hosts").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_drop((e, cx) => {
        const p = (e.paths ?? []).find((x) => /\.json$/i.test(x));
        if (!p) return;
        this.transfer = true; this.form = false;
        this.pathInput.set_value(p);
        this.importFile(p, cx);
      })
      .size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(this.sidebar(t))
      .child(this.main(t))
      .when(this.form, (el) => el.child(this.formPanel(t)))
      .when(this.transfer, (el) => el.child(this.transferPanel(t)));
  }
}
