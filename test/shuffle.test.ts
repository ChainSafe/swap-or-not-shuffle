import {expect, describe, it} from "@jest/globals";
import {fromHex} from "@lodestar/utils";
import {unshuffleList, SHUFFLE_ROUNDS, asyncUnshuffleList} from "../index.js";

const oldSeed = Buffer.alloc(32, 0x00);
oldSeed.set([42, 32], 0);

describe("util / shuffle", () => {
  const testCases: {
    id: string;
    count: number;
    seed: string;
    expected: number[];
  }[] = [
    // Values from `unshuffleList()` at commit https://github.com/ChainSafe/lodestar/commit/ec065635ca7da7f3788da018bd68c4900f0427d2
    {
      id: "from spec",
      count: 100,
      seed: "0x4fe91d85d6bc19b20413659c61f3c690a1c4d48be41cab8363a130cebabada97",
      expected: [
        99, 71, 51, 5, 78, 61, 12, 17, 30, 3, 59, 47, 6, 9, 1, 41, 18, 37, 55, 43, 20, 31, 38, 79, 29, 69, 70, 54, 53,
        36, 34, 62, 77, 87, 39, 96, 56, 92, 16, 82, 40, 27, 58, 14, 68, 76, 80, 13, 28, 81, 64, 26, 19, 60, 90, 2, 98,
        67, 66, 52, 46, 95, 49, 72, 8, 21, 75, 57, 97, 83, 84, 88, 86, 7, 74, 32, 63, 85, 23, 65, 24, 91, 0, 48, 35, 15,
        44, 25, 22, 73, 93, 45, 4, 33, 89, 94, 10, 42, 11, 50,
      ],
    },
    {
      id: "8 elements",
      count: 8,
      seed: oldSeed.toString("hex"),
      expected: [6, 3, 4, 0, 1, 5, 7, 2],
    },
    {
      id: "16 elements",
      count: 16,
      seed: oldSeed.toString("hex"),
      expected: [8, 4, 11, 7, 10, 6, 0, 3, 15, 12, 5, 14, 1, 9, 13, 2],
    },
  ];

  const seed = new Uint8Array(Buffer.alloc(32));
  seed.set([42, 32], 0);
  // const seed = new Uint8Array([42, 32]);

  it.each(testCases)("$id", async ({count, seed, expected}) => {
    const result = await asyncUnshuffleList(
      Uint32Array.from(Array.from({length: count}, (_, i) => i)),
      fromHex(seed),
      10
    );
    expect(Buffer.from(result).toString("hex")).toEqual(Buffer.from(expected).toString("hex"));
  });
});
