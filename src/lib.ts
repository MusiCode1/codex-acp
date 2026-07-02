// lib.ts — programmatic (in-process) entry point.
//
// Fork addition: exposes `startAcpServer(readable, writable, opts)` so the codex
// ACP agent can be driven over ANY stream pair, not just process.stdin/stdout.
// That enables in-process embedding — the same model as
// @agentclientprotocol/claude-agent-acp, which exports its agent from
// `dist/lib.js`. Upstream here ships only the CLI bin and no `exports` field.
//
// 🛑 No top-level side effects — safe to import. `src/index.ts` is the CLI and
// keeps the argv handling; it calls this with process.stdin/stdout.
//
// Re-derived on 2.5.0 (2026-11-04): upstream extracted the method wiring into
// `createAcpAgentRouter`, so this file no longer repeats the request table.
// Keep it that way — a copy of the table here would rot silently against
// upstream's router.

import type {Readable, Writable} from "node:stream";
import {startCodexConnection} from "./CodexJsonRpcConnection";
import {CodexAcpServer, type CodexProcessState} from "./CodexAcpServer";
import {createJsonStream} from "./StdUtils";
import {isCodexAuthRequest} from "./CodexAuthMethod";
import {providerStartupConfig, CodexAcpClient} from "./CodexAcpClient";
import {CodexAppServerClient} from "./CodexAppServerClient";
import packageJson from "../package.json";
import {logger} from "./Logger";
import {appServerStartup, CodexAppServerSupervisor} from "./app-server-recovery/CodexAppServerSupervisor";
import {prepareCodexHookConfig} from "./CodexHookConfig";
import {createAcpAgentRouter} from "./AcpAgentRouter";
import type {AcpClientConnection, AcpV2Connection} from "./ACPSessionConnection";

export interface StartAcpServerOptions {
    /** Path to the codex executable. Falls back to process.env.CODEX_PATH. */
    codexPath?: string;
    /** Codex config object. Falls back to JSON.parse(process.env.CODEX_CONFIG). */
    config?: unknown;
    /** Model provider. Falls back to process.env.MODEL_PROVIDER. */
    modelProvider?: string;
    /** Default auth request. Falls back to JSON.parse(process.env.DEFAULT_AUTH_REQUEST). */
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
    const hookConfig = prepareCodexHookConfig(config);
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

    const startupState = {
        appServerStartupArgs: hookConfig.appServerStartupArgs,
        providerStartupConfig: providerStartupConfig(modelProvider ?? null, hookConfig.sessionConfig ?? {}, null),
    };
    const startup = appServerStartup(startupState);
    const codexProcessState: CodexProcessState = {
        // The supervisor disposes the connection itself, after the last output of the process was read.
        connection: startCodexConnection(codexPath, {...process.env, ...startup.env}, startup.args, {disposeOnExit: false}),
        codexPath,
        config: hookConfig.sessionConfig,
        ...startupState,
        modelProvider,
        stderr: "",
    };
    const supervisor = new CodexAppServerSupervisor(codexProcessState);
    codexProcessState.supervisor = supervisor;

    // 🛑 `readable`, not process.stdin: in-process embedding closes its own pipe
    // while the host process keeps running, and the supervisor must follow the
    // stream it was given.
    readable.on("close", () => {
        // Ends the stdin of the app-server, sends SIGTERM if it is still running 2 s later, and never restarts it.
        supervisor.shutdown();
    });

    const acpJsonStream = createJsonStream(readable, writable);

    function createAgent(connection: AcpClientConnection | AcpV2Connection): CodexAcpServer {
        const appServerClient = new CodexAppServerClient(codexProcessState.connection.connection);
        const codexClient = new CodexAcpClient(appServerClient, hookConfig.sessionConfig, modelProvider);
        return new CodexAcpServer(
            connection,
            codexClient,
            defaultAuthRequest,
            undefined,
            undefined,
            codexProcessState,
        );
    }

    createAcpAgentRouter(createAgent).connect(acpJsonStream);
}
