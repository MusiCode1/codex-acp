import type {SessionId} from "@agentclientprotocol/sdk/unstable";

/**
 * Voice front-end for a Codex session, backed by app-server `thread/realtime/*` (GPT-Live, v3 over WebRTC).
 *
 * The client owns the WebRTC peer (mic, speaker, data channel); the adapter only negotiates the call
 * on the session's own thread. Delegations from the voice model become ordinary Codex turns on that
 * thread, so their output reaches the client through the normal session updates.
 */
export const REALTIME_START_METHOD = "_codex/realtime/start";
export const REALTIME_STOP_METHOD = "_codex/realtime/stop";
export const REALTIME_APPEND_SPEECH_METHOD = "_codex/realtime/appendSpeech";
export const REALTIME_LIST_VOICES_METHOD = "_codex/realtime/listVoices";
/** Notification carrying a forwarded `thread/realtime/*` app-server notification. */
export const REALTIME_EVENT_NOTIFICATION = "_codex/realtime/event";

export type RealtimeStartRequest = {
    sessionId: SessionId;
    /** SDP offer from the client's RTCPeerConnection (audio track + `oai-events` data channel). */
    sdp: string;
    /** Instructions for the voice model. */
    prompt?: string;
    voice?: string;
    delegationAckFiller?: boolean;
    /** How Codex's answers reach the voice: quiet context (`thinking`, default), `commentary`, or `bemTags`. */
    handoffMode?: "thinking" | "commentary" | "bemTags";
};
export type RealtimeStartResponse = { sdp: string };
export type RealtimeStopRequest = { sessionId: SessionId };
export type RealtimeAppendSpeechRequest = { sessionId: SessionId; text: string };
export type RealtimeListVoicesRequest = { sessionId: SessionId };
/** Voices of the realtime version this extension starts (v3), and the one used when none is chosen. */
export type RealtimeListVoicesResponse = { voices: string[]; default: string };
/** Codex's own default on the ChatGPT route when no voice is set (codex-api realtime_call.rs). */
export const REALTIME_DEFAULT_VOICE = "cove";

export type RealtimeStartExtRequest = { method: typeof REALTIME_START_METHOD; params: RealtimeStartRequest };
export type RealtimeStopExtRequest = { method: typeof REALTIME_STOP_METHOD; params: RealtimeStopRequest };
export type RealtimeAppendSpeechExtRequest = { method: typeof REALTIME_APPEND_SPEECH_METHOD; params: RealtimeAppendSpeechRequest };
export type RealtimeListVoicesExtRequest = { method: typeof REALTIME_LIST_VOICES_METHOD; params: RealtimeListVoicesRequest };

export type RealtimeEventNotification = {
    sessionId: SessionId;
    method: string;
    params: Record<string, unknown>;
};

/** Forwarded to the client. Deltas and audio stay out: the WebRTC data channel already carries them. */
export const FORWARDED_REALTIME_METHODS: ReadonlySet<string> = new Set([
    "thread/realtime/started",
    "thread/realtime/transcript/done",
    "thread/realtime/error",
    "thread/realtime/closed",
]);

/** How long to wait for the SDP answer after `thread/realtime/start` is accepted. */
export const REALTIME_SDP_TIMEOUT_MS = 30_000;

/**
 * Marks a chat message as part of the voice conversation, in `_meta.codex.realtime`:
 * - `speech`: what the user or the voice said (final transcript).
 * - `handoff`: a request the voice delegated to Codex; the message text is the request and
 *   `transcript` is the conversation since the previous handoff, as Codex received it.
 */
export type RealtimeMessageMeta =
    | { kind: "speech"; role: "user" | "assistant" }
    | { kind: "handoff"; transcript?: string };

export function realtimeMeta(realtime: RealtimeMessageMeta): { codex: { realtime: RealtimeMessageMeta } } {
    return {codex: {realtime}};
}

const DELEGATION = /^<realtime_delegation>\s*<input>([\s\S]*?)<\/input>(?:\s*<transcript_delta>([\s\S]*?)<\/transcript_delta>)?/;

/**
 * Codex hands a voice delegation to the thread as a user message
 * `<realtime_delegation><input>…</input><transcript_delta>…</transcript_delta></realtime_delegation>`.
 * Returns its parts, or null when the text is not a delegation.
 */
export function parseRealtimeDelegation(text: string): { input: string; transcript?: string } | null {
    const match = DELEGATION.exec(text.trimStart());
    const input = match?.[1]?.trim();
    if (!match || !input) return null;
    const transcript = match[2]?.trim();
    return transcript ? {input, transcript} : {input};
}
