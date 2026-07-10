import { describe, expect, it } from "vitest";
import { isPublicIpAddress } from "../networkPolicy.js";

describe("doctor network policy", () => {
  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "::ffff:93.184.216.34",
  ])("accepts public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it.each([
    "not-an-ip",
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
  ])("rejects private or special-purpose address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });
});
