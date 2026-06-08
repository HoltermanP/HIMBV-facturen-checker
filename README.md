# HIMBV — Bonnen & Facturen → Basecone

Productie-klare Next.js 14 (App Router) app die bonnen en facturen via OCR naar
**Basecone** stuurt en registreert in **Neon Postgres**. Drie ingangen, één pijplijn:

1. **iPhone** — foto van een bon maken (camera) en versturen.
2. **Laptop** — één of meerdere PDF's/afbeeldingen uploaden via drag-and-drop.
3. **Mail doorsturen** — facturen die je naar een mailmap stuurt worden automatisch opgehaald.

Elke binnenkomende bon/factuur doorloopt: **OCR** (bedrag, btw, leverancier, datum)
→ **e-mail met bijlage naar Basecone** → **registratie in Neon**.

## Cruciale ontwerpkeuze: deliverability

Basecone accepteert alleen mail van geautoriseerde afzenders. Daarom verstuurt deze
app de mail **vanuit je eigen `@himbv.nl`-mailbox via SMTP** (niet via een externe
mailservice). Zo is de afzender je whitelisted `@himbv.nl`-adres en wordt de mail door
Basecone geaccepteerd. De app probeert daarna een kopie in je **Verzonden-map** te zetten.

> Deze versie werkt met **standaard SMTP (versturen) en IMAP (ophalen)** — voor mail die
> op gewone hosting draait (dus *geen* Microsoft 365 of Google Workspace nodig).

## Stack

- Next.js 14 (App Router, route handlers, `runtime = 'nodejs'`)
- `nodemailer` (SMTP versturen) + `imapflow` (IMAP ophalen)
- OpenAI `gpt-4o-mini` met vision voor OCR
- Neon (`@neondatabase/serverless`)
- Deploy op Vercel, mailbox-poll via Vercel Cron (dagelijks op Hobby; vaker met externe cron of Pro)

---

## Architectuur

```
app/page.jsx               Webclient: drag-and-drop, bestand kiezen, foto maken
app/check/page.jsx         Volledigheidscontrole: CSV-afschrift uploaden + rapport
app/api/intake             POST multipart -> per file de pipeline (handmatig)
app/api/poll-mail          GET via cron -> ongelezen mail uit INTAKE_FOLDER -> pipeline
app/api/transactions/import POST CSV -> transacties opslaan + matchen
app/api/report             GET -> uitgaven zonder bon + bonnen zonder transactie
lib/mail.js                SMTP versturen + IMAP ophalen/markeren als gelezen
lib/ocr.js                 OpenAI vision -> {amount, vat, vendor, doc_date}
lib/db.js                  Neon: documenten + transacties + matching-queries
lib/process.js             Gedeelde pipeline + isProcessable-filter
lib/bankcsv.js             Flexibele bankafschrift-CSV-parser
lib/match.js               Matching transacties <-> bonnen (bedrag + datum ±7d)
db/schema.sql              Tabellen documents + transactions + indexen
vercel.json                Cron: 0 7 * * * (dagelijks; Hobby-plan staat niet vaker toe)
```

**Idempotentie bij mail.** Per bijlage is de sleutel
`${internetMessageId || uid}#${mimeDeelnummer}` de `message_id` in de database.
Een mail met meerdere facturen levert dus meerdere registraties op, maar niets gaat
dubbel naar Basecone — ook niet als de cron vaker draait. Handmatige uploads hebben
géén `message_id` (null) en worden altijd geregistreerd.

**Foutafhandeling.** Een OCR-fout blokkeert het versturen niet (er wordt dan met lege
velden verstuurd). Een mislukte verzending is wél een harde fout (502); het bericht
wordt dan **niet** als gelezen gemarkeerd, zodat de volgende cron-run het opnieuw probeert.

---

## Handmatige stappen (eenmalig)

### 1. Mailgegevens (SMTP + IMAP) opvragen bij je hostingpartij

Vraag (of zoek in het klantenpaneel van je hosting) de instellingen op voor de mailbox
`patrickholterman@himbv.nl`:

