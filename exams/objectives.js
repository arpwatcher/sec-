// SY0-801 V8 domains and objectives (CompTIA exam objectives document, version 2.0)
export const DOMAINS = {
  1: { name: "General Security Concepts", weight: 16 },
  2: { name: "Threats, Vulnerabilities, and Attacks", weight: 24 },
  3: { name: "Security Architecture", weight: 19 },
  4: { name: "Security Operations", weight: 27 },
  5: { name: "Security Program Management and Oversight", weight: 14 },
};

export const OBJECTIVES = {
  "1.1": "Explain security concepts and controls.",
  "1.2": "Given a scenario, demonstrate the impact of change management processes on security.",
  "1.3": "Explain the importance of using appropriate cryptographic solutions.",
  "2.1": "Explain characteristics of threats and vulnerabilities.",
  "2.2": "Describe common threat actors and motivations.",
  "2.3": "Describe threat vectors and sources.",
  "2.4": "Explain types of vulnerabilities and attack surfaces.",
  "2.5": "Given a scenario, analyze indicators of malicious activity.",
  "2.6": "Summarize threats and vulnerabilities associated with artificial intelligence (AI) usage.",
  "3.1": "Compare and contrast security implications of different architecture models.",
  "3.2": "Given a scenario, manage the security architecture to best protect the infrastructure.",
  "3.3": "Summarize concepts and strategies used to protect data.",
  "3.4": "Explain the importance of resilience and recovery in security architecture.",
  "4.1": "Given a scenario, apply mitigating controls, techniques, and solutions to secure the environment.",
  "4.2": "Explain the security implications of proper hardware, software, and data asset management.",
  "4.3": "Given a scenario, perform tasks associated with vulnerability management.",
  "4.4": "Explain security alerting and monitoring concepts and tools.",
  "4.5": "Given a scenario, apply concepts related to identity and access management.",
  "4.6": "Given a scenario, apply automation and orchestration solutions to secure operations.",
  "4.7": "Summarize concepts associated with incident response activities.",
  "4.8": "Given a scenario, use data, artifacts and sources to support a security investigation.",
  "5.1": "Explain the importance of governance, risk, and compliance artifacts.",
  "5.2": "Explain the impact of risk management processes on the security of the organization.",
  "5.3": "Explain the assessment and management processes associated with third-party risk.",
  "5.4": "Summarize elements of effective security compliance.",
  "5.5": "Explain concepts associated with audit and assessment activities.",
  "5.6": "Given a scenario, apply security awareness concepts to improve organizational security.",
};

// items per domain in a 90-item form, from the published weights (16/24/19/27/14)
export const BLUEPRINT = { 1: 14, 2: 22, 3: 17, 4: 25, 5: 12 };
