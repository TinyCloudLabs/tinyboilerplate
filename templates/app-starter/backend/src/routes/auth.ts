import { Router } from "express";
import type { Request, Response } from "express";
import {
  isExpectedSiweOrigin,
  issueSessionToken,
  verifyRenewal,
  verifySIWE,
  type NonceStore,
  type RenewalVerifyConfig,
} from "@tinyboilerplate/server";

interface AuthRoutesConfig {
  nonceStore: NonceStore;
  privateKey: string;
  /** The frontend URL: a grant is accepted only when its SIWE domain is this host. */
  frontendUrl: string;
  /** Pinned node and renewer for `/verify-renewal`; absent, that route answers 503. */
  renewal?: RenewalVerifyConfig;
  /** Test seam for the node relay. */
  renewalFetch?: typeof fetch;
}

export function createAuthRouter(config: AuthRoutesConfig) {
  const router = Router();

  router.get("/nonce", (req: Request, res: Response) => {
    const address = req.query.address;
    if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      res.status(400).json({ error: "invalid_address", message: "A valid address is required" });
      return;
    }
    res.json({ nonce: config.nonceStore.generate(address) });
  });

  router.post("/verify", async (req: Request, res: Response) => {
    const { message, signature } = req.body;
    if (typeof message !== "string" || typeof signature !== "string") {
      res
        .status(400)
        .json({ error: "invalid_request", message: "Message and signature are required" });
      return;
    }

    try {
      const { address, nonce, domain, uri } = await verifySIWE(message, signature);
      if (!isExpectedSiweOrigin(domain, uri, config.frontendUrl)) {
        res.status(400).json({
          error: "invalid_origin",
          message: "SIWE domain or URI does not match this application",
        });
        return;
      }
      if (!config.nonceStore.validate(address, nonce)) {
        res
          .status(401)
          .json({ error: "invalid_nonce", message: "Nonce is invalid, expired, or already used" });
        return;
      }
      const { token, expiresIn } = await issueSessionToken(address, config.privateKey);
      res.json({ token, expiresIn, address: address.toLowerCase() });
    } catch (error) {
      console.error("[auth] verification failed:", error);
      res
        .status(401)
        .json({ error: "verification_failed", message: "SIWE signature verification failed" });
    }
  });

  /**
   * A fresh bearer for a TinyCloud session restored through its renewal lease after the original grant's signed end.
   * The nonce is consumed first; the node is asked only once everything the client signed has passed.
   * Adapted from TinyChat's `/api/auth/verify-renewal`.
   */
  router.post("/verify-renewal", async (req: Request, res: Response) => {
    if (!config.renewal) {
      res.status(503).json({ error: "renewal_unavailable" });
      return;
    }
    const { address, nonce, delegation, leaseAuthorization, holderProof, statusInvocation } =
      req.body ?? {};
    if (
      typeof address !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(address) ||
      typeof nonce !== "string" ||
      typeof delegation !== "object" ||
      delegation === null ||
      typeof delegation.message !== "string" ||
      typeof delegation.signature !== "string" ||
      typeof delegation.delegationCid !== "string" ||
      typeof leaseAuthorization !== "string" ||
      typeof holderProof !== "string" ||
      typeof statusInvocation !== "string"
    ) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!config.nonceStore.validate(address, nonce)) {
      res.status(401).json({ error: "invalid_nonce" });
      return;
    }
    try {
      const result = await verifyRenewal(
        {
          address,
          nonce,
          delegation: {
            message: delegation.message,
            signature: delegation.signature,
            delegationCid: delegation.delegationCid,
          },
          leaseAuthorization,
          holderProof,
          statusInvocation,
        },
        { config: config.renewal, ...(config.renewalFetch ? { fetch: config.renewalFetch } : {}) },
      );
      if (!result.ok) {
        console.warn("[auth] verify-renewal refused:", result.code);
        res.status(result.status).json({ error: result.code });
        return;
      }
      const { token, expiresIn } = await issueSessionToken(address, config.privateKey, {
        notAfter: new Date(result.notAfter * 1000),
      });
      res.json({
        token,
        expiresIn,
        address: address.toLowerCase(),
        renewal: { effectiveEnd: result.effectiveEnd },
      });
    } catch (error) {
      console.error("[auth] verify-renewal failed:", error);
      res.status(401).json({ error: "verification_failed" });
    }
  });

  return router;
}