| Wat | Voorbeeld | Env-variabele |
|---|---|---|
| SMTP-server (uitgaand) | `smtp.jouwhosting.nl` | `SMTP_HOST` |
| SMTP-poort | `465` (TLS) of `587` (STARTTLS) | `SMTP_PORT` |
| IMAP-server (inkomend) | `imap.jouwhosting.nl` (vaak gelijk aan SMTP) | `IMAP_HOST` |
| IMAP-poort | `993` | `IMAP_PORT` |
| Gebruikersnaam | meestal `patrickholterman@himbv.nl` | `MAILBOX_USER` |
| Wachtwoord | mailbox-wachtwoord (of een *app-wachtwoord*) | `MAILBOX_PASSWORD` |

> Heeft je hosting tweestapsverificatie of een aparte "app-wachtwoord"-functie voor
> mail? Maak dan een app-wachtwoord aan en gebruik dat als `MAILBOX_PASSWORD`.

### 2. Mailmap maken voor doorgestuurde facturen

1. Maak in je mailprogramma (of webmail) een map met exact de naam uit `INTAKE_FOLDER`
   (standaard **`Bonnen-intake`**). Submappen worden ook gevonden.
2. Optioneel een alias `factuur@himbv.nl` aanmaken die naar je mailbox aflevert.
3. Maak een **mailregel**: berichten gericht aan `factuur@himbv.nl` (of met een bepaald
   onderwerp) → **verplaats naar map `Bonnen-intake`** en **laat ongelezen**.
   De poll zoekt naar ongelezen berichten met bijlagen, dus zorg dat doorgestuurde
   facturen ongelezen in die map binnenkomen.

### 3. Neon database

1. Maak een project op [neon.tech], kopieer de connection string → `DATABASE_URL`.
2. Draai het schema:

   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   # of plak de inhoud van db/schema.sql in de Neon SQL Editor
   ```

### 4. Environment variables

Vul `.env.example` in (lokaal als `.env.local`, op Vercel onder **Project Settings →
Environment Variables**):

| Variabele | Waarde |
|---|---|
| `BASECONE_ADDRESS` | jouw Basecone-inboxadres |
| `INTAKE_SECRET` | zelf verzonnen token voor `/api/intake` |
| `CRON_SECRET` | zelf verzonnen token voor `/api/poll-mail` |
| `MAILBOX_USER` / `MAILBOX_PASSWORD` | login van je `@himbv.nl`-mailbox |
| `SMTP_HOST` / `SMTP_PORT` | uitgaande mailserver |
| `IMAP_HOST` / `IMAP_PORT` | inkomende mailserver |
| `INTAKE_FOLDER` | `Bonnen-intake` |
| `OPENAI_API_KEY` | OpenAI key |
| `DATABASE_URL` | Neon connection string |

### 5. Deploy op Vercel

```bash
npm install
npm run build      # moet slagen
vercel             # of koppel de repo in het Vercel-dashboard
```

`vercel.json` registreert de cron automatisch. Vercel stuurt bij elke cron-run de header
`x-vercel-cron`, dus `/api/poll-mail` werkt zonder dat je een token hoeft te configureren
in de cron-definitie. Voor handmatig testen gebruik je `CRON_SECRET`.

> **Hobby-plan: max. 1× per dag.** Op het gratis Vercel-plan mag een cron maar één keer
> per dag draaien; daarom staat de schedule op `0 7 * * *` (07:00 UTC). Wil je vaker
> ophalen (bijv. elk kwartier), dan zijn er twee opties:
>
> 1. **Externe cron-service** (gratis, aanbevolen): laat bijv. [cron-job.org] elke 15 min
>    een GET doen naar `https://<jouw-app>.vercel.app/api/poll-mail` met header
>    `Authorization: Bearer <CRON_SECRET>`. De route accepteert deze auth gewoon.
> 2. **Upgrade naar Vercel Pro** en zet de schedule terug op `*/15 * * * *`.

> Let op: SMTP/IMAP gebruiken uitgaande TCP-verbindingen. Dat werkt op Vercel met de
> Node.js-runtime (al ingesteld via `runtime = 'nodejs'`).

### 6. iPhone

- Open de Vercel-URL in Safari → **Deel → Zet op beginscherm** (werkt als een app).
- Vul onder **Instellingen** je `INTAKE_SECRET` in (wordt in localStorage bewaard).
- Knop **📷 Foto maken** opent direct de camera (`capture="environment"`).

