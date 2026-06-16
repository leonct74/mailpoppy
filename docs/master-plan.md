# MailPoppy — Master Plan (Product · Website · Marketing)

> The governing plan. Product development, website, and go-to-market in one place, phased.
> We work against this from now on. Last updated 2026-06-16.
> Companion docs: [agent onboarding](./agent-onboarding-interview.md), DESIGN.md (architecture), DESIGN.md §13 (deliverability).

---

## 0. North star

**What MailPoppy is:** business email you *own* — deployed into your *own* AWS account, where
no vendor (not even us) can read it, for a price per-seat incumbents structurally can't match,
with an AI assistant built in.

**Lead wedge (the beachhead):** **Amazon WorkMail refugees.** WorkMail is EOL — no new customers
since 2026-04-30, full shutdown **2027-03-31**, all data deleted after. ~27–30k corporate
customers who *specifically chose email-inside-AWS* must migrate within months. They are the
exact psychographic MailPoppy is built for, and they have a deadline. (Verified via AWS docs.)

**Secondary segment:** AWS-native indie businesses / developers / agencies already past the
"AWS account" hurdle (the SES installed base — hundreds of thousands of orgs already in AWS).

**Long-tail:** privacy/ownership-minded prosumers (the "Jerry" creator persona). Not the
headline; a halo.

**The economic weapon:** BYO-AWS → our marginal cost per customer ≈ **$0** (the user pays AWS for
their own infra). Agents run on the **user's own Bedrock**, so even AI stays ≈ $0 to us. This
lets us undercut everyone and still profit. *Real costs we do carry:* code-signing (Apple ~$99/yr
+ Windows cert), Stripe (~3%), hosting/domain, ads, our time.

**The two-engine GTM:**
- **Attention engine = the agents.** The AI assistant is the demo-able "wow" that earns
  Product Hunt / HN / Reddit attention and differentiates us from boring "WorkMail alternative"
  listicles.
- **Conversion engine = the WorkMail catalyst + unbeatable price.** Intent-driven, deadline-
  driven, low-competition acquisition + a price nobody can match → cheap conversion + word-of-mouth.

**Packaging decision (settled):** ONE product under the MailPoppy brand. Agents are an
**integrated premium feature shipped as a fast-follow** — *not* bundled into v1 (don't delay
launch), *not* a separate product (a solo budget can't market two brands). This yields **two
launch moments from one product**.

**Monetisation model:** desktop admin/back-end deploy = **free** (the "own your email" core).
The **paid product is the mobile client** — and the agent's *real-time, push, approve-on-the-go,
hands-off* experience is what makes the mobile client worth paying for. Pricing leans on the
zero-marginal-cost advantage (see §3).

---

## 1. Timeline at a glance

Today: 2026-06-16. WorkMail shutdown: 2027-03-31 (~9.5 months). The migration wave is live now and
peaks late-2026 → early-2027. We must be in-market fast to ride it, with the agent "2.0" moment
landing comfortably inside the window.

| Phase | Theme | Target window |
|---|---|---|
| **0** | Launch-ready core + WorkMail wedge | now → ~6 weeks |
| **1** | Trust (deliverability + expectations) | overlaps, weeks 4–8 |
| **2** | Agents 2.0 — the headline upgrade | months 2–4 |
| **3** | Widen (more email-native agents; Outlook bridge call) | months 4–7 |
| **4** | Platform (connect outside agents + mission control) | months 7+ |

---

## 2. The phases (Product · Website · Marketing per phase)

### Phase 0 — Launch the core on the WorkMail wedge

The core is **already built**. The job is to make it sellable and get in front of the wave. Do
not gate launch on agents.

**Product**
- [ ] **Polish the AWS-connect step — the #1 conversion cliff.** Guided wizard copy, a walkthrough
      video, dead-simple language, fail-soft errors. Nothing else matters if non-technical buyers
      fall off here.
- [ ] **WorkMail migration on-ramp** — a WorkMail-specific guided flow on top of the existing IMAP
      migration import (source-server presets, step-by-step, "bring your mail across" framing).
- [ ] Pricing + purchase wired (Stripe) for the mobile client unlock.
- [ ] Final QA pass on the happy path: deploy → mailbox → send/receive → mobile read/reply.

**Website**
- [ ] **Reposition the homepage** to lead with "own your business email, in your AWS" + the
      WorkMail angle. Kill any consumer-only framing.
- [ ] **Dedicated WorkMail page** — "Amazon WorkMail is shutting down (2027). Move to email you
      actually own." SEO target + migration CTA. (Reuse the /check-statement SEO playbook: visible
      FAQ + FAQPage schema kept in sync.)
