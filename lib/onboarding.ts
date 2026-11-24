export type SetupStatus =
  | { stage: "setup"; personas: { id: string; name: string }[] }
  | { stage: "locked" }
  | { stage: "ready" };
