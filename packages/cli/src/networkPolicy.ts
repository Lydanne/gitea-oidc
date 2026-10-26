import { isIP } from "node:net";

const parseIpv4 = (address: string): number | undefined => {
  if (isIP(address) !== 4) {
    return undefined;
  }
  return address
    .split(".")
    .map(Number)
    .reduce((value, octet) => (value * 256 + octet) >>> 0, 0);
};

const isInIpv4Range = (address: number, base: number, prefixLength: number): boolean => {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (address & mask) >>> 0 === (base & mask) >>> 0;
};

const PRIVATE_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const parseIpv6Words = (address: string): number[] | undefined => {
  if (isIP(address) !== 6) {
    return undefined;
  }

  const expandPart = (part: string): number[] => {
    if (!part) {
      return [];
    }
    return part.split(":").flatMap((word) => {
      if (!word.includes(".")) {
        return [Number.parseInt(word, 16)];
      }
      const ipv4 = parseIpv4(word);
      return ipv4 === undefined ? [] : [ipv4 >>> 16, ipv4 & 0xffff];
    });
  };

  const separator = address.indexOf("::");
  if (separator < 0) {
    const words = expandPart(address);
    return words.length === 8 ? words : undefined;
  }
  const left = expandPart(address.slice(0, separator));
  const right = expandPart(address.slice(separator + 2));
  const missing = 8 - left.length - right.length;
  if (missing < 1) {
    return undefined;
  }
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
};

const hasIpv6Prefix = (words: number[], prefix: number[], prefixLength: number): boolean => {
  const completeWords = Math.floor(prefixLength / 16);
  for (let index = 0; index < completeWords; index += 1) {
    if (words[index] !== prefix[index]) {
      return false;
    }
  }
  const remainder = prefixLength % 16;
  if (remainder === 0) {
    return true;
  }
  const mask = (0xffff << (16 - remainder)) & 0xffff;
  return (words[completeWords] & mask) === (prefix[completeWords] & mask);
};

export const isPublicIpAddress = (address: string): boolean => {
  const ipv4 = parseIpv4(address);
  if (ipv4 !== undefined) {
    return !PRIVATE_IPV4_RANGES.some(([base, prefixLength]) =>
      isInIpv4Range(ipv4, parseIpv4(base) ?? 0, prefixLength),
    );
  }

  const ipv6 = parseIpv6Words(address);
  if (!ipv6) {
    return false;
  }

  const isIpv4Mapped = ipv6.slice(0, 5).every((word) => word === 0) && ipv6[5] === 0xffff;
  if (isIpv4Mapped) {
    return isPublicIpAddress(
      `${ipv6[6] >>> 8}.${ipv6[6] & 0xff}.${ipv6[7] >>> 8}.${ipv6[7] & 0xff}`,
    );
  }

  if (!hasIpv6Prefix(ipv6, [0x2000], 3)) {
    return false;
  }

  const specialPurposeRanges = [
    [[0x2001, 0x0000], 23],
    [[0x2001, 0x0002, 0x0000], 48],
    [[0x2001, 0x0db8], 32],
    [[0x2002], 16],
    [[0x3fff, 0x0000], 20],
  ] as const;
  return !specialPurposeRanges.some(([prefix, prefixLength]) =>
    hasIpv6Prefix(ipv6, [...prefix], prefixLength),
  );
};
