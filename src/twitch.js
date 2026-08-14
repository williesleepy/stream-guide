const TWITCH_TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API_ENDPOINT = 'https://api.twitch.tv/helix';

export class TwitchError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'TwitchError';
  }
}

export class TwitchClient {
  constructor(clientId, clientSecret, logger = console) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.logger = logger;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  get enabled() {
    return Boolean(this.clientId && this.clientSecret);
  }

  async appAccessToken() {
    if (!this.enabled) return null;

    const now = Date.now();
    if (this.accessToken && now < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    let response;
    try {
      const body = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials',
      });

      response = await fetch(TWITCH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new TwitchError(`Twitch token request failed: ${error.message}`, { cause: error });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new TwitchError(
        `Twitch token request returned HTTP ${response.status}${text ? `: ${text.slice(0, 250)}` : ''}`,
      );
    }

    const payload = await response.json();
    if (!payload?.access_token) {
      throw new TwitchError('Twitch token response did not include an access token');
    }

    this.accessToken = payload.access_token;
    this.accessTokenExpiresAt = now + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    return this.accessToken;
  }

  async liveStreams(logins) {
    if (!this.enabled) return null;

    const unique = [...new Set(
      (logins ?? [])
        .map((login) => String(login ?? '').trim().toLowerCase())
        .filter(Boolean),
    )];

    const result = new Map();
    if (!unique.length) return result;

    const token = await this.appAccessToken();

    // Helix accepts repeated user_login parameters. Keep batches modest even
    // though Stream Guide normally checks only a handful of channels.
    for (let index = 0; index < unique.length; index += 50) {
      const batch = unique.slice(index, index + 50);
      const url = new URL(`${TWITCH_API_ENDPOINT}/streams`);
      for (const login of batch) url.searchParams.append('user_login', login);
      url.searchParams.set('first', String(Math.min(100, batch.length)));

      let response;
      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Client-Id': this.clientId,
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        throw new TwitchError(`Twitch streams request failed: ${error.message}`, { cause: error });
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new TwitchError(
          `Twitch streams request returned HTTP ${response.status}${text ? `: ${text.slice(0, 250)}` : ''}`,
        );
      }

      const payload = await response.json();
      const liveByLogin = new Map(
        (payload?.data ?? []).map((stream) => [String(stream.user_login ?? '').toLowerCase(), stream]),
      );

      for (const login of batch) {
        result.set(login, liveByLogin.get(login) ?? null);
      }
    }

    return result;
  }
}
