# MailPoppy — agent onboarding (the "it interviews you" setup)

> Design note for the built-in email agents (the Door-1 / "be the experience" path).
> Status: vision / not yet built. Captures the onboarding approach so we don't have to
> re-derive it. Related: DESIGN.md §11 (bring-your-own client), §13 (deliverability).

## Why this exists

The agent engine is **generic**: it watches an inbox, reads incoming mail, and responds
according to a brief. "Sponsor concierge" is **one template**, not the product. The same
engine serves sales enquiries, customer support, freelance/recruiting replies, press,
booking requests — infinitely many roles.

We cannot write a bespoke onboarding wizard per use-case. The escape: **don't enumerate
use-cases, enumerate dimensions.** Every email-responding job has the same small, fixed set
of dimensions. We engineer those once; the user's answers make it a sponsor agent, a support
agent, or anything else.

## The universal brief (the 8 fields)

Every agent, regardless of role, is fully described by these. We always elicit these eight;
only the *content* changes per use-case.

| # | Field | What it captures |
|---|---|---|
| 1 | **Mailbox** | Which address it watches |
| 2 | **Mission** | One sentence: who writes here, and what you want done |
| 3 | **Knowledge** | What it can draw on (website, price list, CV, FAQ, past sent mail) |
| 4 | **Voice** | Tone / persona + signature |
| 5 | **Boundaries** | Hard never-dos (no prices, no commitments, no legal/medical claims) |
| 6 | **Escalate when** | When it must stop and ask the human |
| 7 | **Autonomy** | draft-only / handle-routine / handle-all (the leash) |
| 8 | **Goal** | What a *win* looks like (collect budget · book a call · resolve · send CV) |

Proof it covers everything — same four questions, four different agents:

| Role | Mission | Knowledge | Escalate when | Goal |
|---|---|---|---|---|
| Sponsor | "Brands wanting to sponsor my channel" | media kit, rates | a real money offer | get budget + book a call |
| Sales | "Prospects asking about my product" | pricing page, docs | custom/enterprise ask | qualify + book a demo |
| Support | "Customers with problems" | help docs, FAQ | refund / angry / legal | resolve, or escalate cleanly |
| Freelance | "Recruiters who found my site" | CV, portfolio | a firm offer or rate ask | send CV + portfolio, gauge fit |

## Design principle: a conversation, not a form

An 8-field form intimidates a non-technical user and gets filled badly. Instead the agent
**interviews** the user: it asks for the mission in plain words, then generates the *right*
follow-ups for whatever they said. We use the model itself to solve "we can't anticipate the
questions" — it anticipates them per-user, live.

Stack four techniques (in order of leverage):

1. **AI-led interview** — adaptive questions, ~90 seconds, not a form.
2. **Seed from what they already have** — infer voice + facts from their website and last
   ~50 sent emails instead of making them type. (Privacy-safe: stays in their AWS account.)
3. **Templates** — a starter gallery (Sponsorships · Sales · Support · Freelance · General)
   that pre-fills the brief with sensible defaults; everything editable; "Blank" always present.
4. **Progressive learning** — start thin, ask when unsure, remember forever. The brief
   completes itself through real cases.

## The interviewer's job (system-prompt sketch)

```
You are setting up an email assistant for a non-technical person. Your goal is to fill an
8-field brief: mailbox, mission, knowledge, voice, boundaries, escalate-when, autonomy, goal.

Rules:
- Ask ONE short question at a time, in plain language. No jargon.
- Start from their mission (one sentence). Generate follow-ups that are SPECIFIC to that
  mission — e.g. if it involves money, ask about prices/quotes; if support, ask about
  refunds/SLAs; if recruiting, ask what to send and what counts as a real offer.
- Prefer offering choices over open questions where possible ("Should I share your rates,
  or just collect interest?").
- Proactively offer to learn from their website + past sent emails to fill knowledge & voice.
- Always default Autonomy to "draft only" and confirm escalation triggers before finishing.
- End by reflecting the brief back in plain English and asking them to confirm or fix it.
- Stop once all 8 fields are populated to a usable level. Do not over-interrogate.
```

## The flow

1. **Pick a starting point** — template gallery, or "Describe your own".
2. **Opening question** — *"In one sentence, what's this inbox for?"* → fills **Mission**.
3. **Adaptive follow-ups** — chosen from the gaps the mission leaves (see logic below).
4. **Offer to seed** — *"Want me to read your website and recent sent emails so I sound like
   you and know your facts?"* → fills **Knowledge** + **Voice**.
5. **Set the leash** — autonomy level + escalation triggers (defaults: draft-only; escalate on
   money/contracts/complaints).
6. **Confirm the brief** — reflect it back: *"Here's how I understand my job… look right?"*
7. **Test run** — user sends a fake email; agent drafts; user sees quality before going live.
8. **Learn-on-the-job loop** — agent asks when unsure, each answer becomes a permanent rule.

## Adaptive follow-up logic

After the mission, detect which fields are under-specified and which **topic flags** the
mission raises, then ask only what's needed:

- mentions money / sponsorship / sales / quotes → ask about prices, what to disclose, floor.
- mentions support / problems / customers → ask about refunds, known issues, escalation.
- mentions recruiting / freelance / jobs → ask what to attach (CV/portfolio), rate handling.
- no clear goal → ask "what should happen by the end of a good exchange?" → **Goal**.
- always confirm **Boundaries** ("anything you never want me to say or promise?") and
  **Escalate-when** before finishing.

## Example transcripts (abridged)

**Sponsor**
- A: What's this inbox for? — U: People wanting to sponsor my fishing channel.
- A: Do you have set rates? Share them, or just collect interest? — U: Collect interest, don't quote.
- A: Anything you'd never accept? — U: No gambling or crypto brands.
- A: Want me to learn your voice from your last emails + media kit? — U: Yes.
- A: I'll draft replies for your approval and ping you on any firm offer. Sound right? — U: Yes.

**Support**
- A: What's this inbox for? — U: Customers having trouble with my course.
- A: Got a help doc or FAQ I can use? — U: Yes, here's the link.
- A: When should I hand it to you? — U: Refund requests or anyone angry.
- A: Resolve simple ones automatically, or draft everything first? — U: Draft first for now.

**Freelance**
- A: What's this inbox for? — U: Recruiters who find my portfolio site.
- A: What should I send them? — U: My CV and a link to my work.
- A: When do I get you involved? — U: If they name a budget or want a call.

## Progressive learning (the brief completes itself)

The brief is never "finished" upfront. On a real email the agent is unsure about, it asks the
human once and stores the answer as a rule: *"A brand asked about pricing — how should I handle
that? I'll remember."* This is lower-friction and more accurate than hypothetical upfront
questions, and pairs with draft-only so early gaps are caught by the human, not sent to a brand.

## Defaults & guardrails

- **Autonomy defaults to draft-only.** Loosen only after the user has seen good drafts.
- **Escalation defaults**: anything mentioning money, contracts, complaints, legal.
- **Hard never-dos** are always asked and always enforced regardless of autonomy.
- **Kill switch**: one button pauses/revokes the agent instantly.
- The onboarding never shows "8 fields" — the user sees a friendly chat that happens to
  populate them.

## Open questions / TODO

- How much past-email history to read for seeding, and how to summarise voice compactly.
- Where the brief lives (per-agent record) and how learned rules append to it.
- Template gallery content + later community/shareable recipes (ties to "mission control" phase).
- Multi-language onboarding (match the user's language).
