export class DiscordWebhookClient {
  constructor(webhookUrl, fetchImplementation = globalThis.fetch) {
    this.url = new URL(webhookUrl);
    this.url.search = "";
    this.url.hash = "";
    this.fetch = fetchImplementation;
  }

  async post(payload) {
    const url = new URL(this.url);
    url.searchParams.set("wait", "true");
    const response = await this.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Discord webhook POST failed with HTTP ${response.status}.`);
    const message = await response.json();
    if (!message?.id) throw new Error("Discord webhook POST succeeded without returning a message ID.");
    return String(message.id);
  }

  async patch(messageId, payload) {
    const url = new URL(this.url);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}`;
    const response = await this.fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Discord webhook PATCH failed with HTTP ${response.status}.`);
    return true;
  }
}
