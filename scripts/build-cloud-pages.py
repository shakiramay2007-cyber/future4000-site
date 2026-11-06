# Generates the F4 Cloud marketing pages (public/cloud/*.html) from one content table.
# Rename the product in one place: PRODUCT.
import html, json, os
PRODUCT = "F4 Cloud"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "cloud")
E = html.escape

PAGES = [
 ("index", "Overview", "F4 Cloud: HIPAA-Ready Hosting for Healthcare Apps, Agents and Data",
  "Deploy web apps, workers, databases and AI agents on HIPAA-eligible AWS infrastructure, with compliance built into every plan.", [
  ("What a cloud platform is", "A platform that runs your software on rented, managed computers so your team ships code instead of maintaining servers."),
  ("Why healthcare needs its own platform", "Patient data needs access control, audit trails and a signed BAA from day one, not as a premium upgrade."),
  ("Who F4 Cloud serves", "Health systems, health-tech builders, universities and government agencies that handle regulated data."),
  ("The service catalog", "Web services, static sites, private services, background workers, cron jobs, workflows, Postgres, key-value stores and sandboxes."),
  ("How a deploy works", "Push to GitHub, we build it, deploy it to new instances, health-check it and switch traffic with zero downtime."),
  ("HIPAA on every plan", "Every paid plan runs on HIPAA-eligible AWS services with encryption, audit logs and a BAA, with no compliance surcharge."),
  ("Patient data kept out of logs", "Logs, build output and error reports are scrubbed for identifiers automatically."),
  ("Private networking by default", "Services talk over a private network, and private links to your AWS accounts are included on every plan."),
  ("Alerts and webhooks", "Slack, Microsoft Teams, email and webhooks for deploys, failures and recoveries on every plan."),
  ("Observability", "Metrics, logs, traces, health checks and uptime in one dashboard, exportable with OpenTelemetry."),
  ("Preview copies and rollback", "A full test copy for every pull request using synthetic data, and one-click rollback to any earlier build."),
  ("Autoscaling and zero-downtime deploys", "Instances scale with load, and new versions take traffic only after passing health checks."),
  ("Healthcare connectors", "FHIR, Epic, Oracle Health, athenahealth, EVV and clearinghouse connectors, with every transfer logged."),
  ("AI with governance", "Claude on AWS Bedrock with PHI masking, an AI inventory, a decision log and a pause switch."),
  ("The security program", "Encryption, least-privilege access, SSO with MFA, secrets management, DDoS protection, pentests and a SOC 2 roadmap."),
  ("Pricing models", "Free for learning, Team, Compliance and Enterprise tiers. Final prices are being set during early access."),
  ("Common questions", "HIPAA-eligible does not mean automatically compliant: we secure the platform, you configure and use it correctly."),
  ("Join early access", "Tell us your use case. We invite organizations in groups and start every pilot with synthetic data.")]),
 ("workers", "Background Workers", "Background Workers That Process Healthcare Jobs Safely, Reliably, and Automatically",
  "Always-on services that take jobs from a queue so your apps stay fast, with durable steps and patient-data protection.", [
  ("What a background worker is", "A service that runs continuously, receives no web traffic, and processes jobs waiting in a queue."),
  ("Choosing the right service", "Web service for requests, worker for queued jobs, cron job for schedules, workflow for long multi-step runs."),
  ("Worker architecture", "Your app adds a job to the queue; a worker picks it up, does the work and saves the result to the database."),
  ("Task queues explained", "A queue is a waiting line for jobs, so slow work never blocks the person using your app."),
  ("Healthcare job examples", "Claim batches, EVV reconciliation, report generation, AI drafting and document reading."),
  ("Worker frameworks", "Celery, Sidekiq, BullMQ, Asynq, Oban and apalis all run as standard background workers."),
  ("Managed queues", "Postgres-backed or Redis-compatible queues, encrypted at rest, with no servers to manage."),
  ("Durable steps", "Each finished step is saved, so a job that crashes resumes where it stopped instead of starting over."),
  ("Retries and failed jobs", "Automatic retries with growing waits, and a holding area for jobs that keep failing."),
  ("Scheduling and priority", "Run jobs now, later, on a schedule, or ahead of routine work when they are urgent."),
  ("Scaling workers", "Set worker count by hand or scale automatically on queue length."),
  ("Protecting patient data in jobs", "Encrypted job data, scrubbed logs and retention limits on finished jobs."),
  ("Monitoring workers", "Queue length, failure rate, run history and alerts in one view."),
  ("Worker costs", "Pay for the compute time your workers actually use."),
  ("Your first worker", "Copy-ready starter code for Node.js and Python."),
  ("Moving existing workers", "Step-by-step migration from another host with no lost jobs."),
  ("Common questions", "Workers can call any service over the private network and never need a public address."),
  ("Join early access", "Tell us what your jobs do, and we will size your first workers with you.")]),
 ("sandboxes", "Sandboxes", "Secure Sandboxes Giving Every AI Agent Its Own Protected Computer",
  "Isolated, temporary computers for agents and untrusted code, with internet blocked by default and every command recorded.", [
  ("What a sandbox is", "A private, temporary computer for one agent or one task, isolated from everything else."),
  ("Why AI agents need sandboxes", "Agents run code they wrote themselves; a sandbox contains mistakes before they reach real systems."),
  ("Run an agent inside a sandbox", "Give each agent its own files, tools and terminal to work in safely."),
  ("Copy a full app for testing", "Spin up a complete copy of your application without touching production."),
  ("Run untrusted code safely", "Execute code you did not write, with no path to your data or credentials."),
  ("Test with synthetic patient data", "Every healthcare sandbox starts with realistic sample records, never real ones."),
  ("The isolation model", "Separate filesystem, network and credentials for every sandbox."),
  ("Snapshots and fast starts", "Start from a saved, ready-to-go setup in seconds."),
  ("Saving work between sessions", "Agents can pick up their files and state where they left off."),
  ("Live logs and errors", "Watch output stream as it happens."),
  ("Scale to thousands of sandboxes", "Stay reliable when demand spikes."),
  ("Pay only while running", "Idle sandboxes stop automatically, so you never pay for idle compute."),
  ("Limited-permission keys", "Each API key can do only what you allow."),
  ("Internet blocked by default", "Allow only the addresses a task actually needs."),
  ("Secrets kept out of reach", "The platform supplies credentials so agent code never sees them."),
  ("The sandbox audit trail", "Every command is recorded, kept and exportable for review."),
  ("Common questions", "Sandboxes can run Docker, keep state, share starting snapshots and run without internet access."),
  ("Create your first sandbox", "Join early access and we will set up your first sandbox with you.")]),
 ("agents", "Coding Agents", "Connect Your Coding Agent to Build, Deploy, and Govern Apps",
  "Let Claude Code, Cursor and other agents deploy and debug on F4 Cloud, with human approval before anything reaches production.", [
  ("What a coding agent is", "An AI system that writes, tests and deploys code."),
  ("Why connect your agent", "Agents work faster when they can deploy and read logs, while people stay in charge."),
  ("Supported agents", "Claude Code, Cursor, OpenAI agents and any tool that speaks the Model Context Protocol (MCP)."),
  ("Agent skills", "Ready instructions for deploying, debugging, rolling back and reading logs."),
  ("The MCP server", "The tools an agent can call, and the permission each tool needs."),
  ("The command-line tool", "Install it and control services from the terminal."),
  ("APIs and developer kits", "REST API plus TypeScript and Python kits."),
  ("Docs written for agents", "Machine-readable guides agents load automatically."),
  ("Permission levels", "Read-only, deploy to a test copy, or production."),
  ("Human approval for production", "No agent changes a live app without a named person approving."),
  ("Checks before every deploy", "Automatic scans for leaked secrets, patient data and risky packages."),
  ("Governing AI agents", "Agent inventory, decision log and a pause switch, shared with FUTURE4000."),
  ("Prompts that work", "Copy-ready requests for common agent tasks."),
  ("Featured agent templates", "Start from F4 Code Studio or the templates gallery."),
  ("Protecting agent credentials", "Short-lived, limited and revocable keys."),
  ("Pricing for agent use", "Agent activity is billed as normal compute."),
  ("Common questions", "Agents never get production access by default."),
  ("Join early access", "Connect your agent during the pilot.")]),
 ("code-studio", "F4 Code Studio", "F4 Code Studio: A Hosted AI Coding Agent With Guardrails",
  "A browser-based coding agent with a saved workspace, Claude on Bedrock and guardrails built for regulated work.", [
  ("What a hosted coding agent is", "Code from any browser without setting up a computer."),
  ("Why host it in the cloud", "Shared access, saved work and central control for your whole team."),
  ("Architecture", "Browser screen, remote terminal, saved workspace and a governed AI model connection."),
  ("What you can build", "Internal tools, FHIR apps, dashboards and automations."),
  ("Core features", "Chat, file editing, terminal and live previews."),
  ("Choosing the AI model", "Claude on AWS Bedrock by default, with backup models."),
  ("Saved workspace and memory", "Continue exactly where you left off."),
  ("Secure remote access", "Single sign-on and two-step login."),
  ("Built-in guardrails", "Production needs approval, patient data is blocked, every action is logged."),
  ("Working as a team", "Share sessions and review changes together."),
  ("Who it is for", "Clinicians prototyping ideas, IT teams and informatics students."),
  ("What the template includes", "The services, storage and settings it creates for you."),
  ("Prerequisites", "An F4 Cloud workspace and a GitHub account."),
  ("Deploy in one click", "A guided, step-by-step setup."),
  ("Estimating costs", "Monthly cost scales with how much the agent runs."),
  ("Security and HIPAA responsibilities", "What the platform covers and what remains yours."),
  ("Resources", "Code repository, technology stack and tags."),
  ("Join early access", "Be among the first teams to use F4 Code Studio.")]),
 ("templates", "Templates", "One-Click Compliant Templates for Healthcare Apps, AI Agents, and Frameworks",
  "Starter projects that deploy in one click, reviewed for security and shipped with synthetic data.", [
  ("What a template is", "A ready starter project you deploy in one click and then make your own."),
  ("Finding the right template", "Filter by technology stack, tags and compliance level."),
  ("Featured templates", "Six recommended starting points."),
  ("Healthcare apps", "FHIR app, patient portal, telehealth visit and EVV mobile check-in."),
  ("Compliance apps", "FUTURE4000, a policy library and an audit log service."),
  ("AI agents", "Research agent, document review agent and policy question-answering."),
  ("Frameworks", "Next.js, Django, FastAPI, Rails and Express."),
  ("Data starters", "Postgres with vector search and analytics dashboards."),
  ("Workers and workflows", "Starters for background processing."),
  ("Reading a template card", "Stack, monthly cost estimate, HIPAA badge and deploy button."),
  ("Inside a template page", "What it builds, a diagram, setup steps and costs."),
  ("How templates are reviewed", "Security and privacy checks before any template is listed."),
  ("Publish your own template", "Community submissions with revenue sharing."),
  ("One file deploys everything", "A single blueprint file defines every service in a template."),
  ("Synthetic data included", "Safe sample data in every healthcare template."),
  ("Versions and updates", "How template improvements reach existing users."),
  ("Common questions", "Templates are starting points; you own and can change everything they create."),
  ("Submit a template or join early access", "Tell us what you want to build.")]),
]

