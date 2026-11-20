"""Stable capability identifiers shared by the API and the administration UI."""

PAGES = {
    "home": "Domov", "calendar": "Kalendár", "attendance": "Dochádzka",
    "scanner": "Skener", "messages": "Správy", "announcements": "Oznamy",
    "members": "Členovia", "team": "Tímy a zostavy", "development": "Rozvoj hráčov",
    "drills": "Knižnica cvičení", "equipment": "Vybavenie", "documents": "Dokumenty",
    "profile": "Profil",
}
BLOCKS = {
    "events": "Udalosti", "rsvp": "Účasť", "places": "Miesta",
    "proposals": "Návrhy tréningov", "workspace": "Tréningový plán",
    "records": "Záznamy", "codes": "Kódy", "chat": "Konverzácie",
    "groups": "Skupiny", "poll": "Ankety", "notices": "Oznamy", "files": "Súbory",
    "accounts": "Účty", "requests": "Žiadosti o roly", "card": "Členský QR kód",
    "lineup": "Zostavy", "skills": "Hodnotenia", "library": "Cvičenia",
    "assets": "Evidencia", "battery": "Batérie", "service": "Prevádzka a servis",
    "loans": "Zápožičky a pridelenia",
}
# Legacy rule: r = page read, w = page edit; s = staff, p = player,
# l = club leadership, c = trainer role, n = new (explicitly grant after migration).
DEFINITIONS = """
calendar.events.read r Zobraziť udalosti
calendar.events.training ws Vytvoriť tréning
calendar.events.meeting ws Vytvoriť stretnutie
calendar.events.match ws Vytvoriť zápas
calendar.events.edit_own n Upraviť vlastnú udalosť
calendar.events.edit_all ws Upraviť ľubovoľnú udalosť
calendar.events.cancel ws Zrušiť udalosť
calendar.events.delete_own ws Odstrániť vlastnú udalosť
calendar.events.delete_all n Odstrániť ľubovoľnú udalosť
calendar.events.delete_unowned ws Odstrániť historickú udalosť bez autora
calendar.events.history r Zobraziť históriu zmien
calendar.rsvp.respond wp Odpovedať za seba
calendar.rsvp.reconfirm wp Potvrdiť zmenu za seba
calendar.rsvp.summary r Zobraziť súhrn odpovedí
calendar.rsvp.roster rs Zobraziť menné odpovede
calendar.places.read r Zobraziť miesta
calendar.places.create ws Pridať miesto
calendar.proposals.read n Zobraziť návrhy
calendar.proposals.create n Navrhnúť tréning
calendar.proposals.edit n Upraviť alebo stiahnuť vlastný návrh
calendar.proposals.vote n Hlasovať za seba
calendar.proposals.results n Zobraziť súhrn hlasov
calendar.proposals.voters n Zobraziť menné hlasy
calendar.proposals.close n Uzavrieť hlasovanie
calendar.proposals.reject n Zamietnuť návrh
calendar.proposals.approve n Schváliť návrh a vytvoriť tréning
calendar.workspace.read r Zobraziť plán
calendar.workspace.edit ws Upraviť plán
calendar.workspace.publish ws Zverejniť alebo skryť plán
calendar.workspace.team_read r Čítať poznámku pre tím
calendar.workspace.team_edit ws Upraviť poznámku pre tím
calendar.workspace.private_read rs Čítať internú poznámku
calendar.workspace.private_edit ws Upraviť internú poznámku
calendar.workspace.feedback_own rp Čítať vlastnú spätnú väzbu
calendar.workspace.feedback_write wp Napísať vlastnú spätnú väzbu
calendar.workspace.feedback_all rs Čítať spätnú väzbu účastníkov
attendance.records.own p Zobraziť vlastnú dochádzku
attendance.records.read rs Zobraziť tímovú dochádzku
attendance.records.member rs Zobraziť dochádzku člena
attendance.records.write ws Zapísať jednotlivca
attendance.records.bulk ws Zapísať hromadne
attendance.records.scan ws Zapísať cez QR
attendance.records.correct ws Opraviť uzavretú dochádzku
scanner.codes.equipment w Vyhľadať vybavenie
scanner.codes.member ws Identifikovať člena
scanner.codes.events rs Vybrať udalosť
scanner.codes.create ws Vytvoriť neplánovaný tréning
messages.chat.read r Čítať konverzácie
messages.chat.direct w Poslať súkromnú správu
messages.chat.send_group w Poslať skupinovú správu
messages.chat.react w Pridať alebo odstrániť reakciu
messages.chat.reactors r Zobraziť menné reakcie
messages.groups.create ws Vytvoriť skupinu
messages.groups.edit ws Spravovať skupinu
messages.groups.coaches rc Prístup do skupiny Tréneri
messages.poll.create w Vytvoriť anketu
messages.poll.options w Pridať možnosť do ankety
messages.poll.vote w Hlasovať v ankete
announcements.notices.read r Čítať oznamy
announcements.notices.read_all rs Čítať oznamy všetkých skupín
announcements.notices.coaches rc Čítať oznamy pre trénerov
announcements.notices.create ws Vytvoriť oznam
announcements.notices.edit ws Upraviť oznam
announcements.notices.publish ws Publikovať oznam
announcements.notices.audience ws Vybrať príjemcov
announcements.notices.pin ws Pripnúť oznam
announcements.notices.push ws Odoslať upozornenie
announcements.notices.delete ws Odstrániť oznam
announcements.files.upload ws Nahrať prílohu
announcements.files.read r Stiahnuť prílohu
members.accounts.read r Zobraziť členov
members.accounts.contacts r Zobraziť kontaktné údaje
members.accounts.invite wi Pozvať člena
members.accounts.invite_roles wa Nastaviť povolené roly v pozvánke
members.accounts.active ws Aktivovať alebo deaktivovať člena
members.accounts.reset ws Obnoviť prístup člena
members.accounts.manage_staff n Spravovať účty s rozšíreným prístupom
members.accounts.delete n Natrvalo odstrániť člena
members.requests.read rl Zobraziť čakajúce žiadosti
members.requests.decide n Rozhodnúť o žiadosti
profile.requests.own - Zobraziť vlastné žiadosti o rolu
profile.requests.create - Požiadať o rolu
profile.card.own p Zobraziť alebo stiahnuť vlastný QR
members.card.read rs Zobraziť členský QR
members.card.reset ws Obnoviť členský QR
team.lineup.club_read r Zobraziť klubovú zostavu
team.lineup.club_edit ws Upraviť klubovú zostavu
team.lineup.event_read r Zobraziť zostavu udalosti
team.lineup.event_edit ws Upraviť zostavu udalosti
team.lineup.publish ws Zverejniť nomináciu
team.lineup.respond n Potvrdiť vlastnú nomináciu
team.lineup.responses n Zobraziť odpovede na nomináciu
development.skills.read rs Zobraziť rozvoj hráča
development.skills.own n Zobraziť vlastný rozvoj
development.skills.write ws Hodnotiť zručnosti
development.skills.private_read rs Čítať súkromné poznámky
development.skills.private_write ws Meniť súkromné poznámky
drills.library.read rs Zobraziť knižnicu cvičení
drills.library.create ws Pridať cvičenie
equipment.assets.read r Zobraziť vybavenie
equipment.assets.create ws Pridať vybavenie
equipment.assets.edit n Upraviť údaje o vybavení
equipment.assets.history r Zobraziť históriu
equipment.battery.used w Zaznamenať použitie batérie
equipment.battery.charged w Označiť nabitie
equipment.battery.discharged w Označiť vybitie
equipment.battery.batch w Zapísať hromadné nabitie
equipment.battery.stored ws Uskladniť
equipment.battery.storage_exit ws Vydať zo skladu
equipment.battery.damaged ws Zapísať poškodenie
equipment.battery.retired ws Vyradiť batériu
equipment.battery.note w Pridať poznámku
equipment.battery.delete ws Odstrániť záznam batérie
equipment.service.inspection w Zapísať kontrolu
equipment.service.training w Zapísať použitie
equipment.service.fault w Nahlásiť poruchu
equipment.service.repair ws Zapísať opravu
equipment.service.maintenance ws Zapísať údržbu
equipment.service.propeller_replacement ws Zapísať výmenu vrtúľ
equipment.service.motor_replacement ws Zapísať výmenu motorov
equipment.service.battery_check w Skontrolovať batériu ovládača
equipment.service.retired ws Vyradiť zariadenie
equipment.service.note w Pridať poznámku
equipment.loans.own n Zobraziť vlastné zverenia
equipment.loans.read r Zobraziť držiteľov vybavenia
equipment.loans.assign ws Prideliť zariadenie dlhodobo
equipment.loans.unassign ws Ukončiť pridelenie
equipment.loans.drone n Zapožičať dron
equipment.loans.controller n Zapožičať ovládač
equipment.loans.charger n Zapožičať nabíjačku
equipment.loans.accept n Potvrdiť vlastné prevzatie
equipment.loans.return n Zaznamenať vrátenie
equipment.loans.cancel n Zrušiť čakajúcu zápožičku
documents.files.list r Zobraziť dokumenty
documents.files.download r Stiahnuť dokument
documents.files.upload ws Nahrať dokument
documents.files.delete ws Odstrániť dokument
documents.files.ack_config n Vyžiadať potvrdenie oboznámenia
documents.files.acknowledge n Potvrdiť vlastné oboznámenie
documents.files.ack_list n Zobraziť potvrdenia oboznámenia
"""
CAPABILITIES = {
    key: (rule, label)
    for key, rule, label in (line.split(maxsplit=2) for line in DEFINITIONS.strip().splitlines())
}
for page, title in PAGES.items():
    CAPABILITIES[f"{page}.open"] = ("-" if page in {"home", "profile"} else "r", title)


