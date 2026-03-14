export interface DirectExperience {
  interactions_count: number;
  avg_response_time?: string;
  content_quality: number;
  commitments_fulfilled: number;
  last_interaction: string;
}

export interface SocialTrust {
  trusted_by: Array<{ entity: string; trust_level: number }>;
  social_trust_score: number;
}

export interface NetworkSignals {
  subscribers_count: number;
  block_count: number;
  report_count: number;
  active_since: string;
}

export interface ReputationRecord {
  entity: string;
  direct: DirectExperience;
  social: SocialTrust;
  network: NetworkSignals;
  computed_trust: number;
  last_computed: string;
}

export function createDefaultReputationRecord(entity: string): ReputationRecord {
  const now = new Date().toISOString();

  return {
    entity,
    direct: {
      interactions_count: 0,
      content_quality: 0,
      commitments_fulfilled: 0,
      last_interaction: now,
    },
    social: {
      trusted_by: [],
      social_trust_score: 0,
    },
    network: {
      subscribers_count: 0,
      block_count: 0,
      report_count: 0,
      active_since: now,
    },
    computed_trust: 0,
    last_computed: now,
  };
}
