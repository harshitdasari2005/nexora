/**
 * @nexora/module-integrations — EmailSender port.
 *
 * The outbound email seam (BKD §9.1: connectors are adapters). The domain
 * only ever produces {@link EmailRecord} outbox records; the sender is the
 * adapter that transports them. The MVP ships a {@link DevEmailSink} (logs
 * the structured email and records the outbox row) — a production SMTP
 * adapter can be swapped in behind this port without touching the domain or
 * the notification pipeline.
 */

import type { EmailRecord } from '../domain/email-record.js';

/** A transport failure (surfaced loudly — outbox records stay persisted). */
export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/** The outbound email transport port. */
export interface EmailSender {
  /**
   * Dispatches an email. Implementations MUST NOT throw for expected
   * transport failures without the caller observing them — the outbox
   * record is already persisted by the time this is called.
   */
  send(record: EmailRecord): Promise<void>;
}

/**
 * The MVP dev sink: logs the structured email (visible in the API log) and
 * does not require SMTP credentials. The outbox row is persisted by the
 * application layer regardless of the sink.
 */
export class DevEmailSink implements EmailSender {
  readonly #log: (record: EmailRecord) => void;

  constructor(
    log: (record: EmailRecord) => void = (record) => {
      process.stdout.write(
        `[dev-email] to=${record.recipientEmail} subject="${record.subject}" body="${record.body}"\n`,
      );
    },
  ) {
    this.#log = log;
  }

  async send(record: EmailRecord): Promise<void> {
    this.#log(record);
  }
}