def dependencies(key):
    page, *parts = key.split(".")
    keys = [] if parts == ["open"] else [f"{page}.open"]
    prerequisites = {
        "members.accounts.invite_roles": "members.accounts.invite",
        "members.requests.decide": "members.requests.read",
        "team.lineup.club_edit": "team.lineup.club_read",
        "team.lineup.event_edit": "team.lineup.event_read",
        "team.lineup.publish": "team.lineup.event_read",
        "team.lineup.respond": "team.lineup.event_read",
        "team.lineup.responses": "team.lineup.event_read",
        "documents.files.ack_config": "documents.files.list",
        "documents.files.acknowledge": "documents.files.list",
        "documents.files.ack_list": "documents.files.list",
        "calendar.workspace.edit": "calendar.workspace.read",
        "calendar.workspace.team_edit": "calendar.workspace.team_read",
        "calendar.workspace.private_edit": "calendar.workspace.private_read",
        "calendar.workspace.feedback_write": "calendar.workspace.feedback_own",
        "announcements.files.read": "announcements.notices.read",
        "messages.chat.react": "messages.chat.read",
        "messages.chat.reactors": "messages.chat.read",
        "messages.poll.options": "messages.chat.read",
        "messages.poll.vote": "messages.chat.read",
    }
    if key in prerequisites:
        keys.append(prerequisites[key])
    if key.startswith("calendar.proposals.") and key != "calendar.proposals.read":
        keys.append("calendar.proposals.read")
    if key in {"calendar.rsvp.respond", "calendar.rsvp.reconfirm", "calendar.events.history"}:
        keys.append("calendar.events.read")
    if key in {"equipment.assets.edit", "equipment.assets.history"} or key.startswith(("equipment.battery.", "equipment.service.", "equipment.loans.")):
        keys.append("equipment.assets.read")
    return keys


