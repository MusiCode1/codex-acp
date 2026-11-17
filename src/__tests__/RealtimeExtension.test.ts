import {describe, expect, it} from "vitest";
import {realtimeDelegationInput} from "../RealtimeExtension";

describe("realtimeDelegationInput", () => {
    it("extracts the spoken request from a Codex voice delegation", () => {
        const text = "<realtime_delegation>\n  <input>כמה קבצים יש בתיקייה</input>\n  <transcript_delta>user: hi</transcript_delta>\n</realtime_delegation>";
        expect(realtimeDelegationInput(text)).toBe("כמה קבצים יש בתיקייה");
    });

    it.each([
        ["an ordinary user message", "please list the files"],
        ["a delegation with an empty input", "<realtime_delegation><input>  </input></realtime_delegation>"],
        ["text that only mentions the tag later", "hello <realtime_delegation><input>x</input>"],
    ])("returns null for %s", (_name, text) => {
        expect(realtimeDelegationInput(text)).toBeNull();
    });
});
