import { randomBytes, randomUUID } from "node:crypto";
import { Database } from "./database.js";
import { Coordination } from "./coordination.js";
import { assert, digest, equal, hmac } from "./common.js";
// Internal-only foundation. No HTTP route or SMS provider is exposed in Phase 1.
export class OtpPolicy {
  constructor(
    private db: Database,
    private coordination: Coordination,
    private pepper: string,
  ) {}
  async create(
    subject: string,
    purpose: string,
    code: string,
    network: string,
  ) {
    assert(/^\d{6}$/.test(code), 400, "INVALID_OTP_FORMAT");
    assert(
      [
        "activation",
        "invitation",
        "suspicious_login",
        "transfer",
        "recovery",
      ].includes(purpose),
      400,
      "INVALID_OTP_PURPOSE",
    );
    const subjectDigest = hmac(this.pepper, subject);
    await this.coordination.limit("otp-resend", subjectDigest, 1, 60);
    await this.coordination.limit("otp-send", subjectDigest, 5, 3600);
    await this.coordination.limit("otp-network", network, 20, 3600);
    const id = randomUUID();
    await this.db.transaction(this.db.identity, async (tx) => {
      await tx.query(
        "INSERT INTO identity.otp_challenges(id,subject_digest,purpose,verifier,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')",
        [
          id,
          subjectDigest,
          purpose,
          hmac(this.pepper, `${id}:${subjectDigest}:${purpose}:${code}`),
        ],
      );
      await this.db.securityEvent("otp.created", null, tx);
    });
    return id;
  }
  async verify(id: string, subject: string, purpose: string, code: string) {
    const subjectDigest = hmac(this.pepper, subject);
    await this.coordination.limit("otp-verify", subjectDigest, 5, 900);
    const proof = randomBytes(32).toString("base64url");
    const valid = await this.db.transaction(this.db.identity, async (tx) => {
      const row = (
        await tx.query(
          "SELECT * FROM identity.otp_challenges WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (
        !row ||
        row.consumed_at ||
        row.expires_at <= new Date() ||
        row.attempts >= 5
      )
        return false;
      await tx.query(
        "UPDATE identity.otp_challenges SET attempts=attempts+1 WHERE id=$1",
        [id],
      );
      if (
        row.subject_digest !== subjectDigest ||
        row.purpose !== purpose ||
        !equal(
          row.verifier as string,
          hmac(this.pepper, `${id}:${subjectDigest}:${purpose}:${code}`),
        )
      )
        return false;
      await tx.query(
        "UPDATE identity.otp_challenges SET consumed_at=now() WHERE id=$1",
        [id],
      );
      await tx.query(
        "INSERT INTO identity.otp_proofs(digest,challenge_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
        [digest(proof), id, purpose],
      );
      await this.db.securityEvent("otp.verified", null, tx);
      return true;
    });
    if (!valid) await this.db.securityEvent("otp.rejected");
    assert(valid, 401, "OTP_INVALID");
    return proof;
  }
  async consume(proof: string, challengeId: string, purpose: string) {
    await this.db.transaction(this.db.identity, async (tx) => {
      const result = await tx.query(
        "UPDATE identity.otp_proofs SET consumed_at=now() WHERE digest=$1 AND challenge_id=$2 AND purpose=$3 AND consumed_at IS NULL AND expires_at>now() RETURNING challenge_id",
        [digest(proof), challengeId, purpose],
      );
      assert(result.rowCount, 401, "OTP_PROOF_INVALID");
      await this.db.securityEvent("otp.proof_consumed", null, tx);
    });
  }
}
