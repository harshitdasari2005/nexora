# How an office actually runs — and what Nexora should build

A research report for the Nexora project, written 2 October 2026.

**What this is.** A map of the work a software company does every day, department by department, written as pipelines: who starts a piece of work, who decides, who does it, who checks it, and what gets recorded. It then looks at how Amazon is publicly known to run these pipelines, and turns both into a build plan for Nexora.

**Where it comes from.** General knowledge of how software companies operate, and Amazon's publicly described practices (its leadership principles, shareholder letters, and books and talks by former Amazon leaders). I did not interview anyone or look anything up live for this report, and companies change their practices, so treat the Amazon sections as "how it is widely described", not as a current internal manual.

---

## 1. The one idea underneath everything

Almost all office work, in every department, has the same shape:

1. **Someone asks** for something (a hire, a feature, a purchase, a campaign, a refund).
2. **Someone decides** whether it should happen (often two people: the one who knows the need, and the one who controls the money or the risk).
3. **Someone does it.**
4. **Someone else checks it** (review, test, audit).
5. **It is recorded**, so the company can see what happened and learn from it.

Departments differ only in _what_ is asked for, _who_ holds each seat, and _what_ is measured. That is good news for Nexora: one well-built engine for "ask → decide → do → check → record" can carry the whole office. The hiring chain, the request chains and the task flow already in Nexora are three instances of it.

Three rules appear in every well-run office, and Nexora already enforces all three:

- **Nobody approves their own request** (separation of duties).
- **The person who controls the money decides after the person who knows the need.**
- **A "no" goes back to the person who asked, with a reason.**

---

## 2. The departments and their pipelines

For each department: the work it does, the main pipelines, what it records, and what it measures.

### 2.1 Leadership and planning (CEO, department heads)

| Pipeline               | Stages                                                                                                    | Who                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Yearly plan            | Each team proposes goals and what it needs → leadership reviews → budget is set → goals are published     | Team leads → CEO and Finance |
| Quarterly goals        | Goals set → progress checked every week → reviewed at quarter end                                         | Every team                   |
| Weekly business review | Each team reports the same numbers every week → problems are named → an owner and a date are set for each | Team leads → CEO             |
| Big decisions          | A written proposal → discussion → decision → the decision and its reasons are recorded                    | Proposer → decision owner    |

**Records:** goals, budgets, decisions and their reasons. **Measures:** goals met, budget used, time taken to decide.

### 2.2 People (HR)

| Pipeline                        | Stages                                                                                                                | Who                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Hiring                          | Team asks → CEO approves → Finance approves cost → HR opens the position → candidates → interviews → offer → accepted | Manager → CEO → Finance → HR, with the manager interviewing |
| Onboarding                      | Paperwork → accounts and equipment → buddy → orientation → active → put on a project                                  | HR, IT, manager                                             |
| Leave                           | Employee asks → manager approves → HR records it                                                                      | Employee → manager → HR                                     |
| Performance review              | Self review → manager review → calibration across managers → feedback conversation → raise or promotion decision      | Employee → manager → HR and leadership                      |
| Payroll                         | Attendance and leave collected → salary calculated → Finance approves → paid → payslips                               | HR → Finance                                                |
| Leaving the company             | Resignation → manager and HR accept → handover → access removed → equipment returned → final pay                      | Employee → manager → HR, IT, Finance                        |
| Complaints and policy questions | Raised (privately) → HR investigates → decision → recorded                                                            | Employee → HR                                               |

**Records:** employee file, contracts, leave balances, reviews, payroll. **Measures:** time to hire, offer acceptance rate, time to become productive, attrition.

### 2.3 Engineering and product (the "developing" part)

