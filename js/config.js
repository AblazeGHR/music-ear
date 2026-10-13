// config.js — deployment configuration.

export const APP_VERSION = '0.6.4';

// PostHog project API key (public, safe to commit). Leave empty to disable
// all analytics — every tracking call becomes a no-op.
// NOTE (import, 2026-10-13): emptied — this fork is privacy-first and does
// not report usage to the upstream author's PostHog project.
export const POSTHOG_KEY = '';
export const POSTHOG_HOST = 'https://us.i.posthog.com';

export const REPO_URL = 'https://github.com/abeage1/earpath-app';
export const FEEDBACK_EMAIL = 'ericsilberstein@gmail.com';
