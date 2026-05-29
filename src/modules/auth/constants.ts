export const CONSENT_TYPES = {
  // Legal
  TERMS_OF_SERVICE: "terms_of_service",
  PRIVACY_POLICY: "privacy_policy",
  COOKIE_POLICY: "cookie_policy",

  // GDPR
  DATA_PROCESSING: "data_processing",
  DATA_RETENTION: "data_retention",
  THIRD_PARTY_SHARING: "third_party_sharing",

  // Marketing
  MARKETING_EMAILS: "marketing_emails",
  MARKETING_SMS: "marketing_sms",
  PUSH_NOTIFICATIONS: "push_notifications",

  // Age
  AGE_VERIFICATION: "age_verification",
} as const;

export type ConsentType = (typeof CONSENT_TYPES)[keyof typeof CONSENT_TYPES];

// Fallback when a consent type has no explicit version in CONSENT_VERSIONS.
// Should never be hit in practice — every type in CONSENT_TYPES should have
// a matching entry below — but acts as a defined sentinel if dev adds a
// new type without updating CONSENT_VERSIONS.
export const DEFAULT_CONSENT_VERSION = "v1.0";

export const CONSENT_VERSIONS: Record<ConsentType, string> = {
  terms_of_service: "v1.0",
  privacy_policy: "v1.0",
  cookie_policy: "v1.0",
  data_processing: "v1.0",
  data_retention: "v1.0",
  third_party_sharing: "v1.0",
  marketing_emails: "v1.0",
  marketing_sms: "v1.0",
  push_notifications: "v1.0",
  age_verification: "v1.0",
};

export const REQUIRED_CONSENTS: ConsentType[] = [
  CONSENT_TYPES.TERMS_OF_SERVICE,
  CONSENT_TYPES.PRIVACY_POLICY,
  CONSENT_TYPES.DATA_PROCESSING,
] as const;

export const OPTIONAL_CONSENTS: ConsentType[] = [
  CONSENT_TYPES.MARKETING_EMAILS,
  CONSENT_TYPES.MARKETING_SMS,
  CONSENT_TYPES.PUSH_NOTIFICATIONS,
  CONSENT_TYPES.COOKIE_POLICY,
  CONSENT_TYPES.DATA_RETENTION,
  CONSENT_TYPES.THIRD_PARTY_SHARING,
] as const;

export const GDPR_CONSENTS: ConsentType[] = [
  CONSENT_TYPES.DATA_PROCESSING,
  CONSENT_TYPES.DATA_RETENTION,
  CONSENT_TYPES.THIRD_PARTY_SHARING,
] as const;

export const MARKETING_CONSENTS: ConsentType[] = [
  CONSENT_TYPES.MARKETING_EMAILS,
  CONSENT_TYPES.MARKETING_SMS,
  CONSENT_TYPES.PUSH_NOTIFICATIONS,
] as const;

export const COOKIE_CONSENTS: ConsentType[] = [
  CONSENT_TYPES.COOKIE_POLICY,
] as const;

export const SIGNUP_CONSENTS: ConsentType[] = [
  CONSENT_TYPES.TERMS_OF_SERVICE,
  CONSENT_TYPES.PRIVACY_POLICY,
  CONSENT_TYPES.DATA_PROCESSING,
] as const;