def catalog():
    return [
        {"key": key, "label": label, "page": key.split(".")[0],
         "page_label": PAGES[key.split(".")[0]],
         "block": key.split(".")[1],
         "block_label": BLOCKS.get(key.split(".")[1]),
         "requires": dependencies(key)}
        for key, (_, label) in sorted(CAPABILITIES.items())
    ]


def allows(user, key):
    return key in CAPABILITIES and (user["role"] == "superadmin" or key in user.get("permissions", ()))


def effective(conn, roles):
    keys = {row["permission"] for row in conn.execute(
        "SELECT DISTINCT permission FROM role_grants WHERE role_key=ANY(%s)", (roles,)
    ).fetchall()} & CAPABILITIES.keys()
    while True:
        remaining = {key for key in keys if all(parent in keys for parent in dependencies(key))}
        if remaining == keys:
            return sorted(keys)
        keys = remaining


def migrate(conn):
    if not conn.execute(
        "INSERT INTO schema_migrations(version) VALUES ('granular_role_grants_v1') ON CONFLICT DO NOTHING RETURNING version"
    ).fetchone():
        return
    rows = conn.execute("""SELECT c.role_key, c.admin_access,c.can_create_invites,c.can_assign_invite_roles,
        COALESCE(jsonb_object_agg(p.menu_key,p.access_level) FILTER (WHERE p.menu_key IS NOT NULL),'{}') AS pages
        FROM role_catalog c LEFT JOIN role_menu_permissions p USING(role_key)
        GROUP BY c.role_key""").fetchall()

    for row in rows:
        role = row["role_key"]
        grants = set()
        for key, (rule, _) in CAPABILITIES.items():
            if rule == "n":
                continue
            page = key.split(".")[0]
            level = row["pages"].get(page, "none")
            if ("r" in rule and level == "none") or ("w" in rule and level != "edit"):
                continue
            if ("s" in rule and not row["admin_access"]
                    or "p" in rule and role != "player"
                    or "c" in rule and role != "coach"
                    or "l" in rule and role not in {"club_leader", "deputy_leader"}
                    or "i" in rule and not row["can_create_invites"]
                    or "a" in rule and not row["can_assign_invite_roles"]):
                continue
            grants.add(key)
            grants.update(dependencies(key))
        with conn.cursor() as cursor:
            cursor.executemany("INSERT INTO role_grants(role_key,permission) VALUES (%s,%s)",
                               [(role, key) for key in sorted(grants)])

