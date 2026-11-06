// FUTURE4000 AI agents, powered by Claude on AWS Bedrock.
import { complete } from './ai.js';

const COMMON_RULES = `You are part of FUTURE4000, an AI-powered healthcare compliance operating system built by LaFortune Business Management.
Rules:
- Write in formal, professional language suitable for hospital leadership, surveyors, and accreditation bodies.
- Cite the specific federal regulation, state rule, or accreditation standard (for example 42 CFR 482, OSHA 29 CFR 1910.1030, CDC guidance, The Joint Commission chapters) that supports each requirement. If you are not certain of an exact citation, say so instead of inventing one.
- Never request, store, or repeat patient-identifying information.
- End every output with a short "Clinician review required" note, because a qualified clinician must approve AI output before it becomes official.`;

export const AGENTS = [
  {
    id: 'policy-writer',
    name: 'DocuTrack Policy Writer',
    subsystem: 'DocuTrack AI',
    model: 'heavy',
    summary: 'Drafts complete hospital policies with purpose, scope, definitions, procedure, responsibilities, and regulatory references.',
    prompt: 'Draft a complete, survey-ready policy. Use these sections: Policy Title, Policy Number placeholder, Purpose, Scope, Definitions, Policy Statement, Procedure (numbered), Roles and Responsibilities, Monitoring and Compliance, Regulatory and Accreditation References, Review Cycle.'
  },
  {
    id: 'regulation-mapper',
    name: 'Regulation Mapper',
    subsystem: 'ComplyTrack',
    model: 'standard',
    summary: 'Given an organization type, state, and services, lists the federal, state, and accreditation requirements that apply.',
    prompt: 'List the regulations and accreditation standards that apply, grouped as Federal, State, and Accreditation. For each, give the citation, a one-line plain-language summary, and the policies or forms it requires.'
  },
  {
    id: 'training-builder',
    name: 'LearnTrack Training Builder',
    subsystem: 'LearnTrack',
    model: 'standard',
    summary: 'Turns a policy into a staff training module with objectives, key points, a scenario, and a 10-question quiz with answers.',
    prompt: 'Convert the provided policy or topic into a staff training module: Learning Objectives, Key Points, a realistic Clinical Scenario, a 10-question multiple-choice Quiz with an answer key and rationales, and an Attestation statement.'
  },
  {
    id: 'audit-prep',
    name: 'Survey and Audit Prep',
    subsystem: 'ComplyTrack',
    model: 'heavy',
    summary: 'Builds a mock-survey checklist and gap analysis for The Joint Commission, CMS, or state surveys.',
    prompt: 'Produce a mock survey tracer: a checklist of what surveyors will ask and inspect, the evidence that must be on hand, common deficiencies, and a gap-analysis table (Requirement | Evidence Needed | Status | Corrective Action).'
  },
  {
    id: 'denial-explainer',
    name: 'Claim Denial Explainer',
    subsystem: 'Revenue Integrity',
    model: 'fast',
    summary: 'Explains claim denial codes (CARC/RARC) in plain English and lists the fix and resubmission steps.',
    prompt: 'Explain the denial or adjustment codes in plain English, the most likely root cause, the documentation needed to correct it, and step-by-step resubmission or appeal instructions.'
  },
  {
    id: 'evv-checker',
    name: 'EVV Compliance Checker',
    subsystem: 'Home Care',
    model: 'fast',
    summary: 'Checks home-care visit records against the six federal EVV data elements and flags mismatches before billing.',
    prompt: 'Check the visit information against the six 21st Century Cures Act EVV elements (type of service, individual receiving service, date, location, individual providing service, time in and out). Flag every missing or mismatched element and give the correction.'
  },
  {
    id: 'interface-analyst',
    name: 'HL7 / FHIR Interface Analyst',
    subsystem: 'Integrations',
    model: 'standard',
    summary: 'Reads HL7 v2 messages or FHIR resources, explains them, finds errors, and maps HL7 v2 fields to FHIR.',
    prompt: 'Analyze the HL7 v2 message or FHIR resource. Explain each segment or element, flag structural errors or missing required fields, and provide the equivalent HL7 v2 to FHIR R4 mapping.'
  },
  {
    id: 'hr-credentialing',
    name: 'HR Credentialing Agent',
    subsystem: 'Workforce',
    model: 'fast',
    summary: 'Lists the licenses, certifications, competencies, and renewal timelines required for a role in a given state.',
    prompt: 'For the role and state given, list the required licenses, certifications, health screenings, competencies, and their renewal intervals, plus the verification source for each (primary source verification).'
  }
];

export { aiConfigured } from './ai.js';

export async function runAgent(agentId, userInput, opts = {}) {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) throw Object.assign(new Error('Unknown agent'), { status: 404 });
  if (!userInput || !String(userInput).trim()) throw Object.assign(new Error('Please enter a request.'), { status: 400 });
  const context = opts.orgContext ? `\n\nOrganization context: ${opts.orgContext}` : '';
  const r = await complete(agent.model, `${COMMON_RULES}\n\nYour role: ${agent.name}.\n${agent.prompt}${context}`, userInput, { preferred: opts.provider });
  return { agent: agent.name, agentId: agent.id, model: r.model, provider: r.provider, output: r.text, phi: r.phi, failovers: r.failovers, usage: r.usage };
}
