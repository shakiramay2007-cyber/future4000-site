// F4 Templates: one-click compliance packs. Applying a pack creates linked draft policies
// (structured skeletons, or AI-written if requested) for every required policy in the pack.
export const PACKS = [
  { id: 'hipaa', name: 'HIPAA Privacy, Security & Breach Pack', for: 'All healthcare organizations', regs: ['HIPAA-PRIVACY', 'HIPAA-SECURITY', 'HIPAA-BREACH'], domain: 'Privacy & Security' },
  { id: 'infection', name: 'Infection Prevention Pack', for: 'Hospitals and teaching hospitals', regs: ['TJC-IC', 'OSHA-BBP'], domain: 'Infection Control' },
  { id: 'patient-safety', name: 'National Patient Safety Goals Pack', for: 'Joint Commission-accredited hospitals', regs: ['TJC-NPSG'], domain: 'Patient Safety' },
  { id: 'medication', name: 'Medication Management & Controlled Substances Pack', for: 'Hospitals with pharmacy services', regs: ['TJC-MM', 'DEA-CSA'], domain: 'Pharmacy' },
  { id: 'emergency', name: 'Emergency Preparedness Pack', for: 'All CMS-certified providers', regs: ['CMS-EP'], domain: 'Emergency Management' },
  { id: 'emtala', name: 'EMTALA Pack', for: 'Hospitals with emergency departments', regs: ['EMTALA'], domain: 'Emergency Department' },
  { id: 'environment', name: 'Environment of Care & Life Safety Pack', for: 'Hospitals', regs: ['TJC-EC', 'OSHA-HAZCOM'], domain: 'Environment of Care' },
  { id: 'cms-hospital', name: 'CMS Hospital Conditions of Participation Pack', for: 'Medicare-certified hospitals', regs: ['CMS-COP-HOSPITAL'], domain: 'Regulatory' },
  { id: 'home-health', name: 'Home Health & EVV Pack', for: 'Home health and home care agencies', regs: ['CMS-COP-HOME-HEALTH', 'EVV-CURES'], domain: 'Home Health' },
  { id: 'behavioral', name: 'Behavioral Health & SUD Confidentiality Pack', for: 'Behavioral health and addiction programs', regs: ['42CFR2'], domain: 'Behavioral Health' },
  { id: 'gme', name: 'Graduate Medical Education Pack', for: 'Teaching hospitals', regs: ['ACGME-INST'], domain: 'Graduate Medical Education' },
  { id: 'civil-rights', name: 'Civil Rights, Access & Language Pack', for: 'All organizations', regs: ['ADA-504', 'ACA-1557'], domain: 'Civil Rights' },
  { id: 'lab', name: 'Laboratory Quality Pack', for: 'Organizations with a laboratory', regs: ['CLIA'], domain: 'Laboratory' },
  { id: 'ltc', name: 'Long-Term Care Pack', for: 'Skilled nursing and nursing facilities', regs: ['CMS-LTC'], domain: 'Long-Term Care' },
  { id: 'university', name: 'University Student Records Pack', for: 'Universities', regs: ['FERPA'], domain: 'Education' }
];

export function skeleton(title, regulation, orgName) {
  return `POLICY TITLE: ${title}
ORGANIZATION: ${orgName}
REGULATORY BASIS: ${regulation.title} (${regulation.authority})

1. PURPOSE
State why this policy exists and the requirement it meets.

2. SCOPE
List the departments, staff, and locations this policy applies to.

3. DEFINITIONS
Define key terms used in this policy.

4. POLICY STATEMENT
State the organization's position and the standard staff must meet.

5. PROCEDURE
5.1 Step-by-step actions, in order.
5.2 Who performs each step.
5.3 Required documentation.

6. ROLES AND RESPONSIBILITIES
Leadership, department managers, staff, and the compliance officer.

7. MONITORING AND COMPLIANCE
How compliance is measured, how often, and who reports results.

8. REFERENCES
${regulation.title}: ${regulation.summary}

9. REVIEW CYCLE
Reviewed at least annually and whenever regulations change.

[Template draft: complete each section, or regenerate with AI, before sending for clinician review.]`;
}
