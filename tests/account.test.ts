import { describe, expect, it } from "vitest";
import { assertPactapEmail } from "@/lib/jira-account";

describe("pactap account email", () => {
  it("accepts a pactap.com address and rejects other domains", () => {
    expect(() => assertPactapEmail("dev@pactap.com")).not.toThrow();
    expect(() => assertPactapEmail("person@gmail.com")).toThrow(/@pactap.com/);
    expect(() => assertPactapEmail("not-an-email")).toThrow(/@pactap.com/);
  });
});
