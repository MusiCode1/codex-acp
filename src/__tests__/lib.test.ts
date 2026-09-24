import {PassThrough} from "node:stream";
import {afterEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    start: vi.fn(),
    stream: vi.fn(),
    client: vi.fn(),
    server: vi.fn(),
    connected: undefined as undefined | ((connection: unknown) => void),
}));

vi.mock("../CodexJsonRpcConnection", () => ({startCodexConnection: mocks.start}));
vi.mock("../StdUtils", () => ({createJsonStream: mocks.stream}));
vi.mock("../CodexAppServerClient", () => ({CodexAppServerClient: class {}}));
vi.mock("../CodexAcpClient", () => ({CodexAcpClient: class {
    constructor(...args: unknown[]) { mocks.client(...args); }
}}));
vi.mock("../CodexAcpServer", () => ({CodexAcpServer: class {
    constructor(...args: unknown[]) { mocks.server(...args); }
}}));
vi.mock("../Logger", () => ({logger: {log: vi.fn()}}));
vi.mock("@agentclientprotocol/sdk", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agentclientprotocol/sdk")>();
    return {...actual, agent: () => {
        const builder = {
            onConnect(callback: (connection: unknown) => void) {
                mocks.connected = callback;
                return builder;
            },
            onRequest() { return builder; },
            onNotification() { return builder; },
            connect() {},
        };
        return builder;
    }};
});

function child() {
    return {stdin: {end: vi.fn()}, killed: false, kill: vi.fn()};
}

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe("in-process entry point", () => {
    it("can be imported without starting Codex", async () => {
        const lib = await import("../lib");
        expect(lib.startAcpServer).toBeTypeOf("function");
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it("uses supplied streams and options instead of process-wide defaults", async () => {
        vi.stubEnv("CODEX_PATH", "/env/codex");
        vi.stubEnv("CODEX_CONFIG", '{"model":"env-model"}');
        vi.stubEnv("MODEL_PROVIDER", "env-provider");
        mocks.start.mockReturnValue({process: child(), connection: {}});
        const {startAcpServer} = await import("../lib");
        const input = new PassThrough();
        const output = new PassThrough();
        const config = {developer_instructions: "test-instruction"};
        startAcpServer(input, output, {codexPath: "/explicit/codex", config, modelProvider: "explicit"});
        mocks.connected?.({client: {}, signal: new AbortController().signal});
        expect(mocks.start).toHaveBeenCalledWith("/explicit/codex", undefined);
        expect(mocks.stream).toHaveBeenCalledWith(input, output);
        expect(mocks.client).toHaveBeenCalledWith(expect.anything(), config, "explicit");
    });

    it("retains environment fallbacks for callers without options", async () => {
        vi.stubEnv("CODEX_PATH", "/env/codex");
        vi.stubEnv("CODEX_CONFIG", '{"model":"env-model"}');
        vi.stubEnv("MODEL_PROVIDER", "env-provider");
        mocks.start.mockReturnValue({process: child(), connection: {}});
        const {startAcpServer} = await import("../lib");
        startAcpServer(new PassThrough(), new PassThrough());
        mocks.connected?.({client: {}, signal: new AbortController().signal});
        expect(mocks.start).toHaveBeenCalledWith("/env/codex", undefined);
        expect(mocks.client).toHaveBeenCalledWith(expect.anything(), {model: "env-model"}, "env-provider");
    });

    it("merges child overrides without mutating the parent environment or options", async () => {
        vi.stubEnv("DC_TOKEN", "parent-token");
        vi.stubEnv("DC_ENV_INHERITED", "parent-value");
        vi.stubEnv("CODEX_PATH", "/parent/codex");
        mocks.start.mockReturnValue({process: child(), connection: {}});
        const {startAcpServer} = await import("../lib");
        const env = {DC_TOKEN: "child-token", CODEX_PATH: "/child-only/codex"};
        const original = {...env};
        startAcpServer(new PassThrough(), new PassThrough(), {env});
        mocks.connected?.({client: {}, signal: new AbortController().signal});

        const spawnEnv = mocks.start.mock.calls[0]?.[1];
        const state = mocks.server.mock.calls[0]?.[5] as {env?: NodeJS.ProcessEnv};
        expect(mocks.start).toHaveBeenCalledWith("/parent/codex", expect.objectContaining({
            DC_TOKEN: "child-token",
            DC_ENV_INHERITED: "parent-value",
            CODEX_PATH: "/child-only/codex",
        }));
        expect(spawnEnv).not.toBe(env);
        expect(spawnEnv).not.toBe(process.env);
        expect(state.env).toBe(spawnEnv);
        expect(env).toEqual(original);
        expect(process.env["DC_TOKEN"]).toBe("parent-token");
        env.DC_TOKEN = "changed-after-start";
        expect(state.env?.["DC_TOKEN"]).toBe("child-token");
    });

    it("keeps concurrent agents' environment snapshots separate", async () => {
        vi.stubEnv("DC_TOKEN", "parent-token");
        mocks.start.mockReturnValue({process: child(), connection: {}});
        const {startAcpServer} = await import("../lib");
        startAcpServer(new PassThrough(), new PassThrough(), {env: {DC_TOKEN: "first-token"}});
        mocks.connected?.({client: {}, signal: new AbortController().signal});
        startAcpServer(new PassThrough(), new PassThrough(), {env: {DC_TOKEN: "second-token"}});
        mocks.connected?.({client: {}, signal: new AbortController().signal});

        const first = mocks.server.mock.calls[0]?.[5] as {env?: NodeJS.ProcessEnv};
        const second = mocks.server.mock.calls[1]?.[5] as {env?: NodeJS.ProcessEnv};
        expect(first.env?.["DC_TOKEN"]).toBe("first-token");
        expect(second.env?.["DC_TOKEN"]).toBe("second-token");
        expect(first.env).not.toBe(second.env);
        expect(process.env["DC_TOKEN"]).toBe("parent-token");
    });

    it("closes the current child after a provider switch replaces the original", async () => {
        vi.useFakeTimers();
        const original = child();
        const replacement = child();
        mocks.start.mockReturnValue({process: original, connection: {}});
        const {startAcpServer} = await import("../lib");
        const input = new PassThrough();
        startAcpServer(input, new PassThrough());
        mocks.connected?.({client: {}, signal: new AbortController().signal});
        const state = mocks.server.mock.calls.at(-1)?.[5] as {connection: {process: ReturnType<typeof child>}};
        state.connection = {process: replacement};
        input.emit("close");
        expect(replacement.stdin.end).toHaveBeenCalledOnce();
        expect(original.stdin.end).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2000);
        expect(replacement.kill).toHaveBeenCalledOnce();
        expect(original.kill).not.toHaveBeenCalled();
    });
});