| Pipeline                                      | Stages                                                                                                        | Who                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| New product or feature                        | Idea written up from the customer's point of view → reviewed → approved and funded → broken into tasks        | Product owner → leadership            |
| Building                                      | Task assigned → developer builds → code review by someone else → tests pass → merged                          | Manager → developer → reviewer        |
| Releasing                                     | Release checklist → approval → release → watch the numbers → roll back if needed                              | Developer → release owner             |
| Bugs                                          | Reported → triaged by severity → assigned → fixed → verified → closed                                         | Anyone → manager → developer → tester |
| Incidents (something is broken for customers) | Detected → owner named → fixed → customers told → written review of the cause → follow-up actions with owners | On-call developer → manager           |
| Technical decisions                           | Written design → review → decision recorded                                                                   | Engineer → senior engineers           |

**Records:** specs, tasks, code reviews, releases, incident reviews. **Measures:** how long from idea to release, how often releases fail, time to recover from an incident, bugs reaching customers.

### 2.4 Marketing

| Pipeline                      | Stages                                                                                                                                               | Who                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Campaign                      | Brief (who it is for, what it should achieve, cost) → budget approval → content created → reviewed for brand and legal → launched → results measured | Marketer → marketing head → Finance → Legal |
| Content (blog, social, email) | Idea → draft → review → schedule → publish → measure                                                                                                 | Writer → editor                             |
| Product launch                | Launch plan → materials for sales and support → announcement → follow-up                                                                             | Marketing with product, sales and support   |
| Events and sponsorships       | Proposal → budget → vendor booking → event → leads handed to sales                                                                                   | Marketer → Finance → Procurement            |

**Records:** briefs, budgets, published content, results. **Measures:** leads generated, cost per lead, conversion, return on spend.

### 2.5 Sales

| Pipeline                  | Stages                                                                                 | Who                                |
| ------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| Deal                      | Lead → qualified → meeting → proposal → negotiation → won or lost → handed to delivery | Salesperson → sales head           |
| Discount or special terms | Salesperson asks → sales head approves → Finance approves above a limit                | Salesperson → sales head → Finance |
| Contract                  | Draft → Legal review → signed → stored                                                 | Salesperson → Legal                |
| Renewal                   | Reminder before expiry → conversation → renewed or lost                                | Account owner                      |

**Records:** customers, deals, contracts. **Measures:** pipeline value, win rate, time to close, revenue against target.

### 2.6 Customer support

| Pipeline         | Stages                                                                                  | Who                       |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------- |
| Ticket           | Customer reports → triage by urgency → assigned → resolved → customer confirms → closed | Support agent             |
| Escalation       | Agent cannot solve → goes to engineering as a bug → fix → customer told                 | Agent → engineering       |
| Refund or credit | Agent proposes → manager approves → Finance pays above a limit                          | Agent → manager → Finance |
| Learning         | Common problems collected → help articles written → product told what to fix            | Support lead → product    |

**Records:** tickets, resolutions, help articles. **Measures:** time to first reply, time to resolve, customer satisfaction, repeat problems.

### 2.7 Finance

| Pipeline            | Stages                                                                                                 | Who                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Budget              | Team proposes → Finance reviews → CEO approves → tracked through the year                              | Team lead → Finance → CEO                  |
| Buying something    | Request → manager approves → Finance approves → order placed → goods received → invoice matched → paid | Employee → manager → Finance → Procurement |
| Expense claim       | Employee submits with receipt → manager approves → Finance checks → reimbursed                         | Employee → manager → Finance               |
| Invoicing customers | Work delivered → invoice sent → payment tracked → reminders → received                                 | Finance                                    |
| Month-end close     | All entries in → reconciled → reviewed → reports to leadership                                         | Controller → CFO                           |

**Records:** budgets, purchase orders, invoices, payments, the books. **Measures:** spend against budget, days to pay and to get paid, cash in the bank.

### 2.8 IT and security

| Pipeline           | Stages                                                                                            | Who                     |
| ------------------ | ------------------------------------------------------------------------------------------------- | ----------------------- |
| Access to a system | Employee asks → manager approves → IT grants → reviewed regularly → removed when no longer needed | Employee → manager → IT |
| Equipment          | Asked for → approved → issued → tracked → returned                                                | Employee → manager → IT |
| Security incident  | Reported → contained → investigated → fixed → reported                                            | Anyone → security lead  |
| New software       | Requested → security and cost review → approved → set up                                          | Employee → IT → Finance |

