<!--
Plain-language End User License Agreement for the PROPRIETARY MailPoppy desktop
admin app (the closed UI shell + any Pro/Business modules). The open-source
components (sidecar engine, lambdas, infra, packages, web, mobile) are licensed
separately under the FSL — this EULA does not override those.

This is written in plain language for MailPoppy by its maintainer. It is not
legal advice; if you can have a lawyer review it later, do — it is usable as-is.
-->

# MailPoppy End User License Agreement (EULA)

**Last updated: 14 June 2026**

This Agreement is between **you** (the person or organisation installing the software)
and **Marco Tomasello**, the owner and operator of MailPoppy ("**MailPoppy**",
"**we**", "**us**"). By downloading, installing, or using the MailPoppy desktop
administration application, you agree to these terms. If you do not agree, do not
install or use it.

## 1. What this covers

This Agreement governs the **MailPoppy desktop administration application** and any
**Pro / Business** features we provide as part of it (together, the "**Application**") —
the software you download and run on your own computer to set up and manage email in
your own AWS account.

It does **not** govern the open-source parts of MailPoppy. The mail backend, the
infrastructure definition, the shared packages, the local engine ("sidecar"), the
webmail, and the mobile apps are published as **source-available** software under the
**Functional Source License (FSL-1.1-Apache-2.0)** and are governed by **that** licence,
not this one. Where the Application bundles those open components, your rights in those
components come from the FSL.

## 2. Licence we grant you

Subject to this Agreement (and, where applicable, an active subscription — see §4), we
grant you a **personal, non-exclusive, non-transferable, revocable** licence to install
and use the Application on computers you own or control, for your own use or your
organisation's internal use.

## 3. What you may not do

You may not:

- **sell, rent, sublicense, or redistribute** the Application, or make it available to
  others as a product or service;
- **remove, alter, or obscure** the MailPoppy name, logo, or notices, or pass the
  Application off as your own (see [`TRADEMARK.md`](./TRADEMARK.md));
- use the Application to **build or operate a competing product or service**;
- **circumvent, disable, or tamper with** the account, subscription, or entitlement
  checks, or any update mechanism;
- **reverse-engineer, decompile, or disassemble** the closed parts of the Application,
  except to the extent this restriction is prohibited by applicable law. *(This does not
  limit your rights in the open-source components, which you may inspect and modify under
  the FSL.)*

## 4. Accounts, subscriptions, and activation

Some features — and, where stated at download or purchase, use of the Application itself
— require a **MailPoppy account** and an **active subscription**. The Application may
check, over the network, whether your account is entitled to those features before it
will run them. We bill subscriptions through our **website** (via our payment processor,
Stripe), not inside the app.

- You must give **accurate account information** and keep your login secure. You are
  responsible for activity under your account.
- Subscriptions **renew** for successive periods until cancelled, at the price and
  interval shown at purchase. You can cancel at any time; cancellation stops the next
  renewal and does not refund the current period unless required by law or stated at
  purchase.
- If your subscription lapses, **paid features stop working**. This does not affect the
  email already running in your own AWS account, or your separate rights under the FSL to
  the open-source components.
- We may change prices or plans on a **going-forward** basis, with reasonable notice
  before your next renewal.

## 5. Your AWS account, your data

MailPoppy runs **in your own AWS account**, against infrastructure you own.

- **We do not access your email or your AWS credentials.** Your credentials stay on your
  machine; your mail stays in your AWS. This is the core design of MailPoppy — see our
  Privacy Policy for the full statement.
- **You are responsible for your AWS account**: your AWS charges and usage, your
  credentials, your domains, your DNS, and the email you send and receive — including
  compliance with anti-spam laws (e.g. CAN-SPAM, GDPR) and with AWS's own terms.
- You are responsible for **backups and retention** of your own data. Deleting MailPoppy's
  infrastructure (e.g. one-click teardown) removes the resources it created in your account.

## 6. Updates

We may provide updates, fixes, and new versions. Some updates may be **required** for the
Application to keep working (for example, for security or AWS-API compatibility). Where an
update materially changes these terms, §11 applies.

## 7. Third-party services

The Application works with third-party services — **Amazon Web Services** in particular.
Your use of those services is governed by **their** terms and pricing, directly between you
and them. We are not responsible for third-party services, their availability, or their
charges.

## 8. Intellectual property

We (or our licensors) own all rights in the Application and in the **MailPoppy name, logo,
and brand**. This Agreement grants you a licence to **use** the Application, not any
ownership of it. Nothing here transfers any trademark rights; see [`TRADEMARK.md`](./TRADEMARK.md).

## 9. No warranty

THE APPLICATION IS PROVIDED **"AS IS"** AND **"AS AVAILABLE"**, WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE, AND NON-INFRINGEMENT. We do not warrant that the Application will be uninterrupted
or error-free, or that email will always be delivered — email deliverability depends on
many factors outside our control (your AWS/SES configuration and reputation, recipients'
servers, and more).

## 10. Limitation of liability

To the maximum extent permitted by law:

- We are **not liable** for indirect, incidental, special, consequential, or punitive
  damages, or for lost profits, lost data, or lost email, or for **your AWS charges**.
- Our **total liability** to you for any claim relating to the Application is limited to
  the **amount you paid us for the Application in the 12 months** before the claim (or, if
  you paid us nothing, **EUR 50**).

Some jurisdictions do not allow certain limitations, so parts of this section may not apply
to you; in that case our liability is limited to the smallest extent permitted by law.
Nothing here limits liability that cannot be limited by law (such as for fraud).

## 11. Term and termination

This Agreement applies for as long as you use the Application. It ends automatically if you
breach it. We may suspend or end your licence (and your account/subscription) if you breach
this Agreement or misuse the Application. On termination you must **stop using and remove**
the Application. Sections 5, 8, 9, 10, and 12 survive termination. Ending this Agreement
does **not** remove the infrastructure already deployed in your own AWS account, nor your
rights to the open-source components under the FSL.

## 12. Governing law

This Agreement is governed by the laws of **the Netherlands**, without regard to its
conflict-of-laws rules, and the United Nations Convention on Contracts for the International
Sale of Goods does not apply. The competent courts of the Netherlands have exclusive
jurisdiction, except that either party may seek injunctive relief where its rights would
otherwise be harmed. This does not remove any mandatory consumer-protection rights you have
under the law of your place of residence (including, for EU consumers, the protections of EU
consumer law).

## 13. Changes to this Agreement

We may update this Agreement. For **material** changes we will give reasonable notice (in
the app, by email, or on the website). Continuing to use the Application after a change
takes effect means you accept the updated terms; if you do not agree, stop using the
Application.

## 14. Contact

Questions about this Agreement: **support@mailpoppy.com**.
