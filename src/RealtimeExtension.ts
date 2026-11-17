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
};
export type RealtimeStartResponse = { sdp: string };
export type RealtimeStopRequest = { sessionId: SessionId };
export type RealtimeAppendSpeechRequest = { sessionId: SessionId; text: string };

export type RealtimeStartExtRequest = { method: typeof REALTIME_START_METHOD; params: RealtimeStartRequest };
export type RealtimeStopExtRequest = { method: typeof REALTIME_STOP_METHOD; params: RealtimeStopRequest };
export type RealtimeAppendSpeechExtRequest = { method: typeof REALTIME_APPEND_SPEECH_METHOD; params: RealtimeAppendSpeechRequest };

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

const DELEGATION_INPUT = /^<realtime_delegation>\s*<input>([\s\S]*?)<\/input>/;

/**
 * Codex wraps a voice delegation as `<realtime_delegation><input>…</input>…</realtime_delegation>`.
 * Returns the spoken request, or null when the text is not a delegation.
 */
export function realtimeDelegationInput(text: string): string | null {
    const match = DELEGATION_INPUT.exec(text.trimStart());
    if (!match) return null;
    const input = (match[1] ?? "").trim();
    return input.length > 0 ? input : null;
}