# Endpoint names are used so a dynamic URL segment cannot change authorization.
ENDPOINTS = """
me -
get_role_catalog -
update_install_preferences -
update_dashboard_preferences -
update_profile -
upload_avatar -
delete_avatar -
avatar -
change_password -
get_role_config @admin
update_role_config @admin
permission_audit @admin
permission_member @admin
start_permission_preview @admin
stop_permission_preview @restore
set_trial_banner @admin
create_role_requests profile.requests.create
own_role_requests profile.requests.own
role_requests members.requests.read
decide_role_request members.requests.decide
own_attendance attendance.records.own
members members.accounts.read
update_member_roles @admin
invite members.accounts.invite
create_coach @admin
set_role @admin
delete_member members.accounts.delete
reset_member_password members.accounts.reset
set_active members.accounts.active
trainings calendar.events.read
create_training @action
edit_training @action
cancel_training calendar.events.cancel
delete_training @action
rsvp @action
training_history calendar.events.history
roster @action
attendance attendance.records.write
bulk_attendance attendance.records.bulk
attendance_matrix attendance.records.read
member_attendance attendance.records.member
get_general_lineup team.lineup.club_read
save_general_lineup team.lineup.club_edit
get_training_lineup team.lineup.event_read
lineup_events team.lineup.event_read
save_training_lineup team.lineup.event_edit
publish_training_lineup team.lineup.publish
respond_training_lineup team.lineup.respond
list_drills drills.library.read
create_drill drills.library.create
training_workspace @action
save_training_workspace @action
publish_training_workspace calendar.workspace.publish
save_training_feedback calendar.workspace.feedback_write
member_development @action
development_players development.skills.read
save_member_coach_note development.skills.private_write
save_member_skill development.skills.write
announcements announcements.notices.read
announcement_workbench @action
publish_announcement announcements.notices.publish
announce announcements.notices.create
edit_announcement announcements.notices.edit
delete_announcement announcements.notices.delete
announcement_contacts announcements.notices.audience
create_announcement_draft announcements.files.upload
upload_announcement_attachment announcements.files.upload
download_announcement_attachment announcements.files.read
pin_announcement announcements.notices.pin
read_announcement announcements.notices.read
places calendar.places.read
add_place calendar.places.create
documents documents.files.list
upload_document documents.files.upload
download_document documents.files.download
delete_document documents.files.delete
configure_document_ack documents.files.ack_config
acknowledge_document documents.files.acknowledge
list_document_ack documents.files.ack_list
conversations messages.chat.read
contacts @action
group_detail messages.chat.read
create_group messages.groups.create
update_group messages.groups.edit
update_reaction messages.chat.react
message_reactors messages.chat.reactors
add_poll_option messages.poll.options
vote_in_poll messages.poll.vote
messages messages.chat.read
send_message @action
read_messages messages.chat.read
read_group messages.chat.read
batteries equipment.assets.read
battery_timeline equipment.assets.history
add_battery equipment.assets.create
events equipment.assets.history
delete_battery_event equipment.battery.delete
add_event @action
equipment_assets equipment.assets.read
add_equipment_asset equipment.assets.create
equipment_asset_events equipment.assets.history
add_equipment_event @action
scan_events scanner.codes.events
create_private_scan_event scanner.codes.create
scan scanner.open
charge_batteries equipment.battery.batch
my_card profile.card.own
my_card_qr profile.card.own
member_card members.card.read
member_card_qr members.card.read
reset_member_card members.card.reset
notification_preferences -
push_config -
subscribe_push -
unsubscribe_push -
push_notification @action
training_proposals calendar.proposals.read
create_training_proposal calendar.proposals.create
edit_training_proposal calendar.proposals.edit
update_training_proposal @action
vote_training_proposal calendar.proposals.vote
loan_members @action
equipment_loans @action
create_equipment_loan @action
update_equipment_loan @action
edit_equipment_asset equipment.assets.edit
edit_battery equipment.assets.edit
"""
ENDPOINTS = dict(line.split() for line in ENDPOINTS.strip().splitlines())