**Optionele Shortcut** (Snelkoppeling) die een foto rechtstreeks POST naar `/api/intake`:

1. Snelkoppelingen → nieuwe snelkoppeling → *Foto's maken* → *Inhoud van URL ophalen*.
2. URL: `https://<jouw-app>.vercel.app/api/intake`
3. Methode: **POST**, Aanvraagtekst: **Formulier**
   - Voeg veld toe, type **Bestand**, naam **`file`**, waarde = de gemaakte foto.
4. Koptekst: **`Authorization`** = **`Bearer <INTAKE_SECRET>`**.
5. Bewaar; voeg de Shortcut toe aan je beginscherm of de Actieknop.

---

## API

### `POST /api/intake`
- Auth: `Authorization: Bearer <INTAKE_SECRET>`
- Body: `multipart/form-data` met één of meer velden `file` (image/* of application/pdf).
- Antwoord: `{ status, results: [{ filename, status, vendor, amount, doc_date }] }`.
  Status **207** bij gedeeltelijk falen, **502** als alles faalt.

### `GET /api/poll-mail`
- Auth: `Authorization: Bearer <CRON_SECRET>` **óf** header `x-vercel-cron` (Vercel).
- Antwoord: `{ processed, skipped, errors, detail }`.

### `POST /api/transactions/import` (volledigheidscontrole)
- Auth: `Authorization: Bearer <INTAKE_SECRET>`
- Body: `multipart/form-data` met veld `file` (een bankafschrift-CSV).
- Slaat transacties idempotent op (op fingerprint) en draait daarna de matching.
- Antwoord: `{ status, parsed, imported, duplicates, matched, warnings }`.

### `GET /api/report` (volledigheidscontrole)
- Auth: `Authorization: Bearer <INTAKE_SECRET>`
- Antwoord: `{ missing, docsWithout, counts }` — uitgaven zonder bon en bonnen zonder transactie.

**Handmatige test-curl voor de poll:**

```bash
curl -i "https://<jouw-app>.vercel.app/api/poll-mail" \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Handmatige test-curl voor de intake (2 PDF's tegelijk):**

```bash
curl -i "https://<jouw-app>.vercel.app/api/intake" \
  -H "Authorization: Bearer $INTAKE_SECRET" \
  -F "file=@factuur1.pdf;type=application/pdf" \
  -F "file=@factuur2.pdf;type=application/pdf"
```

---

## Acceptatiecriteria (checklist)

- [x] `npm run build` slaagt.
- [x] Alle API-routes valideren auth en geven nette JSON-fouten.
- [x] Laptop-upload van 2 PDF's → 2 mails naar Basecone + 2 rijen in Neon.
- [x] Doorgestuurde mail met 1 PDF wordt binnen één cron-run verwerkt en als gelezen
      gemarkeerd; opnieuw draaien geeft geen dubbele registratie.

## Volledigheidscontrole (bankafschrift)

Ga naar **`/check`** (link "Controle" op de hoofdpagina):

1. Upload een **bankafschrift als CSV** (export uit je bank). De parser herkent automatisch
   het scheidingsteken en de kolommen (datum, bedrag, tegenpartij, omschrijving) en de
   NL-bedragnotatie. Her-uploaden geeft geen dubbele regels (idempotent op fingerprint).
2. Elke **uitgave** wordt gekoppeld aan een geregistreerde bon op **bedrag (exact) + datum
   (±7 dagen)**; een leveranciersnaam die op de tegenpartij lijkt is een tiebreaker.
3. Het rapport toont **uitgaven zonder bon** (de gaten) en **bonnen zonder transactie**.

> Matching is één-op-één: een bon wordt aan hooguit één transactie gekoppeld. Alleen
> uitgaven (negatieve bedragen) hoeven een bon te hebben; bijschrijvingen worden genegeerd.

## Opmerkingen

- OCR werkt het best op afbeeldingen. PDF's worden als databron meegestuurd; lukt het
  uitlezen niet, dan faalt OCR zacht (lege velden) en gaat de bijlage alsnog naar Basecone.
- De `isProcessable`-filter negeert bijlagen ≤ 15 KB (logo's/handtekeningen in mailfooters).
- De kopie in de Verzonden-map is best-effort: lukt het IMAP-appenden niet, dan is de mail
  nog steeds verstuurd.
