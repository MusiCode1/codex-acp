import {describe, expect, it} from "vitest";
import {parseRealtimeDelegation} from "../RealtimeExtension";

describe("parseRealtimeDelegation", () => {
    it("splits the request from the conversation that led to it", () => {
        const text = "<realtime_delegation>\n  <input>זה GPT Live?</input>\n  <transcript_delta>user: hey\nassistant: hi</transcript_delta>\n</realtime_delegation>";
        expect(parseRealtimeDelegation(text)).toEqual({input: "זה GPT Live?", transcript: "user: hey\nassistant: hi"});
    });

    it("accepts a delegation without a transcript", () => {
        expect(parseRealtimeDelegation("<realtime_delegation><input>count files</input></realtime_delegation>"))
            .toEqual({input: "count files"});
    });

    it.each([
        ["an ordinary message", "please list the files"],
        ["an empty input", "<realtime_delegation><input> </input></realtime_delegation>"],
        ["a tag that is not at the start", "hello <realtime_delegation><input>x</input>"],
    ])("returns null for %s", (_name, text) => {
        expect(parseRealtimeDelegation(text)).toBeNull();
    });
});
