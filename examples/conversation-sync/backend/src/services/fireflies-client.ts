const FIREFLIES_GRAPHQL_URL = "https://api.fireflies.ai/graphql";

// ── Response types ──────────────────────────────────────────────────

export interface FirefliesUser {
  name: string;
  email: string;
  is_admin: boolean;
}

export interface TranscriptSummary {
  id: string;
  title: string;
  date: number;
  duration: number;
  organizer_email: string;
  transcript_url: string;
}

export interface Speaker {
  id: string;
  name: string;
}

export interface MeetingAttendee {
  displayName: string;
  email: string;
}

export interface AiFilters {
  task: boolean;
  pricing: boolean;
  metric: boolean;
  question: boolean;
  date_and_time: boolean;
  sentiment: string;
}

export interface Sentence {
  index: number;
  speaker_id: string;
  speaker_name: string;
  text: string;
  raw_text: string;
  start_time: number;
  end_time: number;
  ai_filters: AiFilters;
}

export interface TranscriptSummaryInfo {
  keywords: string[];
  action_items: string[];
  overview: string;
  shorthand_bullet: string;
  meeting_type: string;
}

export interface FullTranscript {
  id: string;
  title: string;
  date: number;
  duration: number;
  organizer_email: string;
  transcript_url: string;
  speakers: Speaker[];
  meeting_attendees: MeetingAttendee[];
  sentences: Sentence[];
  summary: TranscriptSummaryInfo;
  audio_url: string;
}

// ── GraphQL queries ─────────────────────────────────────────────────

const GET_USER_QUERY = `query GetUser {
  user {
    name
    email
    is_admin
  }
}`;

const LIST_TRANSCRIPTS_QUERY = `query ListTranscripts($limit: Int, $skip: Int) {
  transcripts(limit: $limit, skip: $skip) {
    id
    title
    date
    duration
    organizer_email
    transcript_url
  }
}`;

const GET_TRANSCRIPT_QUERY = `query GetTranscript($id: String!) {
  transcript(id: $id) {
    id
    title
    date
    duration
    organizer_email
    transcript_url
    speakers {
      id
      name
    }
    meeting_attendees {
      displayName
      email
    }
    sentences {
      index
      speaker_id
      speaker_name
      text
      raw_text
      start_time
      end_time
      ai_filters {
        task
        pricing
        metric
        question
        date_and_time
        sentiment
      }
    }
    summary {
      keywords
      action_items
      overview
      shorthand_bullet
      meeting_type
    }
    audio_url
  }
}`;

// ── Client ──────────────────────────────────────────────────────────

export class FirefliesClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /** Fetch the authenticated user's info. */
  async getUser(): Promise<FirefliesUser> {
    return this.request<{ user: FirefliesUser }>(GET_USER_QUERY).then(
      (data) => data.user,
    );
  }

  /** List transcripts with optional pagination. */
  async listTranscripts(
    limit?: number,
    skip?: number,
  ): Promise<TranscriptSummary[]> {
    return this.request<{ transcripts: TranscriptSummary[] }>(
      LIST_TRANSCRIPTS_QUERY,
      { limit, skip },
    ).then((data) => data.transcripts);
  }

  /** Fetch a single transcript with full detail. */
  async getTranscript(id: string): Promise<FullTranscript> {
    return this.request<{ transcript: FullTranscript }>(
      GET_TRANSCRIPT_QUERY,
      { id },
    ).then((data) => data.transcript);
  }

  // ── Private ───────────────────────────────────────────────────

  private async request<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(FIREFLIES_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(
        `Fireflies API error: ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }

    return json.data as T;
  }
}
