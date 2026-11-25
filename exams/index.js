// One entry per mock exam, newest last. A new mock is a new file plus one line here.
// Never rename or remove an id: saved attempts and scores are keyed by it.
export const EXAMS = [
  { id: "mock-01", title: "Mock Exam 1", date: "2026-11-25", load: () => import("./mock-01.js") },
];
