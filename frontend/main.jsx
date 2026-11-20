import React, {useContext, useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {createRoot} from "react-dom/client";
import {Drone, Gamepad2, Zap, Menu, X, House, CalendarDays, MessageCircle, Megaphone, Users, Battery, Boxes, ShieldCheck, Construction, BookOpen, Timer,
  LogOut, Bell, Plus, ChevronLeft, ChevronRight, MapPin, Clock, Check, CircleHelp,
  Search, ScanLine, QrCode, ClipboardCheck, Pin, FileText, Download, ArrowUpRight, Settings2, Send, CheckCheck, Pencil, SmilePlus, Heart, MoveUp, MoveDown} from "lucide-react";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-ext-400.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-ext-600.css";
import "./style.css";
import {CameraScanner} from "./scanner.jsx";
import {usePwaInstall, promptInstallation, installationPlatform} from "./install.js";
import {detectLanguage, initialLanguage, localizeText, translateNode, translatePage} from "./localization.js";
import {EmojiPicker} from "frimousse";

const base = new URL("./", location.href);
let activeLanguage = initialLanguage();
const uiLocale = () => activeLanguage === "sk" ? "sk-SK" : activeLanguage === "uk" ? "uk-UA" : "en-GB";
const labels = {yes: "Prídem", no: "Neprídem", maybe: "Ešte neviem"};
const batteryLabels = {used: "V drone", charged: "Nabitá", discharged: "Vybitá", stored: "Dlhodobo uskladnená", storage_exit: "Vydaná zo skladu", damaged: "Poškodená", retired: "Vyradená", note: "Poznámka"};
const batteryStateLabels = {in_drone: "V drone", charged: "Nabitá", discharged: "Vybitá", stored: "Dlhodobo uskladnená", storage_exit: "Stav neznámy po vybratí zo skladu", damaged: "Poškodená", retired: "Vyradená"};
const timeZone = "Europe/Bratislava";
const formatShortDate = value => {
  const dateValue = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T00:00:00Z") : new Date(value);
  return new Intl.DateTimeFormat("en-GB", {day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Bratislava"}).format(dateValue);
};
const date = value => formatShortDate(value) + " " + new Intl.DateTimeFormat(uiLocale(), {hour: "2-digit", minute: "2-digit", timeZone}).format(new Date(value));
const past = t => new Date(t.starts_at) <= new Date();
const hash = () => new URLSearchParams(location.hash.slice(1));
const trainingParts = new Intl.DateTimeFormat("sv-SE", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const clubLocal = value => trainingParts.format(new Date(value)).replace(" ", "T");

function trainingISO(local) {
  const reference = Date.parse(local + "Z");
  const offset = instant => Date.parse(clubLocal(instant) + "Z") - instant;
  const candidates = [...new Set([offset(reference - 86400000), offset(reference + 86400000)])]
    .map(shift => new Date(reference - shift)).filter(instant => clubLocal(instant) === local);
  if (candidates.length !== 1) throw new Error("Vyber jednoznačný čas mimo prechodu letného času.");
  return candidates[0].toISOString();
}

async function api(path, method = "GET", body) {
  const response = await fetch(new URL("api/" + path, base), {
    method,
    headers: body === undefined ? undefined : {"Content-Type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(typeof payload.detail === "string" ? localizeText(payload.detail, activeLanguage) :
      response.status === 422 ? "Skontroluj vyplnené údaje." : "Požiadavka sa nepodarila.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function Form({submit, children, label, reset = false}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function handle(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      await submit(Object.fromEntries(new FormData(form)));
      if (reset) form.reset();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <form onSubmit={handle}>
    <fieldset disabled={busy}>
      {children}
      <button className="primary">{busy ? "Ukladá sa…" : label}</button>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function Action({run, children, className = "", pressed, disabled = false}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <span className="action"><button type="button" className={className} aria-pressed={pressed} disabled={busy || disabled} onClick={async () => {
    setBusy(true);
    setError("");
    try { await run(); } catch (error) { setError(error.message); } finally { setBusy(false); }
  }}>{children}</button>{error && <small className="error" role="alert">{error}</small>}</span>;
}

function Login({onLogin}) {
  const [invite, setInvite] = useState(() => hash().get("invite"));
  const [inviteInfo,setInviteInfo]=useState(null);
  const [accepted, setAccepted] = useState(false);
  const reset = hash().has("reset");
  useEffect(()=>{if(invite)api("members/invite-info/"+invite).then(setInviteInfo).catch(()=>{});},[invite]);
  return <section className="card auth">
    <h1>{invite ? (reset ? "Obnova hesla" : "Aktivácia účtu") : "Prihlásenie"}</h1>
    {accepted && <p role="status">Účet je pripravený. Prihlás sa e-mailom, ktorý si potvrdil.</p>}
    {invite ? <Form key={"accept:"+(inviteInfo?.email||"")} label={reset ? "Nastaviť heslo" : "Aktivovať účet"} submit={async ({password,email}) => {
      await api("members/accept", "POST", {token: invite, password,email});
      history.replaceState(null, "", location.pathname);
      setInvite(null);
      setAccepted(true);
    }}>
      <p className="muted">Účet {inviteInfo?.name?"pre "+inviteInfo.name:""} sa aktivuje s týmto e-mailom. Skontroluj ho a oprav prípadný preklep.</p>
      <label>E-mail<input name="email" type="email" maxLength="254" autoComplete="email" defaultValue={inviteInfo?.email||""} required /></label>
      {inviteInfo?.roles?.length>0&&<p className="meta">Priradené roly: {clubRoleLabel(inviteInfo.roles)}</p>}
      <label>Nové heslo<input name="password" type="password" minLength="8" maxLength="128" autoComplete="new-password" required /></label>
      <small>Použi aspoň 8 znakov.</small>
    </Form> : <Form key="login" label="Prihlásiť sa" submit={async data => {
      await api("login", "POST", data);
      await onLogin();
    }}>
      <label>E-mail alebo prihlasovacie meno<input name="login" type="text" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength="254" required /></label>
      <label>Heslo<input type="password" name="password" autoComplete="current-password" maxLength="128" required /></label>
    </Form>}
  </section>;
}

const kinds = {training: "Tréning", match: "Zápas", meeting: "Stretnutie"};
const roleNames = {player:"Hráč",coach:"Tréner",club_leader:"Vedúci klubu",deputy_leader:"Zástupca vedúceho klubu",administrator:"Administratívny pracovník",equipment_technician:"Technik vybavenia",social_media_manager:"Správca sociálnych sietí",competition_coordinator:"Koordinátor súťaží",recruitment_coordinator:"Koordinátor náboru",safety_coordinator:"Bezpečnostný a prevádzkový koordinátor",team_coordinator:"Koordinátor tímov",content_creator:"Fotograf / tvorca obsahu"};
function clubRoleLabel(roles = []) {
  return roles.map(key => localizeText(roleNames[key] || key, activeLanguage)).join(" · ");
}

const initials = name => name.split(" ").filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase();
const dayKey = timestamp => clubLocal(timestamp).slice(0, 10);
const today = () => dayKey(new Date());
const clock = timestamp => new Date(timestamp).toLocaleTimeString(uiLocale(), {hour: "2-digit", minute: "2-digit", timeZone});
const upcoming = training => !training.cancelled && !past(training);

function avatarUrl(id, version) {
  return new URL("api/avatars/" + id + "?v=" + version, base).href;
}

function Avatar({name, id, version}) {
  const url = id && version ? avatarUrl(id, version) : "";
  const [failed, setFailed] = useState("");
  return <span className="avatar" aria-hidden="true">
    {url && failed !== url ? <img key={url} src={url} alt="" loading="lazy" onError={() => setFailed(url)} /> : initials(name)}
  </span>;
}

function Empty({icon: Icon = CalendarDays, children}) {
  return <div className="empty"><Icon size={28} /><p>{children}</p></div>;
}

const ToolbarTarget = React.createContext(null);

function PageToolbar({children}) {
  const target = useContext(ToolbarTarget);
  return target && createPortal(children, target);
}

function Modal({title, close, children}) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {document.body.style.overflow = old;};
  }, []);
  return <dialog ref={ref} className="modal" onCancel={event => {event.preventDefault(); close();}}
    onClick={event => {if (event.target === ref.current) close();}}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Zavrieť" onClick={close}><X /></button></div>
    <div className="modal-body">{children}</div>
  </dialog>;
}

const PermissionContext = React.createContext(null);
const hasRight = (user, key) => Boolean(user?.permissions?.includes(key));
const useRight = () => {
  const user = useContext(PermissionContext);
  return key => hasRight(user, key);
};
const eventTypes = ["training", "meeting", "match"];
const maySchedule = user => eventTypes.some(kind => hasRight(user, "calendar.events." + kind));
const mayRespond = (user, event) => hasRight(user, event.schedule_revision ? "calendar.rsvp.reconfirm" : "calendar.rsvp.respond");

function PermissionCheckbox({keys, selected, label, change}) {
  const node = useRef(null);
  const count = keys.filter(key => selected.has(key)).length;
  useEffect(() => {node.current.indeterminate = count > 0 && count < keys.length;}, [count, keys.length]);
  return <label className="checkbox"><input type="checkbox" ref={node} checked={count === keys.length}
    onChange={event => change(keys, event.target.checked)} />{label}</label>;
}

function PermissionsPanel({roles, catalog, members, update}) {
  const [roleKey, setRoleKey] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState([]);
  const [member, setMember] = useState("");
  const [effective, setEffective] = useState(null);
  const [audit, setAudit] = useState(null);
  const role = roles.find(item => item.key === roleKey) || roles[0];
  const saved = role?.grants || [];
  const selected = new Set(draft ?? saved);
  const byKey = Object.fromEntries(catalog.map(item => [item.key, item]));
  const names = Object.fromEntries(roles.map(item => [item.key, item.name]));
  const added = [...selected].filter(key => !saved.includes(key)).sort();
  const removed = saved.filter(key => !selected.has(key));
  const pages = [...new Set(catalog.map(item => item.page))];
  const text = key => byKey[key]?.label || key;

  function change(keys, enabled) {
    function enable(key) {
      if (selected.has(key)) return;
      selected.add(key);
      byKey[key].requires.forEach(enable);
    }
    for (const key of keys) enabled ? enable(key) : selected.delete(key);
    if (!enabled) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const key of selected) {
          if (byKey[key].requires.some(required => !selected.has(required))) {
            selected.delete(key);
            changed = true;
          }
        }
      }
    }
    setDraft([...selected]);
  }

  return <div className="permission-admin">
    <section className="card">
      <h2>Oprávnenia rolí</h2>
      <div className="form-row">
        <label>Rola<select value={role?.key || ""} onChange={event => {setRoleKey(event.target.value);setDraft(null);}}>
          {roles.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
        </select></label>
        <label>Hľadať v oprávneniach<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      </div>
      {pages.map(page => {
        const branch = catalog.filter(item => item.page === page);
        const shown = branch.filter(item => [item.label, item.block_label, item.page_label].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
        if (!shown.length) return null;
        const blocks = [...new Set(shown.filter(item => item.block !== "open").map(item => item.block))];
        return <details key={page} open={query ? true : undefined} className="permission-branch">
          <summary>{branch[0].page_label} · {branch.filter(item => selected.has(item.key)).length}/{branch.length}</summary>
          <PermissionCheckbox keys={branch.map(item => item.key)} selected={selected} label="Celá vetva" change={change} />
          {shown.some(item => item.block === "open") && <PermissionCheckbox keys={[page + ".open"]}
            selected={selected} label="Otvoriť stránku" change={change} />}
          {blocks.map(block => {
            const items = shown.filter(item => item.block === block);
            const blockKeys = branch.filter(item => item.block === block).map(item => item.key);
            return <details key={block} open={query ? true : undefined}>
              <summary>{items[0].block_label}</summary>
              <PermissionCheckbox keys={blockKeys} selected={selected} label="Všetky akcie bloku" change={change} />
              {items.map(item => <PermissionCheckbox key={item.key} keys={[item.key]} selected={selected} label={item.label} change={change} />)}
            </details>;
          })}
        </details>;
      })}
      {(added.length > 0 || removed.length > 0) && <div className="permission-diff">
        {added.length > 0 && <p><strong>Pribudne:</strong> {added.map(text).join(", ")}</p>}
        {removed.length > 0 && <p><strong>Odoberie sa:</strong> {removed.map(text).join(", ")}</p>}
        <Action className="primary" run={async () => {
          const result = await api("role-config/" + role.key, "PUT", {grants: [...selected], expected: saved});
          update(role.key, result.grants);setDraft(null);setAudit(null);setEffective(null);
        }}>Uložiť oprávnenia</Action>
        <button type="button" onClick={() => setDraft(null)}>Zahodiť zmeny</button>
      </div>}
    </section>
    <section className="card">
      <h2>Vyskúšať ako rola</h2>
      <p className="muted">Náhľad v tejto relácii. Údaje sa v náhľade nemenia.</p>
      <div className="permission-preview-roles">{roles.map(item => <label className="checkbox" key={item.key}>
        <input type="checkbox" checked={preview.includes(item.key)} onChange={event => setPreview(value =>
          event.target.checked ? [...value, item.key] : value.filter(key => key !== item.key))} />{item.name}
      </label>)}</div>
      <Action disabled={!preview.length} run={async () => {
        await api("role-preview", "POST", {roles: preview});
        location.reload();
      }}>Otvoriť náhľad</Action>
    </section>
    <section className="card">
      <h2>Práva konkrétneho člena</h2>
      <label>Člen<select value={member} onChange={event => {setMember(event.target.value);setEffective(null);}}>
        <option value="">Vyber člena</option>{members.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <Action disabled={!member} run={async () => setEffective(await api("role-config/member/" + member))}>Zobraziť práva</Action>
      {effective && <ul className="records">{Object.entries(effective.permissions).map(([key, sources]) =>
        <li key={key}>{text(key)} · {sources.map(source => names[source] || source).join(", ")}</li>)}</ul>}
    </section>
    <section className="card">
      <h2>História zmien oprávnení</h2>
      <Action run={async () => setAudit(await api("role-config/audit"))}>Načítať históriu</Action>
      {audit?.length === 0 && <p className="muted">Zatiaľ bez zmien.</p>}
      {audit && <ul className="timeline">{audit.map(row => <li key={row.id}>
        <strong>{names[row.role_key] || row.role_key}</strong><span className="meta">{date(row.created_at)} · {row.actor || "Odstránený účet"}</span>
        {row.added.length > 0 && <p>Pridané: {row.added.map(text).join(", ")}</p>}
        {row.removed.length > 0 && <p>Odobrané: {row.removed.map(text).join(", ")}</p>}
      </li>)}</ul>}
    </section>
  </div>;
}

const proposalStatus = {open: "Otvorené", closed: "Hlasovanie uzavreté", withdrawn: "Stiahnuté", rejected: "Zamietnuté", approved: "Schválené"};
const proposalVotes = {yes: "Vyhovuje", no: "Nevyhovuje", maybe: "Možno"};

function ProposalForm({proposal, initialDay, done}) {
  const [slots, setSlots] = useState(() => {
    const initial = (proposal?.options || [{id: 0}]).map(option => ({
      id: option.id, starts_at: option.starts_at ? clubLocal(option.starts_at) : "",
      ends_at: option.ends_at ? clubLocal(option.ends_at) : "",
    }));
    return initial.map((slot, index) => !proposal && index === 0 && initialDay
      ? {...slot, starts_at: initialDay + "T18:00", ends_at: initialDay + "T19:00"} : slot);
  });
  const next = useRef(1000000);
  return <Form label={proposal ? "Uložiť návrh" : "Navrhnúť tréning"} submit={async data => {
    await api(proposal ? "training-proposals/" + proposal.id : "training-proposals", proposal ? "PUT" : "POST", {
      ...data, version: proposal?.version,
      options: slots.map(slot => ({
        starts_at: trainingISO(slot.starts_at),
        ends_at: slot.ends_at ? trainingISO(slot.ends_at) : null,
      })),
    });
    await done();
  }}>
    <label>Názov<input name="title" maxLength={120} defaultValue={proposal?.title || "Tréning"} required /></label>
    <label>Miesto<input name="location" maxLength={120} defaultValue={proposal?.location} required /></label>
    <label>Poznámka<textarea name="instructions" maxLength={1000} defaultValue={proposal?.instructions} /></label>
    {slots.map(slot => <div className="form-row" key={slot.id}>
      <label>Začiatok<input type="datetime-local" value={slot.starts_at} required
        onChange={event => setSlots(items => items.map(item => item.id === slot.id ? {...item, starts_at: event.target.value} : item))} /></label>
      <label>Koniec<input type="datetime-local" value={slot.ends_at}
        onChange={event => setSlots(items => items.map(item => item.id === slot.id ? {...item, ends_at: event.target.value} : item))} /></label>
      {slots.length > 1 && <button type="button" onClick={() => setSlots(items => items.filter(item => item.id !== slot.id))}>Odobrať termín</button>}
    </div>)}
    <button type="button" disabled={slots.length >= 8} onClick={() => {
      const id = next.current++;
      setSlots(items => [...items, {id, starts_at: "", ends_at: ""}]);
    }}>Pridať termín</button>
  </Form>;
}

function TrainingProposals({refresh, openTraining, selectedDay}) {
  const user = useContext(PermissionContext);
  const can = useRight();
  const [items, setItems] = useState([]);
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState("");
  async function load() {setItems(await api("training-proposals"));}
  useEffect(() => {load().catch(problem => setError(problem.message));}, []);
  async function decide(proposal, action, option_id) {
    const result = await api("training-proposals/" + proposal.id + "/decision", "POST", {action, option_id, version: proposal.version});
    await load();
    if (result.training_id) {await refresh();openTraining(result.training_id);}
  }
  const visibleItems = selectedDay ? items.filter(proposal => proposal.options.some(option => dayKey(option.starts_at) === selectedDay)) : items;
  return <section className="training-proposals">
    {selectedDay && can("calendar.proposals.create") && <button className="primary" onClick={() => setEditor({})}><Plus size={17}/>Navrhnúť tréning na {formatShortDate(selectedDay)}</button>}
    {editor && <section className="card proposal-editor"><h2>{editor.id ? "Upraviť návrh" : "Nový návrh tréningu"}</h2>
      <ProposalForm key={editor.id || selectedDay || "new"} proposal={editor.id ? editor : null} initialDay={selectedDay}
        done={async () => {await load();setEditor(null);}} />
      <button type="button" onClick={() => setEditor(null)}>Zrušiť návrh</button>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    {visibleItems.length === 0 && <Empty>{selectedDay ? "Na tento dátum zatiaľ nie sú návrhy tréningov." : "Zatiaľ nie sú žiadne návrhy tréningov."}</Empty>}
    {visibleItems.map(proposal => <article className="card" key={proposal.id}>
      <h2>{proposal.title}</h2><p>{proposal.location} · {proposalStatus[proposal.status]}</p>
      {proposal.author && <span className="meta">{proposal.author}</span>}
      {proposal.instructions && <p>{proposal.instructions}</p>}
      <ul className="records proposal-options">{proposal.options.map(option => <li key={option.id}>
        <div><strong>{date(option.starts_at)}{option.ends_at ? " – " + date(option.ends_at) : ""}</strong>
          {option.results !== undefined && <p className="meta">{Object.entries(proposalVotes).map(([key, label]) =>
            label + " " + (option.results?.[key] || 0)).join(" · ")}</p>}
          {option.votes?.length > 0 && <details><summary>Menné hlasy</summary><ul>{option.votes.map((vote, index) =>
            <li key={index}>{vote.name} · {proposalVotes[vote.response]}</li>)}</ul></details>}
        </div>
        <div className="actions">{proposal.status === "open" && upcoming(option) && can("calendar.proposals.vote") &&
          Object.entries(proposalVotes).map(([response, label]) => <Action key={response} pressed={option.my_vote === response}
            run={async () => {await api("training-proposals/" + proposal.id + "/options/" + option.id + "/vote", "PUT", {response});await load();}}>{label}</Action>)}
          {["open", "closed"].includes(proposal.status) && upcoming(option) && can("calendar.proposals.approve") &&
            <Action className="primary" run={() => decide(proposal, "approve", option.id)}>Schváliť tento termín</Action>}
        </div>
      </li>)}</ul>
      <div className="actions">
        {proposal.status === "open" && (proposal.created_by === user.id || user.role === "superadmin") && can("calendar.proposals.edit") && <>
          <button onClick={() => setEditor(proposal)}>Upraviť návrh</button><Action run={() => decide(proposal, "withdraw")}>Stiahnuť návrh</Action>
        </>}
        {proposal.status === "open" && can("calendar.proposals.close") && <Action run={() => decide(proposal, "close")}>Uzavrieť hlasovanie</Action>}
        {["open", "closed"].includes(proposal.status) && can("calendar.proposals.reject") && <Action run={() => decide(proposal, "reject")}>Zamietnuť návrh</Action>}
        {proposal.training_id && can("calendar.events.read") && <button onClick={() => openTraining(proposal.training_id)}>Otvoriť tréning</button>}
      </div>
    </article>)}
  </section>;
}

function TrainingForm({training, initialDay, places, done}) {
  const can = useRight();
  const [kind, setKind] = useState(training?.kind || eventTypes.find(type => can("calendar.events." + type)));
  const [repeat, setRepeat] = useState(false);
  const [place, setPlace] = useState(training?.location || places[0]?.name || "");
  const [newPlace, setNewPlace] = useState(places.length === 0 || Boolean(training && !places.some(p => p.name === training.location)));
  const [editedVersion] = useState(training?.updated_at);
  return <Form label={training ? "Uložiť zmeny" : "Naplánovať udalosť"} submit={async data => {
    const starts_at = training && data.starts_at === clubLocal(training.starts_at) ? training.starts_at : trainingISO(data.starts_at);
    const ends_at = !data.ends_at ? null : training?.ends_at && data.ends_at === clubLocal(training.ends_at)
      ? training.ends_at : trainingISO(data.ends_at);
    if (ends_at && new Date(ends_at) <= new Date(starts_at)) throw new Error("Koniec musí nasledovať po začiatku.");
    if (newPlace && can("calendar.places.create")) await api("places", "POST", {name: data.location});
    await api(training ? "trainings/" + training.id : "trainings", training ? "PUT" : "POST", {
      title: data.title || kinds[kind], kind, starts_at, ends_at, location: data.location,
      instructions: data.instructions, weeks: Number(data.weeks || 1),
      expected_updated_at: editedVersion,
    });
    await done();
  }}>
    <label>Typ udalosti<select value={kind} onChange={event => setKind(event.target.value)}>
      {Object.entries(kinds).filter(([type]) => type === training?.kind || can("calendar.events." + type)).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select></label>
    <label>Názov<input name="title" maxLength="120" defaultValue={training?.title} placeholder={kinds[kind]} /></label>
    <div className="form-row">
      <label>Začiatok<input type="datetime-local" lang="sk-SK" name="starts_at" defaultValue={training ? clubLocal(training.starts_at) : initialDay ? initialDay + "T17:00" : ""} required /></label>
      <label>Koniec<input type="datetime-local" lang="sk-SK" name="ends_at" defaultValue={training?.ends_at ? clubLocal(training.ends_at) : ""} /></label>
    </div>
    <small>Časy sú v časovom pásme Slovenska.</small>
    <label>Miesto{newPlace ?
      <input name="location" maxLength="120" value={place} onChange={event => setPlace(event.target.value)} required /> :
      <select name="location" value={place} onChange={event => setPlace(event.target.value)} required>
        {places.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
      </select>}
    </label>
    {places.length > 0 && <button type="button" className="text-button" onClick={() => {
      setNewPlace(!newPlace);
      setPlace(newPlace ? places[0].name : "");
    }}>{newPlace ? "Vybrať uložené miesto" : "+ Nové miesto"}</button>}
    <label>Pokyny<textarea name="instructions" maxLength="1000" defaultValue={training?.instructions} placeholder="Čo si priniesť alebo na čo sa pripraviť…" /></label>
    {!training && <>
      <label className="checkbox"><input type="checkbox" checked={repeat} onChange={event => setRepeat(event.target.checked)} /> Opakovať každý týždeň</label>
      {repeat && <label>Počet termínov<input name="weeks" type="number" min="2" max="26" defaultValue="8" required /></label>}
    </>}
  </Form>;
}

function RSVP({training, refresh}) {
  const revision = training.schedule_revision || 0;
  const response = revision ? training.change_response : training.response;
  const savedNote = (revision ? training.change_note : training.note) || "";
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(savedNote);
  useEffect(() => {setNote(savedNote);}, [savedNote, revision]);
  async function save(nextResponse) {
    try {
      await api("trainings/" + training.id + "/rsvp", "PUT", {response: nextResponse, note, schedule_revision: revision});
    } catch (error) {
      if (error.status === 409) await refresh();
      throw error;
    }
    await refresh();
  }
  return <div className="rsvp">
    {revision > 0 && <div className="rsvp-change">
      <strong>{response ? "Odpoveď na zmenu je uložená" : "Zmenil sa termín alebo miesto"}</strong>
      <div><span>Pôvodná účasť</span> <span className="badge">{labels[training.response] || "Bez odpovede"}</span></div>
      {!response && training.last_response && <Action className="primary" run={() => save(training.last_response)}>
        <Check size={16} /><span>Potvrdiť zmenu</span><span aria-hidden="true">·</span><span>{labels[training.last_response]}</span>
      </Action>}
    </div>}
    <p className="field-title">{revision ? "Tvoja účasť po zmene" : response ? "Tvoja účasť" : "Dáš nám vedieť, či prídeš?"}</p>
    <div className="segmented rsvp-buttons">{Object.entries(labels).map(([value, label]) =>
      <Action key={value} pressed={response === value} className={value + (response === value ? " selected" : "")} run={() => save(value)}>
        {value === "yes" ? <Check size={17} /> : value === "no" ? <X size={17} /> : <CircleHelp size={17} />}{label}
      </Action>
    )}</div>
    <button className="text-button" aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>{noteOpen ? "Zavrieť poznámku" : savedNote ? "Upraviť poznámku" : "+ Poznámka trénerovi"}</button>
    {noteOpen && <Form label="Uložiť poznámku" submit={async () => {
      if (!response) throw new Error("Najprv vyber účasť.");
      await save(response);
      setNoteOpen(false);
    }}><label>Poznámka<input value={note} maxLength="1000" onChange={event => setNote(event.target.value)} /></label></Form>}
  </div>;
}

function TrainingCard({training, staff, canRespond = !staff, refresh, open, prominent = false}) {
  return <article className={"card training-card event-" + (training.kind || "training") + " " + (prominent ? "prominent " : "") + (training.cancelled ? "cancelled" : "")}>
    <button className="event-link" onClick={open}>
      <span className="date-tile"><strong>{formatShortDate(training.starts_at)}</strong></span>
      <span className="event-text"><span className={"badge event-type " + (training.kind || "training")}>{kinds[training.kind] || "Tréning"}</span><strong>{training.title}</strong>
        <span className="meta"><Clock size={14} />{clock(training.starts_at)}{training.ends_at && " – " + clock(training.ends_at)}</span>
        <span className="meta"><MapPin size={14} />{training.location}</span>
      </span><ChevronRight size={20} />
    </button>
    {training.cancelled ? <p className="notice">Udalosť bola zrušená</p> : <>
      {staff ? <button className="count-strip" onClick={open}>
        <span><i className="dot yes" />{training.counts?.yes || 0} {training.schedule_revision > 0 ? "pôvodne prídu" : "prídu"}</span>
        {training.schedule_revision > 0
          ? <span><i className="dot pending" />{training.counts?.change_yes || 0} <span>prídu po zmene</span> · {training.counts?.change_pending || 0} <span>bez potvrdenia zmeny</span></span>
          : <span><i className="dot pending" />{training.counts?.unanswered || 0} bez odpovede</span>}
        <ArrowUpRight size={16} />
      </button> : null}
      {upcoming(training) && canRespond && <RSVP key={training.schedule_revision} training={training} refresh={refresh} />}
      {!upcoming(training) && training.attended !== undefined && <p className="meta">{training.attended === true ? "Bol si prítomný" : training.attended === false ? "Bol si neprítomný" : "Udalosť sa už začala"}</p>}
    </>}
  </article>;
}

function TrainingWorkspace({training}) {
  const can = useRight();
  const canEdit = ["edit", "team_edit", "private_edit"].some(key => can("calendar.workspace." + key));
  const [data, setData] = useState({plan: [], member_note: "", coach_note: "", feedback: []});
  const [draft, setDraft] = useState(null);
  const [drills, setDrills] = useState([]);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState({went_well: "", difficult: "", next_focus: ""});
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    const workspace = await api("trainings/" + training.id + "/workspace");
    setData(workspace);
    if (workspace.own_feedback) setFeedback(workspace.own_feedback);
    if (can("drills.library.read")) setDrills(await api("drills"));
  }
  useEffect(() => {load().catch(e => setError(e.message));}, [training.id]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds(value => {if (value <= 1) {setRunning(false); return 0;} return value - 1;}), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const changed = (key, value) => setDraft(current => ({...current, [key]: value}));
  async function save() {
    await api("trainings/" + training.id + "/workspace", "PUT", Object.fromEntries(Object.entries(draft).filter(([key]) =>
      ({plan: "edit", member_note: "team_edit", coach_note: "private_edit"}[key]) &&
      can("calendar.workspace." + {plan: "edit", member_note: "team_edit", coach_note: "private_edit"}[key]))));
    await load(); setEditing(false);
  }
  const canFeedback = past(training) && training.attended === true && !training.cancelled;
  return <section className="training-workspace">
    {error && <p className="error" role="alert">{error}</p>}
    {canEdit ? <div className="toolbar end"><button onClick={() => {setDraft({...data, plan: [...(data.plan || [])]}); setEditing(!editing);}}><Pencil size={16} />{editing ? "Zavrieť úpravy" : "Upraviť plán a poznámky"}</button>
      {editing && <Action className="primary" run={save}>Uložiť</Action>}</div> : null}
    <section className="card workout-section"><h3><BookOpen size={19} />Plán tréningu</h3>
      {can("calendar.workspace.publish") && <Action run={async () => {
        await api("trainings/" + training.id + "/workspace/publication", "PUT", {published: !data.published});
        await load();
      }}>{data.published ? "Skryť plán pred tímom" : "Sprístupniť plán tímu"}</Action>}
      {editing ? <>
        {can("calendar.workspace.edit") && <>
        {(draft.plan || []).map((block, index) => <div className="workout-block-edit" key={index}>
          <label>Cvičenie<input value={block.title} maxLength="120" onChange={e => changed("plan", draft.plan.map((item, i) => i === index ? {...item, title: e.target.value} : item))} /></label>
          <div className="form-row"><label>Minúty<input type="number" min="1" max="240" value={block.duration_minutes || 10} onChange={e => changed("plan", draft.plan.map((item, i) => i === index ? {...item, duration_minutes: Number(e.target.value)} : item))} /></label>
            <button className="text-button" onClick={() => changed("plan", draft.plan.filter((_, i) => i !== index))}>Odobrať</button></div>
          <label>Pokyny<textarea rows="2" value={block.notes || ""} maxLength="1000" onChange={e => changed("plan", draft.plan.map((item, i) => i === index ? {...item, notes: e.target.value} : item))} /></label>
        </div>)}
        <button className="button" onClick={() => changed("plan", [...(draft.plan || []), {title: "", duration_minutes: 10, notes: ""}])}><Plus size={16} />Pridať blok</button>
        {drills.length > 0 && <label>Pridať z knižnice cvičení<select value="" onChange={e => {const drill = drills.find(item => String(item.id) === e.target.value); if (drill) changed("plan", [...draft.plan, {title: drill.title, duration_minutes: drill.duration_minutes, notes: drill.objective}]);}}><option value="">Vybrať cvičenie</option>{drills.map(drill => <option key={drill.id} value={drill.id}>{drill.title} · {drill.duration_minutes} min</option>)}</select></label>}
        </>}
        {can("drills.library.create") && <Form label="Pridať cvičenie do knižnice" reset submit={async form => {await api("drills", "POST", {...form, duration_minutes: Number(form.duration_minutes), difficulty: "basic"}); await load();}}>
          <details><summary>Nové cvičenie</summary><label>Názov<input name="title" maxLength="120" required /></label><label>Cieľ<input name="objective" maxLength="1000" /></label><label>Trvanie v minútach<input name="duration_minutes" type="number" min="1" max="240" defaultValue="10" /></label><label>Pomôcky<input name="equipment" maxLength="1000" /></label></details>
        </Form>}
        {can("calendar.workspace.team_edit") && <label>Poznámka pre členov<textarea rows="3" maxLength="4000" value={draft.member_note || ""} onChange={e => changed("member_note", e.target.value)} /></label>}
        {can("calendar.workspace.private_edit") && <label>Súkromná poznámka trénerov<textarea rows="3" maxLength="4000" value={draft.coach_note || ""} onChange={e => changed("coach_note", e.target.value)} /></label>}
      </> : <>
        {data.plan?.length ? <ol className="workout-plan">{data.plan.map((block, index) => <li key={index}><div><strong>{block.title}</strong><span className="meta"><Timer size={14} />{block.duration_minutes} min</span>{block.notes && <p className="body small">{block.notes}</p>}</div>
          {can("calendar.workspace.read") && <button className="text-button" onClick={() => {setSeconds((block.duration_minutes || 10) * 60); setRunning(true);}}>Spustiť čas</button>}</li>)}</ol> : <p className="muted">Plán zatiaľ nie je pripravený.</p>}
        {running && <div className="timer-display" role="timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} <button className="text-button" onClick={() => setRunning(false)}>Zastaviť</button></div>}
        {data.member_note && <div className="notice"><strong>Poznámka pre tím</strong><p>{data.member_note}</p></div>}
        {data.coach_note && <div className="private-note"><strong>Iba tréneri</strong><p>{data.coach_note}</p></div>}
      </>}
    </section>
    {can("calendar.workspace.feedback_write") && canFeedback && <section className="card workout-section"><h3>Spätná väzba po tréningu</h3><p className="muted">Vidíš ju ty a tréneri.</p>
      <Form label="Uložiť feedback" submit={async values => {await api("trainings/" + training.id + "/feedback", "PUT", values); await load();}}>
        <label>Čo sa podarilo?<textarea name="went_well" rows="2" maxLength="1000" value={feedback.went_well} onChange={e => setFeedback({...feedback, went_well: e.target.value})} /></label>
        <label>Čo bolo náročné?<textarea name="difficult" rows="2" maxLength="1000" value={feedback.difficult} onChange={e => setFeedback({...feedback, difficult: e.target.value})} /></label>
        <label>Na čo sa chceš zamerať nabudúce?<textarea name="next_focus" rows="2" maxLength="1000" value={feedback.next_focus} onChange={e => setFeedback({...feedback, next_focus: e.target.value})} /></label>
      </Form>
    </section>}
    {data.feedback?.length > 0 && <details className="card feedback-list"><summary>Feedback od členov ({data.feedback.length})</summary><ul className="people-list">{data.feedback.map(row => <li key={row.member_id}><div className="grow"><strong>{row.name}</strong><span className="meta">{clubRoleLabel(row.roles)}</span>{row.went_well && <p><b>Podarilo sa:</b> {row.went_well}</p>}{row.difficult && <p><b>Náročné:</b> {row.difficult}</p>}{row.next_focus && <p><b>Nabudúce:</b> {row.next_focus}</p>}</div></li>)}</ul></details>}
  </section>;
}

const participantResponses = {yes: "Príde", no: "Nepríde", maybe: "Nevie"};

const trainingChangeLabels = {title: "Názov", starts_at: "Začiatok", ends_at: "Koniec", location: "Miesto",
  instructions: "Pokyny", kind: "Typ udalosti"};

function trainingChangeValue(field, value) {
  if (!value) return "—";
  if (field === "starts_at" || field === "ends_at") return date(value);
  if (field === "kind") return kinds[value];
  return value;
}

function TrainingHistory({history}) {
  if (!history) return <p className="muted" role="status">Načítava sa…</p>;
  if (!history.length) return <Empty icon={Clock}>Zatiaľ bez zmien.</Empty>;
  return <ol className="training-history">{history.map(entry => <li key={entry.id}>
    <header>
      <strong>{entry.schedule_revision ? <>Zmena termínu alebo miesta · {entry.schedule_revision}</> : "Úprava udalosti"}</strong>
      <span className="meta">{date(entry.changed_at)}{entry.editor && <> · {entry.editor}</>}</span>
    </header>
    <dl>{Object.entries(trainingChangeLabels).filter(([field]) => entry.changes[field]).map(([field, label]) => {
      const {before, after} = entry.changes[field];
      return <div key={field}><dt>{label}</dt><dd><del>{trainingChangeValue(field, before)}</del><span>{trainingChangeValue(field, after)}</span></dd></div>;
    })}</dl>
    {entry.response && <p className="meta"><span>Tvoja účasť po zmene</span> · <strong>{labels[entry.response]}</strong> · {date(entry.responded_at)}</p>}
  </li>)}</ol>;
}

function TrainingDetail({training, canRespond, places, close, refresh}) {
  const can = useRight();
  const roster = can("calendar.rsvp.roster");
  const readAttendance = ["read", "write", "bulk"].some(key => can("attendance.records." + key));
  const closed = new Date(training.ends_at || new Date(Date.parse(training.starts_at) + 10800000)) <= new Date();
  const writable = past(training) && !training.cancelled && (!closed || can("attendance.records.correct"));
  const workspace = ["read","edit","team_read","team_edit","private_read","private_edit","feedback_own","feedback_all","publish"].some(key => can("calendar.workspace." + key));
  const [tab, setTab] = useState("info");
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState("all");
  const [selectedRevision, setSelectedRevision] = useState(null);
  const [history, setHistory] = useState(null);
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState("");
  async function load() {setRows(await api("trainings/" + training.id + "/roster"));}
  useEffect(() => {
    if ((roster && tab === "rsvp") || (readAttendance && tab === "attendance")) load().catch(error => setError(error.message));
  }, [roster, readAttendance, tab, training.id, training.updated_at, training.counts?.unanswered, training.counts?.change_pending,
    training.counts?.yes, training.counts?.no, training.counts?.change_yes]);
  useEffect(() => {
    if (!can("calendar.events.history") || (tab !== "history" && !(tab === "rsvp" && roster && training.schedule_revision > 0))) return;
    let current = true;
    api("trainings/" + training.id + "/changes").then(entries => {
      if (current) setHistory(entries);
    }).catch(error => {if (current) setError(error.message);});
    return () => {current = false;};
  }, [tab, roster, training.id, training.updated_at, training.schedule_revision, training.change_response]);
  const revision = selectedRevision ?? training.schedule_revision ?? 0;
  const responseFor = row => revision ? row.change_responses?.[revision]?.response : row.response;
  const filtered = rows.filter(row => filter === "all" || (filter === "none" ? !responseFor(row) : responseFor(row) === filter));
  async function saveAttendance(ids, attended, bulk = false) {
    await api("trainings/" + training.id + "/attendance" + (bulk ? "" : "/" + ids[0]), "PUT", bulk ? {member_ids: ids, attended} : {attended});
    setSelected([]);
    await load();
    await refresh();
  }
  return <Modal title={training.title} close={close}>
    {edit ? <TrainingForm training={training} places={places} done={async () => {setEdit(false); await refresh();}} /> : <>
      <div className="tabs training-tabs" role="tablist" aria-label="Detail udalosti">
        {[["info", "Informácie"], ...(workspace ? [["workout", "Tréning"]] : []), ...(roster ? [["rsvp", "Účasť"]] : []), ...(readAttendance ? [["attendance", "Dochádzka"]] : []), ...(can("calendar.events.history") ? [["history", "História zmien"]] : [])].map(([value, text]) =>
          <button role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{text}</button>)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {tab === "workout" ? <TrainingWorkspace training={training} /> : tab === "history" ? <TrainingHistory history={history} /> : tab === "info" ? <>
        {training.cancelled && <p className="notice">Udalosť bola zrušená</p>}
        <div className="detail-facts"><p><CalendarDays />{date(training.starts_at)}</p>
          {training.ends_at && <p><Clock />Do {clock(training.ends_at)}</p>}
          <p><MapPin />{training.location}</p></div>
        {training.instructions && <p className="body">{training.instructions}</p>}
        {canRespond && upcoming(training) && <RSVP key={training.schedule_revision} training={training} refresh={refresh} />}
        {(training.can_edit || can("calendar.events.cancel")) && !training.cancelled && <div className="actions section-space">
          {training.can_edit && <button onClick={() => setEdit(true)}><Pencil size={17} />Upraviť</button>}
          {can("calendar.events.cancel") && <Action className="danger" run={async () => {
            if (!window.confirm(localizeText("Zrušiť udalosť a zverejniť oznam pre tím? Udalosť zostane v kalendári označená ako zrušená.", activeLanguage))) return;
            await api("trainings/" + training.id + "/cancel", "POST"); await refresh();
          }}>Zrušiť udalosť</Action>}
        </div>}
        {training.can_delete && <div className="section-space"><Action className="danger" run={async () => {
          if (!window.confirm(localizeText("Natrvalo vymazať túto udalosť aj jej prihlášky, dochádzku a súvisiace automatické oznamy? Bez odoslania upozornenia. Táto akcia sa nedá vrátiť.", activeLanguage))) return;
          await api("trainings/" + training.id, "DELETE"); close(); await refresh();
        }}>Vymazať bez upozornenia</Action></div>}
      </> : <>
        {tab === "rsvp" && <>
          {training.schedule_revision > 0 && <label className="rsvp-revision-filter">Odpovede pre
            <select value={selectedRevision ?? ""} onChange={event => setSelectedRevision(event.target.value === "" ? null : Number(event.target.value))}>
              <option value="">Aktuálny termín</option><option value="0">Pôvodný termín</option>
              {(history || []).filter(entry => entry.schedule_revision && entry.schedule_revision !== training.schedule_revision).map(entry =>
                <option key={entry.id} value={entry.schedule_revision}>Zmena {entry.schedule_revision} · {date(entry.changed_at)}</option>)}
            </select>
          </label>}
          <div className="chips">
            {[["all", "Všetci"], ["yes", "Prídu"], ["no", "Neprídu"], ["maybe", "Nevedia"],
              ["none", revision ? "Bez potvrdenia zmeny" : "Bez odpovede"]].map(([value, label]) =>
              <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
        </>}
        {tab === "attendance" && (!past(training) || training.cancelled) && <p className="notice">Dochádzku možno zapísať od začiatku nezrušenej udalosti.</p>}
        {tab === "attendance" && writable && can("attendance.records.bulk") && rows.length > 0 && <>
          <label className="checkbox"><input type="checkbox" checked={selected.length === rows.length} onChange={event => setSelected(event.target.checked ? rows.map(row => row.id) : [])} />Vybrať všetkých</label>
          {selected.length > 0 && <div className="actions"><Action run={() => saveAttendance(selected, true, true)}>Prítomní ({selected.length})</Action>
            <Action run={() => saveAttendance(selected, false, true)}>Neprítomní ({selected.length})</Action></div>}
        </>}
        <ul className="people-list">{(tab === "rsvp" ? filtered : rows).map(row => {
          const currentResponse = row.change_responses?.[training.schedule_revision];
          const latestResponse = tab === "attendance" ? Object.values(row.change_responses || {}).at(-1) : null;
          return <li key={row.id}
          className={tab === "rsvp" ? "rsvp-person rsvp-" + (responseFor(row) || "none") : undefined}>
          {tab === "attendance" && writable && can("attendance.records.bulk") &&
            <input type="checkbox" aria-label={"Vybrať " + row.name} checked={selected.includes(row.id)}
              onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} />}
          <Avatar name={row.name} id={row.id} version={row.avatar_version} /><div className="grow"><strong>{row.name}</strong><span className="meta">{clubRoleLabel(row.roles)}</span>
            {tab === "rsvp" ? <>
              <div className="rsvp-person-summary">
                {revision > 0 && <span className="meta"><span>Pôvodná účasť</span> · {participantResponses[row.response] || "Bez odpovede"}</span>}
                <span className="badge rsvp-response">{participantResponses[responseFor(row)] || (revision ? "Bez potvrdenia zmeny" : "Bez odpovede")}</span>
              </div>
              {revision > 0 && row.note && <p className="small body"><span>Pôvodná poznámka</span> · {row.note}</p>}
              {(revision ? row.change_responses?.[revision]?.note : row.note) && <p className="small body">{revision ? row.change_responses[revision].note : row.note}</p>}
            </> : <>
              <span className="meta">{labels[latestResponse?.response || row.response] || "Bez odpovede"}
                {training.schedule_revision > 0 && !currentResponse && <> · <span>Bez potvrdenia zmeny</span></>}</span>
              {latestResponse?.note && <p className="small body">{latestResponse.note}</p>}
              {row.note && <p className="small body">{row.note}</p>}
            </>}</div>
          {tab === "attendance" && writable && can("attendance.records.write") && <div className="attendance-buttons">
            <Action className={row.attended === true ? "yes selected" : ""} pressed={row.attended === true} run={() => saveAttendance([row.id], true)}><Check size={18} /><span className="sr-only">Prítomný {row.name}</span></Action>
            <Action className={row.attended === false ? "no selected" : ""} pressed={row.attended === false} run={() => saveAttendance([row.id], false)}><X size={18} /><span className="sr-only">Neprítomný {row.name}</span></Action>
          </div>}
        </li>;})}</ul>
        {rows.length === 0 && <Empty icon={Users}>Zatiaľ žiadni účastníci.</Empty>}
      </>}
    </>}
  </Modal>;
}

function Calendar({trainings, places, refresh, openTraining}) {
  const user = useContext(PermissionContext);
  const can = useRight();
  const proposals = can("calendar.proposals.read");
  const events = can("calendar.events.read");
  const staff = can("calendar.rsvp.summary");
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(null);
  const [create, setCreate] = useState(false);
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const padding = (start.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  function moveMonth(offset) {
    setMonth(new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7));
    setSelectedDay(null);
  }
  const shown = trainings.filter(t => dayKey(t.starts_at).startsWith(month) && (!selectedDay || dayKey(t.starts_at) === selectedDay))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  if (!events && !proposals && !maySchedule(user)) return <Empty>Nemáš prístup k udalostiam.</Empty>;
  return <>
    <PageToolbar><div className="page-toolbar-row">
      <div className="period-control">
        <button className="icon-button" aria-label="Predchádzajúci mesiac" onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></button>
        <span aria-live="polite">{start.toLocaleDateString(uiLocale(), {month: "long", year: "numeric", timeZone: "UTC"})}</span>
        <button className="icon-button" aria-label="Nasledujúci mesiac" onClick={() => moveMonth(1)}><ChevronRight size={18} /></button>
      </div>
      {maySchedule(user) && <button className="primary page-primary" onClick={() => setCreate(true)}><Plus size={18} />
        {selectedDay ? <>Pridať udalosť na {formatShortDate(selectedDay)}</> : "Naplánovať"}
      </button>}
    </div></PageToolbar>
    <div className="calendar-month-layout">
      <section className="card calendar">
        <div className="calendar-grid">{["Po", "Ut", "St", "Št", "Pi", "So", "Ne"].map(day => <span className="weekday" key={day}>{day}</span>)}
          {Array.from({length: padding}, (_, i) => <span key={"pad" + i} />)}
          {Array.from({length: days}, (_, i) => {
            const key = month + "-" + String(i + 1).padStart(2, "0");
            const activities = trainings.filter(t => dayKey(t.starts_at) === key && !t.cancelled);
            const types = [...new Set(activities.map(t => t.kind || "training"))];
            const summary = activities.map(t => kinds[t.kind || "training"] + ": " + t.title).join(", ");
            return <button key={key} aria-label={"Vybrať " + formatShortDate(key) + (summary ? " · " + summary : "")} aria-pressed={selectedDay === key}
              className={(key === today() ? "today " : "") + (key === selectedDay ? "selected " : "") + (types.length ? "has-activities " : "") + (types.length === 1 ? "activity-" + types[0] : "")}
              onClick={() => setSelectedDay(selectedDay === key ? null : key)}>
              <span className="calendar-day-number">{i + 1}</span>
              {types.length > 0 && <span className="calendar-markers" aria-hidden="true">{types.map(type => <span className={"event-marker " + type} key={type} />)}</span>}
              {activities.length > 0 && <span className="calendar-event-count" aria-hidden="true">{activities.length}</span>}
            </button>;
          })}</div>
        <div className="calendar-legend">{Object.entries(kinds).map(([type, name]) => <span key={type}><span className={"event-marker " + type} />{name}</span>)}</div>
      </section>
      <div className="event-list">{events && (shown.length ? shown.map((t, i) => <React.Fragment key={t.id}>
        {(i === 0 || dayKey(shown[i - 1].starts_at) !== dayKey(t.starts_at)) && <h2 className="day-heading">{new Date(t.starts_at).toLocaleDateString(uiLocale(), {weekday: "long", day: "numeric", month: "long", timeZone})}</h2>}
        <TrainingCard training={t} staff={staff} canRespond={mayRespond(user, t)} refresh={refresh} open={() => openTraining(t.id)} />
      </React.Fragment>) : <Empty>V tomto období nie sú žiadne udalosti.</Empty>)}
        {proposals && <TrainingProposals refresh={refresh} openTraining={openTraining} selectedDay={selectedDay} />}
      </div>
    </div>
    {create && <Modal title="Nová udalosť" close={() => setCreate(false)}><TrainingForm initialDay={selectedDay} places={places} done={async () => {setCreate(false); await refresh();}} /></Modal>}
  </>;
}

function Members({user,superadmin,onMessage,onCard,onTrialBanner,userId}) {
  const can = useRight();
  const mayManage = member => member.role === "member" || can("members.accounts.manage_staff");
  const [members,setMembers]=useState([]),[query,setQuery]=useState(""),[filter,setFilter]=useState("active");
  const [selected,setSelected]=useState(null),[form,setForm]=useState(false),[link,setLink]=useState(""),[inviteTarget,setInviteTarget]=useState(null);
  const [attendance,setAttendance]=useState([]),[development,setDevelopment]=useState(null),[error,setError]=useState("");
  const [section,setSection]=useState("members"),[catalog,setCatalog]=useState([]);
  const [requests,setRequests]=useState([]),[config,setConfig]=useState([]),[permissionCatalog,setPermissionCatalog]=useState([]);
  const [inviteRoles,setInviteRoles]=useState(["player"]),[editRoles,setEditRoles]=useState([]),[bannerEnabled,setBannerEnabled]=useState(true);
  const canReview=can("members.requests.read");
  const canCreateInvites=can("members.accounts.invite");
  const canAssignInviteRoles=can("members.accounts.invite_roles");
  const inviteRoleOptions=superadmin?config:catalog;
  async function load() {if (can("members.accounts.read")) setMembers(await api("members"));}
  async function loadRequests() {if(canReview)setRequests(await api("role-requests"));}
  async function loadAdmin() {
    if(!superadmin)return;
    const [result,settings]=await Promise.all([api("role-config"),api("public/settings")]);
    setConfig(result.roles);setCatalog(result.roles);setPermissionCatalog(result.catalog);setBannerEnabled(settings.trial_banner_enabled);
  }
  useEffect(()=>{Promise.all([load(),loadRequests(),loadAdmin(),superadmin?Promise.resolve():api("role-catalog").then(setCatalog)]).catch(e=>setError(e.message));},[]);
  useEffect(()=>{let current=true;setAttendance([]);if(can("attendance.records.member")&&selected)api("members/"+selected.id+"/attendance").then(v=>{if(current)setAttendance(v);}).catch(e=>setError(e.message));return()=>{current=false};},[selected?.id,user.permissions]);
  useEffect(()=>{let current=true;setDevelopment(null);if(can("development.skills.read")&&(selected?.roles||[]).includes("player"))api("members/"+selected.id+"/development").then(v=>{if(current)setDevelopment(v);}).catch(e=>setError(e.message));return()=>{current=false};},[selected?.id,user.permissions]);
  useEffect(()=>{if(superadmin&&selected)setEditRoles(selected.roles||["player"]);},[superadmin,selected?.id]);
  const found=members.filter(m=>(m.name+" "+(m.email||"")).toLowerCase().includes(query.toLowerCase())&&
    (filter==="all"||(filter==="coaches"?(m.roles||[]).includes("coach")&&m.active:filter==="invited"?!m.registered&&m.active:filter==="inactive"?!m.active:m.active&&m.registered)));
  const status=m=>!m.active?"Neaktívny":!m.registered?"Pozvaný":"Aktívny";
  function toggle(setter,current,key){setter(current.includes(key)?current.filter(x=>x!==key):[...current,key]);}
  return <>
    <PageToolbar>
      <div className="page-toolbar-row">
        {superadmin && <div className="segmented"><button aria-pressed={section==="members"} onClick={()=>setSection("members")}>Členovia</button>
          <button aria-pressed={section==="requests"} onClick={()=>setSection("requests")}>Žiadosti o roly {requests.length>0&&<span className="counter">{requests.length}</span>}</button>
          <button aria-pressed={section==="roles"} onClick={()=>setSection("roles")}>Roly a prístupy</button></div>}
        {section==="members" && <label className="search"><Search size={17}/><input type="search" aria-label="Hľadať člena" placeholder="Hľadať podľa mena…" value={query} onChange={e=>setQuery(e.target.value)}/></label>}
        {!superadmin&&canReview&&<button aria-pressed={section==="requests"} onClick={()=>setSection(section==="requests"?"members":"requests")}><ShieldCheck size={16}/>Žiadosti o roly {requests.length>0&&<span className="counter">{requests.length}</span>}</button>}
        {section==="members"&&canCreateInvites&&<button className="primary page-primary" onClick={()=>{setLink("");setInviteTarget(null);setInviteRoles(["player"]);setForm(true);}}><Plus size={18}/>Pozvať člena</button>}
      </div>
      {section==="members" && <div className="page-toolbar-row"><div className="chips">
        {[["active","Aktívni"],["coaches","Tréneri"],["invited","Pozvaní"],["inactive","Neaktívni"],["all","Všetci"]].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}
      </div></div>}
    </PageToolbar>
    {section==="members"&&<>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="card flush"><ul className="people-list">{found.map(member=><li key={member.id}><button className="person-link" onClick={()=>{setSelected(member);setLink("");}}>
        <Avatar name={member.name} id={member.id} version={member.avatar_version}/><span className="grow"><strong>{member.name}</strong><span className="meta">{[clubRoleLabel(member.roles), member.email].filter(Boolean).join(" · ")}</span>
        {can("attendance.records.member")&&<span className="meta">{member.recorded_count>0?"Dochádzka "+member.attended_count+"/"+member.recorded_count:"Dochádzka zatiaľ bez záznamu"}</span>}
        {member.equipment?.length>0&&<span className="meta member-equipment-summary"><Boxes size={13}/>{member.equipment.map(item=>item.code).join(", ")}</span>}</span>
        <span className={"badge "+(member.active?"positive":"")}>{status(member)}</span><ChevronRight size={18}/></button></li>)}
      </ul>{found.length===0&&<Empty icon={Users}>Žiadne zodpovedajúce účty.</Empty>}</div>
      {form&&<Modal title="Pozvať člena" close={()=>setForm(false)}>{link?<InviteLink link={link}/>:<Form label="Vytvoriť pozvánku" submit={async data=>{
        if(canAssignInviteRoles&&!inviteRoles.length)throw new Error("Vyber aspoň jednu rolu.");
        const result=await api("members/invite","POST",{...data,roles:canAssignInviteRoles?inviteRoles:["player"]});await load();setLink(result.invite_url);
      }}><label>Meno<input name="name" maxLength="120" autoComplete="name" defaultValue={inviteTarget?.name||""} required/></label><label>E-mail<input name="email" type="email" maxLength="254" autoComplete="email" defaultValue={inviteTarget?.email||""} required/></label>
        {canAssignInviteRoles&&<fieldset className="role-checkboxes"><legend>Roly pri pozvánke</legend>{inviteRoleOptions.map(item=><label className="checkbox" key={item.key}><input type="checkbox" checked={inviteRoles.includes(item.key)} onChange={()=>toggle(setInviteRoles,inviteRoles,item.key)}/>{item.name}{!item.available&&<span className="badge">Funkcia zatiaľ nedostupná</span>}</label>)}</fieldset>}
      </Form>}</Modal>}
      {selected&&<Modal title={selected.name} close={()=>setSelected(null)}><div className="profile-heading"><Avatar name={selected.name} id={selected.id} version={selected.avatar_version}/><div><span className="badge">{clubRoleLabel(selected.roles)}</span><p>{selected.email}</p></div></div>
        {can("members.card.read")&&(selected.roles||[]).includes("player")&&selected.active&&<button className="section-space" onClick={()=>onCard(selected)}><QrCode size={17}/>Členský QR kód</button>}
        <div className="actions">{can("messages.chat.direct")&&selected.id!==userId&&selected.active&&selected.registered&&<button className="primary" onClick={()=>{onMessage(selected.id);setSelected(null);}}><MessageCircle size={17}/>Napísať správu</button>}
          {<>
          {can("members.accounts.active")&&mayManage(selected)&&<Action run={async()=>{await api("members/"+selected.id+"/active","PUT",{active:!selected.active});setSelected({...selected,active:!selected.active});await load();}}>{selected.active?"Deaktivovať":"Aktivovať"}</Action>}
          {can("members.accounts.reset")&&mayManage(selected)&&selected.active&&selected.registered&&<Action run={async()=>{const r=await api("members/"+selected.id+"/reset","POST");setLink(r.invite_url);}}>Obnoviť heslo</Action>}
          {canCreateInvites&&selected.active&&!selected.registered&&<Action run={async()=>{setInviteTarget(selected);setInviteRoles(canAssignInviteRoles?(selected.roles||["player"]):["player"]);setLink("");setForm(true);setSelected(null);}}>Nová pozvánka</Action>}
          </>}
        </div>{link&&<InviteLink link={link}/>}
        {superadmin&&<section className="section-space"><h3>Funkčné roly</h3>{config.map(role=><label className="checkbox role-member-checkbox" key={role.key}><input type="checkbox" checked={editRoles.includes(role.key)} onChange={()=>toggle(setEditRoles,editRoles,role.key)}/>{role.name}{!role.available&&<span className="badge">Funkcia zatiaľ nedostupná</span>}</label>)}
          <Action className="primary section-space" run={async()=>{if(!editRoles.length)throw new Error("Vyber aspoň jednu rolu.");const r=await api("members/"+selected.id+"/roles","PUT",{roles:editRoles});const updated={...selected,roles:r.roles,role:r.roles.some(k=>config.find(x=>x.key===k)?.admin_access)?"coach":"member"};setSelected(updated);await load();}}>Uložiť roly</Action>
          </section>}
          {can("members.accounts.delete")&&mayManage(selected)&&selected.registered&&<Action className="danger section-space" run={async()=>{if(!window.confirm("Natrvalo odstrániť člena "+selected.name+"?"))return;await api("members/"+selected.id,"DELETE");setSelected(null);await load();}}>Natrvalo odstrániť člena</Action>}
        {selected.equipment?.length>0&&<section className="section-space member-equipment"><h3>Pridelené vybavenie</h3><ul>{selected.equipment.map(item=><li key={item.code}><Boxes size={15}/><span><strong>{item.code}</strong><span className="meta">{equipmentKindLabels[item.kind]} · {item.label}</span></span></li>)}</ul></section>}
        {can("attendance.records.member")&&(selected.roles||[]).includes("player")&&<section className="section-space"><h3>Dochádzka</h3>{attendance.length?<ul className="records">{attendance.map((row,i)=><li key={i}><div className="grow"><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span></div><span className={"badge "+(row.attended?"positive":"")}>{row.attended?"Prítomný":"Neprítomný"}</span></li>)}</ul>:<p className="muted">Zatiaľ bez záznamu.</p>}</section>}
        {(selected.roles||[]).includes("player")&&can("development.skills.read")&&<section className="section-space development-section"><h3>Rozvoj hráča</h3>{development?<>
          {can("development.skills.private_write") && <Form label="Uložiť trénerovu poznámku" submit={async({note})=>{await api("members/"+selected.id+"/development/note","PUT",{note});setDevelopment({...development,note});}}><label>Súkromná poznámka trénerov<textarea name="note" rows="3" maxLength="4000" defaultValue={development.note}/></label></Form>}
          {!can("development.skills.private_write") && development.note && <p>{development.note}</p>}
          <div className="skill-list">{development.skills.map(skill=><div className="skill-row" key={skill.skill}><strong>{skill.skill}</strong><span className="skill-level">{[1,2,3,4].map(level=><button disabled={!can("development.skills.write")} type="button" aria-label={skill.skill+" "+level} className={level<=skill.level?"filled":""} key={level} onClick={async()=>{await api("members/"+selected.id+"/development/skills","PUT",{...skill,level});setDevelopment(await api("members/"+selected.id+"/development"));}}>●</button>)}</span></div>)}</div>
          {can("development.skills.write") && <Form key={selected.id+":skill"} label="Pridať zručnosť" reset submit={async values=>{await api("members/"+selected.id+"/development/skills","PUT",{...values,level:Number(values.level)});setDevelopment(await api("members/"+selected.id+"/development"));}}><label>Zručnosť<input name="skill" maxLength="120" required/></label><label>Úroveň<select name="level" defaultValue="2"><option value="0">Na začiatku</option><option value="1">Základy</option><option value="2">Rozvíja sa</option><option value="3">Samostatný</option><option value="4">Istý</option></select></label><label>Poznámka<input name="note" maxLength="1000"/></label></Form>}
          {development.feedback.length>0&&<details className="section-space"><summary>Tréningový feedback ({development.feedback.length})</summary><ul className="records">{development.feedback.map(row=><li key={row.training_id}><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span>{row.next_focus&&<p>{row.next_focus}</p>}</li>)}</ul></details>}
        </>:<p className="muted">Načítava sa…</p>}</section>}
      </Modal>}
    </>}
    {section==="requests"&&<section className="card role-requests-panel"><h2>Žiadosti o pridanie rolí</h2>{requests.length?requests.map(item=><article className="role-request-row" key={item.id}><div className="grow"><strong>{item.member_name} · {item.role_name}</strong><span className="meta">{item.email} · {date(item.created_at)}</span></div>
      {can("members.requests.decide")?<><Action className="primary" run={async()=>{await api("role-requests/"+item.id,"PUT",{status:"approved"});await Promise.all([loadRequests(),load()]);}}>Schváliť</Action><Action className="danger" run={async()=>{await api("role-requests/"+item.id,"PUT",{status:"rejected"});await loadRequests();}}>Zamietnuť</Action></>:<span className="badge">Čaká na schválenie</span>}</article>):<p className="muted">Žiadne čakajúce žiadosti.</p>}</section>}
    {section==="roles"&&superadmin&&<>
      <section className="card"><h2>Skúšobná prevádzka</h2><label className="checkbox"><input type="checkbox" checked={bannerEnabled} onChange={async e=>{const value=e.target.checked;setBannerEnabled(value);try{await api("admin/trial-banner","PUT",{enabled:value});onTrialBanner(value);}catch(err){setBannerEnabled(!value);setError(err.message);}}}/>Zobrazovať banner o skúšobnej prevádzke všetkým používateľom</label></section>
      <PermissionsPanel roles={config} catalog={permissionCatalog} members={members} update={(key, grants) =>
        setConfig(rows => rows.map(row => row.key === key ? {...row, grants} : row))} />
    </>}
  </>;
}

function InviteLink({link}) {
  return <div className="invite"><p>Odkaz je platný 7 dní. Pošli ho používateľovi.</p><label>Odkaz<input readOnly value={link} onFocus={event => event.target.select()} /></label>
    {navigator.clipboard && <Action run={() => navigator.clipboard.writeText(link)}>Kopírovať odkaz</Action>}</div>;
}

function OwnAttendance() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {api("me/attendance").then(setRows).catch(problem => setError(problem.message));}, []);
  return <section className="card"><h2>Moja dochádzka</h2>
    {error && <p className="error" role="alert">{error}</p>}
    <ul className="records">{rows.map(row => <li key={row.id}><strong className="grow">{row.title}</strong>
      <span>{date(row.starts_at)}</span><span className="badge">{row.attended ? "Prítomný" : "Neprítomný"}</span></li>)}</ul>
    {!error && !rows.length && <p className="muted">Zatiaľ bez záznamu.</p>}
  </section>;
}

function AttendanceOverview({openScanner}) {
  const initial = () => ({date_from: today().slice(0, 7) + "-01", date_to: today(),
    kinds: Object.keys(kinds), include_cancelled: false});
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    const query = new URLSearchParams({kinds: filters.kinds.join(","), include_cancelled: String(filters.include_cancelled)});
    if (filters.date_from) query.set("date_from", filters.date_from);
    if (filters.date_to) query.set("date_to", filters.date_to);
    async function load(background = false) {
      if (!background) {setLoading(true); setResult(null);}
      try {
        const data = await api("attendance?" + query);
        if (current) {setResult(data); setError("");}
      } catch (error) {if (current) setError(error.message);}
      finally {if (current) setLoading(false);}
    }
    load();
    const timer = setInterval(() => {if (!document.hidden) load(true);}, 15000);
    const focus = () => {if (!document.hidden) load(true);};
    addEventListener("visibilitychange", focus);
    return () => {current = false; clearInterval(timer); removeEventListener("visibilitychange", focus);};
  }, [filters, revision]);
  const people = (result?.members || []).filter(person => person.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
  const events = result?.events || [];
  const records = new Map((result?.attendance || []).map(row => [row.member_id + ":" + row.training_id, row.attended]));
  const status = (person, event) => event.cancelled ? "Zrušené" : !past(event) ? "Plánované" :
    records.get(person.id + ":" + event.id) === true ? "Prítomný" : records.get(person.id + ":" + event.id) === false ? "Neprítomný" : "Nezapísané";
  const classes = {"Prítomný": "present", "Neprítomný": "absent", "Nezapísané": "unknown", "Plánované": "planned", "Zrušené": "cancelled"};
  const dateLabel = value => formatShortDate(value);
  const appliedPeriod = [filters.date_from, filters.date_to].map(value => value ? dateLabel(value) : "…").join(" – ");
  const filterCount = Number(filters.kinds.length !== Object.keys(kinds).length) + Number(filters.include_cancelled);
  return <>
    <PageToolbar>
      <div className="page-toolbar-row">
        <label className="search"><Search size={17} /><input type="search" aria-label="Vyhľadať člena" value={search} onChange={event => setSearch(event.target.value)} placeholder="Vyhľadať člena" /></label>
        {result && <span className="meta" role="status">Členovia: {people.length} · Udalosti: {events.length}</span>}
        {openScanner && <button className="primary page-primary" onClick={() => openScanner()}><ScanLine size={18} />Skenovať dochádzku</button>}
      </div>
      <details className="attendance-filter-details"><summary>
        <span>Filtre a obdobie</span>
        {filterCount > 0 && <span className="counter">{filterCount}</span>}
        <span className="meta filter-period">{filters.date_from || filters.date_to ? appliedPeriod : "Celé obdobie"}</span>
      </summary><form onSubmit={event => {
        event.preventDefault();
        if (draft.date_from && draft.date_to && draft.date_from > draft.date_to) {setError("Dátum od nesmie byť neskôr než dátum do."); return;}
        setFilters({...draft, kinds: [...draft.kinds]});
      }}>
        <div className="attendance-date-filters">
          <label>Od<input type="date" lang="sk-SK" value={draft.date_from} onChange={event => setDraft({...draft, date_from: event.target.value})} /></label>
          <label>Do<input type="date" lang="sk-SK" value={draft.date_to} onChange={event => setDraft({...draft, date_to: event.target.value})} /></label>
        </div>
        <fieldset className="attendance-types"><legend>Typy udalostí</legend>
          {Object.entries(kinds).map(([key, label]) => <label className="checkbox" key={key}><input type="checkbox" checked={draft.kinds.includes(key)} onChange={event => setDraft({...draft,
            kinds: event.target.checked ? [...draft.kinds, key] : draft.kinds.filter(kind => kind !== key)})} />{label}</label>)}
        </fieldset>
        <label className="checkbox"><input type="checkbox" checked={draft.include_cancelled} onChange={event => setDraft({...draft, include_cancelled: event.target.checked})} />Zobraziť aj zrušené udalosti</label>
        <div className="actions"><button type="button" onClick={() => {const all = {date_from: "", date_to: "", kinds: Object.keys(kinds), include_cancelled: false}; setDraft(all); setFilters(all);}}>Celé obdobie</button>
          <button type="button" onClick={() => setRevision(value => value + 1)}>Obnoviť údaje</button>
          <button className="primary">Zobraziť</button>
        </div>
      </form></details>
    </PageToolbar>
    {error && <p className="error" role="alert">{error}</p>}
    {loading ? <Empty>Načítava sa dochádzka…</Empty> : result && <>
      {!events.length ? <Empty icon={CalendarDays}>Pre vybrané filtre nie sú žiadne udalosti.</Empty> : !people.length ? <Empty icon={Users}>Žiadni členovia pre tento výber.</Empty> : <>
        <div className="attendance-table-scroll" tabIndex={0} role="region" aria-label="Tabuľka dochádzky členov, posúvateľná vodorovne aj zvislo">
          <table className="attendance-table"><caption className="sr-only">Členovia tímu a dochádzka na udalostiach podľa vybraných filtrov</caption>
            <thead><tr><th scope="col" className="attendance-name">Člen</th><th scope="col">Prítomný / zapísané</th>
              {events.map(event => <th scope="col" key={event.id} className={"attendance-event event-" + event.kind}>
                <span className={"badge event-type " + event.kind}>{kinds[event.kind]}</span><strong>{event.title}</strong>
                <span>{date(event.starts_at)}</span>{event.cancelled && <span>Zrušené</span>}
              </th>)}
            </tr></thead>
            <tbody>{people.map(person => {
              const recorded = events.filter(event => !event.cancelled && past(event) && records.has(person.id + ":" + event.id));
              const present = recorded.filter(event => records.get(person.id + ":" + event.id) === true).length;
              return <tr key={person.id}><th scope="row" className="attendance-name"><strong>{person.name}</strong><span className="meta">{clubRoleLabel(person.roles)}</span>{!person.active && <span className="meta">Neaktívny</span>}</th>
                <td className="attendance-total">{present} / {recorded.length}</td>
                {events.map(event => {const label = status(person, event); return <td key={event.id} aria-label={person.name + ", " + event.title + ", " + date(event.starts_at) + ": " + label}>
                  <span className={"attendance-status " + classes[label]}>{label === "Prítomný" && <Check size={15} />}{label === "Neprítomný" && <X size={15} />}{label}</span>
                </td>;})}
              </tr>;
            })}</tbody>
          </table>
        </div>
      </>}
    </>}
  </>;
}

function AnnouncementEditor({item, close, refresh}) {
  const can = useRight();
  const [draftMode, setDraftMode] = useState(item?.published === false || !can("announcements.notices.publish"));
  const [audience,setAudience]=useState(item?.audience || "team");
  const [people,setPeople]=useState([]);
  const [selected,setSelected]=useState(item?.recipient_ids || []);
  const [keep,setKeep]=useState((item?.attachments || []).map(f=>f.id));
  const [files,setFiles]=useState([]);
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{if (can("announcements.notices.audience")) api("announcement-recipients").then(setPeople).catch(e=>setError(e.message));},[]);
  return <Modal title={item ? "Upraviť oznam" : "Nový oznam"} close={close}>
    {error && <p className="error" role="alert">{error}</p>}
    <Form label={draftMode ? "Uložiť koncept" : item ? "Uložiť zmeny" : "Zverejniť oznam"} submit={async data=>{
      if (can("announcements.notices.audience") && audience === "selected" && !selected.length) throw new Error("Vyber aspoň jedného adresáta.");
      const existing=(item?.attachments || []).filter(f=>keep.includes(f.id));
      if(existing.length+files.length>5 || files.reduce((sum,f)=>sum+f.size,0)>5*1024*1024)
        throw new Error("Najviac 5 príloh, spolu najviac 5 MB.");
      let draft;
      if(files.length){
        draft=await api("announcement-drafts","POST");
        for(const file of files){
          const name=Array.from(new TextEncoder().encode(file.name),b=>b.toString(16).padStart(2,"0")).join("");
          const response=await fetch(new URL("api/announcement-drafts/"+draft.id+"/attachments",base),{
            method:"POST",headers:{"X-Filename":name},body:file});
          if(!response.ok) throw new Error((await response.json()).detail || "Príloha sa nenahrala.");
        }
      }
      await api("announcements"+(item ? "/"+item.id : ""),item ? "PUT" : "POST",{
        title:data.title,body:data.body,published:!draftMode,pinned:can("announcements.notices.pin") ? data.pinned==="on" : Boolean(item?.pinned),audience,recipient_ids:can("announcements.notices.audience") && audience==="selected" ? selected : [],
        keep_attachment_ids:keep,draft_id:draft?.id || null,notify:data.notify==="on"});
      close();await refresh();
    }}>
      {item?.published !== true && can("announcements.notices.publish") && <label className="checkbox"><input type="checkbox" checked={draftMode} onChange={event => setDraftMode(event.target.checked)} />Uložiť ako koncept</label>}
      <label>Názov<input name="title" maxLength="120" defaultValue={item?.title || ""} required /></label>
      <label>Text<textarea name="body" maxLength="4000" defaultValue={item?.body || ""} required /></label>
      {can("announcements.notices.audience") && <label>Adresáti<select value={audience} onChange={e=>setAudience(e.target.value)}>
        <option value="team">Celý tím</option><option value="coaches">Iba tréneri</option><option value="selected">Vybraní členovia a tréneri</option>
      </select></label>}
      {can("announcements.notices.audience") && audience==="selected" && <><label>Vyhľadať adresáta<input type="search" value={query} onChange={e=>setQuery(e.target.value)} /></label>
        <div className="recipient-picker">{people.filter(p=>p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(person=><label className="checkbox" key={person.id}>
          <input type="checkbox" checked={selected.includes(person.id)} onChange={e=>setSelected(e.target.checked ? [...selected,person.id] : selected.filter(id=>id!==person.id))} />
          {person.name} · {clubRoleLabel(person.roles)}
        </label>)}</div><p className="meta">Vybraných: {selected.length}</p></>}
      {can("announcements.notices.pin") && <label className="checkbox"><input name="pinned" type="checkbox" defaultChecked={item?.pinned || false} />Pripnúť na nástenku</label>}
      {can("announcements.files.upload") && <>{(item?.attachments || []).map(file=><label className="checkbox" key={file.id}><input type="checkbox" checked={keep.includes(file.id)} onChange={e=>setKeep(e.target.checked ? [...keep,file.id] : keep.filter(id=>id!==file.id))} />Ponechať {file.filename}</label>)}
      <label>Pridať prílohy<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" onChange={e=>setFiles(Array.from(e.target.files || []))} /></label>
      <p className="meta">PDF, PNG alebo JPEG. Najviac 5 príloh, spolu 5 MB.</p></>}
      {!draftMode && can("announcements.notices.push") && <label className="checkbox"><input name="notify" type="checkbox" defaultChecked={!item} />Poslať push upozornenie adresátom</label>}
      <p className="meta">Oznamy spravujú tréneri a vedenie klubu. Pri úprave sa potvrdenia prečítania vynulujú.</p>
    </Form>
  </Modal>;
}

function Bulletin({items, refresh}) {
  const can = useRight();
  const [editor,setEditor]=useState(null);
  const [drafts, setDrafts] = useState([]);
  const [draftError, setDraftError] = useState("");
  const maySeeDrafts = ["create","edit","publish"].some(key => can("announcements.notices." + key));
  async function loadDrafts() {if (maySeeDrafts) setDrafts(await api("announcement-workbench"));}
  useEffect(() => {loadDrafts().catch(problem => setDraftError(problem.message));}, [maySeeDrafts]);
  useEffect(()=>{
    const id=Number(hash().get("notice"));
    if(id) document.getElementById("notice-"+id)?.scrollIntoView?.({block:"center"});
  },[items]);
  return <>
    {can("announcements.notices.create") && <PageToolbar><div className="page-toolbar-row"><button className="primary page-primary" onClick={()=>setEditor({})}><Plus size={18} />Nový oznam</button></div></PageToolbar>}
    {draftError && <p className="error" role="alert">{draftError}</p>}
    {drafts.length > 0 && <section className="card">
      <h2>Rozpracované oznamy</h2>
      <ul className="records">{drafts.map(item => <li key={item.id}>
        <div className="grow"><strong>{item.title}</strong><p>{item.body}</p></div>
        <div className="actions">
          {can("announcements.notices.edit") && <button onClick={() => setEditor(item)}>Upraviť koncept</button>}
          {can("announcements.notices.publish") && <Action run={async () => {
            await api("announcements/" + item.id + "/publish", "POST", {notify: false});
            await Promise.all([loadDrafts(), refresh()]);
          }}>Zverejniť</Action>}
        </div>
      </li>)}</ul>
    </section>}
    {items.length ? <div className="bulletin-list">{items.map(item=><article className="card" key={item.id} id={"notice-"+item.id}>
      <div className="row-between"><span className="meta">{date(item.created_at)}</span>{item.pinned && <span className="badge"><Pin size={13} />Pripnuté</span>}</div>
      <h2>{item.title}</h2><p className="body">{item.body}</p>
      {can("announcements.notices.audience") && <p className="meta">{item.audience==="selected" ? "Vybraní adresáti" : item.audience==="coaches" ? "Iba tréneri" : "Celý tím"}</p>}
      {can("announcements.files.read") && (item.attachments || []).length>0 && <ul className="attachment-list">{item.attachments.map(file=><li key={file.id}><a href={new URL("api/announcements/"+item.id+"/attachments/"+file.id,base).href}><Download size={16} />{file.filename}</a></li>)}</ul>}
      <div className="actions section-space">
        {!item.is_read ? <Action className="text-button" run={async()=>{await api("announcements/"+item.id+"/read","POST");await refresh();}}><CheckCheck size={16} />Prečítané</Action> : <span className="meta"><CheckCheck size={16} />Prečítané</span>}
        {can("announcements.notices.pin") && <Action className="text-button" run={async()=>{await api("announcements/"+item.id+"/pin","PUT",{pinned:!item.pinned});await refresh();}}><Pin size={16} />{item.pinned ? "Odopnúť" : "Pripnúť"}</Action>}
        {can("announcements.notices.edit") && can("announcements.notices.publish") && <button onClick={()=>setEditor(item)}><Pencil size={16} />Upraviť</button>}
        {can("announcements.notices.delete") && <Action className="danger" run={async()=>{
            if(!window.confirm(localizeText("Natrvalo vymazať oznam aj prílohy? Bez odoslania upozornenia.", activeLanguage))) return;
            await api("announcements/"+item.id,"DELETE");await refresh();
          }}>Vymazať</Action>}
      </div>
    </article>)}</div> : <Empty icon={Megaphone}>Zatiaľ žiadne oznamy.</Empty>}
    {editor && <AnnouncementEditor item={editor.id ? editor : null} close={()=>setEditor(null)} refresh={async () => {await Promise.all([loadDrafts(), refresh()]);}} />}
  </>;
}

function GroupEditor({contacts, group, user, close, done}) {
  const [selected, setSelected] = useState(() => group ? group.members.filter(m => m.id !== user.id).map(m => m.id) : []);
  const [query, setQuery] = useState("");
  return <Modal title={group ? "Upraviť skupinu" : "Nová skupina"} close={close}>
    <Form label={group ? "Uložiť skupinu" : "Vytvoriť skupinu"} submit={async data => {
      if (selected.length === 0) throw new Error("Vyber aspoň jedného ďalšieho účastníka.");
      const result = await api(group ? "chat-groups/" + group.id : "chat-groups", group ? "PUT" : "POST", {name: data.name, member_ids: selected});
      await done(result.group_id || group.id);
    }}>
      <label>Názov skupiny<input name="name" defaultValue={group?.name || ""} maxLength="120" required /></label>
      <label className="search"><Search size={18} /><input type="search" value={query} placeholder="Hľadať ľudí…" aria-label="Hľadať účastníkov" onChange={event => setQuery(event.target.value)} /></label>
      <p className="muted small">Vybraní účastníci: {selected.length + 1} vrátane teba</p>
      <div className="recipient-list">
        {contacts.filter(person => person.name.toLowerCase().includes(query.toLowerCase())).map(person =>
          <label className="recipient-check" key={person.id}>
            <input type="checkbox" checked={selected.includes(person.id)} onChange={event =>
              setSelected(event.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id))} />
            <Avatar name={person.name} id={person.id} version={person.avatar_version} /><span className="grow"><strong>{person.name}</strong><span className="meta">{clubRoleLabel(person.roles)}</span></span>
          </label>)}
      </div>
    </Form>
  </Modal>;
}

function MessageInteractions({item, own, change}) {
  const can = useRight();
  const [picker, setPicker] = useState(false);
  const [reactors, setReactors] = useState(null);
  const [addingOption, setAddingOption] = useState(false);
  const reactions = item.reactions || [];
  const vote = item.poll_results?.find(result => result.mine)?.choice;
  const total = item.poll_results?.reduce((sum, result) => sum + result.count, 0) || 0;
  async function react(emoji) {
    await change(item.id, "reaction", {emoji, active: !reactions.some(row => row.emoji === emoji && row.mine)});
    setPicker(false);
  }
  async function showReactors(emoji) {
    const people = await api("messages/" + item.id + "/reactions?" + new URLSearchParams({emoji}));
    setReactors({emoji, people});
  }
  return <>
    {item.poll_options && <div className="message-poll">
      <strong>Anketa</strong>
      <p className="poll-question">{item.body}</p>
      {item.poll_options.map((option, choice) => {
        const count = item.poll_results?.find(result => result.choice === choice)?.count || 0;
        return <Action key={choice} className="poll-option" disabled={!can("messages.poll.vote")} pressed={vote === choice}
          run={() => change(item.id, "vote", {choice: vote === choice ? null : choice})}>
          <span>{option}</span><span>{total ? Math.round(count / total * 100) : 0}%</span>
        </Action>;
      })}
      <small className="poll-total"><span>Počet hlasov</span> · {total}</small>
      {can("messages.poll.options") && <button type="button" className="text-button poll-add-option" aria-expanded={addingOption}
        onClick={() => setAddingOption(value => !value)}><Plus size={14} />Pridať možnosť</button>}
      {addingOption && <Form label="Uložiť možnosť" submit={async ({option}) => {
        await change(item.id, "poll-options", {option}, "POST");
        setAddingOption(false);
      }}>
        <label>Nová možnosť<input name="option" required maxLength={120} autoFocus /></label>
      </Form>}
    </div>}
    {(!own || reactions.length > 0) && <div className="message-reactions">
      {reactions.map(({emoji, count, mine}) =>
        <Action key={emoji} className="reaction-button" disabled={!can(own ? "messages.chat.reactors" : "messages.chat.react")} pressed={own ? undefined : mine}
          run={() => own ? showReactors(emoji) : react(emoji)}>
          <span className="sr-only">{own ? "Zobraziť reakciu" : "Reakcia"}</span>{emoji}<span>{count}</span>
        </Action>)}
      {!own && can("messages.chat.react") && <button type="button" className="reaction-button reaction-trigger" aria-expanded={picker} aria-label="Pridať reakciu"
        onClick={() => setPicker(value => !value)}><SmilePlus size={15} /></button>}
      {!own && picker && <div className="reaction-picker" aria-label="Vybrať reakciu">
        <EmojiPicker.Root locale={activeLanguage === "uk" ? "uk" : activeLanguage === "hu" ? "hu" : "en"}
          emojibaseUrl={new URL("emoji-data/", document.baseURI).href}
          columns={9} onEmojiSelect={({emoji}) => react(emoji)}>
          <EmojiPicker.Search className="reaction-picker-search" placeholder="Hľadať emoji…" autoFocus />
          <EmojiPicker.Viewport className="reaction-picker-viewport">
            <EmojiPicker.Loading>Načítavajú sa emoji…</EmojiPicker.Loading>
            <EmojiPicker.Empty>Emoji sa nenašli.</EmojiPicker.Empty>
            <EmojiPicker.List components={{CategoryHeader: ({category, ...props}) => <div {...props}>{category.label}</div>, Emoji: ({emoji, ...props}) => <button type="button" aria-label={emoji.label} title={emoji.label} {...props}>{emoji.emoji}</button>}} />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>
      </div>}
    </div>}
    {reactors && <Modal title={localizeText("Reakcie", activeLanguage) + " " + reactors.emoji} close={() => setReactors(null)}>
      {reactors.people.length ? <ul className="people-list">{reactors.people.map(person =>
        <li key={person.id}><Avatar name={person.name} id={person.id} version={person.avatar_version} /><strong>{person.name}</strong></li>
      )}</ul> : <p className="muted">Žiadne reakcie.</p>}
    </Modal>}
  </>;
}

function PollComposer({close, send}) {
  const [options, setOptions] = useState(["", ""]);
  return <Modal title="Nová anketa" close={close}>
    <Form label="Odoslať anketu" submit={async ({question}) => {
      const choices = options.map(option => option.trim());
      if (choices.some(option => !option) || new Set(choices.map(option => option.toLowerCase())).size !== choices.length) {
        throw new Error(localizeText("Anketa potrebuje rôzne vyplnené možnosti.", activeLanguage));
      }
      await send({body: question, poll_options: choices});
      close();
    }}>
      <label>Otázka<input name="question" required maxLength={4000} /></label>
      {options.map((option, index) => <div className="poll-editor-option" key={index}>
        <label><span>Možnosť</span> {index + 1}<input value={option} required maxLength={120}
          onChange={event => setOptions(options.map((value, i) => i === index ? event.target.value : value))} /></label>
        {options.length > 2 && <button type="button" className="icon-button" aria-label="Odstrániť možnosť" onClick={() => setOptions(options.filter((_, i) => i !== index))}><X size={16} /></button>}
      </div>)}
      <button type="button" onClick={() => setOptions([...options, ""])}><Plus size={16} />Pridať možnosť</button>
    </Form>
  </Modal>;
}

function Messages({user, conversations, refresh, initialContact}) {
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(initialContact ? {type: "private", id: initialContact} : hash().get("group") ? {type: "group", id: Number(hash().get("group"))} : null);
  const [messages, setMessages] = useState([]);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const can = useRight();
  const [pollOpen, setPollOpen] = useState(false);
  const [newMessage, setNewMessage] = useState(false);
  const [groupEditor, setGroupEditor] = useState(null);
  const [groupInfo, setGroupInfo] = useState(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [error, setError] = useState("");
  const scroller = useRef(null);
  const scrollPending = useRef(true);
  const selectedKey = selected ? selected.type + ":" + selected.id : "";
  const activeKey = useRef(selectedKey);
  activeKey.current = selectedKey;
  useEffect(() => {
    let current = true;
    if (!["messages.chat.direct", "messages.groups.create", "messages.groups.edit"].some(can)) return;
    const load = () => api("contacts").then(rows => {if (current) setContacts(rows);}).catch(error => {if (current) setError(error.message);});
    load();
    const timer = setInterval(() => {if (!document.hidden) load();}, 15000);
    return () => {current = false; clearInterval(timer);};
  }, []);
  const conversationKey = item => item.type === "group" ? "group:" + item.group_id : "private:" + item.contact_id;
  const rows = [...conversations];
  if (selected?.type === "private" && !rows.some(row => conversationKey(row) === selectedKey)) {
    const contact = contacts.find(person => person.id === selected.id);
    if (contact) rows.push({...contact, contact_id: contact.id, id: null, type: "private", unread: 0});
  }
  const activeConversation = rows.find(row => conversationKey(row) === selectedKey);
  const person = selected?.type === "private" ? contacts.find(person => person.id === selected.id) : null;
  const canSend = selected?.type === "group" ? can("messages.chat.send_group") && Boolean(activeConversation) : can("messages.chat.direct") && Boolean(person?.active || activeConversation?.active);
  const latest = activeConversation?.id;
  const messagePath = selection => "messages?" + (selection.type === "group" ? "group_id=" : "contact_id=") + selection.id;
  async function markRead(selection, rows) {
    if (user.preview) return;
    if (selection.type === "group" && rows.length) {
      await api("chat-groups/" + selection.id + "/read", "POST", {last_message_id: rows[0].id});
    } else {
      const unread = rows.filter(row => row.recipient_id === user.id && !row.read_at);
      if (unread.length) await api("messages/read", "POST", unread.map(row => row.id));
    }
  }
  function openConversation(selection) {
    if (selection.type + ":" + selection.id !== selectedKey) {
      setMessages([]); setMore(false); setError("");
    }
    setSelected(selection); setNewMessage(false); setGroupInfo(null); setPollOpen(false);
  }
  useEffect(() => {
    let current = true;
    if (selected) {
      const selection = {...selected};
      scrollPending.current = true;
      api(messagePath(selection)).then(async rows => {
        if (!current) return;
        setMessages(rows);
        setMore(rows.length === 200);
        await markRead(selection, rows);
        if (current) await refresh();
      }).catch(error => {if (current) setError(error.message);});
    }
    return () => {current = false;};
  }, [selectedKey, latest, user.id]);
  useEffect(() => {
    if (!selected) return;
    let current = true;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const rows = await api(messagePath(selected));
        if (!current) return;
        const fresh = new Map(rows.map(row => [row.id, row]));
        setMessages(previous => previous.map(row => fresh.get(row.id) || row));
      } catch (error) {
        if (current) setError(error.message);
      }
    }, 15000);
    return () => {current = false; clearInterval(timer);};
  }, [selectedKey]);

  async function changeInteraction(id, kind, data, method = "PUT") {
    const key = selectedKey;
    const result = await api("messages/" + id + "/" + kind, method, data);
    if (activeKey.current === key) {
      setMessages(rows => rows.map(row => row.id === id ? {...row, ...result} : row));
    }
  }
  async function send(data) {
    const key = selectedKey;
    const destination = selected.type === "group" ? {group_id: selected.id} : {recipient_id: selected.id};
    await api("messages", "POST", {...destination, ...data});
    const rows = await api(messagePath(selected));
    if (activeKey.current === key) {
      scrollPending.current = true;
      setMessages(rows);
      setMore(rows.length === 200);
      await markRead(selected, rows);
    }
    await refresh();
  }
  useEffect(() => {
    if (scroller.current && scrollPending.current) {
      const area = window.matchMedia("(min-width: 1100px)").matches
        ? scroller.current.closest(".messages-page")
        : scroller.current;
      if (area) area.scrollTop = area.scrollHeight;
      scrollPending.current = false;
    }
  }, [messages]);
  return <>
    <PageToolbar><div className={"page-toolbar-row chat-toolbar" + (selected ? " conversation-open" : "")}>
      <label className="search"><Search size={17} /><input type="search" aria-label="Hľadať konverzáciu" placeholder="Hľadať konverzáciu…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="actions page-primary">
        {can("messages.groups.create") && <button className="icon-button" aria-label="Nová skupina" onClick={() => setGroupEditor({})}><Users size={20} /></button>}
        {can("messages.chat.direct") && <button className="primary" onClick={() => {setRecipientQuery(""); setNewMessage(true);}}><Plus size={17} />Nová správa</button>}
      </div>
    </div></PageToolbar>
    <div className={"chat card flush " + (selected ? "conversation-open" : "")}>
    <aside className="conversation-list">
      {error && !selected && <p className="error chat-list-error" role="alert">{error}</p>}
      {rows.filter(row => row.name.toLowerCase().includes(query.toLowerCase())).map(row => {
        const group = row.type === "group";
        const key = conversationKey(row);
        return <button className={"conversation-row " + (selectedKey === key ? "active" : "")} key={key}
          onClick={() => openConversation({type: group ? "group" : "private", id: group ? row.group_id : row.contact_id})}>
          {group ? <span className="avatar group-avatar"><Users size={21} /></span> : <Avatar name={row.name} id={row.contact_id ?? row.id} version={row.avatar_version} />}
          <span className="grow"><strong>{row.name}</strong>{!group && <span className="meta">{clubRoleLabel(row.roles)}</span>}<span className="preview">{row.body ? (group && row.sender ? row.sender + ": " : "") + row.body :
            row.system_key === "coaches" ? "Skupina trénerov" : group ? "Skupinová konverzácia" : "Začať konverzáciu"}</span></span>
          <span className="conversation-meta">{row.created_at && <small>{clock(row.created_at)}</small>}{row.unread > 0 && <span className="counter">{row.unread}</span>}</span>
        </button>;
      })}
      {rows.length === 0 && <Empty icon={MessageCircle}>Začni konverzáciu tlačidlom Nová správa.</Empty>}
    </aside>
    <section className="conversation-pane">
      {selected ? <>
        <div className="chat-head">
          <button className="icon-button chat-back" aria-label="Späť na konverzácie" onClick={() => {setSelected(null); setPollOpen(false); scroller.current?.closest(".messages-page")?.scrollTo({top: 0});}}><ChevronLeft /></button>
          {selected.type === "group" ? <span className="avatar group-avatar"><Users size={19} /></span> : <Avatar name={activeConversation?.name || person?.name || "Kontakt"} id={selected.id} version={person ? person.avatar_version : activeConversation?.avatar_version} />}
          <span className="grow"><strong>{activeConversation?.name || person?.name || "Konverzácia"}</strong>
            {selected.type === "private" && <span className="meta">{clubRoleLabel(activeConversation?.roles || person?.roles)}</span>}
          </span>
          {selected.type === "group" && <Action className="icon-button" run={async () => setGroupInfo(await api("chat-groups/" + selected.id))}>
            <Settings2 size={19} /><span className="sr-only">Účastníci a nastavenia skupiny</span>
          </Action>}
        </div>
        <div className="message-stream" ref={scroller}>
          {error && <p className="error" role="alert">{error}</p>}
          {more && <Action className="text-button" run={async () => {
            const key = selectedKey;
            const page = await api(messagePath(selected) + "&before=" + messages.at(-1).id);
            if (activeKey.current === key) {setMessages([...messages, ...page]); setMore(page.length === 200);}
          }}>Staršie správy</Action>}
          {messages.length ? [...messages].reverse().map(item => <div className={"message " + (item.sender_id === user.id ? "outgoing" : "")} key={item.id}>
            {selected.type === "group" && item.sender_id !== user.id && <div className="message-author">
              <Avatar name={item.sender} id={item.sender_id} version={item.sender_avatar_version} />
              <strong>{[item.sender, clubRoleLabel(item.sender_roles)].filter(Boolean).join(" · ")}</strong>
            </div>}
            {!item.poll_options && <p>{item.body}</p>}
            <MessageInteractions item={item} own={item.sender_id === user.id} change={changeInteraction} />
            <span>{date(item.created_at)}{selected.type === "private" && item.sender_id === user.id && item.read_at && <CheckCheck size={13} />}</span>
          </div>) : <p className="muted small">Tu sa začína vaša konverzácia.</p>}
        </div>
        {canSend ? <div className="composer with-poll">
          {can("messages.poll.create") && <button type="button" className="icon-button" aria-label="Vytvoriť anketu" title="Vytvoriť anketu" onClick={() => setPollOpen(true)}><ClipboardCheck size={20} /></button>}
          <Form key={selectedKey} label={<><Send size={18} /><span className="sr-only">Odoslať správu</span></>} reset submit={data => send({body: data.body})}>
            <label className="sr-only" htmlFor="message-body">Správa</label><textarea id="message-body" name="body" rows="1" maxLength="4000" placeholder="Napíš správu…" required />
          </Form>
        </div> :
          <p className="notice">Do tejto konverzácie už nemožno posielať správy.</p>}
      </> : <Empty icon={MessageCircle}>Vyber konverzáciu alebo vytvor novú správu.</Empty>}
    </section>
    </div>
    {canSend && can("messages.poll.create") && pollOpen && <PollComposer close={() => setPollOpen(false)} send={send} />}
    {newMessage && <Modal title="Nová správa" close={() => setNewMessage(false)}>
      <label className="search"><Search size={18} /><input type="search" aria-label="Hľadať adresáta" value={recipientQuery} placeholder="Hľadať člena alebo trénera…" onChange={event => setRecipientQuery(event.target.value)} /></label>
      {can("messages.groups.create") && <button className="button section-space" onClick={() => {setNewMessage(false); setGroupEditor({});}}><Users size={18} />Vytvoriť skupinu</button>}
      <ul className="people-list recipient-list">{contacts.filter(person => person.name.toLowerCase().includes(recipientQuery.toLowerCase())).map(person =>
        <li key={person.id}><button className="person-link" onClick={() => openConversation({type: "private", id: person.id})}><Avatar name={person.name} id={person.id} version={person.avatar_version} /><span className="grow"><strong>{person.name}</strong><span className="meta">{clubRoleLabel(person.roles)}</span></span><ChevronRight size={18} /></button></li>)}</ul>
      {contacts.length === 0 && <p className="muted section-space">Zatiaľ žiadne dostupné kontakty.</p>}
    </Modal>}
    {groupInfo && <Modal title={groupInfo.name} close={() => setGroupInfo(null)}>
      <p className="muted">{groupInfo.members.length} účastníkov</p>
      {groupInfo.system_key && <p className="small">Účastníci tejto skupiny sa určujú automaticky podľa rolí v klube.</p>}
      <ul className="people-list">{groupInfo.members.map(person => <li key={person.id}><Avatar name={person.name} id={person.id} version={person.avatar_version} /><span className="grow"><strong>{person.name}</strong><span className="meta">{clubRoleLabel(person.roles)}</span></span></li>)}</ul>
      {groupInfo.can_manage && <button className="primary section-space" onClick={() => {setGroupEditor(groupInfo); setGroupInfo(null);}}><Pencil size={17} />Upraviť názov a účastníkov</button>}
    </Modal>}
    {groupEditor && <GroupEditor group={groupEditor.id ? groupEditor : null} contacts={contacts} user={user} close={() => setGroupEditor(null)}
      done={async group_id => {setGroupEditor(null); await refresh(); openConversation({type: "group", id: group_id});}} />}
  </>;
}

function BatteryActionPicker({action,onAction,status}) {
  const can = useRight();
  const [showMore,setShowMore]=useState(false);
  const more=Object.entries(batteryLabels)
    .filter(([key]) => can("equipment.battery." + key))
    .filter(([key])=>key!=="storage_exit"||status==="stored")
    .filter(([key])=>status!=="damaged"||["damaged","retired","note"].includes(key))
    .filter(([key])=>status!=="retired"||key==="note");
  return <div className="battery-actions">
    {["charged","used","discharged"].filter(key=>can("equipment.battery." + key) && status!==({charged:"charged",used:"in_drone",discharged:"discharged"}[key])).map(key=><button type="button" key={key} className={action===key?"selected":""} disabled={["damaged","retired"].includes(status)} onClick={()=>onAction(key)}>{batteryLabels[key]}</button>)}
    {more.length > 0 && <button type="button" aria-expanded={showMore} className="text-button battery-more-link" onClick={()=>setShowMore(value=>!value)}>{showMore?"Skryť":"Viac"}</button>}
    {showMore&&<div className="battery-action-more-list">{more.map(([key,label])=><button type="button" key={key} className={action===key?"selected":""} onClick={()=>onAction(key)}>{label}</button>)}</div>}
  </div>;
}

function shiftBatteryDay(day, offset) {
  const value = new Date(day + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function EquipmentActivityTimeline({items, revision, end, openBattery, openAsset, canEdit, onDelete}) {
  const [result, setResult] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const days = Array.from({length: 7}, (_, index) => shiftBatteryDay(end, index - 6));
  const current = result?.end === end && result.revision === revision ? result : null;
  const dayFormat = day => {
    const value = new Date(day + "T00:00:00Z");
    return String(value.getUTCDate()).padStart(2, "0") + "." + String(value.getUTCMonth() + 1).padStart(2, "0");
  };
  const fullDayFormat = new Intl.DateTimeFormat(uiLocale(), {dateStyle: "full", timeZone: "UTC"});
  const timeFormat = new Intl.DateTimeFormat(uiLocale(), {timeStyle: "short", timeZone});
  const fullDay = day => fullDayFormat.format(new Date(day + "T00:00:00Z"));
  const text = source => localizeText(source, activeLanguage);

  useEffect(() => {
    let active = true;
    Promise.all([
      api("batteries/timeline?" + new URLSearchParams({end})),
      ...items.filter(item => item.kind !== "battery").map(item => api("equipment/assets/" + encodeURIComponent(item.code) + "/events")),
    ]).then(([batteryEvents, ...assetEvents]) => {
      const events = [
        ...batteryEvents.map(event => ({...event, kind: "battery"})),
        ...assetEvents.flat().map(event => ({...event, kind: "asset"})),
      ];
      if (active) setResult({end, revision, events});
    }).catch(error => {
      if (active) setResult({end, revision, error: error.message});
    });
    return () => {active = false;};
  }, [end, revision, items.map(item => item.code).join(",")]);

  const visibleCodes = new Set(items.map(item => item.code));
  const byItem = new Map();
  const actionTypes = new Set();
  for (const event of current?.events ?? []) {
    if (!visibleCodes.has(event.code)) continue;
    const day = clubLocal(event.created_at).slice(0, 10);
    if (!byItem.has(event.code)) byItem.set(event.code, new Map());
    const byDay = byItem.get(event.code);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(event);
    actionTypes.add(event.action);
  }
  const detail = selectedDay && byItem.get(selectedDay.code)?.get(selectedDay.day);
  const eventLabel = action => batteryLabels[action] || equipmentActionLabels[action] || action;
  const itemLabel = item => item.kind === "battery" ? batteryStateLabels[item.status] || "Neznámy stav" : equipmentActionLabels[item.status] || "Bez záznamu";

  return <section className="card battery-overview" aria-labelledby="equipment-timeline-heading">
    <h2 className="sr-only" id="equipment-timeline-heading">Časová os zariadení</h2>
    {!current ? <p className="muted" role="status">Načítava sa…</p> :
      current.error ? <p className="error" role="alert">{current.error}</p> :
      !byItem.size ? <p className="muted">V tomto období nie sú žiadne záznamy pre zobrazené zariadenia.</p> : <>
        <div className="battery-overview-scroll" role="region" aria-labelledby="equipment-timeline-heading" tabIndex={0}>
          <table className="battery-overview-table" aria-labelledby="equipment-timeline-heading">
            <thead><tr><th scope="col">Zariadenie</th>{days.map(day =>
              <th key={day} scope="col"><time dateTime={day}>{dayFormat(day)}</time></th>)}</tr></thead>
            <tbody>{items.filter(item => byItem.has(item.code)).map(item =>
              <tr key={item.code}><th scope="row"><div className="battery-timeline-identity"><span className="battery-timeline-code">{item.code}</span><span className={"badge " + (item.kind === "battery" ? "battery-state-badge" : "equipment-status-badge") + " state-" + (item.status || "unknown")}>{itemLabel(item)}</span></div></th>{days.map(day => {
                const events = byItem.get(item.code).get(day);
                if (!events) return <td key={day}><span className="muted" aria-hidden="true">–</span><span className="sr-only">Bez záznamu</span></td>;
                const counts = events.reduce((totals,event)=>({...totals,[event.action]:(totals[event.action]||0)+1}),{});
                const actions = Object.keys(counts);
                return <td key={day}><button type="button" className="battery-day-button"
                  aria-label={[item.code, fullDay(day), ...actions.map(action => counts[action]+" × "+text(eventLabel(action)))].join(" · ")}
                  onClick={() => setSelectedDay({code: item.code, day})}>
                  <span className="battery-day-action-counts">{actions.map(action => <span key={action}><i className={"battery-event-color action-" + action} />{counts[action]}</span>)}</span>
                </button></td>;
              })}</tr>)}</tbody>
          </table>
        </div>
        <ul className="battery-overview-legend">
          {[...Object.entries(batteryLabels), ...Object.entries(equipmentActionLabels)].filter(([action], index, rows) => actionTypes.has(action) && rows.findIndex(row => row[0] === action) === index).map(([action, label]) =>
            <li key={action}><i className={"battery-event-color action-" + action} aria-hidden="true" /><span>{label}</span></li>)}
        </ul>
      </>}
    {detail && <Modal title={selectedDay.code + " · " + fullDay(selectedDay.day)} close={() => setSelectedDay(null)}>
      <ul className="timeline battery-day-detail">
        {detail.map(event => <li key={event.id}>
          <strong className="battery-event-title"><i className={"battery-event-color action-" + event.action} aria-hidden="true" />{eventLabel(event.action)}</strong>
          <span className="meta">{timeFormat.format(new Date(event.created_at))} · {event.name}</span>
          {event.note && <p className="body small">{event.note}</p>}
          {event.kind === "battery" && canEdit && <button type="button" className="danger battery-delete-event" onClick={async()=>{await onDelete(event); setSelectedDay(null);}}>Odstrániť záznam</button>}
        </li>)}
      </ul>
      <button type="button" onClick={() => {if (detail[0]?.kind === "battery") openBattery(selectedDay.code); else openAsset(selectedDay.code); setSelectedDay(null);}}>Otvoriť detail zariadenia</button>
    </Modal>}
  </section>;
}

function equipmentActionPermission(action) {
  if (action === "assigned") return "equipment.loans.assign";
  if (action === "returned") return "equipment.loans.unassign";
  return "equipment.service." + action;
}

const loanStatus = {pending: "Čaká na prevzatie", accepted: "Zapožičané", returned: "Vrátené", cancelled: "Zrušené", assigned: "Pridelené"};

function EquipmentLoanPanel({asset, refresh}) {
  const user = useContext(PermissionContext);
  const can = useRight();
  const [rows, setRows] = useState([]);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [create, setCreate] = useState(false);
  const mayCreate = can("equipment.loans." + asset.kind);
  const mayRead = ["read", "own", "accept", "return", "cancel"].some(key => can("equipment.loans." + key));

  async function load() {
    if (mayRead) setRows(await api("equipment/assets/" + asset.code + "/loans"));
  }
  useEffect(() => {
    Promise.all([load(), mayCreate ? api("equipment/loan-members").then(setMembers) : null])
      .catch(problem => setError(problem.message));
  }, [asset.code, mayCreate, mayRead]);

  async function decide(id, action) {
    await api("equipment/assets/" + asset.code + "/loans/" + id, "PUT", {action});
    await Promise.all([load(), refresh()]);
  }

  if (!mayRead && !mayCreate) return null;
  return <section className="section-space">
    <h3>Zápožičky</h3>
    {error && <p className="error" role="alert">{error}</p>}
    {mayCreate && !asset.loan_status && !asset.assigned_member_name && asset.status !== "retired" &&
      <button type="button" onClick={() => setCreate(!create)}>Založiť zápožičku</button>}
    {create && <Form label="Založiť zápožičku" submit={async data => {
      await api("equipment/assets/" + asset.code + "/loans", "POST", {
        member_id: Number(data.member_id), due_at: data.due_at ? trainingISO(data.due_at) : null,
      });
      setCreate(false);await Promise.all([load(), refresh()]);
    }}>
      <label>Príjemca<select name="member_id" required defaultValue=""><option value="">Vyber člena</option>
        {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label>Termín vrátenia<input name="due_at" type="datetime-local" /></label>
    </Form>}
    <ul className="records">{rows.map(row => <li key={row.id}>
      <div className="grow"><strong>{loanStatus[row.status]}{row.member_name ? " · " + row.member_name : ""}</strong>
        {row.due_at && <span className="meta">Vrátiť do {date(row.due_at)}</span>}</div>
      <div className="actions">
        {row.status === "pending" && row.member_id === user.id && can("equipment.loans.accept") &&
          <Action className="primary" run={() => decide(row.id, "accept")}>Potvrdiť prevzatie</Action>}
        {row.status === "pending" && can("equipment.loans.cancel") &&
          <Action run={() => decide(row.id, "cancel")}>Zrušiť zápožičku</Action>}
        {row.status === "accepted" && can("equipment.loans.return") &&
          <Action run={() => decide(row.id, "return")}>Zapísať vrátenie</Action>}
      </div>
    </li>)}</ul>
  </section>;
}

function EquipmentLabelEditor({item, battery, refresh}) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="text-button" onClick={() => setOpen(true)}>Upraviť označenie</button>;
  return <Form label="Uložiť označenie" submit={async data => {
    await api((battery ? "batteries/" : "equipment/assets/") + item.code, "PUT", data);
    await refresh();setOpen(false);
  }}><label>Označenie<input name="label" maxLength={120} defaultValue={item.label} required /></label></Form>;
}

function Batteries({initialCode}) {
  const can = useRight();
  const history = can("equipment.assets.history");
  const canDelete = can("equipment.battery.delete");
  const canAssign = can("equipment.loans.assign");
  const currentDay = today();
  const [items, setItems] = useState([]);
  const [assets, setAssets] = useState([]);
  const [selected, setSelected] = useState(initialCode || null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [events, setEvents] = useState([]);
  const [view, setView] = useState("cards");
  const [end, setEnd] = useState(currentDay);
  const [create, setCreate] = useState(false);
  const [kindFilter, setKindFilter] = useState("all");
  const [newKind, setNewKind] = useState("battery");
  const [newCode, setNewCode] = useState("");
  const [assetEvents, setAssetEvents] = useState([]);
  const [assetAction, setAssetAction] = useState("");
  const [assignmentMembers, setAssignmentMembers] = useState([]);
  const [showMoreAssetActions, setShowMoreAssetActions] = useState(false);
  const [action, setAction] = useState(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  async function load() {
    const [batteries,devices,members]=await Promise.all([can("equipment.assets.read") ? api("batteries") : [],can("equipment.assets.read") ? api("equipment/assets") : [],canAssign?api("equipment/loan-members"):Promise.resolve([])]);
    setItems(batteries);setAssets(devices);setAssignmentMembers(members);
    setRevision(value => value + 1);
  }
  useEffect(() => {load().catch(error => setError(error.message));}, []);
  useEffect(() => {
    let current = true;
    setEvents([]);
    if (selected && history) api("batteries/" + encodeURIComponent(selected) + "/events")
      .then(rows => {if (current) setEvents(rows);}).catch(error => {if (current) setError(error.message);});
    return () => {current = false;};
  }, [selected]);
  const battery = items.find(item => item.code === selected);
  const asset = assets.find(item=>item.code===selectedAsset);
  const timelineItems = [
    ...((kindFilter === "all" || kindFilter === "battery") ? items.map(item => ({...item, kind: "battery"})) : []),
    ...assets.filter(item => kindFilter === "all" || item.kind === kindFilter).map(item => ({...item, kind: item.kind})),
  ];
  useEffect(()=>{let active=true;if(selectedAsset&&history)api("equipment/assets/"+encodeURIComponent(selectedAsset)+"/events").then(rows=>{if(active)setAssetEvents(rows);}).catch(error=>{if(active)setError(error.message);});return()=>{active=false;};},[selectedAsset,revision]);
  function openBattery(code, initialAction = null) {setSelected(code); setAction(initialAction);}
  async function deleteEvent(event) {
    if (!window.confirm("Odstrániť tento záznam z histórie batérie?")) return;
    await api("batteries/" + encodeURIComponent(event.code) + "/events/" + event.id, "DELETE");
    setEvents(await api("batteries/" + encodeURIComponent(event.code) + "/events"));
    await load();
  }
  return <>
    <PageToolbar><div className="page-toolbar-row">
      <div className="segmented" role="group" aria-label="Zobrazenie vybavenia">
        <button type="button" aria-pressed={view === "cards"} onClick={()=>setView("cards")}>Karty</button>
        {history && <button type="button" aria-pressed={view === "timeline"} onClick={()=>{if (view !== "timeline") setEnd(currentDay);setView("timeline");}}>Časová os</button>}
      </div>
      <label className="toolbar-select equipment-kind-filter">Zariadenie<select value={kindFilter} onChange={event=>setKindFilter(event.target.value)}>
        <option value="all">Všetky typy</option><option value="battery">Batérie</option><option value="charger">Nabíjačky</option><option value="drone">Drony</option><option value="controller">Ovládače</option>
      </select></label>
      {view === "timeline" && timelineItems.length > 0 && <div className="period-control">
        <button type="button" className="icon-button" aria-label="Predchádzajúcich 7 dní" onClick={() => setEnd(shiftBatteryDay(end, -7))}><ChevronLeft size={18} /></button>
        <span aria-live="polite">{formatShortDate(shiftBatteryDay(end, -6)) + " – " + formatShortDate(end)}</span>
        <button type="button" className="icon-button" aria-label="Nasledujúcich 7 dní" disabled={end >= currentDay} onClick={() => {
          const next = shiftBatteryDay(end, 7);
          setEnd(next > currentDay ? currentDay : next);
        }}><ChevronRight size={18} /></button>
      </div>}
      {can("equipment.assets.create") && <button className="primary page-primary" onClick={() => {setNewKind("battery");setNewCode("");setCreate(true);}}><Plus size={18} />Pridať zariadenie</button>}
    </div></PageToolbar>
    {error && <p className="error" role="alert">{error}</p>}
    {view === "timeline" && timelineItems.length > 0 && <EquipmentActivityTimeline items={timelineItems} revision={revision} end={end}
      openBattery={openBattery} openAsset={code => {setSelectedAsset(code);setAssetAction("");}} canEdit={canDelete} onDelete={deleteEvent} />}
    {view === "cards" && <div className="equipment-grid">{(kindFilter==="all"||kindFilter==="battery"?items:[]).map(b =>
      <article className={"card battery-state-card state-"+(b.status||"unknown")} key={b.code}>
        <div className="battery-card-heading">
        <button className="text-button" aria-haspopup="dialog" onClick={() => openBattery(b.code)}><Battery size={17} />{b.code}</button>
          <span className={"badge battery-state-badge state-"+(b.status||"unknown")}>{batteryStateLabels[b.status] || "Neznámy stav"}</span>
        </div>
        <div className="battery-card-details">
          <span className="battery-card-label muted">{b.label}</span>
          {can("equipment.battery.used") && !["stored", "damaged", "retired"].includes(b.status) && <button className="text-button" aria-haspopup="dialog" onClick={() => openBattery(b.code, "used")}>Zapísať použitie</button>}
        </div>
      </article>)}{assets.filter(item=>kindFilter==="all"||item.kind===kindFilter).map(item=><button type="button" className={"card battery-state-card equipment-asset-card state-"+(item.status||"unknown")} key={item.code} onClick={()=>{setSelectedAsset(item.code);setAssetAction("");setShowMoreAssetActions(false);}}>
        <span className="battery-card-heading"><strong className="equipment-card-title">{item.kind==="drone"?<Drone size={16}/>:item.kind==="controller"?<Gamepad2 size={16}/>:item.kind==="charger"?<Zap size={16}/>:<Boxes size={16}/>} {item.code}</strong><span className="badge">{equipmentKindLabels[item.kind]}</span></span>
        <span className="battery-card-details"><span className="battery-card-label muted">{item.assigned_member_name ? "Pridelené: " + item.assigned_member_name : item.loan_member_name ? loanStatus[item.loan_status] + ": " + item.loan_member_name : item.label}</span><span className={"badge equipment-status-badge state-"+(item.status||"unknown")}>{equipmentActionLabels[item.status]||"Bez záznamu"}</span></span>
      </button>)}</div>}
    {view === "cards" && items.length===0&&assets.filter(item=>kindFilter==="all"||item.kind===kindFilter).length===0 && <Empty icon={Battery}>Pre tento filter zatiaľ nie je zaevidované žiadne zariadenie.</Empty>}
    {selected && <Modal title={battery ? battery.code : "Batéria"} close={() => {setSelected(null); setAction(null);}}>
      {battery ? <>
        {can("equipment.assets.edit") && <EquipmentLabelEditor item={battery} battery refresh={load} />}
        <p className="muted">{battery.label}</p><p><span className={"badge battery-state-badge state-"+(battery.status||"unknown")}>{batteryStateLabels[battery.status] || "Neznámy stav"}</span></p>
        <p className="meta">{battery.status_at ? "Aktuálny stav od " + date(battery.status_at) : "Batéria zatiaľ nemá zaznamenaný aktuálny stav."}</p>
        <p className="meta">{battery.charges} evidovaných nabití</p>
        <BatteryActionPicker action={action} status={battery.status} onAction={setAction}/>
        {action && <Form label={"Zapísať · " + batteryLabels[action]} submit={async data => {
          await api("batteries/" + battery.code + "/events", "POST", {action, note: data.note});
          setEvents(await api("batteries/" + battery.code + "/events")); setAction(null); await load();
        }}><label>{action === "note" ? "Poznámka" : "Poznámka (voliteľná)"}<input name="note" maxLength="1000" required={action === "note"} placeholder={action === "used" ? "Pri akom úkone sa použila?" : ""} /></label></Form>}
        {history && <><h3 className="section-space">História</h3><ul className="timeline">{events.map(event => <li key={event.id}>
          <strong>{batteryLabels[event.action]}</strong><span className="meta">{date(event.created_at)} · {event.name}</span>
          {event.note && <p className="body small">{event.note}</p>}
          {canDelete && <button type="button" className="danger battery-delete-event" onClick={async()=>{await deleteEvent(event);}}>Odstrániť záznam</button>}
        </li>)}</ul></>}
      </> : <p>Batéria sa načítava alebo sa nenašla.</p>}
    </Modal>}
    {selectedAsset&&<Modal title={asset?.code||selectedAsset} close={()=>{setSelectedAsset(null);setAssetAction("");}}>{asset&&<>
      {can("equipment.assets.edit") && <EquipmentLabelEditor item={asset} refresh={load} />}
      <p>{asset.label}</p><p><span className="badge">{equipmentKindLabels[asset.kind]} · {equipmentActionLabels[asset.status]||"Bez záznamu"}</span></p>
      {asset.assigned_member_name&&<p className="member-assignment-current"><Boxes size={16}/>Pridelené používateľovi <strong>{asset.assigned_member_name}</strong></p>}
      {equipmentActions[asset.kind].some(key => can(equipmentActionPermission(key)))&&<>
        <div className="equipment-actions" aria-label="Rýchle úkony">{primaryEquipmentActions[asset.kind].filter(key => can(equipmentActionPermission(key))).map(key=><button key={key} type="button" className={assetAction===key?"primary":""} aria-pressed={assetAction===key} onClick={()=>setAssetAction(assetAction===key?"":key)}>{equipmentActionLabels[key]}</button>)}</div>
        <button type="button" className="battery-more-link text-button" aria-expanded={showMoreAssetActions} onClick={()=>{setShowMoreAssetActions(value=>!value);setAssetAction("");}}>Viac</button>
        {showMoreAssetActions&&<label className="equipment-more-select">Ďalšie úkony<select value={assetAction} onChange={event=>setAssetAction(event.target.value)}><option value="">Vyber úkon</option>{equipmentActions[asset.kind].filter(key=>!primaryEquipmentActions[asset.kind].includes(key) && can(equipmentActionPermission(key))).map(key=><option key={key} value={key}>{equipmentActionLabels[key]}</option>)}</select></label>}
        {assetAction&&<Form key={asset.code+":"+assetAction} label={assetAction==="assigned"?"Priradiť vybavenie":"Zaznamenať úkon"} submit={async data=>{await api("equipment/assets/"+encodeURIComponent(asset.code)+"/events","POST",{action:assetAction,member_id:assetAction==="assigned"?Number(data.member_id):null,note:data.note});setAssetAction("");await load();}}>
          {assetAction==="assigned"&&<label>Prideliť používateľovi<select name="member_id" defaultValue="" required><option value="" disabled>Vyber člena</option>{assignmentMembers.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
          <label>Poznámka<input name="note" maxLength="1000" placeholder="Nepovinná poznámka"/></label>
        </Form>}
      </>}
      <EquipmentLoanPanel key={asset.code} asset={asset} refresh={load} />
      {history && <><h3 className="section-space">História</h3><ul className="timeline">{assetEvents.map(event=><li key={event.id}><strong>{equipmentActionLabels[event.action]}{event.assigned_member_name?" · "+event.assigned_member_name:""}</strong><span className="meta">{date(event.created_at)} · {event.name}</span>{event.note&&<p className="body small">{event.note}</p>}</li>)}</ul></>}
    </>}</Modal>}
    {create && <Modal title="Pridať zariadenie" close={() => setCreate(false)}><label>Typ zariadenia<select value={newKind} onChange={event=>setNewKind(event.target.value)}><option value="battery">Batéria</option><option value="charger">Nabíjačka</option><option value="drone">Dron</option><option value="controller">Ovládač</option></select></label><Form label="Pridať zariadenie" submit={async data => {
      const record={code:data.code.toUpperCase(),label:data.label};
      if(newKind==="battery")await api("batteries","POST",record);
      else await api("equipment/assets","POST",{...record,kind:newKind});
      await load();setCreate(false);if(newKind==="battery")setSelected(record.code);else setSelectedAsset(record.code);
    }}><label>Kód<input name="code" value={newCode} onChange={event=>{const value=event.target.value.toUpperCase();setNewCode(value);const prefix=value.slice(0,4);if(prefix==="LF-B")setNewKind("battery");else if(prefix==="LF-C")setNewKind("controller");else if(prefix==="LF-D")setNewKind("drone");else if(prefix==="LF-X")setNewKind("charger");}} pattern={{battery:"LF-B[0-9]{2,6}",controller:"LF-C[0-9]{2,6}",drone:"LF-D[0-9]{2,6}",charger:"LF-X[0-9]{2,6}"}[newKind]} placeholder={{battery:"LF-B01",controller:"LF-C01",drone:"LF-D01",charger:"LF-X01"}[newKind]} required /></label><label>Označenie<input name="label" maxLength="120" required /></label></Form></Modal>}
  </>;
}

function DrillLibrary() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  async function load() {setItems(await api("drills"));}
  useEffect(() => {load().catch(e => setError(e.message));}, []);
  return <>
    <PageToolbar><div className="page-toolbar-row"><label className="search"><Search size={17} /><input type="search" aria-label="Hľadať cvičenie" placeholder="Hľadať cvičenie…" value={query} onChange={e => setQuery(e.target.value)} /></label></div></PageToolbar>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="drill-grid">{items.filter(item => (item.title + " " + item.objective + " " + item.equipment).toLowerCase().includes(query.toLowerCase())).map(item => <article className="card drill-card" key={item.id}>
      <div className="toolbar"><BookOpen /><strong className="grow">{item.title}</strong><span className="badge">{item.duration_minutes} min</span></div>
      {item.objective && <p>{item.objective}</p>}{item.equipment && <span className="meta">Pomôcky: {item.equipment}</span>}
    </article>)}</div>
    {items.length === 0 && <Empty icon={BookOpen}>Knižnica cvičení je zatiaľ prázdna. Cvičenia pridáš v úpravách plánu tréningu.</Empty>}
  </>;
}

const equipmentKindLabels={controller:"Ovládač",drone:"Dron",charger:"Nabíjačka"};
const equipmentActionLabels={assigned:"Pridelené",returned:"Vrátené",inspection:"Predletová kontrola",training:"Použitie na tréningu",fault:"Porucha",repair:"Oprava",maintenance:"Údržba",propeller_replacement:"Výmena vrtúľ",motor_replacement:"Výmena motorov",battery_check:"Kontrola batérie",retired:"Vyradené",note:"Poznámka"};
const equipmentActions={drone:["assigned","returned","inspection","training","fault","repair","maintenance","propeller_replacement","motor_replacement","retired","note"],controller:["assigned","returned","inspection","training","fault","repair","maintenance","battery_check","retired","note"],charger:["assigned","returned","inspection","fault","repair","maintenance","retired","note"]};
const primaryEquipmentActions={drone:["assigned","returned","inspection"],controller:["assigned","returned","inspection"],charger:["assigned","returned","inspection"]};

function PlayerDevelopmentPage() {
  const can = useRight();
  const user = useContext(PermissionContext);
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [development, setDevelopment] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  async function loadMembers() {
    if (can("development.skills.read")) setMembers(await api("development/players"));
    else if (can("development.skills.own")) setMembers([user]);
  }
  async function open(member) {setSelected(member); setDevelopment(await api("members/" + member.id + "/development"));}
  useEffect(() => {loadMembers().catch(e => setError(e.message));}, []);
  return <>
    <PageToolbar><div className="page-toolbar-row"><label className="search"><Search size={17} /><input type="search" aria-label="Hľadať hráča" placeholder="Hľadať hráča…" value={query} onChange={e => setQuery(e.target.value)} /></label></div></PageToolbar>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="card flush"><ul className="people-list">{members.filter(m => m.name.toLowerCase().includes(query.toLowerCase())).map(member => <li key={member.id}>
      <button className="person-link" onClick={() => open(member)}><Avatar name={member.name} id={member.id} version={member.avatar_version} /><span className="grow"><strong>{member.name}</strong><span className="meta">{clubRoleLabel(member.roles)}</span>{!member.active && <span className="meta">Neaktívny</span>}</span><ChevronRight size={18} /></button>
    </li>)}</ul></div>
    {selected && <Modal title={selected.name} close={() => {setSelected(null); setDevelopment(null);}}>
      {!development ? <p className="muted">Načítava sa…</p> : <>
        {(can("development.skills.private_write") || development.note) && <section className="development-section"><h3>Súkromná poznámka trénerov</h3>{can("development.skills.private_write") ? <Form label="Uložiť poznámku" submit={async ({note}) => {await api("members/" + selected.id + "/development/note", "PUT", {note}); setDevelopment({...development, note});}}><label>Poznámka<textarea name="note" rows="4" maxLength="4000" defaultValue={development.note} /></label></Form> : <p>{development.note}</p>}</section>}
        <section className="development-section section-space"><h3>Zručnosti</h3>{development.skills.length === 0 && <p className="muted">Zručnosti zatiaľ nie sú ohodnotené.</p>}
          {development.skills.map(skill => <div className="skill-row" key={skill.skill}><strong>{skill.skill}</strong><span className="skill-level">{[1,2,3,4].map(level => <button disabled={!can("development.skills.write")} type="button" aria-label={skill.skill + " " + level} className={level <= skill.level ? "filled" : ""} key={level} onClick={async () => {await api("members/" + selected.id + "/development/skills", "PUT", {...skill, level}); setDevelopment(await api("members/" + selected.id + "/development"));}}>●</button>)}</span></div>)}
          {can("development.skills.write") && <Form reset label="Pridať zručnosť" submit={async values => {await api("members/" + selected.id + "/development/skills", "PUT", {...values, level: Number(values.level)}); setDevelopment(await api("members/" + selected.id + "/development"));}}>
            <label>Zručnosť<input name="skill" maxLength="120" required /></label><label>Úroveň<select name="level" defaultValue="1">{["Na začiatku", "Základy", "Rozvíja sa", "Samostatný", "Istý"].map((label, i) => <option key={i} value={i}>{label}</option>)}</select></label><label>Poznámka<input name="note" maxLength="1000" /></label>
          </Form>}
        </section>
        <details className="section-space"><summary>Tréningový feedback ({development.feedback.length})</summary><ul className="records">{development.feedback.map(row => <li key={row.training_id}><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span>{row.went_well && <p>Podarilo sa: {row.went_well}</p>}{row.difficult && <p>Náročné: {row.difficult}</p>}{row.next_focus && <p>Nabudúce: {row.next_focus}</p>}</li>)}</ul></details>
      </>}
    </Modal>}
  </>;
}

const slotLabels = ["Striker 1", "Striker 2", "Defender 1", "Defender 2", "Defender 3"];
function normalizeLineup(rows=[]) {
  const result = [];
  for (const team of ["A", "B"]) {
    const teamRows = rows.filter(item => item.team === team);
    const occupied = new Set();
    for (const item of teamRows) {
      const oldRole = item.position || "";
      if (item.substitute || oldRole === "Substitute") {
        result.push({...item, team, slot: null, substitute: true, position: "Substitute"});
        continue;
      }
      let slot = Number(item.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 5 || occupied.has(slot)) {
        const allowed = ["Striker", "Attacker"].includes(oldRole) ? [1,2] : oldRole ? [3,4,5] : [1,2,3,4,5];
        slot = allowed.find(number => !occupied.has(number)) || [1,2,3,4,5].find(number => !occupied.has(number));
      }
      if (!slot) continue;
      occupied.add(slot);
      result.push({...item, team, slot, substitute: false, position: slot <= 2 ? "Striker" : "Defender"});
    }
  }
  return result;
}

function DroneArena({players, roster}) {
  const starterPoints = {A:[[455,185],[455,315],[350,145],[265,250],[350,355]],B:[[545,185],[545,315],[650,145],[735,250],[650,355]]};
  const plotted = players.filter(player => !player.substitute && player.slot).map(player => {
    const person=roster.find(row=>row.id===player.member_id);
    const [x,y]=starterPoints[player.team][player.slot-1];
    return {player,person,x,y};
  });
  const subsA=players.filter(p=>p.team==="A"&&p.substitute), subsB=players.filter(p=>p.team==="B"&&p.substitute);
  return <section className="card arena-card"><h2>Drone Soccer · Class 20</h2>
    <svg className="drone-arena" viewBox="0 0 1000 500" role="img" aria-label="Schéma uzavretej drone soccer arény Class 20">
      <rect x="8" y="42" width="112" height="416" rx="12" className="pilot-zone team-A-zone" />
      <rect x="880" y="42" width="112" height="416" rx="12" className="pilot-zone team-B-zone" />
      <text x="64" y="68" className="arena-zone-label">PILOTI A</text><text x="936" y="68" className="arena-zone-label">PILOTI B</text>
      <rect x="120" y="42" width="760" height="416" rx="12" className="arena-frame" />
      <rect x="134" y="56" width="372" height="388" className="arena-half arena-half-a" />
      <rect x="506" y="56" width="360" height="388" className="arena-half arena-half-b" />
      <rect x="134" y="56" width="732" height="388" rx="5" className="arena-net" />
      <line x1="500" y1="56" x2="500" y2="444" className="arena-center-line" />
      <circle cx="500" cy="250" r="56" className="arena-center-circle" />
      <circle cx="275" cy="250" r="29" className="goal-ring-outer"/><circle cx="275" cy="250" r="19" className="goal-ring-inner"/>
      <circle cx="725" cy="250" r="29" className="goal-ring-outer"/><circle cx="725" cy="250" r="19" className="goal-ring-inner"/>
      <text x="275" y="300" className="arena-goal-label">BRÁNA A</text><text x="725" y="300" className="arena-goal-label">BRÁNA B</text>
      {plotted.map(({player,person,x,y})=><g className={"arena-player team-"+player.team} key={player.member_id}>
        <circle cx={x} cy={y} r="20"/><text x={x} y={y+5}>{initials(person?.name||"?")}</text>
        {person?.avatar_version && <image className="arena-avatar" x={x-18} y={y-18} width="36" height="36" href={avatarUrl(person.id, person.avatar_version)} />}
      </g>)}
      {[...subsA.slice(0,3).map((p,i)=>({p,x:64,y:128+i*52})),...subsB.slice(0,3).map((p,i)=>({p,x:936,y:128+i*52}))].map(({p,x,y})=>{
        const person=roster.find(row=>row.id===p.member_id);
        return <g className={"arena-player team-"+p.team+" arena-substitute"} key={p.member_id}><circle cx={x} cy={y} r="17"/><text x={x} y={y+5}>{initials(person?.name||"?")}</text>{person?.avatar_version && <image className="arena-avatar" x={x-15} y={y-15} width="30" height="30" href={avatarUrl(person.id, person.avatar_version)} />}</g>;
      })}
      {subsA.length>3&&<text x="64" y="310" className="arena-extra">+{subsA.length-3}</text>}{subsB.length>3&&<text x="936" y="310" className="arena-extra">+{subsB.length-3}</text>}
    </svg>
    <div className="pitch-legend"><span><i className="team-dot team-a-dot"/>Tím A</span><span><i className="team-dot team-b-dot"/>Tím B</span><span className="muted small">Náhradníci sú v pilotnej zóne</span></div>
  </section>;
}

function TeamSlots({team,players,roster,editable,onSlot,onSub,onRemove}) {
  const teamPlayers=players.filter(player=>player.team===team);
  const getMember=id=>roster.find(member=>member.id===id);
  return <section className={"card team-slot-card team-card-"+team}>
    <h2>Tím {team}</h2>
    <div className="starter-slots">{slotLabels.map((label,index)=>{
      const player=teamPlayers.find(item=>!item.substitute&&item.slot===index+1);
      const person=player&&getMember(player.member_id);
      return <div className={"starter-slot "+(player?"occupied":"empty-slot")} key={index}>
        <span className="slot-role">{label}</span>
        {player?<><strong>{person?.name||"Hráč"}</strong>{editable&&<div className="slot-actions"><button className="text-button" onClick={()=>onSlot(team,index+1)}>Zmeniť</button><button className="text-button" aria-label={"Odobrať "+(person?.name||"hráča")} onClick={()=>onRemove(player.member_id)}>Odobrať</button></div>}</>:
          editable?<button className="slot-assign" onClick={()=>onSlot(team,index+1)}>+ Priradiť hráča</button>:<span className="slot-empty-label">Voľné miesto</span>}
      </div>;
    })}</div>
    <div className="substitutes-section"><div className="substitutes-heading"><strong>Náhradníci</strong><span className="badge">{teamPlayers.filter(item=>item.substitute).length}</span></div>
      {teamPlayers.filter(item=>item.substitute).map(player=><div className="substitute-row" key={player.member_id}><span>{getMember(player.member_id)?.name||"Hráč"}</span>{editable&&<button className="text-button" onClick={()=>onRemove(player.member_id)}>Odobrať</button>}</div>)}
      {editable&&<button className="add-substitute" onClick={()=>onSub(team)}>+ Pridať náhradníka</button>}
    </div>
  </section>;
}

function LineupDisplay({players,roster,editable=false,onChange}) {
  const [assigning,setAssigning]=useState(null);
  const assigned=new Set(players.map(player=>player.member_id));
  function setSlot(team,slot,member) {
    const next=players.filter(player=>player.member_id!==member.id&&!(player.team===team&&!player.substitute&&player.slot===slot));
    next.push({member_id:member.id,team,slot,position:slot<=2?"Striker":"Defender",substitute:false});
    onChange(next);setAssigning(null);
  }
  function setSub(team,member) {
    const next=players.filter(player=>player.member_id!==member.id);
    next.push({member_id:member.id,team,slot:null,position:"Substitute",substitute:true});
    onChange(next);setAssigning(null);
  }
  function remove(id){onChange(players.filter(player=>player.member_id!==id));}
  const available=roster.filter(member=>!assigned.has(member.id));
  return <>
    <div className="lineup-dashboard">
      <div className="lineup-team-stack">
        {['A','B'].map(team=><TeamSlots key={team} team={team} players={players} roster={roster} editable={editable}
          onSlot={(selectedTeam,slot)=>setAssigning({team:selectedTeam,slot})} onSub={selectedTeam=>setAssigning({team:selectedTeam,substitute:true})} onRemove={remove}/>) }
      </div>
      <div className="lineup-field-stack"><DroneArena players={players} roster={roster}/>
        <section className="card unassigned-card"><h3>Nezaradení hráči <span className="badge">{available.length}</span></h3>
          {available.length?<ul className="unassigned-list">{available.map(member=><li key={member.id}><Avatar name={member.name} id={member.id} version={member.avatar_version}/><span>{member.name}</span></li>)}</ul>:<p className="muted small">Všetci členovia sú zaradení alebo sú náhradníkmi.</p>}
        </section>
      </div>
    </div>
    {assigning&&<Modal title={assigning.substitute?"Pridať náhradníka · Tím "+assigning.team:"Priradiť hráča · Tím "+assigning.team+" · "+slotLabels[assigning.slot-1]} close={()=>setAssigning(null)}>
      <p className="muted small">Hráč, ktorý už je v zostave, sa presunie na nové miesto.</p>
      <ul className="people-list assignment-list">{roster.map(member=>{
        const current=players.find(player=>player.member_id===member.id);
        const status=current?(current.substitute?"Náhradník · tím "+current.team:"Tím "+current.team+" · "+slotLabels[current.slot-1]):"Nezaradený";
        return <li key={member.id}><button className="person-link" onClick={()=>assigning.substitute?setSub(assigning.team,member):setSlot(assigning.team,assigning.slot,member)}>
          <Avatar name={member.name} id={member.id} version={member.avatar_version}/><span className="grow"><strong>{member.name}</strong><span className="meta">{clubRoleLabel(member.roles)}</span><span className="meta">{status}</span></span><ChevronRight size={18}/></button></li>;
      })}</ul>
    </Modal>}
  </>;
}

function TeamSheet({trainings}) {
  const can = useRight();
  const events = trainings.filter(event => !event.cancelled && (event.kind === "match" || event.kind === "training")).sort((a,b) => new Date(b.starts_at)-new Date(a.starts_at));
  const [eventId, setEventId] = useState(() => can("team.lineup.club_read") ? "general" : "");
  const [roster, setRoster] = useState([]);
  const [players, setPlayers] = useState([]);
  const [source, setSource] = useState("general");
  const [error, setError] = useState("");
  const [nomination, setNomination] = useState(null);
  useEffect(() => {
    if (!eventId) return;
    let active = true;
    api(eventId === "general" ? "lineup/general" : "trainings/" + eventId + "/lineup").then(data => {if (active) {setRoster(data.roster); setPlayers(normalizeLineup(data.players)); setSource(data.source); setNomination(data);}}).catch(e => {if (active) setError(e.message);});
    return () => {active = false;};
  }, [eventId]);
  const event = events.find(item => String(item.id) === eventId);
  return <>
    <PageToolbar><div className="page-toolbar-row"><label className="toolbar-select">Zostava<select value={eventId} onChange={e => {setEventId(e.target.value); setError("");}}><option value="">Vyber zostavu</option>{can("team.lineup.club_read") && <option value="general">Základná zostava tímu</option>}{can("team.lineup.event_read") && events.map(item => <option key={item.id} value={item.id}>{date(item.starts_at)} · {item.title}</option>)}</select></label></div></PageToolbar>
    {error && <p className="error" role="alert">{error}</p>}
    {eventId === "general" && <div className="notice">Základná zostava priebežne vyjadruje, s kým tréner počíta a na akej pozícii.</div>}
    {event && source === "general" && <div className="notice">Pre túto udalosť zatiaľ nie je uložená samostatná zostava; zobrazuje sa základná zostava tímu.</div>}
    {(event || eventId === "general") && <><div className="section-heading"><h2>{event?.title || "Základná zostava tímu"}</h2>{event && <span className="meta">{date(event.starts_at)}</span>}</div>
      {event && upcoming(event) && nomination?.nominated && can("team.lineup.respond") && <div className="actions">
        {[true, false].map(accepted => <Action key={String(accepted)} pressed={nomination.my_response === accepted}
          run={async () => {
            await api("trainings/" + event.id + "/lineup/response", "PUT", {accepted});
            setNomination(row => ({...row, my_response: accepted}));
          }}>{accepted ? "Potvrdiť nomináciu" : "Odmietnuť nomináciu"}</Action>)}
      </div>}
      {event && nomination?.responses?.length > 0 && <details>
        <summary>Odpovede na nomináciu</summary><ul>{nomination.responses.map((row, index) =>
          <li key={index}>{row.name} · {row.accepted ? "Potvrdil" : "Odmietol"}</li>)}</ul>
      </details>}
      {players.length ? <LineupDisplay players={players} roster={roster} /> : <Empty icon={Users}>{eventId === "general" ? "Základná zostava ešte nie je pripravená." : "Tréner zatiaľ nepripravil zostavu na túto udalosť."}</Empty>}
    </>}
    {!event && eventId !== "general" && events.length === 0 && <Empty icon={Users}>Zatiaľ nie sú naplánované tréningy ani zápasy.</Empty>}
  </>;
}

function LineupPlanner({trainings}) {
  const can = useRight();
  const events = trainings.filter(event => event.kind === "match" || event.kind === "training").sort((a,b) => new Date(b.starts_at)-new Date(a.starts_at));
  const [eventId, setEventId] = useState(() => can("team.lineup.club_read") ? "general" : "");
  const [roster, setRoster] = useState([]);
  const [players, setPlayers] = useState([]);
  const [source, setSource] = useState("general");
  const [error, setError] = useState("");
  const [published, setPublished] = useState(false);
  function chooseEventMode() {
    if (eventId !== "general") return;
    const next = events.find(event => new Date(event.starts_at) >= new Date()) || events[0];
    setEventId(next ? String(next.id) : "");
  }
  useEffect(() => {
    if (!eventId) return;
    let active = true;
    api(eventId === "general" ? "lineup/general" : "trainings/" + eventId + "/lineup").then(data => {if (active) {setRoster(data.roster); setPlayers(normalizeLineup(data.players)); setSource(data.source);setPublished(data.published);}}).catch(e => {if (active) setError(e.message);});
    return () => {active = false;};
  }, [eventId]);
  const editable = can(eventId === "general" ? "team.lineup.club_edit" : "team.lineup.event_edit");
  const event = events.find(item=>String(item.id)===eventId);
  return <>
    <PageToolbar><div className="page-toolbar-row">
      <div className="segmented lineup-mode-switch">
        <button type="button" disabled={!can("team.lineup.club_read")} className={eventId === "general" ? "selected" : ""} aria-pressed={eventId === "general"} onClick={() => {setEventId("general");setError("");}}>Základná zostava tímu</button>
        <button type="button" disabled={!can("team.lineup.event_read")} className={eventId !== "general" ? "selected" : ""} aria-pressed={eventId !== "general"} onClick={chooseEventMode}>Zostava na udalosť</button>
      </div>
      {eventId !== "general" && <label className="toolbar-select">Udalosť<select value={eventId} onChange={e => {setEventId(e.target.value); setError("");}}><option value="">Vyber tréning alebo zápas</option>{events.map(event => <option key={event.id} value={event.id}>{date(event.starts_at)} · {event.title}</option>)}</select></label>}
      {eventId && editable && <div className="page-primary"><Action className="primary" run={async () => {
        await api(eventId === "general" ? "lineup/general" : "trainings/" + eventId + "/lineup", "PUT", {players});
        setSource(eventId === "general" ? "general" : "event");
        setPublished(false);
      }}>Uložiť zostavu</Action></div>}
      {event && source === "event" && can("team.lineup.publish") && <Action run={async () => {
        const result = await api("trainings/" + event.id + "/lineup/publication", "PUT", {published: !published});
        setPublished(result.published);
      }}>{published ? "Skryť nomináciu" : "Zverejniť nomináciu"}</Action>}
    </div></PageToolbar>
    {error && <p className="error" role="alert">{error}</p>}
    {eventId !== "general" && source === "general" && <div className="notice">Upravuješ zostavu na konkrétnu udalosť. Začínaš zo základnej zostavy; zmeny sa uložia iba pre túto udalosť.</div>}
    {eventId && <>
      <div className="lineup-context"><strong>{event?.title || "Základná zostava tímu"}</strong>{event&&<span className="meta">{date(event.starts_at)}</span>}</div>
      <LineupDisplay players={players} roster={roster} editable={editable} onChange={setPlayers}/>
    </>}
  </>;
}

function TeamWorkspace() {
  const can = useRight();
  const staff = can("team.lineup.club_edit") || can("team.lineup.event_edit") || can("team.lineup.publish");
  const [trainings, setTrainings] = useState([]);
  const [error, setError] = useState("");
  const mayViewEvents = can("team.lineup.event_read");
  useEffect(() => {
    if (mayViewEvents) api("lineup/events").then(setTrainings).catch(problem => setError(problem.message));
  }, [mayViewEvents]);
  const [section,setSection]=useState("overview");
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {staff&&<div className="team-workspace-tabs segmented" role="tablist" aria-label="Prehľad tímu a zostavy">
      <button type="button" role="tab" aria-selected={section==="overview"} onClick={()=>setSection("overview")}>Prehľad tímov</button>
      <button type="button" role="tab" aria-selected={section==="lineups"} onClick={()=>setSection("lineups")}>Zostavy</button>
    </div>}
    {section==="lineups"&&staff?<LineupPlanner trainings={trainings}/>:<TeamSheet trainings={trainings}/>}
  </>;
}

function Documents() {
  const can = useRight();
  const [items, setItems] = useState([]);
  const [create, setCreate] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [acknowledgements, setAcknowledgements] = useState(null);
  async function load() {if (can("documents.files.list")) setItems(await api("documents"));}
  useEffect(() => {load().catch(error => setError(error.message));}, []);
  return <>
    {can("documents.files.upload") && <PageToolbar><div className="page-toolbar-row"><button className="primary page-primary" onClick={() => {setFile(null); setCreate(true);}}><Plus size={18} />Dokument</button></div></PageToolbar>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="card flush"><ul className="people-list">{items.map(item => <li key={item.id}><FileText /><div className="grow"><strong>{item.title}</strong><span className="meta">PDF · {date(item.created_at)}</span></div>
      {can("documents.files.download") && <a className="icon-button" href={new URL("api/documents/" + item.id + "/download", base)} aria-label={"Stiahnuť " + item.title}><Download size={19} /></a>}
      <div className="actions">
        {item.requires_acknowledgement && can("documents.files.acknowledge") && (item.acknowledged
          ? <span className="badge positive">Potvrdené</span>
          : <Action run={async () => {await api("documents/" + item.id + "/acknowledgement", "POST");await load();}}>Potvrdiť oboznámenie</Action>)}
        {can("documents.files.ack_config") && <Action run={async () => {
          await api("documents/" + item.id + "/acknowledgement-settings", "PUT", {required: !item.requires_acknowledgement});
          await load();
        }}>{item.requires_acknowledgement ? "Vypnúť potvrdenia" : "Vyžiadať potvrdenie"}</Action>}
        {can("documents.files.ack_list") && <Action run={async () => {
          const rows = await api("documents/" + item.id + "/acknowledgements");
          setAcknowledgements({title: item.title, rows});
        }}>Zobraziť potvrdenia</Action>}
      </div>
      {can("documents.files.delete") && <Action className="icon-button danger" run={async () => {
        if (!window.confirm(localizeText("Odstrániť dokument „", activeLanguage) + item.title + "“?")) return;
        await api("documents/" + item.id, "DELETE"); await load();
      }}><X size={18} /><span className="sr-only">Odstrániť {item.title}</span></Action>}
    </li>)}</ul>{items.length === 0 && <Empty icon={FileText}>Klubové dokumenty sa zobrazia tu.</Empty>}</div>
    {acknowledgements && <Modal title={acknowledgements.title} close={() => setAcknowledgements(null)}>
      <h3>Potvrdenia oboznámenia</h3>
      {acknowledgements.rows.length === 0 && <p>Zatiaľ nikto nepotvrdil oboznámenie.</p>}
      <ul className="records">{acknowledgements.rows.map(row => <li key={row.id}>
        <strong className="grow">{row.name}</strong><span>{date(row.created_at)}</span>
      </li>)}</ul>
    </Modal>}
    {create && <Modal title="Pridať dokument" close={() => setCreate(false)}><Form label="Nahrať dokument" submit={async data => {
      if (!file || file.size > 5 * 1024 * 1024) throw new Error("Vyber PDF s veľkosťou najviac 5 MB.");
      const title = [...new TextEncoder().encode(data.title)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const response = await fetch(new URL("api/documents", base), {method: "POST", headers: {"Content-Type": "application/pdf", "X-Document-Title": title}, body: file});
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Nahrávanie sa nepodarilo.");
      setCreate(false); await load();
    }}><label>Názov<input name="title" maxLength="120" required /></label>
      <label>PDF dokument (najviac 5 MB)<input type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files[0])} required /></label>
    </Form></Modal>}
  </>;
}

function InstallPanel({installation, install}) {
  if (installation.installed) return <section className="card">
    <p className="meta"><CheckCheck size={18} />Aplikácia je nainštalovaná.</p>
  </section>;
  return <section className="card install-card"><span className="quick-icon"><Download size={23} /></span>
    <div className="grow"><h2>DroneSoccer LF na tvojej ploche</h2><p className="muted small">Otváraj klub priamo cez ikonu aplikácie.</p>
      <button className="primary" disabled={installation.busy} onClick={install}><Download size={17} />
        {installation.busy ? "Otvára sa…" : installation.available ? "Nainštalovať aplikáciu" : "Ako nainštalovať"}
      </button></div>
  </section>;
}

function MemberQr({member,close}) {
  const can = useRight();
  const own=member.self;
  const path=own ? "me/card" : "members/"+member.id+"/card";
  const [card,setCard]=useState(null),[error,setError]=useState("");
  const [version,setVersion]=useState(0);
  useEffect(()=>{let current=true;api(path).then(value=>{if(current)setCard(value);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[path,version]);
  return <Modal title={own ? "Môj členský QR" : "Členský QR"} close={close}>
    {error && <p className="error" role="alert">{error}</p>}
    {card ? <div className="member-qr"><span className="badge">DroneSoccer LF</span><h2>{card.name}</h2>
      <img src={new URL("api/"+path+".svg?v="+version,base).href} alt={"Členský QR kód: "+card.name} />
      <p>Ukáž tento kód trénerovi na zápis dochádzky.</p>
      {navigator.clipboard && <Action run={()=>navigator.clipboard.writeText(card.payload)}>Kopírovať členský kód</Action>}
      {!own && can("members.card.reset") && <div className="section-space"><Action className="danger" run={async()=>{
        if(!window.confirm(localizeText("Obnoviť členský QR? Starý kód okamžite prestane platiť. Člen si nový zobrazí vo svojej appke.", activeLanguage))) return;
        setCard(await api(path+"/reset","POST"));setVersion(value=>value+1);
      }}>Obnoviť QR kód</Action></div>}
    </div> : !error && <Empty>Načítava sa QR kód…</Empty>}
  </Modal>;
}

function ClubScanner({user,initialEvent,refresh}) {
  const can = useRight();
  const staff = can("scanner.codes.events");
  const mayRecord = can("attendance.records.scan");
  const [loanMembers, setLoanMembers] = useState([]);
  useEffect(() => {
    if (can("equipment.loans.assign")) api("equipment/loan-members").then(setLoanMembers).catch(() => {});
  }, [user.permissions]);
  const [running,setRunning]=useState(true),[busy,setBusy]=useState(false);
  const [manual,setManual]=useState("");
  const [error,setError]=useState("");
  const [result,setResult]=useState(null);
  const [day,setDay]=useState(()=>initialEvent ? dayKey(initialEvent.starts_at) : today());
  const [events,setEvents]=useState([]),[eventId,setEventId]=useState(initialEvent?.id || null);
  const [eventsLoading,setEventsLoading]=useState(staff);
  const [recent,setRecent]=useState([]);
  const [saved,setSaved]=useState("");
  const [toast,setToast]=useState("");
  const [pendingMember,setPendingMember]=useState(null);
  const [newPrivateEvent,setNewPrivateEvent]=useState(false);
  const [action,setAction]=useState("used");
  const [requestId,setRequestId]=useState(null);
  const [selectedBatteries,setSelectedBatteries]=useState([]),[batchRequestId,setBatchRequestId]=useState(null);
  const locked=useRef(false),mounted=useRef(true);
  const selectedEvent=events.find(event=>event.id===eventId);
  useEffect(()=>()=>{mounted.current=false;},[]);
  useEffect(()=>{
    if(!staff)return;
    let current=true;
    setEventsLoading(true);setEvents([]);setEventId(initialEvent?.id || null);
    api("scan/events"+(day?"?day="+encodeURIComponent(day):"")).then(rows=>{
      if(!current)return;
      setEvents(rows);
      const currentEvents=rows.filter(event=>event.is_current&&event.can_record);
      setEventId(previous=>initialEvent&&rows.some(event=>event.id===initialEvent.id&&event.can_record)?initialEvent.id:
        rows.some(event=>event.id===previous&&event.can_record)?previous:currentEvents.length===1?currentEvents[0].id:null);
    }).catch(e=>{if(current){setEventId(null);setError(e.message);}}).finally(()=>{if(current)setEventsLoading(false);});
    return()=>{current=false;};
  },[staff,day,initialEvent?.id]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(""),2200);return()=>clearTimeout(timer);},[toast]);
  async function decode(raw){
    if(locked.current)return;
    locked.current=true;setRunning(false);setBusy(true);setResult(null);setError("");setSaved("");
    try{
      const response=await api("scan","POST",{value:raw,event_id:mayRecord&&selectedEvent?.can_record?eventId:null});
      if(!mounted.current)return;
      if(response.type==="member"){
        if(response.recorded){
          setPendingMember(null);
          setRecent(previous=>[{id:response.id,name:response.name,event:response.event_title},...previous].slice(0,12));
          const prefix=response.already_present?"Dochádzka už bola zapísaná: ":"Zapísaná dochádzka: ";
          setToast(localizeText(prefix,activeLanguage)+response.name+" · "+response.event_title);
          await refresh();setRunning(true);
        }else setPendingMember(response);
      }else if(response.type==="charger"){
        setResult(response);setSelectedBatteries(response.batteries.filter(b=>!['damaged','retired','stored'].includes(b.status)).map(b=>b.code));setBatchRequestId(crypto.randomUUID());
      }else if(response.type==="equipment"){
        setResult(response);setAction(response.kind==="drone"?"training":"assigned");
      }else{
        setResult(response);setAction(response.status==="retired"?"note":response.status==="damaged"?"damaged":response.status==="stored"?"storage_exit":response.status==="charged"?"used":response.status==="in_drone"?"discharged":"used");setRequestId(crypto.randomUUID());
      }
    }catch(e){if(mounted.current){setResult(null);setError(e.message);}}
    finally{if(mounted.current)setBusy(false);locked.current=false;}
  }
  return <>
    {!running && <PageToolbar><div className="page-toolbar-row">
      <button className="primary page-primary" disabled={busy} onClick={()=>{locked.current=false;setError("");setRunning(true);}}><ScanLine size={18}/>Otvoriť kameru</button>
    </div></PageToolbar>}
    <section className="card scanner-page-card">
      {running && <Modal title="Skenovať kódy" close={()=>setRunning(false)}>
        <div className="scan-camera-stage"><CameraScanner running={running} onDecode={decode} onError={message=>{setRunning(false);setError(message);}} /></div>
        <button className="primary scan-stop-modal" onClick={()=>setRunning(false)}>Zastaviť skener</button>
      </Modal>}
      <details className="scan-manual"><summary>Zadať kód ručne alebo cez USB skener</summary>
        <Form label={busy?"Spracúva sa…":"Spracovať kód"} submit={async()=>{if(busy)return;locked.current=false;await decode(manual);}}>
          <label className="section-space">Kód<input value={manual} onChange={event=>setManual(event.target.value)} placeholder="LF-B001" maxLength="2048" autoComplete="off" autoCapitalize="none" spellCheck="false" required disabled={busy}/></label>
        </Form>
      </details>
      {error&&<p className="error" role="alert">{error}</p>}
      {busy&&<p className="muted" role="status">Spracúva sa kód…</p>}
    </section>
    {toast&&<div className="scan-success-toast" role="status"><Check size={16}/>{toast}</div>}
    {pendingMember&&<Modal title={pendingMember.name} close={()=>setPendingMember(null)}>
      <p>Vyber udalosť pre zápis dochádzky alebo vytvor novú udalosť.</p>
      <label>Deň udalosti<input type="date" lang="sk-SK" value={day} onChange={event=>{setEventId(null);setDay(event.target.value);}} /></label>
      {eventsLoading&&<p className="muted">Načítavajú sa udalosti…</p>}
      {!eventsLoading&&events.filter(event=>mayRecord&&event.can_record).map(event=><button className="card scan-event-option" key={event.id} onClick={async()=>{
        try{const response=await api("scan","POST",{value:pendingMember.payload,event_id:event.id});setPendingMember(null);if(response.recorded){const prefix=response.already_present?"Dochádzka už bola zapísaná: ":"Zapísaná dochádzka: ";setToast(localizeText(prefix,activeLanguage)+response.name+" · "+response.event_title);await refresh();}}
        catch(e){setError(e.message);setPendingMember(null);}
      }}>{date(event.starts_at)} · {event.title}</button>)}
      {!eventsLoading&&!events.some(event=>event.can_record)&&<p className="muted">Na tento deň nie je dostupná udalosť na zápis dochádzky.</p>}
      {can("scanner.codes.create") && mayRecord && <button className="primary section-space" onClick={()=>setNewPrivateEvent(true)}><Plus size={18}/>Vytvoriť novú udalosť</button>}
      {newPrivateEvent&&<Form label="Vytvoriť udalosť a zapísať prítomnosť" submit={async data=>{
        const starts_at=trainingISO(data.starts_at),ends_at=data.ends_at?trainingISO(data.ends_at):null;
        if(ends_at&&ends_at<=starts_at)throw new Error("Koniec musí nasledovať po začiatku.");
        const created=await api("scan/private-events","POST",{title:data.title||"Neplánovaný tréning",starts_at,ends_at,location:data.location});
        const response=await api("scan","POST",{value:pendingMember.payload,event_id:created.id});setNewPrivateEvent(false);setPendingMember(null);
        setToast(localizeText("Zapísaná dochádzka: ",activeLanguage)+response.name+" · "+response.event_title);await refresh();
      }}><label>Názov<input name="title" defaultValue="Neplánovaný tréning" maxLength="120" required/></label>
        <label>Začiatok<input name="starts_at" lang="sk-SK" type="datetime-local" defaultValue={clubLocal(new Date())} required/></label>
        <label>Koniec<input name="ends_at" lang="sk-SK" type="datetime-local"/></label><label>Miesto<input name="location" maxLength="120" defaultValue="Hala" required/></label></Form>}
    </Modal>}
    {result?.type==="charger"&&<section className="card scan-result">
      <Battery size={26}/><h2>Nabíjačka {result.code}</h2>
      {saved?<p className="success" role="status">{saved}</p>:can("equipment.battery.batch")&&<Form label={localizeText("Zaznamenať nabitie",activeLanguage)+" ("+selectedBatteries.length+")"} submit={async()=>{
        const response=await api("battery-charges","POST",{charger_code:result.code,codes:selectedBatteries,request_id:batchRequestId});
        setSaved(localizeText("Nabitie zapísané pre ",activeLanguage)+response.count+" "+localizeText("batérií.",activeLanguage));await refresh();
      }}>
        <div className="charger-battery-list"><label className="checkbox"><input type="checkbox" checked={selectedBatteries.length===result.batteries.filter(b=>!['damaged','retired','stored'].includes(b.status)).length&&selectedBatteries.length>0} onChange={event=>setSelectedBatteries(event.target.checked?result.batteries.filter(b=>!['damaged','retired','stored'].includes(b.status)).map(b=>b.code):[])}/>Vybrať všetky vhodné batérie</label>
          {result.batteries.map(b=>{const disabled=['damaged','retired','stored'].includes(b.status);return <label className="checkbox charger-battery-row" key={b.code}>
            <input type="checkbox" checked={selectedBatteries.includes(b.code)} disabled={disabled} onChange={event=>setSelectedBatteries(current=>event.target.checked?[...current,b.code]:current.filter(code=>code!==b.code))}/>
            <span><strong>{b.code}</strong><span className="meta">{b.label}</span></span><span className={"badge battery-state-badge state-"+(b.status||"unknown")}>{batteryStateLabels[b.status]||"Neznámy stav"}</span>
          </label>;})}
        </div>
        {selectedBatteries.length===0&&<p className="error">Vyber aspoň jednu batériu.</p>}
        <button className="primary" disabled={selectedBatteries.length===0}>Zaznamenať nabitie</button>
      </Form>}
      {result.asset && <EquipmentLoanPanel key={result.code} asset={result.asset}
        refresh={async () => {setResult(await api("scan","POST",{value:result.code}));await refresh();}}/>}
      <button className="section-space" onClick={()=>{setResult(null);setSaved("");locked.current=false;setRunning(true);}}>Skenovať ďalší kód</button>
    </section>}
    {result?.type==="equipment"&&<section className="card scan-result">
      <Drone size={26}/><h2>{result.code}</h2>
      {!result.exists?<><p>Zariadenie ešte nie je evidované.</p>{can("equipment.assets.create")?<Form label="Pridať zariadenie" submit={async data=>{
        await api("equipment/assets","POST",{code:result.code,kind:result.kind,label:data.label});const updated=await api("scan","POST",{value:result.code});setResult(updated);setAction(result.kind==="drone"?"inspection":"assigned");await refresh();
      }}><label>Typ<input value={equipmentKindLabels[result.kind]} readOnly /></label><label>Označenie<input name="label" defaultValue={result.code} maxLength="120" required/></label></Form>:<p>Požiadaj trénera o zaevidovanie.</p>}</>:<>
        <p>{result.label}</p>{result.status&&<p><span className="badge">{equipmentActionLabels[result.status]}</span></p>}{result.status_at&&<p className="meta">Zaznamenané {date(result.status_at)}</p>}
        {!saved&&equipmentActions[result.kind].some(key => can(equipmentActionPermission(key)))&&<Form label="Zaznamenať úkon" submit={async data=>{await api("equipment/assets/"+encodeURIComponent(result.code)+"/events","POST",{action,note:data.note,member_id:action==="assigned"?Number(data.member_id):null});const updated=await api("scan","POST",{value:result.code});setResult(updated);setSaved("Záznam bol uložený.");await refresh();}}>
          <label>Úkon<select value={can(equipmentActionPermission(action)) ? action : ""} required onChange={event=>setAction(event.target.value)}><option value="" disabled>Vyber úkon</option>{equipmentActions[result.kind].filter(key => can(equipmentActionPermission(key))).map(key=><option key={key} value={key}>{equipmentActionLabels[key]}</option>)}</select></label>
          {action === "assigned" && can("equipment.loans.assign") && <label>Člen<select name="member_id" required defaultValue=""><option value="">Vyber člena</option>{loanMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
          <label>Poznámka<input name="note" maxLength="1000" placeholder="Nepovinná poznámka"/></label>
        </Form>}{saved&&<p className="success" role="status">{saved}</p>}
      </>}
      {result.exists && <EquipmentLoanPanel key={result.code} asset={result} refresh={async () => {setResult(await api("scan","POST",{value:result.code}));await refresh();}}/>}
      <button className="section-space" onClick={()=>{setResult(null);setSaved("");locked.current=false;setRunning(true);}}>Skenovať ďalší kód</button>
    </section>}
    {result?.type==="battery"&&<section className="card scan-result">
      <Battery size={26}/><h2>{result.code}</h2>
      {!result.exists?<><p>Batéria ešte nie je evidovaná.</p><Form label="Pridať batériu" submit={async data=>{
        setBusy(true);try{try{await api("batteries","POST",{code:result.code,label:data.label});}catch(e){if(e.status!==409)throw e;}
          const updated=await api("scan","POST",{value:result.code});setResult(updated);setSaved("");setAction("used");await refresh();
        }finally{setBusy(false);}
      }}><label>Označenie batérie<input name="label" defaultValue={result.code} maxLength="120" required/></label></Form></>:<>
        <p>{result.label}</p><p><span className={"badge battery-state-badge state-"+(result.status||"unknown")}>{batteryStateLabels[result.status]||"Neznámy stav"}</span></p>
        {result.status_at&&<p className="meta">Stav od {date(result.status_at)}</p>}
        {result.status==="damaged"&&<p className="notice">Túto batériu nepoužívaj.</p>}
        {!saved&&Object.keys(batteryLabels).some(key => can("equipment.battery." + key))&&<Form label="Uložiť záznam" submit={async data=>{
          if (!can("equipment.battery." + action)) throw new Error("Vyber úkon.");
          setBusy(true);try{await api("batteries/"+result.code+"/events","POST",{action,note:data.note,request_id:requestId});
            const updated=await api("scan","POST",{value:result.code});setSaved("Záznam bol uložený.");setResult(updated);await refresh();
          }finally{setBusy(false);}
        }}>
          <p className="small muted">Úkon</p><BatteryActionPicker action={action} status={result.status} onAction={value=>{setAction(value);setRequestId(crypto.randomUUID());}}/>
          <label>{action==="note"?"Poznámka":"Poznámka (voliteľná)"}<input name="note" maxLength="1000" required={action==="note"} placeholder={action==="used"?"Pri akom úkone sa použila?":""}/></label>
        </Form>}
      </>}
      {saved&&<p className="success" role="status">{saved}</p>}
      <button className="section-space" onClick={()=>{setResult(null);setSaved("");locked.current=false;setRunning(true);}}>Skenovať ďalší kód</button>
    </section>}
    {recent.length>0&&<section className="card"><h2>Posledné zápisy v tomto skenovaní</h2><ul className="records">{recent.map((person,index)=><li key={index}><Check size={17}/><span><strong>{person.name}</strong><span className="meta">{person.event}</span></span></li>)}</ul></section>}
  </>;
}

const supportsPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
async function disablePush() {
  if(!supportsPush()) return;
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription();
  if(subscription){
    await api("push/subscriptions","DELETE",{endpoint:subscription.endpoint});
    await subscription.unsubscribe();
  }
  for(const notification of await registration.getNotifications()) notification.close();
}

function PushSettings({user,reloadUser}) {
  const [enabled,setEnabled]=useState(false);
  const [state,setState]=useState("Načítava sa…");
  const [saved,setSaved]=useState("");
  const supported=supportsPush();
  async function check(){
    if(!supported){setState("Tento prehliadač zatiaľ neponúka push. Na iPhone otvor aplikáciu pridanú na plochu (iOS 16.4 alebo novší).");return;}
    const registration=await navigator.serviceWorker.ready;
    const subscription=await registration.pushManager.getSubscription();
    setEnabled(Boolean(subscription) && Notification.permission==="granted");
    setState(Notification.permission==="denied" ? "Upozornenia sú zablokované. Povoľ ich v nastaveniach prehliadača alebo zariadenia." : subscription ? "Toto zariadenie je prihlásené na push upozornenia." : "Push upozornenia na tomto zariadení nie sú zapnuté.");
  }
  useEffect(()=>{check().catch(()=>setState("Nepodarilo sa zistiť stav upozornení."));},[]);
  return <section className="card push-settings"><h2>Upozornenia</h2>
    <p className="muted">Vyber, na čo chceš dostávať push upozornenia. Výber platí na všetkých tvojich zariadeniach.</p>
    <Form key={[user.push_messages,user.push_calendar,user.push_announcements].join(":")} label="Uložiť výber upozornení" submit={async data=>{
      await api("me/notification-preferences","PUT",{push_messages:data.messages==="on",push_calendar:data.calendar==="on",push_announcements:data.announcements==="on"});
      await reloadUser();setSaved("Výber upozornení bol uložený.");
    }}>
      <label className="checkbox"><input type="checkbox" name="messages" defaultChecked={user.push_messages!==false} />Správy – súkromné aj skupinové</label>
      <label className="checkbox"><input type="checkbox" name="calendar" defaultChecked={user.push_calendar!==false} />Kalendár – nové udalosti, zmeny a zrušenia</label>
      <label className="checkbox"><input type="checkbox" name="announcements" defaultChecked={user.push_announcements!==false} />Oznamy – manuálne zverejnené oznamy</label>
    </Form>
    {saved && <p className="success" role="status">{saved}</p>}
    <p className="small">Oznamy a správy zostanú v aplikácii dostupné aj pri vypnutom push.</p>
    <h3>Toto zariadenie</h3><p className="muted" role="status">{state}</p>
    {supported && <div className="actions"><Action run={async()=>{
      if(Notification.permission==="denied") throw new Error("Povoľ upozornenia v nastaveniach prehliadača alebo zariadenia.");
      const permission=await Notification.requestPermission();
      if(permission!=="granted"){await check();return;}
      const registration=await navigator.serviceWorker.ready;
      const config=await api("push/config");
      const text=config.public_key.replace(/-/g,"+").replace(/_/g,"/");
      const key=Uint8Array.from(atob(text+"=".repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
      const subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      await api("push/subscriptions","POST",subscription.toJSON());await check();
    }}>{enabled ? "Obnoviť prihlásenie zariadenia" : "Zapnúť push na tomto zariadení"}</Action>
    {enabled && <Action run={async()=>{await disablePush();await check();}}>Vypnúť push na tomto zariadení</Action>}</div>}
  </section>;
}

function RoleApplications({user}) {
  const can = useRight();
  const [catalog,setCatalog]=useState([]),[requests,setRequests]=useState([]),[confirmRole,setConfirmRole]=useState(null),[saved,setSaved]=useState(""),[error,setError]=useState("");
  useEffect(()=>{Promise.all([api("role-catalog"),can("profile.requests.own") ? api("me/role-requests") : []]).then(([c,r])=>{setCatalog(c);setRequests(r);}).catch(e=>setError(e.message));},[]);
  const names=Object.fromEntries((user.roles||[]).map(key=>[key,true]));
  const pending=new Set(requests.filter(x=>x.status==="pending").map(x=>x.role_key));
  async function submit(role){await api("me/role-requests","POST",{roles:[role.key]});setConfirmRole(null);setSaved("Žiadosť bola odoslaná vedeniu klubu.");if (can("profile.requests.own")) setRequests(await api("me/role-requests"));}
  return <section className="card role-application-panel"><h2>Ďalšie klubové roly</h2>
    {error&&<p className="error" role="alert">{error}</p>}{saved&&<p className="success" role="status">{saved}</p>}
    {catalog.filter(role=>role.available).map(role=>{const owned=names[role.key],waiting=pending.has(role.key);return <details className="role-application-option" key={role.key}>
      <summary><strong>{role.name}</strong>{(owned||waiting)&&<span className="badge">{owned?"Už pridelená":"Čaká na schválenie"}</span>}</summary>
      <p>{role.description}</p>
      <div className="role-capabilities">{(role.capabilities||[]).map(feature=><span className="role-capability" key={feature.name}><span>{feature.name}</span><span className={"badge "+(feature.available?"positive":"planned-role")}>{feature.available?"Dostupné":"Zatiaľ nedostupné"}</span></span>)}</div>
      {can("profile.requests.create") && <Action className="primary section-space" disabled={owned||waiting} run={()=>setConfirmRole(role)}>{owned?"Už pridelená":waiting?"Čaká na schválenie":"Požiadať o rolu"}</Action>}
    </details>})}
    {requests.filter(row=>row.status!=="pending").length>0&&<details className="section-space"><summary>Predchádzajúce žiadosti</summary><ul className="records">{requests.filter(row=>row.status!=="pending").map(row=><li key={row.id}><strong>{row.name}</strong><span className="badge">{row.status==="approved"?"Schválená":"Zamietnutá"}</span></li>)}</ul></details>}
    {confirmRole&&<Modal title="Odoslať žiadosť o rolu?" close={()=>setConfirmRole(null)}><p>Žiadosť o rolu „{confirmRole.name}“ bude poslaná vedeniu klubu na posúdenie.</p><div className="actions"><Action className="primary" run={()=>submit(confirmRole)}>Potvrdiť a odoslať</Action><button onClick={()=>setConfirmRole(null)}>Zrušiť</button></div></Modal>}
  </section>;
}

function Profile({user, reloadUser, installation, install, saveInstallPreferences, openCard, languagePreference, onLanguageChange}) {
  const [attendance, setAttendance] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {if (hasRight(user,"attendance.records.own")) api("me/attendance").then(setAttendance).catch(error => setError(error.message));}, []);
  const attended = attendance.filter(row => row.attended).length;
  return <>
    <PageToolbar><div className="page-toolbar-row">
      {hasRight(user,"profile.card.own") && <button onClick={openCard}><QrCode size={18} />Môj členský QR kód</button>}
      <div className="actions page-primary">
        {user.role !== "superadmin" && <button onClick={() => setEdit("password")}>Zmeniť heslo</button>}
        <button className="primary" onClick={() => setEdit("profile")}><Pencil size={16} />Upraviť profil</button>
      </div>
    </div></PageToolbar>
    <section className="card profile-card">
      <button type="button" className="profile-avatar-edit" aria-label={user.avatar_version ? "Zmeniť profilovú fotku" : "Nahrať profilovú fotku"}
        aria-haspopup="dialog" onClick={() => setEdit("avatar")}>
        <Avatar name={user.name} id={user.id} version={user.avatar_version} />
        <span className="profile-avatar-edit-icon" aria-hidden="true"><Pencil size={13} /></span>
      </button>
      <h2>{user.name}</h2><p className="muted">{user.email || "admin"}</p><span className="badge">{user.role === "superadmin" ? "Administrátor" : clubRoleLabel(user.roles)}</span>
    </section>
    {saved && <p className="success" role="status">{saved}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <section className="card language-settings"><h2>Jazyk aplikácie</h2>
      <label>Jazyk aplikácie<select value={languagePreference} onChange={event=>onLanguageChange(event.target.value)}>
        <option value="system">Podľa jazyka systému</option>
        <option value="sk">Slovenčina</option>
        <option value="en">English</option>
        <option value="uk">Українська</option>
      </select></label>
      <p className="small muted">Zmena sa uloží iba v tomto zariadení.</p>
    </section>
    {(user.roles||[]).includes("player") && <section className="card"><h2>Moja dochádzka</h2>
      {attendance.length ? <><p className="big-number">{attended}<span> / {attendance.length}</span></p><p className="muted">navštívených udalostí so zaznamenanou dochádzkou</p>
        <ul className="records">{attendance.map(row => <li key={row.id}><div className="grow"><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span></div><span className="badge">{row.attended ? "Prítomný" : "Neprítomný"}</span></li>)}</ul></> : <p className="muted">Tréner zatiaľ nezapísal dochádzku.</p>}
    </section>}
    {user.role!=="superadmin" && (hasRight(user, "profile.requests.own") || hasRight(user, "profile.requests.create")) && <RoleApplications user={user}/>}
    {user.role!=="superadmin" && <PushSettings user={user} reloadUser={reloadUser} />}
    <section className="card install-settings"><h2>Nastavenia inštalácie</h2>
      <Form key={String(user.pwa_show_card) + ":" + user.pwa_show_popup} label="Uložiť nastavenia" submit={async data => {
        await saveInstallPreferences({pwa_show_card: data.card === "on", pwa_show_popup: data.popup === "on"});
        setSaved("Nastavenia inštalácie boli uložené.");
      }}>
        <label className="checkbox"><input type="checkbox" name="card" defaultChecked={user.pwa_show_card !== false} />Zobrazovať kartu na domovskej stránke</label>
        <label className="checkbox"><input type="checkbox" name="popup" defaultChecked={user.pwa_show_popup !== false} />Ponúkať inštaláciu po prihlásení</label>
      </Form>
    </section>
    <InstallPanel installation={installation} install={install} />
    <section className="card">
      <h2>O aplikácii</h2>
      <a className="profile-about-link" href="https://github.com/szokezoltan95/lf-ds-hub/blob/main/docs/index.md"
        target="_blank" rel="noopener noreferrer">Dokumentácia na GitHube <ArrowUpRight size={16} aria-hidden="true" /></a>
    </section>
    {edit === "avatar" && <Modal title="Profilová fotka" close={() => setEdit(null)}>
      <Form label="Nahrať fotku" submit={async ({photo}) => {
        if (photo.size > 5 * 1024 * 1024) throw new Error(localizeText("Fotka môže mať najviac 5 MB.", activeLanguage));
        const response = await fetch(new URL("api/me/avatar", base), {method:"PUT", body:photo});
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(localizeText(payload.detail || "Fotku sa nepodarilo nahrať.", activeLanguage));
        }
        await reloadUser();
        setSaved("Profilová fotka bola uložená.");
        setEdit(null);
      }}><label>Vybrať fotku<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required /></label></Form>
      {user.avatar_version && <Action className="text-button danger" run={async () => {
        await api("me/avatar", "DELETE");
        await reloadUser();
        setSaved("Profilová fotka bola odstránená.");
        setEdit(null);
      }}>Odstrániť fotku</Action>}
    </Modal>}
    {edit && edit !== "avatar" && <Modal title={edit === "profile" ? "Upraviť profil" : "Zmeniť heslo"} close={() => setEdit(null)}>
      <Form label="Uložiť" submit={async data => {
        await api(edit === "profile" ? "me" : "me/password", "PUT", data);
        if (edit === "profile") await reloadUser();
        setSaved(edit === "profile" ? "Profil bol uložený." : "Heslo bolo zmenené."); setEdit(null);
      }}>
        {edit === "profile" ? <label>Meno<input name="name" maxLength="120" defaultValue={user.name} required /></label> : <>
          <label>Aktuálne heslo<input name="current_password" type="password" autoComplete="current-password" maxLength="128" required /></label>
          <label>Nové heslo<input name="password" type="password" autoComplete="new-password" minLength="8" maxLength="128" required /></label></>}
      </Form>
    </Modal>}
  </>;
}
const navigation = [
  ["home", "Domov", House], ["calendar", "Kalendár", CalendarDays], ["attendance", "Dochádzka", ClipboardCheck],
  ["messages", "Správy", MessageCircle], ["announcements", "Oznamy", Megaphone],
  ["members", "Členovia", Users], ["team", "Tímy a zostavy", Users], ["development", "Rozvoj hráčov", Users], ["drills", "Knižnica cvičení", BookOpen], ["equipment", "Vybavenie", Boxes],
  ["documents", "Dokumenty", FileText],
];

const dashboardThemes = [
  ["blue", "Modrá"], ["sky", "Nebeská"], ["mint", "Mätová"], ["coral", "Koralová"],
];
const dashboardWidgetInfo = {
  event: [CalendarDays, "Najbližšia udalosť"], schedule: [CalendarDays, "Nadchádzajúci program"],
  rsvp: [Check, "Moje potvrdenia"], attendance: [Heart, "Moja dochádzka"],
  followup: [ClipboardCheck, "Dochádzka na doplnenie"], team_attendance: [ClipboardCheck, "Účasť tímu"],
  rsvp_summary: [Users, "Potvrdenia účasti"], announcements: [Megaphone, "Aktuálne oznámenie"],
  messages: [MessageCircle, "Neprečítané správy"], role_requests: [Users, "Žiadosti o roly"],
  battery_status: [Battery, "Stav batérií"], battery_activity: [Battery, "Nedávne použitie batérií"],
  member_invites: [Users, "Pozvánky a noví členovia"], quick_links: [ArrowUpRight, "Rýchly prístup"],
};
const dashboardLinkInfo = {
  calendar: [CalendarDays, "Kalendár"], attendance: [ClipboardCheck, "Dochádzka"], messages: [MessageCircle, "Správy"],
  announcements: [Megaphone, "Oznamy"], members: [Users, "Členovia"], team: [Users, "Tímy a zostavy"],
  development: [Users, "Rozvoj hráčov"], lineups: [ClipboardCheck, "Tímy a zostavy"], drills: [BookOpen, "Knižnica cvičení"],
  equipment: [Boxes, "Vybavenie"], documents: [FileText, "Dokumenty"], scanner: [ScanLine, "Skenovať"],
  member_qr: [QrCode, "Môj členský QR kód"],
};
function Home({user, trainings, announcements, conversations, refresh, navigate, openTraining, openScanner, openCard, plan, roleRequestCount, unreadNotices}) {
  const can = useRight();
  const staff = can("calendar.rsvp.summary");
  const canRespond = can("calendar.rsvp.respond") || can("calendar.rsvp.reconfirm");
  const has = page => user.menu_access?.includes(page);
  const next = trainings.filter(upcoming);
  const unread = conversations.reduce((sum, row) => sum + row.unread, 0);
  const attendanceWaiting = trainings.find(t => !t.cancelled && past(t) && t.counts?.attendance_pending > 0);
  const revised = next.find(t => mayRespond(user,t) && t.schedule_revision > 0 && !t.change_response);
  const unanswered = canRespond ? next.filter(t => mayRespond(user,t) && (!t.response || (t.schedule_revision > 0 && !t.change_response))) : [];
  const notice = announcements.find(item => item.pinned) || announcements[0];
  const unreadNotice = announcements.find(item => !item.is_read);
  const availableWidgets = [
    ...(can("calendar.events.read") ? ["event", "schedule"] : []),
    ...(canRespond ? ["rsvp"] : []), ...(can("attendance.records.own") ? ["attendance"] : []),
    ...(can("attendance.records.read") ? ["followup", "team_attendance"] : []),
    ...(can("calendar.rsvp.summary") ? ["rsvp_summary"] : []),
    ...(can("announcements.notices.read") ? ["announcements"] : []),
    ...(can("messages.chat.read") ? ["messages"] : []),
    ...(user.menu_access?.includes("members") && user.roles?.some(role => ["club_leader", "deputy_leader"].includes(role)) ? ["role_requests"] : []),
    ...(can("equipment.assets.read") ? ["battery_status"] : []), ...(can("equipment.assets.history") ? ["battery_activity"] : []),
    ...(can("members.accounts.read") && can("members.accounts.invite") ? ["member_invites"] : []),
    ...(user.menu_access?.some(key => key !== "home") ? ["quick_links"] : []),
  ];
  const defaults = staff
    ? [["event","both"],["followup","both"],["announcements","both"],["battery_status","both"],["quick_links","both"],["rsvp_summary","desktop"],["team_attendance","desktop"],["messages","desktop"],["battery_activity","desktop"],["member_invites","desktop"],["role_requests","desktop"]]
    : [["event","both"],["rsvp","both"],["announcements","both"],["quick_links","both"],["battery_status","mobile"],["messages","desktop"],["attendance","desktop"]];
  const saved = user.dashboard_preferences || {};
  const rawWidgets = Array.isArray(saved.widgets) ? saved.widgets : defaults.map(([id,display]) => ({id,display}));
  const widgets = rawWidgets.map(item => typeof item === "string" ? {id:item,display:defaults.find(([id])=>id===item)?.[1]||"both"} : item)
    .filter((item,index,list) => item && availableWidgets.includes(item.id) && list.findIndex(other => (typeof other === "string" ? other : other.id) === item.id) === index);
  const theme = saved.theme || "blue";
  const columns = [1,2,3,4].includes(saved.columns) ? saved.columns : 2;
  const homeColor = theme.startsWith("#") ? theme : ({blue:"#41b6e6",sky:"#7fc8ed",mint:"#83cbb4",coral:"#e8a28c"}[theme] || "#41b6e6");
  const defaultLinks = ["calendar",...(has("messages")? ["messages"]:[]),...(has("announcements")?["announcements"]:[]),...(canRespond?["member_qr"]:[]),...(has("scanner")?["scanner"]:[])];
  const availableLinks = Object.keys(dashboardLinkInfo).filter(key => key === "member_qr" ? can("profile.card.own") : has(key));
  const quickLinks = (Array.isArray(saved.quick_links) ? saved.quick_links : defaultLinks).filter(key => availableLinks.includes(key));
  const [editOpen, setEditOpen] = useState(false), [draftWidgets, setDraftWidgets] = useState(widgets), [draftLinks, setDraftLinks] = useState(quickLinks), [draftTheme, setDraftTheme] = useState(theme), [draftColumns, setDraftColumns] = useState(columns);
  const [dashboardData, setDashboardData] = useState({attendance:[],batteries:[],batteryActivity:[],members:[],teamAttendance:null});
  const [dataLoaded, setDataLoaded] = useState({});
  const [saveError, setSaveError] = useState(""), [saving, setSaving] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 780px)").matches);
  useEffect(() => {const query=window.matchMedia("(min-width: 780px)"),change=event=>setIsDesktop(event.matches);query.addEventListener("change",change);return()=>query.removeEventListener("change",change);},[]);
  const visibleWidgetIds=widgets.filter(item=>item.display==="both"||(isDesktop?item.display==="desktop":item.display==="mobile")).map(item=>item.id);
  useEffect(() => {
    let current = true;
    const tasks = [];
    if (visibleWidgetIds.includes("attendance") && !dataLoaded.attendance) tasks.push(["attendance",()=>api("me/attendance")]);
    if (visibleWidgetIds.includes("battery_status") && !dataLoaded.batteries) tasks.push(["batteries",()=>api("batteries")]);
    if (visibleWidgetIds.includes("battery_activity") && !dataLoaded.batteryActivity) tasks.push(["batteryActivity",()=>api("batteries/timeline?end="+today())]);
    if (visibleWidgetIds.includes("member_invites") && !dataLoaded.members) tasks.push(["members",()=>api("members")]);
    if (visibleWidgetIds.includes("team_attendance") && !dataLoaded.teamAttendance) {
      const end=today(), startDate=new Date(end+"T12:00:00Z");startDate.setUTCDate(startDate.getUTCDate()-29);
      const start=startDate.toISOString().slice(0,10);
      tasks.push(["teamAttendance",()=>api("attendance?date_from="+start+"&date_to="+end)]);
    }
    if (tasks.length) Promise.all(tasks.map(async ([key,load])=>[key,await load().catch(()=>null)])).then(results=>{
      if(!current)return;
      setDashboardData(previous=>({...previous,...Object.fromEntries(results.filter(([,value])=>value!==null))}));
      setDataLoaded(previous=>({...previous,...Object.fromEntries(results.map(([key])=>[key,true]))}));
    });
    return () => {current = false;};
  }, [visibleWidgetIds.join(","), JSON.stringify(dataLoaded)]);
  function openEditor() {setDraftWidgets(widgets); setDraftLinks(quickLinks); setDraftTheme(theme); setDraftColumns(columns); setSaveError(""); setEditOpen(true);}
  async function saveDashboard() {
    setSaving(true); setSaveError("");
    try {
      const preferences = await api("me/dashboard-preferences", "PUT", {widgets: draftWidgets, quick_links: draftLinks, theme: draftTheme, columns: draftColumns});
      user.dashboard_preferences = preferences;
      setEditOpen(false);
    } catch (error) {setSaveError(error.message);}
    finally {setSaving(false);}
  }
  const pageLinks={calendar:()=>navigate("calendar"),attendance:()=>navigate("attendance"),messages:()=>navigate("messages"),announcements:()=>navigate("announcements"),members:()=>navigate("members"),team:()=>navigate("team"),development:()=>navigate("development"),lineups:()=>navigate("team"),drills:()=>navigate("drills"),equipment:()=>navigate("equipment"),documents:()=>navigate("documents"),scanner:openScanner,member_qr:openCard};
  const homeAlerts=[];
  if(revised) homeAlerts.push({tone:"urgent",text:"Zmenila sa udalosť: "+revised.title,action:()=>openTraining(revised.id)});
  else if(unanswered.length) homeAlerts.push({tone:"attention",text:"Čaká sa na tvoju odpoveď: "+unanswered[0].title,action:()=>openTraining(unanswered[0].id)});
  if(attendanceWaiting) homeAlerts.push({tone:"attention",text:"Treba doplniť dochádzku: "+attendanceWaiting.title,action:()=>openTraining(attendanceWaiting.id)});
  if(unreadNotice && unreadNotices) homeAlerts.push({tone:unreadNotice.pinned?"attention":"info",text:"Nový oznam: "+unreadNotice.title,action:()=>navigate("announcements")});
  if(unread) homeAlerts.push({tone:"info",text:unread+" neprečítaných správ",action:()=>navigate("messages")});
  if(roleRequestCount) homeAlerts.push({tone:"attention",text:roleRequestCount+" čakajúcich žiadostí o roly",action:()=>navigate("members")});
  if(!homeAlerts.length && next[0]) homeAlerts.push({tone:"event",text:"Najbližšie: "+next[0].title+" · "+date(next[0].starts_at),action:()=>openTraining(next[0].id)});
  if(!homeAlerts.length) homeAlerts.push({tone:"success",text:"Zatiaľ nemáš žiadne naliehavé upozornenia.",action:null});
  const makeAction=(label,run,Icon=ArrowUpRight)=> <button className="dashboard-widget-action" onClick={run}>{label}<Icon size={15}/></button>;
  function renderWidget(key) {
    if (key === "event") {
      const event = next[0];
      return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><CalendarDays size={18}/><h3>Najbližšia udalosť</h3></div>
        {event ? <TrainingCard training={event} staff={staff} canRespond={mayRespond(user, event)} refresh={refresh} open={() => openTraining(event.id)} prominent /> : <p className="muted">Zatiaľ nie je naplánovaná žiadna udalosť.</p>}
        <div className="dashboard-widget-actions">{makeAction("Otvoriť kalendár",()=>navigate("calendar"))}{maySchedule(user)&&makeAction("Naplánovať udalosť",plan,Plus)}</div>
      </article>;
    }
    if (key === "schedule") return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><CalendarDays size={18}/><h3>Nadchádzajúci program</h3></div>
      {next.length ? <div className="dashboard-mini-list">{next.slice(0,3).map(event=><button key={event.id} onClick={()=>openTraining(event.id)}><span className="dashboard-date-chip">{formatShortDate(event.starts_at)}</span><span><strong>{event.title}</strong><small>{clock(event.starts_at)} · {event.location}</small></span><ChevronRight size={16}/></button>)}</div>:<p className="muted">Zatiaľ nie sú naplánované žiadne udalosti.</p>}
      {makeAction("Otvoriť kalendár",()=>navigate("calendar"))}
    </article>;
    if (key === "rsvp") return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><Check size={18}/><h3>Moje potvrdenia</h3></div>
      {unanswered.length ? <div className="dashboard-mini-list">{unanswered.slice(0,3).map(event=><button key={event.id} onClick={()=>openTraining(event.id)}><span className={"dashboard-status-dot "+(event.schedule_revision?"warning":"")}/><span><strong>{event.schedule_revision&&!event.change_response?"Potvrdiť zmenu":"Odpovedať"}</strong><small>{event.title} · {date(event.starts_at)}</small></span><ChevronRight size={16}/></button>)}</div>:<p className="muted">Na všetky nadchádzajúce udalosti máš odpoveď.</p>}
      {makeAction("Otvoriť kalendár",()=>navigate("calendar"))}
    </article>;
    if (key === "attendance") {
      const attendance=dashboardData.attendance, attended = attendance.filter(row => row.attended).length, rate=attendance.length?Math.round(attended/attendance.length*100):0;
      return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><Heart size={18}/><h3>Moja dochádzka</h3></div>
        {attendance.length ? <><p className="dashboard-number">{rate}<span>%</span></p><p className="dashboard-subtext">{attended} prítomností z {attendance.length} zapísaných udalostí</p></>:<p className="muted">{dataLoaded.attendance?"Zatiaľ nie je zapísaná dochádzka.":"Načítavam dochádzku…"}</p>}
        {makeAction("Zobraziť dochádzku",()=>navigate("profile"))}
      </article>;
    }
    if (key === "followup") return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><ClipboardCheck size={18}/><h3>Dochádzka na doplnenie</h3></div>
      {attendanceWaiting ? <button className="dashboard-inline-action" onClick={() => openTraining(attendanceWaiting.id)}><span className="dashboard-number small">{attendanceWaiting.counts.attendance_pending}</span><span>{attendanceWaiting.title}<small>{date(attendanceWaiting.starts_at)}</small></span><ChevronRight size={17}/></button> : <p className="muted">Všetka doterajšia dochádzka je zapísaná.</p>}
      {makeAction("Otvoriť tabuľku dochádzky",()=>navigate("attendance"),ClipboardCheck)}
    </article>;
    if (key === "team_attendance") {
      const result=dashboardData.teamAttendance, present=(result?.attendance||[]).filter(row=>row.attended).length, recorded=(result?.attendance||[]).length, rate=recorded?Math.round(present/recorded*100):0;
      return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><ClipboardCheck size={18}/><h3>Účasť tímu</h3></div>
        {result ? <><p className="dashboard-number">{rate}<span>%</span></p><p className="dashboard-subtext">účasť v evidovaných záznamoch za posledných 30 dní</p><p className="dashboard-subtext">{present} prítomností z {recorded} zapísaných záznamov</p></>:<p className="muted">{dataLoaded.teamAttendance?"Za posledných 30 dní nie sú záznamy.":"Načítavam prehľad…"}</p>}
        {makeAction("Otvoriť tabuľku dochádzky",()=>navigate("attendance"),ClipboardCheck)}</article>;
    }
    if (key === "rsvp_summary") {
      const event=next[0], counts=event?.counts||{};
      return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><Users size={18}/><h3>Potvrdenia účasti</h3></div>
        {event ? <><strong>{event.title}</strong><div className="dashboard-counts"><span><i className="dot yes"/>{counts.yes||0} prídu</span><span><i className="dot pending"/>{counts.maybe||0} nevedia</span><span><i className="dot no"/>{counts.no||0} neprídu</span><span><i className="dot pending"/>{event.schedule_revision?(counts.change_pending||0): (counts.unanswered||0)} bez odpovede</span></div></>:<p className="muted">Nie je naplánovaná ďalšia udalosť.</p>}
        {event&&makeAction("Otvoriť účastníkov",()=>openTraining(event.id),Users)}</article>;
    }
    if (key === "announcements") return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><Megaphone size={18}/><h3>Aktuálne oznámenie</h3></div>
      {notice ? <button className="dashboard-notice" onClick={() => navigate("announcements")}><strong>{notice.title}</strong><span>{notice.body}</span><small>{notice.pinned ? "Pripnuté oznámenie" : "Otvoriť oznamy"} <ArrowUpRight size={14}/></small></button> : <p className="muted">Momentálne nie sú zverejnené žiadne oznamy.</p>}
    </article>;
    if (key === "messages") return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><MessageCircle size={18}/><h3>Správy</h3></div>
      <button className="dashboard-inline-action" onClick={() => navigate("messages")}><span className="dashboard-number small">{unread}</span><span>{unread === 1 ? "neprečítaná správa" : "neprečítaných správ"}<small>{unread ? "Otvoriť doručenú poštu" : "Všetky správy máš prečítané"}</small></span><ChevronRight size={17}/></button>{makeAction("Otvoriť správy",()=>navigate("messages"),MessageCircle)}
    </article>;
    if (key === "role_requests") return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><Users size={18}/><h3>Žiadosti o roly</h3></div>
      <button className="dashboard-inline-action" onClick={() => navigate("members")}><span className="dashboard-number small">{roleRequestCount}</span><span>{roleRequestCount === 1 ? "čakajúca žiadosť" : "čakajúcich žiadostí"}<small>Prejsť na členov</small></span><ChevronRight size={17}/></button>
    </article>;
    if (key === "battery_status") {
      const batteries=dashboardData.batteries, counts={charged:0,discharged:0,damaged:0,stored:0,unknown:0};
      batteries.forEach(item=>{const state=item.status||"unknown";counts[state]=(counts[state]||0)+1;});
      return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><Battery size={18}/><h3>Stav batérií</h3></div>
        {batteries.length ? <><p className="dashboard-number">{counts.charged}<span> / {batteries.length}</span></p><p className="dashboard-subtext">nabitých batérií</p><div className="dashboard-counts"><span><i className="battery-state-dot charged"/>{counts.discharged} vybitých</span><span><i className="battery-state-dot damaged"/>{counts.damaged} poškodených</span><span><i className="battery-state-dot stored"/>{counts.stored} uskladnených</span></div></>:<p className="muted">{dataLoaded.batteries?"Zatiaľ nie sú evidované batérie.":"Načítavam stav batérií…"}</p>}
        {makeAction("Otvoriť vybavenie",()=>navigate("equipment"),Battery)}</article>;
    }
    if (key === "battery_activity") {
      const events=dashboardData.batteryActivity.slice(0,3);
      return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><Battery size={18}/><h3>Nedávne použitie batérií</h3></div>
        {events.length?<div className="dashboard-mini-list">{events.map(item=><div className="dashboard-mini-row" key={item.id}><span className={"battery-state-dot action-"+item.action}/><span><strong>{item.code} · {batteryLabels[item.action]||item.action}</strong><small>{item.name} · {date(item.created_at)}</small></span></div>)}</div>:<p className="muted">{dataLoaded.batteryActivity?"Za posledných 7 dní nie sú záznamy.":"Načítavam záznamy…"}</p>}
        {makeAction("Otvoriť vybavenie",()=>navigate("equipment"),Battery)}</article>;
    }
    if (key === "member_invites") {
      const members=dashboardData.members, invited=members.filter(item=>item.active&&!item.registered).length, recent=members.filter(item=>item.active&&item.registered).slice(-3);
      return <article className="dashboard-widget" key={key}><div className="dashboard-widget-title"><Users size={18}/><h3>Pozvánky a noví členovia</h3></div>
        {dataLoaded.members?<><p className="dashboard-number">{invited}</p><p className="dashboard-subtext">pozvánok ešte neaktivovalo účet</p>{recent.length>0&&<p className="dashboard-subtext">Aktívnych členov v evidencii: {members.filter(item=>item.active&&item.registered).length}</p>}</>:<p className="muted">Načítavam členov…</p>}
        {makeAction("Otvoriť členov",()=>navigate("members"),Users)}</article>;
    }
    if (key === "quick_links") return <article className="dashboard-widget dashboard-quick-widget" key={key}><div className="dashboard-widget-title"><ArrowUpRight size={18}/><h3>Rýchly prístup</h3></div>
      {quickLinks.length?<div className="dashboard-quick-links">{quickLinks.map(link=>{const [Icon,label]=dashboardLinkInfo[link];return <button key={link} onClick={pageLinks[link]}><Icon size={19}/><span>{label}</span></button>;})}</div>:<p className="muted">Pridaj odkazy v úprave hlavnej stránky.</p>}
    </article>;
    return null;
  }
  const activeWidgetIds=draftWidgets.map(item=>item.id).filter(id=>availableWidgets.includes(id));
  const inactiveWidgetIds=availableWidgets.filter(id=>!activeWidgetIds.includes(id));
  function renderEditorWidget(key, selected) {
    const [Icon,label]=dashboardWidgetInfo[key], position=draftWidgets.findIndex(item=>item.id===key), display=selected?draftWidgets[position].display:"both";
    return <div className={"dashboard-editor-row "+(selected?"is-active":"is-inactive")} key={key}>
      {selected&&<span className="dashboard-order-number" aria-label={"Poradie "+(position+1)}>{position+1}</span>}
      <label className="checkbox"><input type="checkbox" checked={selected} onChange={event=>setDraftWidgets(items=>event.target.checked?[...items,{id:key,display:"both"}]:items.filter(item=>item.id!==key))}/><Icon size={18}/><span>{label}</span></label>
      {selected&&<div className="dashboard-editor-controls"><select aria-label={label+" – zobrazenie"} value={display} onChange={event=>setDraftWidgets(items=>items.map(item=>item.id===key?{...item,display:event.target.value}:item))}><option value="both">Všade</option><option value="desktop">Len desktop</option><option value="mobile">Len mobil</option></select><span className="dashboard-reorder"><button type="button" className="icon-button" aria-label={"Posunúť "+label+" vyššie"} disabled={position<=0} onClick={()=>setDraftWidgets(items=>{const copy=[...items],i=copy.findIndex(item=>item.id===key);[copy[i-1],copy[i]]=[copy[i],copy[i-1]];return copy;})}><MoveUp size={17}/></button><button type="button" className="icon-button" aria-label={"Posunúť "+label+" nižšie"} disabled={position===draftWidgets.length-1} onClick={()=>setDraftWidgets(items=>{const copy=[...items],i=copy.findIndex(item=>item.id===key);[copy[i+1],copy[i]]=[copy[i],copy[i+1]];return copy;})}><MoveDown size={17}/></button></span></div>}
    </div>;
  }
  return <>
    <section className="home-welcome" style={{"--home-color": homeColor,"--dashboard-columns": columns}}>
      <button className="home-edit-icon" aria-label="Upraviť úvodnú stránku" title="Upraviť úvodnú stránku" onClick={openEditor}><Pencil size={18}/></button>
      <section className="home-summary-widget" aria-label="Privítanie a dôležité informácie">
        <div className="home-greeting"><time dateTime={today()}>{new Date().toLocaleDateString(uiLocale(), {weekday: "long", day: "numeric", month: "long", timeZone})}</time><h2>Ahoj, {user.name.split(" ")[0]}!</h2></div>
        <div className="home-priority-alerts">{homeAlerts.slice(0,5).map((alert,index)=><button key={index} className={"home-priority-alert tone-"+alert.tone} onClick={alert.action||undefined} disabled={!alert.action}><span className="home-alert-mark" aria-hidden="true"/><span>{alert.text}</span>{alert.action&&<ChevronRight size={15}/>}</button>)}</div>
      </section>
      {widgets.length ? <div className="dashboard-widgets">{widgets.map(item=><div key={item.id} className={"dashboard-widget-slot scope-"+(item.display||"both")}>{renderWidget(item.id)}</div>)}</div> : <div className="dashboard-no-widgets"><p>Privítanie a upozornenia zostávajú zobrazené.</p></div>}
    </section>
    {editOpen && <Modal title="Prispôsobiť úvodnú stránku" close={() => setEditOpen(false)}><div className="dashboard-editor">
      <p className="muted">Vyber widgety a urč, na ktorých displejoch sa zobrazia. Poradie je spoločné.</p>
      <label className="dashboard-column-setting">Počet stĺpcov na desktope<select value={draftColumns} onChange={event=>setDraftColumns(Number(event.target.value))}><option value="1">1 stĺpec</option><option value="2">2 stĺpce</option><option value="3">3 stĺpce</option><option value="4">4 stĺpce</option></select></label>
      <div className="dashboard-editor-widgets">
        {activeWidgetIds.length>0&&<strong className="dashboard-editor-section-label">Zobrazené widgety · aktuálne poradie</strong>}
        {activeWidgetIds.map(key=>renderEditorWidget(key,true))}
        {inactiveWidgetIds.length>0&&<strong className="dashboard-editor-section-label inactive">Neaktívne widgety</strong>}
        {inactiveWidgetIds.map(key=>renderEditorWidget(key,false))}
      </div>
      {draftWidgets.some(item=>item.id==="quick_links")&&<fieldset className="dashboard-link-picker"><legend>Odkazy v widgete Rýchly prístup</legend>{availableLinks.map(key=>{const [Icon,label]=dashboardLinkInfo[key];return <label className="checkbox" key={key}><input type="checkbox" checked={draftLinks.includes(key)} onChange={event=>setDraftLinks(items=>event.target.checked?[...items,key]:items.filter(item=>item!==key))}/><Icon size={17}/><span>{label}</span></label>;})}</fieldset>}
      <fieldset className="dashboard-theme-picker"><legend>Farebný akcent</legend><div className="dashboard-theme-options">{dashboardThemes.map(([key,label])=><label key={key}><input type="radio" name="dashboard-theme" checked={draftTheme===key} onChange={()=>setDraftTheme(key)}/><span className={"dashboard-theme-swatch theme-"+key}/>{label}</label>)}
        <label className="dashboard-custom-color"><input type="radio" name="dashboard-theme" checked={draftTheme.startsWith("#")} onChange={()=>setDraftTheme(draftTheme.startsWith("#")?draftTheme:"#a78bfa")}/><input type="color" aria-label="Vlastná farba" value={draftTheme.startsWith("#")?draftTheme:"#a78bfa"} onChange={event=>setDraftTheme(event.target.value)}/>Vlastná</label></div></fieldset>
      {saveError && <p className="error" role="alert">{saveError}</p>}<div className="actions"><button type="button" onClick={()=>setEditOpen(false)}>Zrušiť</button><button type="button" className="primary" disabled={saving} onClick={saveDashboard}>{saving?"Ukladá sa…":"Uložiť"}</button></div>
    </div></Modal>}
  </>;
}

function Drawer({close, children}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {document.body.style.overflow = old;};
  }, []);
  return <dialog ref={ref} className="drawer" aria-label="Navigácia" onCancel={event => {event.preventDefault(); close();}}
    onClick={event => {if (event.target === ref.current) close();}}>
    <div className="drawer-head"><strong>Drone Soccer Hub</strong><button aria-label="Zavrieť menu" className="icon-button" onClick={close}><X /></button></div>
    {children}
  </dialog>;
}

function App() {
  const [language, setLanguage] = useState(initialLanguage);
  const [languagePreference, setLanguagePreference] = useState(() => localStorage.getItem("lf-ds-hub-language") || "system");
  activeLanguage = language;
  const installation = usePwaInstall();
  const platform = installationPlatform();
  const [installHelp, setInstallHelp] = useState(false);
  const [installError, setInstallError] = useState("");
  const [installHidden, setInstallHidden] = useState(false);
  const [installPopup, setInstallPopup] = useState(false);
  const loginPromotionShown = useRef(null);
  const [user, setUser] = useState(undefined);
  const contentRef = useRef(null);
  const [toolbarTarget, setToolbarTarget] = useState(null);
  const [page, setPage] = useState(() => hash().has("battery") ? "equipment" : hash().get("page")==="lineups" ? "team" : hash().get("page") || "home");
  const [menu, setMenu] = useState(false);
  const [route, setRoute] = useState(location.hash);
  const [snapshot, setSnapshot] = useState(null);
  const session = useRef(null);
  const empty = {trainings: [], announcements: [], conversations: [], places: []};
  const data = snapshot && snapshot.owner === user ? snapshot.data : empty;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [trainingId, setTrainingId] = useState(() => Number(hash().get("event")) || null);
  const [activeBattery, setActiveBattery] = useState(() => hash().get("battery"));
  const [contact, setContact] = useState(() => Number(hash().get("contact")) || null);
  const [createTraining, setCreateTraining] = useState(false);
  const [scanEvent,setScanEvent]=useState(null);
  const [scanSession,setScanSession]=useState(0);
  const [cardMember,setCardMember]=useState(null);
  const [notifications, setNotifications] = useState(false);
  // Keep the banner hidden until the server confirms it is enabled.
  const [trialBannerEnabled,setTrialBannerEnabled]=useState(false);
  const [roleRequestCount,setRoleRequestCount]=useState(0);
  const superadmin = user?.role === "superadmin";
  const visibleNavigation = navigation.filter(([key]) => hasRight(user, key + ".open"));
  const allowedPages = [...visibleNavigation.map(([key]) => key), ...(hasRight(user,"scanner.open") ? ["scanner"] : []), "profile"];
  const currentPage = allowedPages.includes(page) ? page : "home";
  const title = currentPage === "profile" ? "Profil a nastavenia" : currentPage === "scanner" ? "Skenovať" : navigation.find(([key]) => key === currentPage)?.[1];
  useEffect(() => {
    document.documentElement.lang = language;
    translatePage(document.body, language);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "characterData" || record.type === "attributes") translateNode(record.target, language);
        else for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) translatePage(node, language);
          else if (node.nodeType === Node.TEXT_NODE) translateNode(node, language);
        }
      }
    });
    observer.observe(document.body, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["aria-label","placeholder","title","alt"]});
    return () => observer.disconnect();
  }, [language]);
  function changeLanguagePreference(preference) {
    localStorage.setItem("lf-ds-hub-language", preference);
    setLanguagePreference(preference);
    setLanguage(preference === "system" ? detectLanguage() : preference);
  }
  async function install() {
    setInstallError("");
    setInstallPopup(false);
    if (!installation.available) {setInstallHelp(true); return;}
    try {
      const outcome = await promptInstallation();
      if (outcome === "dismissed") setInstallHidden(true);
      if (outcome === "unavailable") setInstallHelp(true);
    } catch {
      setInstallError("Inštalačný dialóg sa nepodarilo otvoriť. Použi menu prehliadača.");
      setInstallHelp(true);
    }
  }
  async function saveInstallPreferences(preferences) {
    const owner = session.current;
    if (!owner) return;
    const saved = await api("me/install-preferences", "PUT", preferences);
    if (session.current !== owner) return;
    const updated = {...owner, ...saved};
    session.current = updated;
    setSnapshot(previous => previous?.owner === owner ? {...previous, owner: updated} : previous);
    setUser(updated);
    if (!saved.pwa_show_popup) setInstallPopup(false);
  }
  async function stopInstallPromotions() {
    await saveInstallPreferences({pwa_show_card: false, pwa_show_popup: false});
    setInstallHidden(true);
    setInstallPopup(false);
  }
  async function loadUser() {
    try {
      const account = await api("me"); session.current = account; setUser(account);
    } catch (error) {
      if (error.status !== 401) setError(error.message);
      session.current = null; setUser(null); setLoading(false);
    }
  }
  useEffect(()=>{api("public/settings").then(settings=>setTrialBannerEnabled(settings.trial_banner_enabled)).catch(()=>{});},[]);
  async function refresh() {
    let owner = session.current;
    if (!owner) return;
    try {
      const refreshed=await api("me");
      if(session.current!==owner)return;
      if(JSON.stringify([owner.role,owner.roles,owner.menu_access,owner.permissions,owner.avatar_version,owner.dashboard_preferences])!==JSON.stringify([refreshed.role,refreshed.roles,refreshed.menu_access,refreshed.permissions,refreshed.avatar_version,refreshed.dashboard_preferences])){
        owner=refreshed;session.current=refreshed;setUser(refreshed);
      }
      const canReviewRoles=hasRight(owner,"members.requests.read");
      const [trainings, announcements, conversations, places,roleRequests,siteSettings] = await Promise.all([
        hasRight(owner,"calendar.events.read")?api("trainings"):Promise.resolve([]),hasRight(owner,"announcements.notices.read")?api("announcements"):Promise.resolve([]),
        hasRight(owner,"messages.chat.read")?api("conversations"):Promise.resolve([]),hasRight(owner,"calendar.places.read")?api("places"):Promise.resolve([]),
        canReviewRoles?api("role-requests"):Promise.resolve([]),api("public/settings"),
      ]);
      if (session.current === owner) {setRoleRequestCount(roleRequests.length);setTrialBannerEnabled(siteSettings.trial_banner_enabled);setSnapshot({owner, data: {trainings, announcements, conversations, places}}); setError(""); setLoading(false);}
    } catch (error) {
      if (session.current !== owner) return;
      if (error.status === 401) {session.current = null; setSnapshot(null); setUser(null);}
      else setError(error.message);
      setLoading(false);
    }
  }
  function navigate(next) {
    const target = new URL(location.href);
    target.hash = "page=" + next;
    if (menu) history.replaceState({}, "", target); else if (next !== page) history.pushState({}, "", target);
    setMenu(false); setNotifications(false); setTrainingId(null); setPage(next); setActiveBattery(null);
    if (next !== "messages") setContact(null);
    contentRef.current?.scrollTo({top: 0, left: 0});
    window.scrollTo({top: 0});
  }
  function openScanner(event=null) {setScanEvent(event);setScanSession(value=>value+1);setTrainingId(null);navigate("scanner");}
  function openMenu() {history.pushState({drawer: true}, "", location.href); setMenu(true);}
  function closeMenu() {if (history.state?.drawer) history.back(); else setMenu(false);}
  function messageMember(id) {setContact(id); navigate("messages");}
  async function logout() {
    await disablePush().catch(()=>{});
    await api("logout", "POST"); session.current = null; setSnapshot(null); setUser(null);
    setTrainingId(null); setMenu(false); setNotifications(false); setCreateTraining(false); setContact(null); history.replaceState({}, "", base);
    setPage("home");
    setInstallHelp(false); setInstallPopup(false); setInstallHidden(false);setCardMember(null);setScanEvent(null);
    loginPromotionShown.current = null;
  }
  useEffect(() => {loadUser();}, []);
  useEffect(() => {contentRef.current?.scrollTo({top: 0, left: 0});}, [currentPage]);
  useEffect(() => {
    const onNavigation = () => {
      setRoute(location.hash);
      setMenu(Boolean(history.state?.drawer));
      setActiveBattery(hash().get("battery"));
      setPage(hash().has("battery") ? "equipment" : hash().get("page")==="lineups" ? "team" : hash().get("page") || "home");
      setTrainingId(Number(hash().get("event")) || null); setContact(Number(hash().get("contact")) || null);
    };
    addEventListener("popstate", onNavigation); addEventListener("hashchange", onNavigation);
    return () => {removeEventListener("popstate", onNavigation); removeEventListener("hashchange", onNavigation);};
  }, []);
  useEffect(() => {
    if (!user) return;
    refresh();
    const timer = setInterval(() => {if (!document.hidden) refresh();}, 15000);
    const focus = () => {if (!document.hidden) refresh();};
    addEventListener("visibilitychange", focus);
    return () => {clearInterval(timer); removeEventListener("visibilitychange", focus);};
  }, [user]);
  useEffect(() => {
    if (!user) {
      loginPromotionShown.current = null;
      setInstallPopup(false);
      setInstallHidden(false);
      return;
    }
    if (loading || loginPromotionShown.current === user.id) return;
    loginPromotionShown.current = user.id;
    if (!installation.installed && user.pwa_show_popup !== false) setInstallPopup(true);
  }, [user?.id, user?.pwa_show_popup, loading, installation.installed]);
  const unread = data.conversations.reduce((sum, row) => sum + row.unread, 0);
  const unreadNotices = data.announcements.filter(item => !item.is_read).length;
  const training = data.trainings.find(t => t.id === trainingId);
  const menuContent = <><nav aria-label="Hlavná navigácia">{visibleNavigation.map(([key, label, Icon]) =>
    <button key={key} className={currentPage === key ? "active" : ""} aria-current={currentPage === key ? "page" : undefined} onClick={() => navigate(key)}>
      <Icon size={20} /><span>{label}</span>{key === "messages" && unread > 0 && <span className="counter">{unread}</span>}{key==="members"&&roleRequestCount>0&&<span className="counter" aria-label={roleRequestCount+" čakajúcich žiadostí o roly"}>{roleRequestCount}</span>}
    </button>)}</nav><div className="menu-footer"><button className="person-link" aria-label="Môj profil" onClick={() => navigate("profile")}><Avatar name={user?.name || "Používateľ"} id={user?.id} version={user?.avatar_version} /><span className="grow"><strong>{user?.name}</strong><span className="meta">Profil a nastavenia</span></span><Settings2 size={18} /></button>
      <Action className="logout-button" run={logout}><LogOut size={18} />Odhlásiť sa</Action></div></>;
  return <PermissionContext.Provider value={user}><div className={user ? "app" : "signed-out"}>
    <header className="topbar">
      {user && <button className="icon-button hamburger" aria-label="Otvoriť menu" aria-expanded={menu} onClick={openMenu}><Menu /></button>}
      <a className={user && currentPage !== "home" ? "brand desktop-brand" : "brand"} href="#page=home" onClick={event => {event.preventDefault(); if (user) navigate("home");}}>
        <span className="brand-symbol" aria-hidden="true"><Drone size={24} /></span><span><strong>Drone Soccer Hub</strong><small>LF TUKE</small></span>
      </a>
      {user && <h1 id="page-title" className={"topbar-title" + (currentPage === "home" ? " home-title" : "")}>{title}</h1>}
      {user?.preview && <Action className="preview-return" run={async () => {await api("role-preview", "DELETE");location.reload();}}><ShieldCheck size={16}/><span>Späť na Superadmina</span></Action>}
      {hasRight(user, "scanner.open") && <button className="icon-button scan-shortcut" aria-label="Skenovať kód" onClick={()=>openScanner()}><ScanLine size={22} /></button>}
      {hasRight(user, "profile.card.own") && <button className="icon-button" aria-label="Môj členský QR kód" onClick={()=>setCardMember({self:true})}><QrCode size={22} /></button>}
      {user && <button className="icon-button notification-button" aria-label={"Oznámenia" + (unread + unreadNotices ? " (" + (unread + unreadNotices) + ")" : "")} onClick={() => setNotifications(true)}><Bell size={22} />{unread + unreadNotices > 0 && <i />}</button>}
    </header>
    {user && <aside className="sidebar">{menuContent}</aside>}
    {user && menu && <Drawer close={closeMenu}>{menuContent}</Drawer>}
    <div className="workspace">
    {user && <div ref={setToolbarTarget} className="page-toolbar" />}
    <ToolbarTarget.Provider value={toolbarTarget}>
    <main ref={contentRef} tabIndex={user ? 0 : undefined} aria-labelledby={user ? "page-title" : undefined}
      className={user ? "content " + currentPage + "-page" : "content"}>
    {user?.preview && <p className="notice">Náhľad roly · {clubRoleLabel(user.roles)}</p>}
    {trialBannerEnabled&&<aside className="development-banner" aria-label="Aplikácia vo vývoji">
        <Construction size={22} aria-hidden="true" />
        <div><strong>Aplikácia je v skúšobnej prevádzke</strong><p>Nie všetky funkcie sú zatiaľ dostupné. Funkcie aj vzhľad aplikácie priebežne dopĺňame a upravujeme.</p></div>
      </aside>}
      {error && <div className="error-banner" role="alert">{error}<Action run={refresh}>Skúsiť znova</Action></div>}
      {user === undefined ? <Empty>Načítava sa…</Empty> : !user ? <Login onLogin={loadUser} /> : <>
        {loading ? <Empty>Načítava sa…</Empty> : <>
          {currentPage === "home" && hasRight(user,"home.open") && <>
            {!installation.installed && user.pwa_show_card !== false && !installHidden && <div className="install-promotion">
              <InstallPanel installation={installation} install={install} />
              <button className="icon-button" aria-label="Skryť kartu teraz" onClick={() => setInstallHidden(true)}><X size={18} /></button>
              <Action className="text-button install-opt-out" run={stopInstallPromotions}>Už nezobrazovať</Action>
            </div>}
            <Home user={user} {...data} refresh={refresh} navigate={navigate} openTraining={setTrainingId}
              openScanner={openScanner} openCard={() => setCardMember({self:true})} plan={() => setCreateTraining(true)} roleRequestCount={roleRequestCount} unreadNotices={unreadNotices} />
          </>}
          {currentPage === "calendar" && <Calendar trainings={data.trainings}
            places={data.places} refresh={refresh} openTraining={setTrainingId} />}
          {currentPage === "scanner" && <ClubScanner key={user.id+":"+(scanEvent?.id || "general")+":"+scanSession} user={user} initialEvent={scanEvent} refresh={refresh} />}
          {currentPage === "attendance" && hasRight(user,"attendance.records.read") && <AttendanceOverview openScanner={hasRight(user,"scanner.open") && hasRight(user,"attendance.records.scan") ? openScanner : undefined} />}
          {currentPage === "attendance" && !hasRight(user,"attendance.records.read") && hasRight(user,"attendance.records.own") && <OwnAttendance />}
          {currentPage === "messages" && <Messages key={user.id + ":" + contact + ":" + route} user={user} conversations={data.conversations} refresh={refresh} initialContact={contact} />}
          {currentPage === "announcements" && <Bulletin items={data.announcements} refresh={refresh} />}
          {currentPage === "members" && <Members key="members" user={user} userId={user.id} superadmin={superadmin} onTrialBanner={setTrialBannerEnabled} onMessage={messageMember} onCard={setCardMember} />}
          {currentPage === "team" && <TeamWorkspace />}
          {currentPage === "development" && (hasRight(user,"development.skills.read") || hasRight(user,"development.skills.own")) && <PlayerDevelopmentPage />}
          {currentPage === "drills" && hasRight(user,"drills.library.read") && <DrillLibrary />}
          {currentPage === "equipment" && <Batteries key={user.id + ":" + activeBattery + ":" + user.permissions.join(",")} initialCode={activeBattery} />}
          {currentPage === "documents" && <Documents />}
          {currentPage === "profile" && hasRight(user,"profile.open") && <Profile user={user} reloadUser={loadUser} installation={installation} install={install} saveInstallPreferences={saveInstallPreferences} openCard={()=>setCardMember({self:true})} languagePreference={languagePreference} onLanguageChange={changeLanguagePreference} />}
        </>}
      </>}
    </main>
    </ToolbarTarget.Provider>
    <footer className="site-footer">DRONE SOCCER HUB LF © 2026 Zoltán Szőke</footer>
    </div>
    {user && installPopup && user.pwa_show_popup !== false && !installation.installed && <Modal title="Maj klub vždy poruke" close={() => setInstallPopup(false)}>
      <InstallPanel installation={installation} install={install} />
      <div className="install-popup-actions">
        <button onClick={() => setInstallPopup(false)}>Teraz nie</button>
        <Action className="text-button" run={async () => {
          await saveInstallPreferences({pwa_show_card: user.pwa_show_card !== false, pwa_show_popup: false});
        }}>Vypnúť popup po prihlásení</Action>
        <Action className="text-button" run={stopInstallPromotions}>Už mi to neponúkať</Action>
      </div>
    </Modal>}
    {installHelp && !installation.installed && <Modal title="Inštalácia DroneSoccer LF" close={() => setInstallHelp(false)}>
      {installError && <p className="error" role="alert">{installError}</p>}
      {platform === "ios" ? <ol className="install-steps"><li>Otvor túto stránku v Safari.</li>
        <li>Otvor <strong>Zdieľať</strong> v menu prehliadača.</li>
        <li>Vyber <strong>Pridať na plochu</strong>.</li>
        <li>Zapni <strong>Otvoriť ako webovú aplikáciu</strong>, ak sa zobrazí, a potvrď <strong>Pridať</strong>.</li>
      </ol> : platform === "android" ? <ol className="install-steps">
        <li>Otvor menu prehliadača vpravo hore.</li>
        <li>Vyber <strong>Inštalovať aplikáciu</strong> alebo <strong>Pridať na plochu</strong>.</li>
        <li>Potvrď inštaláciu DroneSoccer LF.</li>
      </ol> : <><p>V adresnom riadku alebo menu prehliadača vyhľadaj možnosť <strong>Inštalovať aplikáciu</strong>.</p>
        <p>Ak túto možnosť prehliadač ponúka, potvrď inštaláciu DroneSoccer LF.</p></>}
    </Modal>}
    {user && cardMember && <MemberQr key={cardMember.self ? "self" : cardMember.id} member={cardMember} close={()=>setCardMember(null)} />}
    {user && training && <TrainingDetail key={training.id} training={training} canRespond={mayRespond(user,training)}
      places={data.places} refresh={refresh} openScanner={openScanner} close={() => setTrainingId(null)} />}
    {maySchedule(user) && createTraining && <Modal title="Nová udalosť" close={() => setCreateTraining(false)}><TrainingForm places={data.places} done={async () => {setCreateTraining(false); await refresh();}} /></Modal>}
    {user && notifications && <Modal title="Oznámenia" close={() => setNotifications(false)}>
      {hasRight(user, "messages.chat.read") && <button className="card quick-link" onClick={() => navigate("messages")}><MessageCircle /><span className="grow"><strong>Správy</strong><span className="meta">{unread ? unread + " neprečítaných" : "Všetko máš prečítané"}</span></span><ChevronRight /></button>}
      {data.announcements.filter(item => !item.is_read).map(item => <button className="card quick-link" key={item.id} onClick={() => navigate("announcements")}><Megaphone /><span className="grow"><strong>{item.title}</strong><span className="meta">{date(item.created_at)}</span></span><ChevronRight /></button>)}
    </Modal>}
  </div></PermissionContext.Provider>;
}

createRoot(document.getElementById("root")).render(<App />);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("sw.js", base)).catch(console.error);
}