**Records:** who has access to what, asset list, incidents. **Measures:** time to grant access, unreturned equipment, incidents.

### 2.9 Legal, compliance and office administration

| Pipeline        | Stages                                                                          | Who                          |
| --------------- | ------------------------------------------------------------------------------- | ---------------------------- |
| Contract review | Draft arrives → Legal reviews → changes → signed → stored with its renewal date | Any department → Legal       |
| Company policy  | Drafted → reviewed → approved → published → employees acknowledge it            | HR or Legal → CEO            |
| Audit           | Evidence requested → collected → findings → fixes with owners                   | Auditor → each department    |
| Travel          | Trip requested → manager approves → booked → expenses claimed                   | Employee → manager → Finance |
| Facilities      | Problem reported → assigned → fixed                                             | Anyone → office admin        |

---

## 3. How Amazon is known to run these pipelines

Amazon is useful to study because it is famous for running a huge company through a small number of written, repeatable routines — it calls them _mechanisms_. The idea is that good intentions do not scale; a routine that forces the right behaviour does.

### 3.1 Start from the customer, in writing ("working backwards")

Before building anything, the team writes a short press release as if the product were already launched, plus a list of hard questions and answers (customer questions and internal ones: cost, risks, what could go wrong). If the press release is not exciting or the questions cannot be answered, the product is not built. _The decision is made on the document, before any code._

→ **For Nexora:** a new project should start as a short written proposal with fixed questions, reviewed and approved before tasks are created.

### 3.2 Decisions on written narratives, not slides

Important meetings start with everyone silently reading a written document of up to six pages. Writing forces clear thinking, and everyone decides from the same facts.

→ **For Nexora:** every request already carries a written reason. Bigger decisions should carry a structured write-up, and the decision plus its reason should be stored with it.

### 3.3 One owner per thing, small teams

Each initiative has one person whose only job is that initiative (often called a single-threaded owner), and teams are kept small enough to be fed by two pizzas. Nothing important is "everyone's job".

→ **For Nexora:** every request, task and project has exactly one named owner at every moment. This is what "My desk" shows.

### 3.4 Hiring with a raised bar

A hire goes through a loop of interviewers, each testing specific things and writing their feedback _before_ seeing anyone else's. One interviewer from outside the hiring team (the "bar raiser") can veto the hire; their job is to stop a team under pressure from lowering its standard.

→ **For Nexora:** written interview feedback already exists. The next step is several interviewers with independent feedback, and an independent reviewer who must agree.

### 3.5 Yearly planning in two passes

Teams write a plan in the autumn (what they will achieve, what they need), leadership reviews and adjusts, and the plan is finalised after the busy season. Budgets and headcount follow the plan — which is why a hiring request needs both the leader and Finance.

→ **For Nexora:** budgets per team, and requests checked against them.

### 3.6 The weekly business review, and measuring inputs

Every week, leaders walk through the same set of numbers for every team. The emphasis is on _input_ measures the team controls (how fast candidates are answered, how many releases went out) more than _output_ measures (revenue), because inputs can be acted on.

→ **For Nexora:** one weekly page per team: what moved, what is stuck and for how long, who owns it.

### 3.7 Written reviews after things go wrong

After an incident, the team writes a review: what happened, the impact, the root cause found by asking "why" repeatedly, and follow-up actions with owners and dates. The point is to fix the system, not to blame a person.

→ **For Nexora:** an incident record with a cause and tracked follow-up tasks.

### 3.8 Fast decisions when they can be undone

Decisions that are easy to reverse should be made quickly by the people close to them; only the hard-to-reverse ones deserve slow, senior review. And once a decision is made, people commit to it even if they disagreed.

→ **For Nexora:** small requests need one approval; large or risky ones need the full chain. This is exactly what the policy engine is for (for example: a purchase above a limit needs Finance).

### 3.9 Teams own what they build

