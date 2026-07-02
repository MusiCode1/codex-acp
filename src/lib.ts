// lib.ts — programmatic (in-process) entry point.
//
// Fork addition: exposes `startAcpServer(readable, writable, opts)` so the codex
// ACP agent can be driven over ANY stream pair (not just process.stdin/stdout),
// enabling in-process embedding (same model as @agentclientprotocol/claude-agent-acp
// which exports its agent). No top-level side effects — safe to import.
//
// `src/index.ts` (the CLI) imports this and calls it with process.stdin/stdout.

import * as acp from "@agentclientprotocol/sdk";
import type {Readable, Writable} from "node:stream";
import {z} from "zod";
import {startCodexConnection} from "./CodexJsonRpcConnection";
import {CodexAcpServer} from "./CodexAcpServer";
import {createJsonStream} from "./StdUtils";
import {isCodexAuthRequest} from "./CodexAuthMethod";
import {CodexAcpClient} from "./CodexAcpClient";
import {CodexAppServerClient} from "./CodexAppServerClient";
import packageJson from "../package.json";
import {logger} from "./Logger";
import {LEGACY_SET_SESSION_MODEL_METHOD} from "./AcpExtensions";

const emptyExtensionParamsParser = z.preprocess(
    (params) => params ?? {},
    z.object({}).passthrough()
);

const legacySetSessionModelParamsParser = z.object({
    sessionId: z.string(),
    modelId: z.string(),
}).passthrough();

export interface StartAcpServerOptions {
    /** Path to the codex executable. Falls back to process.env.CODEX_PATH. */
    codexPath?: string;
    /** Codex config object. Falls back to JSON.parse(process.env.CODEX_CONFIG). */
    config?: unknown;
    /** Model provider. Falls back to process.env.MODEL_PROVIDER. */
    modelProvider?: string;
    /** Default auth request. Falls back to process.env.DEFAULT_AUTH_REQUEST. */
    defaultAuthRequest?: unknown;
}

/**
 * Wire the codex ACP agent to a stream pair.
 *
 * Defaults to process.stdin/stdout (CLI behaviour) but accepts any Node
 * Readable/Writable, so the agent can run in-process over an in-memory duplex.
 */
export function startAcpServer(
    readable: Readable = process.stdin,
    writable: Writable = process.stdout,
    opts: StartAcpServerOptions = {},
): void {
    const codexPath = opts.codexPath ?? process.env["CODEX_PATH"];
    const configString = process.env["CODEX_CONFIG"];
    const authRequestString = process.env["DEFAULT_AUTH_REQUEST"];
    const modelProvider = opts.modelProvider ?? process.env["MODEL_PROVIDER"];
    const config = opts.config ?? (configString ? JSON.parse(configString) : undefined);
    const parsedAuthRequest = opts.defaultAuthRequest ?? (authRequestString ? JSON.parse(authRequestString) : undefined);
    const defaultAuthRequest = parsedAuthRequest && isCodexAuthRequest(parsedAuthRequest) ? parsedAuthRequest : undefined;

    logger.log("Startup", {
        name: packageJson.name,
        version: packageJson.version,
        codexPath: codexPath,
        modelProvider: modelProvider ?? null,
        codexConfig: config ?? null,
        authRequest: authRequestString ?? null,
        defaultAuthRequest: defaultAuthRequest ?? null,
    });

    const codexConnection = startCodexConnection(codexPath);

    const maxStderrTailChars = 2 * 1024;
    let stderr = "";
    codexConnection.process.stderr.addListener("data", (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-maxStderrTailChars);
    });

    readable.on("close", () => {
        codexConnection.process.stdin.end();
        // Kill the codex process if it doesn't exit naturally
        setTimeout(() => {
            if (!codexConnection.process.killed) {
                logger.log("Codex still running 2s after stream closed; terminating process");
                codexConnection.process.kill();
            }
        }, 2000);
    });

    const acpJsonStream = createJsonStream(readable, writable);

    function createAgent(connection: acp.AgentContext): CodexAcpServer {
        const appServerClient = new CodexAppServerClient(codexConnection.connection);
        const codexClient = new CodexAcpClient(appServerClient, config, modelProvider);
        return new CodexAcpServer(connection, codexClient, defaultAuthRequest, () => codexConnection.process.exitCode, () => stderr);
    }

    let codexAcpServer: CodexAcpServer | null = null;
    const getAgent = (): CodexAcpServer => {
        if (!codexAcpServer) {
            throw acp.RequestError.internalError("ACP agent is not connected");
        }
        return codexAcpServer;
    };

    acp.agent({name: packageJson.name})
        .onConnect((connection) => {
            const agent = createAgent(connection.client);
            codexAcpServer = agent;
            connection.signal.addEventListener("abort", () => {
                if (codexAcpServer === agent) {
                    codexAcpServer = null;
                }
            });
        })
        .onRequest(acp.methods.agent.initialize, (ctx) => getAgent().initialize(ctx.params))
        .onRequest(acp.methods.agent.session.new, (ctx) => getAgent().newSession(ctx.params))
        .onRequest(acp.methods.agent.session.load, (ctx) => getAgent().loadSession(ctx.params))
        .onRequest(acp.methods.agent.session.list, (ctx) => getAgent().listSessions(ctx.params))
        .onRequest(acp.methods.agent.session.delete, (ctx) => getAgent().deleteSession(ctx.params))
        .onRequest(acp.methods.agent.session.resume, (ctx) => getAgent().resumeSession(ctx.params))
        .onRequest(acp.methods.agent.session.close, (ctx) => getAgent().closeSession(ctx.params))
        .onRequest(acp.methods.agent.session.setMode, (ctx) => getAgent().setSessionMode(ctx.params))
        .onRequest(acp.methods.agent.session.setConfigOption, (ctx) => getAgent().setSessionConfigOption(ctx.params))
        .onRequest(acp.methods.agent.authenticate, (ctx) => getAgent().authenticate(ctx.params))
        .onRequest(acp.methods.agent.logout, (ctx) => getAgent().logout(ctx.params))
        .onRequest(acp.methods.agent.session.prompt, (ctx) => getAgent().prompt(ctx.params, ctx.signal))
        .onNotification(acp.methods.agent.session.cancel, (ctx) => getAgent().cancel(ctx.params))
        .onRequest("authentication/status", emptyExtensionParamsParser, (ctx) => getAgent().extMethod("authentication/status", ctx.params))
        .onRequest("authentication/logout", emptyExtensionParamsParser, (ctx) => getAgent().extMethod("authentication/logout", ctx.params))
        .onRequest(LEGACY_SET_SESSION_MODEL_METHOD, legacySetSessionModelParamsParser, (ctx) => getAgent().extMethod(LEGACY_SET_SESSION_MODEL_METHOD, ctx.params))
        .connect(acpJsonStream);
}
