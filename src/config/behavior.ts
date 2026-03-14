export type PermissionLevel = 'auto' | 'auto_notify' | 'ask';

export interface BehaviorConfig {
  autonomy_level: 'low' | 'medium' | 'high';
  permissions: {
    feed_consumption: PermissionLevel;
    content_analysis: PermissionLevel;
    reputation_calculation: PermissionLevel;
    auto_reply_simple: PermissionLevel;
    accept_low_risk_request: PermissionLevel;
    discover_new_sources: PermissionLevel;
    recommend_to_others: PermissionLevel;
    follow_new_source: PermissionLevel;
    publish_content: PermissionLevel;
    negotiate: PermissionLevel;
    unfollow: PermissionLevel;
    block: PermissionLevel;
  };
  preferences: {
    content_interests: string[];
    social_style: 'open' | 'selective' | 'conservative';
    notification_frequency: 'realtime' | 'hourly' | 'daily_digest';
  };
}

export function createDefaultBehavior(autonomy: 'low' | 'medium' | 'high' = 'medium'): BehaviorConfig {
  if (autonomy === 'low') {
    return {
      autonomy_level: 'low',
      permissions: {
        feed_consumption: 'auto',
        content_analysis: 'auto_notify',
        reputation_calculation: 'auto_notify',
        auto_reply_simple: 'ask',
        accept_low_risk_request: 'ask',
        discover_new_sources: 'ask',
        recommend_to_others: 'ask',
        follow_new_source: 'ask',
        publish_content: 'ask',
        negotiate: 'ask',
        unfollow: 'ask',
        block: 'ask',
      },
      preferences: {
        content_interests: [],
        social_style: 'conservative',
        notification_frequency: 'realtime',
      },
    };
  }

  if (autonomy === 'high') {
    return {
      autonomy_level: 'high',
      permissions: {
        feed_consumption: 'auto',
        content_analysis: 'auto',
        reputation_calculation: 'auto',
        auto_reply_simple: 'auto',
        accept_low_risk_request: 'auto',
        discover_new_sources: 'auto',
        recommend_to_others: 'auto_notify',
        follow_new_source: 'auto_notify',
        publish_content: 'auto_notify',
        negotiate: 'auto_notify',
        unfollow: 'auto_notify',
        block: 'ask',
      },
      preferences: {
        content_interests: [],
        social_style: 'open',
        notification_frequency: 'daily_digest',
      },
    };
  }

  // medium (default)
  return {
    autonomy_level: 'medium',
    permissions: {
      feed_consumption: 'auto',
      content_analysis: 'auto',
      reputation_calculation: 'auto',
      auto_reply_simple: 'auto_notify',
      accept_low_risk_request: 'auto_notify',
      discover_new_sources: 'auto_notify',
      recommend_to_others: 'ask',
      follow_new_source: 'ask',
      publish_content: 'ask',
      negotiate: 'ask',
      unfollow: 'auto_notify',
      block: 'ask',
    },
    preferences: {
      content_interests: [],
      social_style: 'selective',
      notification_frequency: 'hourly',
    },
  };
}