- [ ] **Pricing page** (free vs paid mobile — see §3 matrix).
- [ ] Meta/OG/schema for the WorkMail + alternative keywords.

**Marketing**
- [ ] Stand up SEO/content around WorkMail keywords ("WorkMail shutdown migration", "WorkMail
      alternative", "WorkMail end of life") — highest-intent, lowest-competition window.
- [ ] Seed presence where refugees ask for help: r/aws, r/sysadmin, r/selfhosted, AWS forums,
      IndieHackers — *helpful answers*, not spam.
- [ ] Prepare (don't fire yet) the launch assets: Show HN, Product Hunt, a short demo video.
- [ ] Start an **agent waitlist/"coming soon"** email capture to build the Phase-2 audience.

**Exit criteria:** a non-technical tester can go from download → working email → paid mobile in one
sitting; the WorkMail page is live and indexing; first paying users.

---

### Phase 1 — Trust (deliverability + honest expectations)

Pre-empt the #1 disappointment/refund driver. Cheap, high-leverage trust.

**Product**
- [ ] **Warm-up coach** — in-app, time-aware guidance for the first ~2 weeks (send to friendly
      contacts, get replies, reputation status light), reading the sending-health signals we
      already collect.
- [ ] Surface the by-use-case **time-to-inbox** guidance contextually (first-send banner;
      sending-health view), not as a wall of text.

**Website**
- [ ] **"What to expect: inbox placement & warm-up"** page built on the by-use-case table
      (1:1 fast; Outlook slower ~2–4 wks; bulk needs a ramp). Honesty as a trust asset.

**Marketing**
- [ ] Turn the deliverability honesty into a content piece ("the truth about new-domain email
      deliverability") — earns credibility + ranks.

**Exit criteria:** new users have realistic expectations; deliverability questions answered
before they're asked.

---

### Phase 2 — Agents 2.0 (the headline upgrade + the paid-mobile supercharger)

The attention engine. Ship the generic email agent, draft-only first, tied to the paid mobile
client. This is the second launch moment.

**Product**
- [ ] **Agent engine** — event-triggered (off the inbound-processor) Lambda in the user's AWS,
      calling **Bedrock/Claude** (user's own → ≈ $0 to us). Generic: one engine, many roles.
- [ ] **Conversational onboarding** that fills the universal 8-field brief (see onboarding doc);
      template gallery + "describe your own"; seed-from-website/past-email; **draft-only default**.
- [ ] **Control plane**: push notification + one-tap approve in the mobile app; kill switch.
- [ ] **The mobile tie:** real-time push, approve-on-the-go, and hands-off autonomy = **mobile-only
      (paid)**; free desktop agent = tethered/digest but still wow-worthy (protect the demo).
- [ ] Progressive learning (asks when unsure, remembers).

**Website**
- [ ] **Agent feature page** — "Meet your AI inbox assistant." Lead the whole site with this.
- [ ] Update pricing page: the agent is the reason to go paid-mobile (one-time vs subscription, §3).

**Marketing**
- [ ] **Second launch**: Product Hunt + Show HN + Reddit, powered by a great agent demo video.
- [ ] Activate the waitlist built in Phase 0.
- [ ] Creator/agency angle content (the "assistant that runs your inbox").

**Exit criteria:** a user sets up an agent in <2 min via the chat onboarding; the free→paid
mobile conversion lifts measurably; a second press spike.

---

### Phase 3 — Widen

**Product**
- [ ] More **email-native agents**: newsletter (opt-in, with unsubscribe + warm-up ramp), support
      auto-responder, lead follow-up. Same engine, new recipes.
- [ ] **Decision point: the IMAP/SMTP (Outlook) bridge.** WorkMail diehards live in Outlook. If
      demand pulls, build the always-on bridge (ECS/EC2 in the user's account; see DESIGN §11) —
      this widens WorkMail capture but adds a fixed monthly cost the user opts into.

**Website**
- [ ] Comparison pages (vs WorkMail / Workspace / 365) for SEO; "use your own client" page if the
      bridge ships.

**Marketing**
- [ ] Newsletter-agent + "use it in Outlook" as fresh content/launch beats.

---

### Phase 4 — Platform

**Product**
- [ ] **Door-2 connection** — public `/v1` API + scoped API keys so *outside* agents (e.g. a
      YouTube-comments summarizer) can email through MailPoppy. (Email-native we build; everything
      else connects — the line.)
- [ ] **Mission control** dashboard — toggle/monitor/spend/kill-switch for all agents.

**Marketing**
- [ ] Developer/agency positioning ("owned email infrastructure for your agents").

---

## 3. Pricing (cross-cutting)

Lean on the ≈ $0 marginal cost. Keep launch simple; let agents unlock recurring revenue later.

**Launch (Phase 0):** Free core; **mobile client = one-time unlock** (on-brand with the pay-once
instinct; undercuts $6/seat dramatically).

**With agents (Phase 2):** the agent justifies either a higher one-time mobile price or a
**subscription** — people resist paying monthly for "an email app" but happily pay monthly for
"an assistant that works for them daily." Recommend testing a low monthly "Assistant" tier
alongside the one-time app unlock.

**Draft on-page free-vs-paid matrix (Phase 2):**

| | Free (desktop) | Paid — MailPoppy Mobile + Assistant |
|---|---|---|
| Own your email in your AWS | ✅ | ✅ |
| Unlimited mailboxes/domains | ✅ | ✅ |
| Read/send on the desktop app | ✅ | ✅ |
| Create & configure AI agents | ✅ | ✅ |
| Agent drafts replies | ✅ (review at desk) | ✅ |
| **Real-time push + one-tap approve, anywhere** | ❌ | ✅ |
| **Hands-off autonomy ("handle routine, ping me on real offers")** | ❌ | ✅ |
| "Your inbox runs itself while you're away" | ❌ | ✅ |

*Word the paid column as "your assistant in your pocket," never "email on your phone."*

---

## 4. Marketing plan detail

**Acquisition, ranked by cost-efficiency (we are budget-constrained):**
1. **WorkMail-shutdown SEO + content + migration tool** — highest intent, deadline urgency, low
   competition. *The primary channel.*
2. **Launch moments** (Phase 0 core, Phase 2 agents) — Product Hunt, Show HN, Reddit, IndieHackers.
   Two spikes from one product.
3. **Word-of-mouth** via near-free pricing + a simple referral nudge.
4. **Community helpfulness** in AWS/self-hosted forums where refugees are asking what to do.
5. **Paid ads — last.** With a tiny budget, do not fight giants in ad auctions; if anything, small
   retargeting only.

**Content calendar spine (now → 2027-03):** WorkMail-shutdown guide → "WorkMail alternatives"
comparison → migration how-to → deliverability honesty piece → agent reveal → newsletter-agent →
Outlook/IMAP (if shipped). Each doubles as an SEO page and a social/launch beat.

---

## 5. Risks & guardrails

- **The AWS-connect cliff is the whole ballgame.** Fix before spending on marketing.
- **IMAP/Outlook gap caps WorkMail conversion** until Phase 3. Be honest in copy about who it's
  for *today* (people happy with MailPoppy's own apps).
- **No calendar/contacts = not full WorkMail parity.** Win "I want email I own," not "I need full
  Exchange" — yet.
- **Don't let the agent dream delay revenue.** Ship the core first.
- **Don't strangle the agent's free demo** — the paywall is "real-time/mobile/hands-off," not "the
  agent exists." The free agent must stay wow-worthy for word-of-mouth.
- **Keep AI on the user's Bedrock** — don't become a token cost-center.

---

## 6. What we watch (signals, not vanity)

- Phase 0: download → working-email completion rate (the cliff); first paid conversions; WorkMail
  page impressions/clicks.
- Phase 1: refund/complaint rate on deliverability; warm-up coach completion.
- Phase 2: agent setup completion (<2 min); free→paid-mobile lift; launch-day traffic/signups.
- Ongoing: word-of-mouth (referral share), WorkMail-keyword rankings.

---

## 7. Immediate next actions (do these first)

1. **Phase 0 launch kit** — WorkMail-angle homepage + dedicated WorkMail page copy (with FAQ/schema),
   and the free-vs-paid pricing copy.
2. **AWS-connect polish** — rewrite the connect step + script a short walkthrough.
3. **WorkMail migration on-ramp** — wrap the existing IMAP import in a WorkMail-specific guided flow.
4. Stand up the **agent waitlist** capture on the site.

> Update this doc as phases complete. It is the single source of truth for sequencing.