The team that builds a service also runs it and answers for it when it breaks. In customer service, front-line staff can stop the sale of a faulty product on their own authority.

→ **For Nexora:** the person closest to the problem can act within clear limits, and the limits are written as policy rather than left to judgement.

---

## 4. Where the AI belongs

The lesson from sections 2 and 3: the valuable part of an office is not the forms, it is the _judgement and the writing_ at each step. That is where an AI helps — and why it must not replace the deciding.

| Step      | What the AI does                                                                           | What stays with a person  |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| Asking    | Turns one sentence into a complete request; checks that nothing is missing                 | Sending it                |
| Deciding  | Prepares a brief: budget left, similar past requests, risks, a recommendation with reasons | The decision              |
| Doing     | Drafts the job posting, the campaign text, the reply to the customer; prepares IT setup    | Approving what goes out   |
| Checking  | Flags what looks wrong: over budget, outside policy, missing evidence                      | Accepting or sending back |
| Recording | Writes the summary, the weekly review, the incident review draft                           | Signing it off            |

Three rules, already true in Nexora's engine: the AI acts only with the role of the person it works for, policy can refuse it, and anything consequential needs a human approval that is recorded.

**This is the project's claim to being new:** not another management system, and not a chatbot — an office where an AI works at every step of every pipeline, and provably cannot skip a person.

---

## 5. Where Nexora stands today

| Area                        | Built and working                                                                            | Missing                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Hiring                      | Request → CEO → Finance → HR → candidates → offer → onboarding → project                     | Several interviewers, independent reviewer                  |
| Leave, purchases, IT access | Request → manager → HR / Finance / IT                                                        | Leave balance, purchase turning into an order and payment   |
| Project work                | Tasks: to do → in progress → review → done, with project progress                            | Project proposal before the work; releases; bugs; incidents |
| Finance                     | Budgets, expenses with approval                                                              | Invoices, purchase orders, month-end                        |
| Everyone's day              | My desk: what is waiting for you                                                             | Weekly review page                                          |
| Marketing                   | Nothing                                                                                      | Campaign pipeline                                           |
| Sales                       | Nothing                                                                                      | Deal pipeline, discount approval                            |
| Support                     | Nothing                                                                                      | Ticket pipeline, escalation to engineering                  |
| Performance, payroll, exits | Nothing                                                                                      | All three                                                   |
| The AI                      | A governed engine: roles, policy, approvals, record of every action, tested on 207 scenarios | The AI is not yet visible inside the pipelines              |

---

## 6. What to build in the three days

Nobody can build every pipeline above in three days, and a demo does not need them all. It needs enough of the office to be believable, and the AI visibly at work inside it. In order:

**Day 1 — more of the office**

1. **Project proposal** (the "working backwards" step): a short written proposal with fixed questions → CEO approves → the project opens and tasks can be created. This connects leadership to the task board already built.
2. **Marketing campaign**: brief → marketing head approves → Finance approves the budget → launch → results recorded. A new department with its own people in the demo office.
3. **Support ticket**: customer problem → support agent → escalated to engineering as a task → resolved → customer told. This connects support to the task board.

**Day 2 — the AI inside the pipelines**

4. **Request from one sentence**: the AI fills in a hiring request, a campaign brief or a project proposal from a short description; the person reviews and sends it.
5. **Decision brief**: for whoever must decide, the AI prepares the facts (budget left, team size, similar past requests) and a recommendation.
6. **"Why" view**: for any AI action, who asked, which rule allowed it, who approved it.
7. **The refusal**, already working: ask the AI to hire someone directly and it declines, because policy says hiring goes through a request.

**Day 3 — the weekly review and the demo**

8. **Weekly review page** for the CEO: per department, what moved, what is stuck and for how long, who owns it.
9. **A shorter menu**, a rehearsed walk-through, and one slide with the evaluation numbers. No new features after midday.

**Left out on purpose:** sales deals, payroll, performance reviews, invoicing, exits. They follow the same pattern and can be named in the presentation as future work — which is a strength, because the report shows the same engine carries them.
