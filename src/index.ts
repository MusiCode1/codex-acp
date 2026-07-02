#!/usr/bin/env node

import packageJson from "../package.json";
import {runLoginCommand} from "./login";
import {runCodexCli} from "./CodexCli";
import {startAcpServer} from "./lib";

// NOTE: this file is the CLI entry (has top-level argv side-effects). The
// programmatic API is exposed via the `./lib` subpath export (dist/lib.js),
// which has NO side effects — import { startAcpServer } from
// "@agentclientprotocol/codex-acp/lib".

if (process.argv.includes("--version")) {
    console.log(`${packageJson.name} ${packageJson.version}`);
    process.exit(0);
}

if (process.argv[2] === "login") {
    const args = process.argv.slice(3);
    runLoginCommand(args)
        .then((success) => process.exit(success ? 0 : 1))
        .catch((error) => {
            console.error("Login error:", error.message);
            process.exit(1);
        });
} else if (process.argv[2] === "cli") {
    const args = process.argv.slice(3);
    runCodexCli(process.env["CODEX_PATH"], args)
        .then((exitCode) => process.exit(exitCode))
        .catch((error) => {
            console.error("Codex CLI error:", error.message);
            process.exit(1);
        });
} else {
    startAcpServer();
}
