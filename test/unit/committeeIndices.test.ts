import {randomBytes} from "node:crypto";
import {describe, it, expect} from "vitest";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  SHUFFLE_ROUND_COUNT,
} from "@lodestar/params";
import {computeProposerIndex} from "@lodestar/state-transition";

import {computeProposerIndexElectra} from "../../index.js";

describe("computeProposerIndex", () => {
  it("should compute the same index as reference implementation", async () => {
    const seed = randomBytes(32);
    const vc = 1000;
    const activeIndices = new Uint32Array(Array.from({length: vc}, (_, i) => i));
    const effectiveBalanceIncrements = new Uint16Array(vc);
    for (let i = 0; i < vc; i++) {
      effectiveBalanceIncrements[i] = 32 + 32 * (i % 64);
    }
    expect(
      computeProposerIndexElectra(
        effectiveBalanceIncrements,
        activeIndices,
        seed,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        SHUFFLE_ROUND_COUNT
      )
    ).to.be.eq(computeProposerIndex(ForkSeq.electra, effectiveBalanceIncrements, activeIndices, seed));
  });
});
