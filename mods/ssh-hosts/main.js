// SSH hosts: a Termius-style list of saved ssh connections. Opened as a dialog
// (`mod.open ssh-hosts`). Click a host to ssh into it in a new tab.
// Hosts live in <appHome>/data/ssh-hosts.json.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, appHome, home, readTextFile, writeTextFile, notify } from "herdr";

const ICON = (n) => `mods/ssh-hosts/${n}.svg`;
const FIELDS = [
  ["label", "Label", "prod-api"],
  ["host", "Host or IP", "203.0.113.10"],
  ["user", "User", "root"],
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

export default class SshHosts extends View {
  init(_props, cx) {
    this.hosts = [];
    this.raw = null; // file text as last read, for writeTextFile's check
    this.loaded = false;
    this.query = "";
    this.mode = "list"; // "list" | "form"
    this.editing = null; // index being edited, or null for new
    this.values = {};
    this.focusedField = null;
    this.error = "";
    this.handle = cx.focus_handle();

    this.search = InputState.new({ placeholder: "Search hosts" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.focusedField = "search"; cx.notify(); });
    this.search.on("blur", (_e, cx) => { if (this.focusedField === "search") this.focusedField = null; cx.notify(); });
    this.search.on("submit", (_e, cx) => {
      const first = this.filtered()[0];
      if (first) this.connect(first.h, "tab");
    });
    this.search.focus();
    cx.timer.after(600, () => { if (this.mode === "list") this.search.focus(); });

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

  filtered() {
    const q = this.query.trim().toLowerCase();
    return this.hosts
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => !q || [h.label, h.host, h.user, h.group, h.alias].some((v) => (v ?? "").toLowerCase().includes(q)));
  }

  connect(h, place) {
    closeOverlay(props().overlay);
    if (place === "split") run("pane.split", { direction: "right", argv: sshArgv(h) });
    else run("tab.new", { name: h.label || target(h), argv: sshArgv(h) });
  }

  edit(index) {
    this.mode = "form";
    this.editing = index;
    this.error = "";
    const h = index === null ? {} : this.hosts[index];
    for (const [key] of FIELDS) {
      this.values[key] = h[key] ?? "";
      this.inputs[key].set_value(h[key] ?? "");
    }
    this.inputs.label.focus();
  }

  save(cx) {
    const v = this.values;
    const alias = this.editing !== null ? this.hosts[this.editing].alias : undefined;
    if (!v.host?.trim() && !alias) { this.error = "Host or IP is required."; cx.notify(); return; }
    if (v.port && !/^\d{1,5}$/.test(v.port.trim())) { this.error = "Port must be a number."; cx.notify(); return; }
    const entry = {};
    for (const [key] of FIELDS) entry[key] = (v[key] ?? "").trim();
    if (alias) entry.alias = alias;
    if (!entry.label) entry.label = entry.host || alias;
    if (this.editing === null) this.hosts.push(entry);
    else this.hosts[this.editing] = entry;
    this.mode = "list";
    cx.spawn(async (cx) => { await this.persist(); cx.notify(); });
    this.search.focus();
    cx.notify();
  }

  remove(index, cx) {
    this.hosts.splice(index, 1);
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
    if (e.key === "escape") {
      if (this.mode === "form") { this.mode = "list"; this.search.focus(); }
      else closeOverlay(props().overlay);
      cx.stop_propagation();
      cx.notify();
    }
  }

  button(t, id, text, primary, action, icon) {
    return h_flex().id(id).h(32).px(14).gap(6).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action)
      .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(13)))
      .child(text);
  }

  iconButton(t, id, icon, action, danger) {
    return div().id(id).w(26).h(26).rounded(6).flex().items_center().justify_center().cursor_pointer()
      .text_color(danger ? t.blocked : t.muted).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(ICON(icon)).size(14));
  }

  row(t, { h, i }) {
    return h_flex().id(`h-${i}`).h(46).px(10).gap(10).items_center().flex_none().rounded(8).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.connect(h, "tab"))
      .child(div().w(30).h(30).rounded(7).flex().items_center().justify_center().bg(t.raised).text_color(t.accent).child(svg(ICON("server")).size(15)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_size(13).font_medium().text_color(t.foreground).truncate().child(h.label))
        .child(div().text_size(11.5).text_color(t.dim).truncate().child(target(h))))
      .child(this.iconButton(t, `split-${i}`, "plus", () => this.connect(h, "split")))
      .child(this.iconButton(t, `edit-${i}`, "pencil", () => { this.edit(i); }))
      .child(this.iconButton(t, `del-${i}`, "trash", (cx) => this.remove(i, cx), true));
  }

  list(t) {
    const rows = this.filtered();
    const groups = new Map();
    for (const r of rows) {
      const g = r.h.group || "Ungrouped";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    const body = [];
    for (const [name, items] of groups) {
      body.push(div().px(10).pt(10).pb(4).flex_none().text_size(11).font_medium().text_color(t.dim).child(`${name.toUpperCase()} · ${items.length}`));
      for (const r of items) body.push(this.row(t, r));
    }
    return v_flex().min_h(0).flex_1()
      .child(Input.new(this.search).h(34).px(10).rounded(8).border_1()
        .border_color(this.focusedField === "search" ? t.accent : t.input).bg(t.background).text_size(13).text_color(t.foreground))
      .child(v_flex().id("hosts-scroll").flex_1().min_h(0).h(300).mt(6).overflow_y_scroll().children(
        !this.loaded ? [div().p(10).text_size(12.5).text_color(t.dim).child("Loading…")]
          : rows.length ? body
          : [v_flex().p(24).items_center().gap(8)
              .child(div().text_size(13).text_color(t.muted).child(this.hosts.length ? "No host matches." : "No saved hosts yet."))
              .child(div().text_size(12).text_color(t.dim).child("Add one, or import the hosts from ~/.ssh/config.")) ]))
      .when(Boolean(this.error), (el) => el.child(div().pt(6).text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().pt(14).gap(8)
        .child(this.button(t, "ssh-new", "New host", true, () => this.edit(null), "plus"))
        .child(this.button(t, "ssh-import", "Import ~/.ssh/config", false, (_e, cx) => this.importConfig(cx)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).self_center().child("Enter connects the first match")));
  }

  form(t) {
    return v_flex().gap(2)
      .children(FIELDS.map(([key, label]) => v_flex().child(div().pt(10).pb(5).text_size(11.5).text_color(t.dim).child(label))
        .child(Input.new(this.inputs[key]).h(34).px(10).rounded(8).border_1()
          .border_color(this.focusedField === key ? t.accent : t.input).bg(t.background).text_size(13).text_color(t.foreground))))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(this.button(t, "ssh-cancel", "Cancel", false, (_e, cx) => { this.mode = "list"; this.error = ""; this.search.focus(); cx.notify(); }))
        .child(this.button(t, "ssh-save", "Save", true, (_e, cx) => this.save(cx))));
  }

  render() {
    const t = theme();
    return v_flex().id("ssh-hosts").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().pb(12)
        .child(div().flex_1().text_size(15).font_semibold().child(this.mode === "form" ? (this.editing === null ? "New host" : "Edit host") : "SSH hosts"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(this.mode === "form" ? this.form(t) : this.list(t));
  }
}
