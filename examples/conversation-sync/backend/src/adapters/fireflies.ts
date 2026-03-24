import type { FullTranscript } from "../services/fireflies-client.js";
import type { NormalizeFn } from "./types.js";

// ── Fireflies → NormalizedConversation adapter ─────────────────────

export const normalizeFireflies: NormalizeFn<FullTranscript> = (raw) => {
  const startedAt = new Date(raw.date).toISOString();
<<<<<<< HEAD
  // Fireflies API duration unit is undocumented. Empirically returns minutes
  // (e.g. 30 for a 30-minute meeting), so we convert to seconds.
  const durationSecs = Math.round(raw.duration * 60);
  console.log(`[adapter] duration raw=${raw.duration} → ${durationSecs}s for "${raw.title}"`);
  const endedAt = new Date(raw.date + durationSecs * 1000).toISOString();

  // Build a lookup from attendee displayName → email for best-effort matching
  const emailByName = new Map<string, string>();
  for (const attendee of raw.meeting_attendees ?? []) {
=======
  const endedAt = new Date(raw.date + raw.duration * 1000).toISOString();

  // Build a lookup from attendee displayName → email for best-effort matching
  const emailByName = new Map<string, string>();
  for (const attendee of raw.meeting_attendees) {
>>>>>>> bac670e (TC-1300: Add NormalizedConversation types and Fireflies adapter)
    emailByName.set(attendee.displayName, attendee.email);
  }

  // Deduplicate speakers by name, keeping the first occurrence
  const seenNames = new Set<string>();
<<<<<<< HEAD
  const uniqueSpeakers = (raw.speakers ?? []).filter((speaker) => {
=======
  const uniqueSpeakers = raw.speakers.filter((speaker) => {
>>>>>>> bac670e (TC-1300: Add NormalizedConversation types and Fireflies adapter)
    if (seenNames.has(speaker.name)) return false;
    seenNames.add(speaker.name);
    return true;
  });

<<<<<<< HEAD
  const summary = raw.summary ?? {};

=======
>>>>>>> bac670e (TC-1300: Add NormalizedConversation types and Fireflies adapter)
  return {
    conversation: {
      id: crypto.randomUUID(),
      title: raw.title,
      source: "fireflies",
      source_id: raw.id,
      source_url: raw.transcript_url,
      started_at: startedAt,
      ended_at: endedAt,
<<<<<<< HEAD
      duration_secs: durationSecs,
      summary: summary.overview ?? null,
      metadata: {
        audio_url: raw.audio_url,
        organizer_email: raw.organizer_email,
        keywords: summary.keywords ?? [],
        meeting_type: summary.meeting_type ?? null,
=======
      duration_secs: raw.duration,
      summary: raw.summary.overview,
      metadata: {
        audio_url: raw.audio_url,
        organizer_email: raw.organizer_email,
        keywords: raw.summary.keywords,
        meeting_type: raw.summary.meeting_type,
>>>>>>> bac670e (TC-1300: Add NormalizedConversation types and Fireflies adapter)
      },
    },
    participants: uniqueSpeakers.map((speaker) => ({
      id: crypto.randomUUID(),
      name: speaker.name,
      email: emailByName.get(speaker.name) ?? null,
      speaker_label: speaker.id,
    })),
<<<<<<< HEAD
    transcript: raw.sentences ?? [],
=======
    transcript: raw.sentences,
>>>>>>> bac670e (TC-1300: Add NormalizedConversation types and Fireflies adapter)
  };
};
