import type { FullTranscript } from "../services/fireflies-client.js";
import type { NormalizeFn } from "./types.js";

// ── Fireflies → NormalizedConversation adapter ─────────────────────

export const normalizeFireflies: NormalizeFn<FullTranscript> = (raw) => {
  const startedAt = new Date(raw.date).toISOString();
  const endedAt = new Date(raw.date + raw.duration * 1000).toISOString();

  // Build a lookup from attendee displayName → email for best-effort matching
  const emailByName = new Map<string, string>();
  for (const attendee of raw.meeting_attendees) {
    emailByName.set(attendee.displayName, attendee.email);
  }

  // Deduplicate speakers by name, keeping the first occurrence
  const seenNames = new Set<string>();
  const uniqueSpeakers = raw.speakers.filter((speaker) => {
    if (seenNames.has(speaker.name)) return false;
    seenNames.add(speaker.name);
    return true;
  });

  return {
    conversation: {
      id: crypto.randomUUID(),
      title: raw.title,
      source: "fireflies",
      source_id: raw.id,
      source_url: raw.transcript_url,
      started_at: startedAt,
      ended_at: endedAt,
      duration_secs: raw.duration,
      summary: raw.summary.overview,
      metadata: {
        audio_url: raw.audio_url,
        organizer_email: raw.organizer_email,
        keywords: raw.summary.keywords,
        meeting_type: raw.summary.meeting_type,
      },
    },
    participants: uniqueSpeakers.map((speaker) => ({
      id: crypto.randomUUID(),
      name: speaker.name,
      email: emailByName.get(speaker.name) ?? null,
      speaker_label: speaker.id,
    })),
    transcript: raw.sentences,
  };
};