NAV = "".join(f'<a href="/cloud{"" if s=="index" else "/"+s}">{E(n)}</a>' for s,n,*_ in PAGES)
def page(slug, name, title, sub, secs):
    assert len(title.split()) == 10, (slug, len(title.split()))
    assert len(secs) == 18, slug
    cards = "".join(f'<article class="cs" id="s{i}"><span class="cs-n">{i:02d}</span><h3>{E(h)}</h3><p>{E(b)}</p></article>' for i,(h,b) in enumerate(secs,1))
    toc = "".join(f'<li><a href="#s{i}">{E(h)}</a></li>' for i,(h,_) in enumerate(secs,1))
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{E(title)} | {PRODUCT} by FUTURE4000</title><meta name="description" content="{E(sub)}" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.css" /></head>
<body class="home cloud">
<header class="home-nav"><a class="brand" href="/cloud" style="text-decoration:none"><span class="logo">F4</span> {PRODUCT}</a>
<nav>{NAV}<a class="nav-cta" href="#waitlist">Join early access</a></nav></header>
<section class="hero cloud-hero"><div class="hero-text"><p class="eyebrow"><span class="ea">Early access</span> {E(name)}</p>
<h1>{E(title)}</h1><p class="hero-sub">{E(sub)}</p>
<div class="hero-cta"><a class="primary big" href="#waitlist">Join early access</a><a class="ghost big" href="#contents">What's inside</a></div>
<p class="hero-note">{PRODUCT} is in early access. Features described here are being built and rolled out to pilot organizations.</p></div></section>
<section class="section" id="contents"><h2>In this guide</h2><ol class="cloud-toc">{toc}</ol></section>
<section class="section alt"><div class="cs-grid">{cards}</div></section>
<section class="section" id="waitlist"><h2>Join {PRODUCT} early access</h2>
<p class="section-sub">Tell us about your organization. We invite pilots in groups and start every pilot with synthetic data.</p>
<form id="wl" class="wl"><input name="name" placeholder="Your name" required maxlength="120" /><input name="organization" placeholder="Organization" required maxlength="200" />
<input name="email" type="email" placeholder="Work email" required maxlength="200" /><select name="interest"><option value="{slug}">{E(name)}</option><option value="platform">Whole platform</option></select>
<textarea name="use_case" rows="3" placeholder="What would you build or run? Please do not include patient information." maxlength="2000"></textarea>
<input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
<button class="primary big">Request access</button><div id="wl-msg" class="notice hidden"></div></form></section>
<footer class="home-foot"><span>&copy; <span id="yr"></span> LaFortune Business Management &middot; {PRODUCT} by FUTURE4000</span><span><a href="/">FUTURE4000</a> &middot; <a href="/changelog">What's new</a></span></footer>
<script>
document.getElementById('yr').textContent=new Date().getFullYear();
document.getElementById('wl').addEventListener('submit',async(e)=>{{e.preventDefault();const m=document.getElementById('wl-msg');
const r=await fetch('/api/waitlist',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}});
const j=await r.json().catch(()=>({{}}));m.className='notice '+(r.ok?'ok':'bad');m.textContent=r.ok?'Thank you. You are on the list, and we will be in touch.':(j.error||'Something went wrong.');if(r.ok)e.target.reset();}});
</script></body></html>"""
for p in PAGES:
    open(os.path.join(OUT, p[0] + ".html"), "w").write(page(*p))
print("built", len(PAGES), "pages:", ", ".join(p[0] for p in PAGES))
