# Supplier Quality Agent

**Closing the quality loop for a print marketplace.**

An online print marketplace does not print itself: partner printers produce and carriers deliver. When something goes wrong, customer service resolves the complaint with a reprint or refund, but the loop often stops there:

- the real root cause is not recorded (customer file, printer or carrier?),
- the cost is not charged to whoever caused it,
- the same supplier error reaches the next customer.

This prototype is an AI agent that reads complaints from the existing ticket stream and closes that loop.

> **Live demo:** open `index.html` (or the GitHub Pages link). All suppliers, orders, complaints and costs are **sample data**.

## What it does

1. **Reads** complaints in any language (EN, NL, DE, FR, ES in the demo). Nobody types anything extra.
2. **Classifies** the defect (colour, cutting, blur, damage, delay, quantity, paper) and the **root-cause owner**, using the order data: which printer, which carrier, and what the upload file check found.
3. **Assigns the cost** to the right party: customer file, supplier or carrier.
4. **Scores suppliers** (defect rate, top defect, own cost) and opens a **CAPA** when the same defect repeats.
5. **Drafts the CAPA request** with evidence and **suggests rerouting** work to a better-performing printer until it is closed.

## Who does what

| | Role |
|---|---|
| **AI** | Reads messy multilingual text, judges the root cause, writes the CAPA draft |
| **Code** | Calculates rates, costs and thresholds (where AI should not be trusted) |
| **Person** | Confirms or overrides every owner; nothing is sent to a supplier automatically |

A rule-based classifier runs as a baseline and as a cross-check: the app shows how often AI and rules agree, so a person looks at the disagreements first.

## How I would measure it

- Recovered reprint/refund cost per month
- Repeat-defect rate per supplier after a CAPA
- CAPA closing time
- How often the quality specialist overrides the agent (the agent's own quality KPI)

## Project structure

| File | What it contains |
|---|---|
| `index.html` | Page structure |
| `style.css` | Styling, including dark mode |
| `data.js` | Sample suppliers, carriers, orders and complaints |
| `script.js` | Rule-based classifier, calculations, AI calls and rendering |

## Run it

Plain HTML, CSS and JavaScript, no framework or build step.

- **Rules only:** open `index.html` in a browser (or use VS Code Live Server).
- **With AI:** paste an Anthropic API key in the box on the Overview tab. The key stays in memory and is sent only to Anthropic.

## Why I built it

I have three years of experience in quality assurance: root cause analysis, supplier non-conformities, complaint handling and CAPA across IFS, BRC and FSSC 22000 certified factories. This project applies that quality loop to a marketplace with AI. The domain logic (root-cause rules, CAPA thresholds, what to measure) comes from that experience.

## What I would do next

- Connect to a real ticket stream and order data instead of sample data
- Build a labelled test set and measure classification accuracy before trusting it
- Use photos attached to complaints as extra evidence
- Feed confirmed root causes back into supplier selection automatically

*Prototype by Melis Gönden. Built with Claude as my coding partner.*