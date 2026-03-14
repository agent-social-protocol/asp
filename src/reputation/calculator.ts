import type { ReputationRecord, DirectExperience, NetworkSignals } from './models.js';

/**
 * Compute a score from direct experience with an entity.
 * Weighted combination:
 *   - content_quality: 40%
 *   - commitments_fulfilled: 40%
 *   - recency bonus: 20% (higher if last_interaction is recent)
 * Returns a value between 0 and 1.
 */
function directScore(direct: DirectExperience): number {
  const qualityWeight = 0.4;
  const commitmentsWeight = 0.4;
  const recencyWeight = 0.2;

  // content_quality and commitments_fulfilled are already 0-1
  const quality = Math.min(1, Math.max(0, direct.content_quality));
  const commitments = Math.min(1, Math.max(0, direct.commitments_fulfilled));

  // Recency bonus: decays over time. Full score if interaction was today,
  // half-life of 30 days.
  const lastInteraction = new Date(direct.last_interaction).getTime();
  const now = Date.now();
  const daysSince = Math.max(0, (now - lastInteraction) / (1000 * 60 * 60 * 24));
  const halfLifeDays = 30;
  const recency = Math.pow(0.5, daysSince / halfLifeDays);

  return qualityWeight * quality + commitmentsWeight * commitments + recencyWeight * recency;
}

/**
 * Compute a score from network-level signals.
 * Factors in subscribers (with diminishing returns via log) and penalizes
 * blocks and reports.
 * Returns a value between 0 and 1.
 */
function networkScore(network: NetworkSignals): number {
  // Subscriber score: diminishing returns via log. log2(1 + subscribers) / log2(1 + 1000)
  // At 0 subscribers -> 0, at 1000+ subscribers -> ~1
  const subscriberScore = Math.min(1, Math.log2(1 + network.subscribers_count) / Math.log2(1 + 1000));

  // Penalty for blocks and reports. Each block/report reduces the score.
  // Cap the penalty at 1 so the score doesn't go negative before clamping.
  const penaltyPerBlock = 0.05;
  const penaltyPerReport = 0.1;
  const penalty = Math.min(1, network.block_count * penaltyPerBlock + network.report_count * penaltyPerReport);

  return Math.max(0, subscriberScore - penalty);
}

/**
 * Compute an overall trust score for an entity based on its reputation record.
 *
 * Weights:
 *   - Direct experience: 50% if available (interactions_count > 0), otherwise 10%
 *   - Social trust score: 30%
 *   - Network signals: remaining weight (20% or 60%)
 *
 * Returns a value clamped between 0 and 1.
 */
export function computeTrust(record: ReputationRecord): number {
  const hasDirectExperience = record.direct.interactions_count > 0;
  const w1 = hasDirectExperience ? 0.5 : 0.1;
  const w2 = 0.3;
  const w3 = 1 - w1 - w2;

  return Math.min(1, Math.max(0,
    w1 * directScore(record.direct) +
    w2 * Math.min(1, Math.max(0, record.social.social_trust_score)) +
    w3 * networkScore(record.network)
  ));
}
